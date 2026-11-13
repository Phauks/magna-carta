import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import {
  inferenceDedupStatements,
  tokenUsageCommitStatements,
} from "@magna-carta/data-access/token-usage-statements";
import type {
  FileId,
  FirmId,
  MagnusConversationId,
  MagnusTurnId,
  UserId,
} from "@magna-carta/identifiers/types";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { catalogEntryFor } from "@magna-carta/inference/catalog";
import {
  extractDocuments,
  layOutCurrentDocuments,
  readCurrentDocuments,
  titleKey,
  writeDocuments,
} from "@magna-carta/magnus/artifact";
import { MAGNUS_SYSTEM_PROMPT } from "@magna-carta/magnus/system-prompt";
import {
  markAttachmentTextStatement,
  readConversation,
  readRecentTurns,
  readTurn,
} from "@magna-carta/magnus/statements";
import { completeTurn, settleTurnFailure } from "@magna-carta/magnus/turn";
import {
  listConversationPermissions,
  readEarlierConversations,
} from "@magna-carta/magnus/permissions";
import type { MagnusWriteContext } from "@magna-carta/magnus/audit";
import type { AttachmentTextStatus, TurnFailureLabel } from "@magna-carta/magnus/types";
import {
  buildConversationWindow,
  WINDOW_MAX_TURNS,
  type WindowAttachmentOutcome,
} from "@magna-carta/magnus/window";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../../bindings.ts";
import { firmDatabaseFor } from "../../firm-database/firm-database-proxy.ts";
import { firmRateGate, tokenUsageKeyForDay } from "../inference/inference-consumer.ts";
import { resolveReasoningModel } from "../../inference/call-site.ts";
import {
  resolveAttachmentTextReader,
  windowAttachmentsFrom,
  type AttachmentTextReader,
  type ReadAttachment,
} from "../../magnus/attachment-text.ts";
import { resolveMagnusFirmGates } from "../../magnus/consent.ts";
import { resolveMagnusInferencePort } from "../../magnus/inference-port-binding.ts";
import type { MagnusTurnJob } from "../../magnus/magnus-types.ts";
import { modelChoiceForRun } from "../../magnus/model-choice.ts";

// The assistant's work happens HERE, off the request path, because a single firm running long
// generations synchronously on the hot path consumes shared gateway capacity every other firm is
// waiting for, with no place to apply back-pressure. The request returns a pending turn; this
// consumer settles it and the transport pushes the transition.
//
// Nothing in this module logs a prompt, a completion, or an upstream body. A failure logs the turn
// identifier, the correlation identifier, and the problem category, and nothing else — the words a
// member typed are presumptively privileged before any answer exists.

// The per-run dedup record key, namespaced off the outbox row's identifier so it cannot collide with
// any other idempotency-record family in the firm database.
export function magnusTurnDedupKey(outboxId: string): string {
  return `magnus:${outboxId}`;
}

// How many prior turns are read to build the request window. Comfortably more than the window's own
// turn cap, because turns with no content — the pending answer this job is settling, and any earlier
// failed one — take a row without taking a window slot. When the read comes back FULL the builder is
// told, so a window that fits its caps exactly is still reported as truncated rather than passing for
// a whole conversation. Still a bounded read: there is no path here that reads a whole conversation.
const WINDOW_READ_LIMIT = WINDOW_MAX_TURNS * 2 + 1;

function writeContext(): MagnusWriteContext {
  return {
    clock: { now: () => new Date().toISOString() },
    // A settled turn is the platform acting on the member's submission, not a member acting. The
    // member's own act is already audited at submission.
    actorUserId: null,
  };
}

// Settle the turn as failed or refused, audit it, and push the transition. Terminal: nothing retries
// after this, because nothing about retrying changes a closed gate or an over-cap answer.
async function settleFailure(
  env: Bindings,
  job: MagnusTurnJob,
  failureLabel: TurnFailureLabel,
  status: "failed" | "refused",
  modelId: string | null,
): Promise<void> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, job.firmId);
  await commitEffectBatch(
    firmDatabase,
    settleTurnFailure(firmDatabase, writeContext(), {
      conversationId: job.conversationId as MagnusConversationId,
      magnusTurnId: job.magnusTurnId as MagnusTurnId,
      status,
      failureLabel,
      modelId,
    }),
    { now: () => new Date().toISOString() },
  );
  await broadcast(env, job);
}

async function broadcast(env: Bindings, job: MagnusTurnJob): Promise<void> {
  const conversation = env.MAGNUS_CONVERSATION.get(
    env.MAGNUS_CONVERSATION.idFromName(`${job.firmId}:${job.conversationId}`),
  );
  await conversation.notifyTurnTransition();
}

