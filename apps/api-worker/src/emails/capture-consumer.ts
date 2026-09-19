import { ensureReady, parseMessage } from "@magna-carta/email";
import type { EffectStatement } from "@magna-carta/data-access/effect-batch";
import emailWasmModule from "@magna-carta/email/src/pkg/email_core_bg.wasm";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import {
  insertEmailAutoFileDecisionStatement,
  suspendEmailAutoFileRule,
  type AutoFileDecisionOutcome,
  type AutoFileDecisionSuppressionReason,
} from "@magna-carta/data-access/email-auto-file-statements";
import {
  captureIdempotencyKey,
  findByDedupKey,
  findCaptureAddressByToken,
  findThreadIdsByMessageIds,
  insertEmailMatterLinkStatement,
  insertEmailMessageStatement,
  insertEmailParticipantStatement,
  insertEmailThreadStatement,
  readEmailMatterLinksForMessage,
  touchEmailMessageStatement,
} from "@magna-carta/data-access/email-filing-statements";
import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { OutboxMessage } from "@magna-carta/data-access/outbox-statements";
import type { AutoFileDecision } from "@magna-carta/email-filing/auto-file-rules";
import {
  captureEmail,
  type CapturePorts,
  type CaptureWritePlan,
} from "@magna-carta/email-filing/capture";
import { verifyDkim } from "@magna-carta/email-filing/dkim";
import { findEntitiesByEmailAddresses } from "@magna-carta/directory/contact-email";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  EmailAutoFileRuleId,
  EmailMessageId,
  EmailThreadId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import { firmScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Bindings } from "../bindings.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { extractAndFileAttachments } from "./attachment-extraction.ts";
import { createAutoFileDecisionPort } from "./auto-file-evaluation.ts";
import { createDkimKeyLookup } from "./dkim-dns-resolver.ts";
import { EMAIL_FILED_TOPIC } from "@magna-carta/email-filing/topics";

const emailWasm = emailWasmModule as unknown as WebAssembly.Module;

// The capture-address token store lives per-firm; this consumer is the one convergence point both
// entrances (the forward/CC Email Worker and the authenticated file-to-matter API) enqueue into. The
// entrance stages the raw MIME to R2 and posts this pointer; the heavy work — parse, hash, dedup,
// thread-link, attachment extraction — runs here, off the request hot path.
export interface EmailsCaptureMessage {
  readonly firmId: string;
  readonly bucketName: string | null;
  readonly stagedR2Key: string; // where the entrance staged the raw MIME
  // Which entrance recorded the capture. `forward` is the Email Worker; `api` and `addin` both post to
  // the authenticated file-to-matter endpoint and are told apart because only an add-in capture
  // carries the original message intact.
  readonly capturedVia: "forward" | "api" | "addin";
  readonly matterId: string | null; // a candidate matter already resolved by the entrance (the API path)
  // The forward/CC token, when the entrance could not resolve a matter itself (the Email Worker has no
  // per-firm database handle). The consumer resolves it against the firm's capture-address store.
  readonly captureToken: string | null;
  readonly linkedBy: string | null;
  readonly acceptOnCapture: boolean;
  readonly jobId: string; // idempotency key: capture:<jobId>
}