// What the attachment rows are told after a question: whole, cut, or nothing. A file the reader
// could not read at all is `unreadable`; one that read but did not fit is `cut`; one that read but
// got no room because the files before it spent the budget is `unreadable` too, from the member's
// side — nothing of it reached the model — and the surface's sentence says why per status.
function attachmentStatuses(
  read: readonly ReadAttachment[],
  outcomes: readonly WindowAttachmentOutcome[],
): readonly { fileId: string; status: AttachmentTextStatus; bytes: number | null }[] {
  return read.map((attachment) => {
    const outcome = outcomes.find((candidate) => candidate.fileId === attachment.fileId);
    if (outcome === undefined || outcome.sent === "none") {
      return { fileId: attachment.fileId, status: "unreadable", bytes: null };
    }
    return {
      fileId: attachment.fileId,
      status: outcome.sent === "whole" ? "sent" : "cut",
      bytes: outcome.bytes,
    };
  });
}

export interface MagnusConsumerPorts {
  // The reader of attached files' text. Injectable because the production reader reaches the firm's
  // bucket and the extraction engines, neither of which a unit of the consumer's own logic needs.
  readonly attachments?: AttachmentTextReader;
}

// The author's own other conversations on the same matter, when the author turned that permission on
// for this conversation and the conversation is kept on a matter. Anything else reads nothing.
async function readPermittedEarlierConversations(
  firmDatabase: ReturnType<typeof firmDatabaseFor>,
  conversationId: MagnusConversationId,
) {
  const permissions = await listConversationPermissions(firmDatabase, conversationId);
  if (!permissions.includes("own-matter-conversations")) return [];
  const conversation = await readConversation(firmDatabase, conversationId);
  if (conversation === undefined || conversation.matterId === null) return [];
  return readEarlierConversations(firmDatabase, {
    matterId: conversation.matterId,
    authorUserId: conversation.createdBy,
    excludeConversationId: conversationId,
  });
}

// The member a document is written for: the conversation's author, who is the one who asks in it.
async function conversationAuthor(
  firmDatabase: ReturnType<typeof firmDatabaseFor>,
  conversationId: string,
): Promise<UserId> {
  const conversation = await readConversation(firmDatabase, conversationId as MagnusConversationId);
  if (conversation === undefined) throw new Error("magnus conversation missing at settle");
  return conversation.createdBy;
}