// Process one capture job. Acks (returns) on every terminal outcome; THROWS only on a transient
// condition (the staged object not yet readable) so the queue retries and, at max attempts,
// dead-letters — mirroring the files-ingest consumer.
export async function handleCaptureMessage(
  env: Bindings,
  message: EmailsCaptureMessage,
  logger: Logger = createWorkersLogger(env.TELEMETRY),
  correlationId: string = newCorrelationId(),
): Promise<void> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  // The staged MIME, the verbatim original written below, and the staged pointer dropped at the end
  // are all this firm's bytes, so they resolve through the one bucket seam rather than the binding —
  // the same handle attachment extraction is handed on the message below.
  const { bucket } = resolveFirmBucket(env, message.bucketName);

  const staged = await bucket.get(message.stagedR2Key);
  if (staged === null) {
    // Not yet readable — a transient window between the entrance's PUT and this delivery. Retry.
    throw new Error(`emails-capture: staged object not readable: ${message.stagedR2Key}`);
  }
  const bytes = new Uint8Array(await staged.arrayBuffer());

  // Resolve the forward/CC token to a candidate matter here, where the firm database handle exists. A
  // per-matter token proposes its matter; a firm catch-all (or an unknown token) lands unrouted — the
  // message is captured to the firm with no matter link, for staff to route.
  let candidateMatterId = message.matterId;
  if (candidateMatterId === null && message.captureToken !== null) {
    const resolution = await findCaptureAddressByToken(firmDatabase, message.captureToken);
    candidateMatterId = resolution?.matterId ?? null;
  }

  const now = (): string => new Date().toISOString();

  const ports: CapturePorts = {
    parse: async (input) => {
      await ensureReady(emailWasm);
      return parseMessage(input);
    },
    persistOriginal: async (input) => {
      const digest = await crypto.subtle.digest("SHA-256", input);
      const contentSha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      // Content-addressed key: re-capturing the same bytes overwrites the identical object, so the
      // verbatim-original write is idempotent at the blob layer.
      const originalR2Key = `emails/${contentSha256}/original`;
      // The verbatim original is keyed by its own hash, so ONE object can be the original behind
      // filings on several matters — the same message forwarded into two matters writes here once.
      // It therefore carries no matter, because there is no single true answer, and the matters it
      // was filed onto are recorded as links in the firm's database where several of them fit.
      await bucket.put(originalR2Key, input, {
        customMetadata: firmScopedObjectDimensions("email-original"),
      });
      return { originalR2Key, contentSha256 };
    },
    findByDedupKey: (key) => findByDedupKey(firmDatabase, key),
    findThreadIdsByMessageIds: (values) => findThreadIdsByMessageIds(firmDatabase, values),
    // ONE QUERY FOR EVERY PARTICIPANT, not one per address. The address set comes from the parsed
    // message's from/to/cc/bcc, so it is bounded by the message rather than by anything this platform
    // chose — a message with two hundred recipients would otherwise be two hundred sequential reads
    // against the per-firm database inside a single queue-consumer invocation. The email-address index
    // is already what is being seeked; asking it once is the same work without the round trips.
    resolveDirectoryEntities: async (addresses) => {
      const matchesByAddress = await findEntitiesByEmailAddresses(firmDatabase, addresses);
      const resolved = new Map<string, string>();
      for (const [address, matches] of matchesByAddress) {
        const first = matches[0];
        if (first !== undefined) resolved.set(address, first.entityId);
      }
      return resolved;
    },
    // Signature adjudication runs here, in the consumer, because it needs a DNS round trip — off the
    // request path by construction. It is informational: a verdict never gates the capture, and the
    // capture core records an honest "unverified" if this port is unavailable or throws.
    verifyDkim: (input) =>
      verifyDkim(input, { lookupKeyRecords: createDkimKeyLookup(env.DKIM_RESOLVER_URL) }),
    // Auto-file evaluation runs here for the same reason signature adjudication does: it is several
    // per-firm reads, and the capture consumer is already off the request path. The capture route
    // does not grow a rules pass — it stages bytes and enqueues, exactly as before.
    resolveAutoFileDecision: createAutoFileDecisionPort({ firmDatabase, now }),
    newEmailMessageId: () => newIdentifier("emailMessage"),
    newEmailThreadId: () => newIdentifier("emailThread"),
    newEmailParticipantId: () => newIdentifier("emailParticipant"),
    newEmailMatterLinkId: () => newIdentifier("emailMatterLink"),
    now,
    writeCapture: async (plan: CaptureWritePlan) => {
      const timestamp = now();
      const statements: EffectStatement[] = [];
      if (plan.thread !== null) {
        statements.push(
          insertEmailThreadStatement(
            firmDatabase,
            {
              id: plan.thread.id,
              subjectNormalized: plan.thread.subjectNormalized,
              firstSeenAt: plan.thread.firstSeenAt,
            },
            timestamp,
          ),
        );
      }
      if (plan.message !== null) {
        statements.push(insertEmailMessageStatement(firmDatabase, plan.message, timestamp));
        for (const participant of plan.participants) {
          statements.push(insertEmailParticipantStatement(firmDatabase, participant, timestamp));
        }
      }
      if (plan.touchMessageId !== null) {
        statements.push(touchEmailMessageStatement(firmDatabase, plan.touchMessageId, timestamp));
      }
      if (plan.link !== null) {
        statements.push(insertEmailMatterLinkStatement(firmDatabase, plan.link, timestamp));
      }
      // Everything the rules did rides THIS batch — the ledger row, the audit row, and the circuit
      // breaker's suspension — beside the link they describe. A separate write would leave a window
      // in which the ledger claims a filing that rolled back, and would need an idempotency story of
      // its own; here a redelivery replays the recorded decision instead of deciding again.
      statements.push(...autoFileStatements(firmDatabase, plan, timestamp));
      // "An email reached this matter" — the notification's emission point, and a row in this same
      // batch rather than a call afterwards, so it exists exactly when the filing does and rolls back
      // with it. An automatic filing announces itself exactly as an accepted one does: the firm is
      // told mail landed on the matter without having to go looking.
      //
      // Written only when a filing actually happens. The link insert is ON CONFLICT DO NOTHING, so a
      // second filer forwarding a message this matter already holds changes nothing, and a claim that
      // it just arrived would be false. A brand-new message cannot already carry a link, which is why
      // only the dedup path pays the read.
      const outboxMessages: OutboxMessage[] = [];
      const filedLink = plan.link !== null && plan.link.state === "filed" ? plan.link : null;
      if (filedLink !== null) {
        const alreadyOnThisMatter =
          plan.dedupState === "existing" &&
          (await readEmailMatterLinksForMessage(firmDatabase, plan.emailMessageId)).some(
            (existing) => existing.matterId === filedLink.matterId,
          );
        if (!alreadyOnThisMatter) {
          outboxMessages.push({
            topic: EMAIL_FILED_TOPIC,
            // Two identifiers. No subject, no address, no participant list — what a reader needs
            // resolves behind the deep link through email filing's own access-checked read.
            payload: { emailMessageId: plan.emailMessageId, matterId: filedLink.matterId },
          });
        }
      }
      // One atomic batch: the capture writes + the idempotency record, keyed on the capture job id.
      // A redelivery replays without re-writing; a concurrent same-message capture that loses the
      // dedup_key race rolls back wholesale and re-runs, converging on the one record.
      //
      // The record carries the outcome, not just the fact of completion: the entrance handed the
      // client a job id and nothing else, and this is what turns that id back into "it landed on this
      // matter as filed" when the client asks (readCaptureOutcome reads exactly this body). It rides
      // the SAME batch as the writes it describes, so a body can never claim a capture that rolled
      // back. Identifiers and enums only — an idempotency body is read by more paths than the message
      // row, so no subject, no address, no content goes in it.
      const outcome = await runIdempotentEffect({
        database: firmDatabase,
        key: captureIdempotencyKey(message.jobId),
        fingerprint: message.jobId,
        effect: async () => ({
          write: { statements, outboxMessages },
          responseCode: 200,
          responseBody: canonicalJsonStringify({
            emailMessageId: plan.emailMessageId,
            threadId: plan.threadId,
            matterId: plan.link?.matterId ?? null,
            linkState: plan.link?.state ?? "none",
            deduplicated: plan.dedupState === "existing",
          }),
        }),
      });
      if (outcome.kind === "fingerprint-mismatch") {
        throw new Error(
          `emails-capture: idempotency fingerprint mismatch for job ${message.jobId}`,
        );
      }
    },
  };

  let result;
  try {
    result = await captureEmail(
      {
        bytes,
        firmId: message.firmId,
        capturedVia: message.capturedVia,
        matterId: candidateMatterId === null ? null : (candidateMatterId as MatterId),
        linkedBy: message.linkedBy === null ? null : (message.linkedBy as UserId),
        acceptOnCapture: message.acceptOnCapture,
      },
      ports,
    );
  } catch (caught) {
    logOperationFailed(logger, "emails.capture", caught, correlationId);
    throw caught; // transient/unknown → retry; a poison message dead-letters at max attempts
  }

  // Extract real attachments into the File Manager (self-guards on existing rows so a redelivery or a
  // second filer never double-files). Bytes ride the existing ingest/quarantine chokepoint.
  //
  // The matter comes from the capture's RESULT, not from the entrance's candidate: where a rule chose
  // the matter, the message's attachments belong on the same one. Reading the candidate here would
  // leave an automatically-filed message on a matter whose file list did not hold its attachments.
  await extractAndFileAttachments(env, firmDatabase, {
    emailMessageId: result.emailMessageId,
    matterId: result.matterId,
    bucketName: message.bucketName,
    parsed: result.parsed,
    rawBytes: bytes,
    uploadedBy: message.linkedBy === null ? null : (message.linkedBy as UserId),
    correlationId,
    logger,
  });

  // The staged pointer is transient — the verbatim original now lives under its content-addressed key.
  await bucket.delete(message.stagedR2Key);
}

// What the rules did, as rows: the evaluation ledger entry, the audit row, and — where a rule has
// been firing far more often than a person would, or its recent filings keep being undone — the
// suspension that takes it out of service.
//
// Nothing is written for a capture no rule looked at. That is the property that keeps this table
// proportional to rule activity rather than to the firm's mail volume, and it is why a firm with no
// rules pays two indexed lookups per capture and no writes.
//
// IDENTIFIERS AND ENUMS ONLY, in the ledger row and in the audit metadata alike. The plain-language
// sentences a person reads are rendered from these enums at read time, the way the suggestion
// machinery renders its reasons — no subject, no address, no display name reaches either row.
function autoFileStatements(
  database: ReturnType<typeof firmDatabaseFor>,
  plan: CaptureWritePlan,
  now: string,
): EffectStatement[] {
  const decision: AutoFileDecision | null = plan.autoFileDecision;
  if (decision === null) return [];
  if (decision.outcome === "noRule" && decision.suppressionReason === null) return [];

  // The outcome is read off the LINK that was actually written, not off what the decision asked for:
  // the capture core re-checks the conflict hook before it commits, so a decision of `file` can still
  // land staged, and a ledger that recorded the request rather than the result would misexplain it.
  const outcome: AutoFileDecisionOutcome =
    decision.outcome === "noRule"
      ? "suppressed"
      : plan.link?.state === "filed"
        ? "filed"
        : "staged";
  const clock = { now: () => now };

  const statements: EffectStatement[] = [
    insertEmailAutoFileDecisionStatement(
      database,
      {
        id: newIdentifier("emailAutoFileDecision"),
        emailMessageId: plan.emailMessageId,
        autoFileRuleId: decision.ruleId as EmailAutoFileRuleId | null,
        matterId: decision.matterId as MatterId | null,
        outcome,
        suppressionReason:
          outcome === "suppressed"
            ? (decision.suppressionReason as AutoFileDecisionSuppressionReason | null)
            : null,
        evidence: {
          decision: decision.outcome,
          demotionReason: decision.demotionReason,
          suppressionReason: decision.suppressionReason,
          suspensionReason: decision.suspension?.reason ?? null,
        },
      },
      now,
    ),
  ];

  if (outcome !== "suppressed" && plan.link !== null) {
    statements.push(
      domainAuditStatement(database, {
        event: outcome === "filed" ? "emails.autoFiled" : "emails.autoFileStaged",
        subjectId: plan.emailMessageId,
        // No actor: nobody was present. The delegating member is on the rule row, which the metadata
        // names, so the trail still terminates in a person's decision without pretending they made
        // this one.
        actorUserId: null,
        clock,
        metadata: { matterId: plan.link.matterId, ruleId: plan.link.autoFileRuleId },
      }),
    );
  }

  if (decision.suspension !== null) {
    statements.push(
      ...suspendEmailAutoFileRule(
        database,
        {
          id: decision.suspension.ruleId as EmailAutoFileRuleId,
          reason: decision.suspension.reason,
        },
        { clock, actorUserId: null },
      ).statements,
    );
  }

  return statements;
}

// The emails-capture queue consumer: one job per message. Ack on success, retry on throw.
export async function emailsCaptureQueue(
  batch: MessageBatch<EmailsCaptureMessage>,
  env: Bindings,
): Promise<void> {
  const logger = createWorkersLogger(env.TELEMETRY);
  for (const message of batch.messages) {
    try {
      await handleCaptureMessage(env, message.body, logger);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