export async function handleMagnusTurnJob(
  env: Bindings,
  job: MagnusTurnJob,
  ports: MagnusConsumerPorts = {},
): Promise<void> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, job.firmId);

  // The re-bill stop, first half: a redelivery that finds the turn already settled returns BEFORE the
  // model call, so the spend never repeats. (The second half is the dedup record in the commit batch
  // below, which loses the UNIQUE(key) race and rolls the whole batch back.)
  const pending = await readTurn(firmDatabase, job.magnusTurnId as MagnusTurnId);
  if (pending === undefined || pending.status !== "pending") return;

  // The gates are re-read here, not trusted from submission. A firm that switched the assistant off
  // between the two must not have queued turns continue to reach a provider — and the refusal is a
  // recorded, labelled turn rather than a silent drop, so the member learns what happened.
  if ((await resolveMagnusFirmGates(firmDatabase)) !== "open") {
    await settleFailure(env, job, "not-eligible", "refused", null);
    return;
  }

  // The shipped per-firm back-pressure seam, unchanged.
  firmRateGate(job.firmId);

  // The model the member chose in the composer, or the firm's own reasoning model, read through the
  // firm-scoped data-access layer. No model id is a constant anywhere in this subsystem. The choice is
  // checked against the catalog again here (./model-choice.ts says why).
  const { modelId, effort } = modelChoiceForRun(await resolveReasoningModel(firmDatabase), {
    modelId: job.modelId,
    effort: job.effort,
  });

  const priorTurns = await readRecentTurns(
    firmDatabase,
    job.conversationId as MagnusConversationId,
    WINDOW_READ_LIMIT,
  );
  // The attached files' readable text, read fresh for this question and kept nowhere else. It rides
  // the newest member turn under its own budget (packages/magnus/src/window.ts says how).
  const attachmentReader =
    ports.attachments ?? resolveAttachmentTextReader(env, job.firmId, firmDatabase);
  const readAttachments = await attachmentReader.readAll(
    job.conversationId as MagnusConversationId,
  );
  // The author's own other conversations on the matter, only where the author turned that on for
  // this conversation, and read fresh for this question like the files.
  const earlierConversations = await readPermittedEarlierConversations(
    firmDatabase,
    job.conversationId as MagnusConversationId,
  );
  // The documents Magnus already wrote here, each at its latest version, so a revision starts from
  // what the document is now (packages/magnus/src/artifact.ts).
  const currentDocuments = await readCurrentDocuments(
    firmDatabase,
    job.conversationId as MagnusConversationId,
  );
  const window = buildConversationWindow(priorTurns, {
    readWasCapped: priorTurns.length >= WINDOW_READ_LIMIT,
    attachments: windowAttachmentsFrom(readAttachments),
    earlierConversations,
    documents: layOutCurrentDocuments(currentDocuments),
  });
  if (window.messages.length === 0) {
    // Nothing to answer — the member turn this job refers to is gone (a deleted conversation racing
    // the queue). Settle rather than dispatch a meaningless request.
    await settleFailure(env, job, "cancelled", "refused", null);
    return;
  }

  const port = resolveMagnusInferencePort(env);
  const result = await port.generateConversation({
    modelId,
    firmId: job.firmId as FirmId,
    // Platform-authored and structurally separate from the conversation: a member cannot occupy this
    // field by typing, because there is no path from a message into it.
    systemPrompt: MAGNUS_SYSTEM_PROMPT,
    messages: window.messages,
    ...(effort !== null && { effort }),
  });

  if (!result.ok) {
    // A retryable problem (transient gateway overload, a timeout) throws so the queue redelivers and
    // dead-letters at max attempts. A terminal problem — the fail-closed eligibility refusal,
    // capability-unsupported — settles the turn with its closed label and acks: a retry loop cannot
    // fix an eligibility refusal and would burn attempts on an unrecoverable state.
    if (result.problem?.retryable === true) {
      throw new Error(`magnus adapter-error (${result.problem.category})`);
    }
    const label: TurnFailureLabel =
      result.problem?.category === "validation" ? "not-eligible" : "model-unavailable";
    await settleFailure(env, job, label, label === "not-eligible" ? "refused" : "failed", modelId);
    return;
  }

  const entry = catalogEntryFor(modelId);
  const slot = entry?.slot ?? "reasoning";
  // One timestamp for the whole batch, so the metering bucket day and the dedup row are provably
  // consistent — no latent UTC-midnight split between reading the day and writing the rows.
  const nowIso = new Date().toISOString();
  const context: MagnusWriteContext = { clock: { now: () => nowIso }, actorUserId: null };

  // The documents in the answer are kept as versions of the conversation's documents; the answer
  // keeps Magnus's own words, and the transcript shows a card for each document it wrote.
  const extracted = extractDocuments(result.value.text);
  const documentWrites =
    extracted.documents.length === 0
      ? []
      : writeDocuments(firmDatabase, context, {
          conversationId: job.conversationId as MagnusConversationId,
          magnusTurnId: job.magnusTurnId as MagnusTurnId,
          memberUserId: await conversationAuthor(firmDatabase, job.conversationId),
          documents: extracted.documents,
          existing: new Map(
            currentDocuments.map((document) => [titleKey(document.title), document.id]),
          ),
          newArtifactId: () => newIdentifier("magnusArtifact"),
        });

  const completion = completeTurn(firmDatabase, context, {
    conversationId: job.conversationId as MagnusConversationId,
    magnusTurnId: job.magnusTurnId as MagnusTurnId,
    content: extracted.prose,
    modelId,
    snapshotId: result.value.snapshotId,
    inputTokens: result.value.usage.inputTokens,
    outputTokens: result.value.usage.outputTokens,
    // Carried onto the turn so the member is told the answer was built on part of the conversation —
    // on this read and on every later one. Silent truncation is what produces a confidently wrong
    // answer built on a premise the member believes was in scope.
    contextTruncated: window.truncated,
    effort,
  });
  if (!completion.ok) {
    await settleFailure(env, job, completion.failureLabel, "failed", modelId);
    return;
  }

  // One atomic batch: the turn's completion and its audit row, the authoritative token meter captured
  // from the RESPONSE (never gateway logs), and the dedup record whose UNIQUE(key) is the re-meter
  // stop. The assistant creates no usage table of its own — it bills in tokens through the same
  // gateway as every other inference call, so it writes the same shipped meter.
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [
        ...completion.effect.statements,
        ...documentWrites,
        // What became of each attachment's text, recorded beside the answer it was sent with, so the
        // conversation can say per file whether the model saw it.
        ...attachmentStatuses(readAttachments, window.attachments).map((attachment) =>
          markAttachmentTextStatement(firmDatabase, {
            conversationId: job.conversationId as MagnusConversationId,
            fileId: attachment.fileId as FileId,
            textStatus: attachment.status,
            textBytes: attachment.bytes,
          }),
        ),
        ...tokenUsageCommitStatements(
          firmDatabase,
          tokenUsageKeyForDay(nowIso, slot, modelId),
          result.value.usage.inputTokens,
          result.value.usage.outputTokens,
        ),
        ...inferenceDedupStatements(firmDatabase, magnusTurnDedupKey(job.outboxId), nowIso),
      ],
      outboxMessages: [],
    },
    { now: () => nowIso },
  );

  await broadcast(env, job);
}

// The queue() handler: one message at a time, ack on success, retry on a transient throw.
export async function magnusQueue(
  batch: MessageBatch<MagnusTurnJob>,
  env: Bindings,
): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    try {
      await handleMagnusTurnJob(env, message.body);
      message.ack();
    } catch (error) {
      // The turn identifier and the problem category, through the one standard pipeline. Never the
      // prompt, never the completion, never an upstream body.
      logOperationFailed(
        logger,
        `queue:magnus:${message.body.magnusTurnId}`,
        error,
        newCorrelationId(),
      );
      message.retry();
    }
  }
}
