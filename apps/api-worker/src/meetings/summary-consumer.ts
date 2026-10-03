import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type EffectStatement,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { tokenUsageCommitStatements } from "@magna-carta/data-access/token-usage-statements";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import {
  catalogEntryFor,
  isOnCloudflareModel,
  onCloudflareReasoningEntry,
} from "@magna-carta/inference/catalog";
import type { InferencePort, TokenUsage } from "@magna-carta/inference/port";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import { summariesEnabledDefinition } from "@magna-carta/meetings/settings";
import {
  parseSummaryAnswer,
  readSummaryAnswer,
  type SummaryParticipant,
} from "@magna-carta/meetings/summary-parse";
import {
  SUMMARY_ANSWER_MAXIMUM_TOKENS,
  SUMMARY_COMBINE_SYSTEM_PROMPT,
  SUMMARY_PART_ANSWER_MAXIMUM_TOKENS,
  SUMMARY_PART_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  splitTranscriptIntoParts,
  summaryCombineMessage,
  summaryPartByteBudget,
  summaryTranscriptMessage,
  transcriptLine,
} from "@magna-carta/meetings/summary-prompt";
import {
  claimSummaryEffect,
  failSummaryEffect,
  readySummaryStatements,
  refuseSummaryEffect,
  SUMMARY_CLAIM_GUARD,
  SUMMARY_FAIL_GUARD,
  SUMMARY_MODEL_FAILURE_GUARD,
  SUMMARY_READY_GUARD,
  SUMMARY_REFUSE_GUARD,
  summaryModelFailureEffect,
} from "@magna-carta/meetings/summary-service";
import {
  readSummaryById,
  releaseSummaryClaimStatement,
  type SummaryRunUsage,
} from "@magna-carta/meetings/summary-statements";
import type {
  MeetingSummaryRefusalReason,
  MeetingSummaryRow,
} from "@magna-carta/meetings/summary-types";
import {
  listTranscriptSegments,
  readTranscriptById,
} from "@magna-carta/meetings/transcript-statements";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { deploymentInferencePort, resolveChosenReasoningModel } from "../inference/call-site.ts";
import { tokenUsageKeyForDay } from "../inference/inference-consumer.ts";
import type { MeetingSummaryMessage } from "./meeting-recorder.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "./sfu/realtime-failure.ts";
import {
  TRANSCRIPT_MODEL_FAILURE_LIMIT,
  transcriptModelRetryDelaySeconds,
} from "./transcript-consumer.ts";

// THE SUMMARY OF A READY TRANSCRIPT: the transcript's lines rendered `HH:MM:SS Name: text`, sent to a
// reasoning model through the one model port with a platform-authored instruction, and the answer read
// into the summary's text and its ordered action items.
//
// ON THE RECORDING'S OWN QUEUE, as a third kind of message: the transcript's settle writes the pending
// summary in the batch that makes it ready and sends this message on the queue it is itself consumed from,
// so a deployment needs no new queue, consumer or binding to carry it (`event-dispatch.ts` routes by the
// message's `kind`).
//
// IT IS NOT AN ASSISTANT CONVERSATION. It reaches `InferencePort.generateConversation` — the same port the
// assistant reaches — with one member message, and writes nothing into the assistant's history: a
// conversation row would put a whole privileged transcript into a second store for a job that has no
// second turn. The two share the model seam and nothing else.
//
// WHICH MODEL, AND WHETHER AT ALL — read when the summary is run, never when it was begun, so a firm that
// switches something off in between is honoured:
//
//   - `meetings.summariesEnabled` off: REFUSED, `disabled`.
//   - the firm has not chosen a reasoning model: the catalog's model HOSTED ON CLOUDFLARE, so a privileged
//     conversation does not leave the platform unless the firm has said it may;
//   - the firm chose one hosted on Cloudflare: that one;
//   - the firm chose a third-party model: that one ONLY where its AI-processing eligibility allows content
//     to reach a third-party provider; otherwise REFUSED, `not-eligible` — the firm's own choice of model
//     is never swapped for another behind its back;
//   - a transcript with no speech: REFUSED, `transcript-empty`.
//
// A TRANSCRIPT TOO LONG FOR ONE CALL is summarized a part at a time and the parts combined, every call
// inside the one message — the bound on the parts and its arithmetic are in
// `@magna-carta/meetings/summary-prompt`, measured against the chosen model's context window from the
// catalog.
//
// EVERY CALL IS METERED. The provider's authoritative usage from each response is written to the firm's
// token meter in the batch that settles the run — ready, failed, or a model refusing for now — so tokens
// spent on a run that did not finish are counted as surely as a finished one's.
//
// A MODEL THAT REFUSES FOR NOW is outlasted exactly as the transcript's speech model is: the refusal is
// counted on the row in the write that lets go of the claim, the run is sent again on a NEW message after
// the transcript's own doubling delay, and the transcript's limit of refusals in a row fails it with an
// Error ID. An answer that is not the documented structure fails it at once — a model that answered badly
// is not a model that is down — and a member may run it again.
//
// THE TEXT IS DERIVED CONTENT. Nothing here logs a line of the transcript, a sentence of the answer, a
// name, or the instruction; every Error ID is recorded against a fixed sentence and a closed label.

/** How long a consumer's claim on a run holds: fifteen minutes, a consumer's longest run. */
export const SUMMARY_CLAIM_LEASE_MILLISECONDS = 15 * 60 * 1000;

/**
 * How many runs in a row may meet a model that refuses for now before the summary fails: the transcript's
 * own limit, with the transcript's own delays between them — the same outage, outlasted the same way.
 */
export const SUMMARY_MODEL_FAILURE_LIMIT = TRANSCRIPT_MODEL_FAILURE_LIMIT;

/** How many transcript lines are read at once while rendering them. */
const LINE_PAGE_SIZE = 500;

/** The conversation operation, which is all of the model port this consumer reaches. */
export type SummaryPort = Pick<InferencePort, "generateConversation">;

/** What one delivery may be given, for a test: its model port, and its lease. */
export interface SummaryOptions {
  readonly port?: SummaryPort;
  readonly claimLeaseMilliseconds?: number;
}

/** What one delivery did. */
export type SummaryOutcome =
  | "ready"
  | "refused"
  | "failed"
  | "retrying"
  | "claimed-elsewhere"
  | "nothing-to-do";

interface RunResult {
  readonly outcome: SummaryOutcome;
  readonly retryAfterSeconds?: number;
}

/** A run that cannot be finished, whatever is retried: failed with an Error ID. The message is fixed. */
class SummaryRefusedError extends Error {}

/** The model refused for now — busy or unreachable — so the run is worth another attempt. */
class SummaryUnavailableError extends Error {}

/** WHICH MODEL A FIRM'S SUMMARY IS WRITTEN BY, or why none is. */
export type SummaryModelDecision =
  | { readonly kind: "model"; readonly modelId: string }
  | {
      readonly kind: "refused";
      readonly reason: Exclude<MeetingSummaryRefusalReason, "transcript-empty">;
      readonly modelId: string | null;
    };

/**
 * THE GATE, read through the firm-scoped data-access layer — `meetings.summariesEnabled`, the firm's
 * chosen reasoning model, and its AI-processing eligibility, in that order.
 */
export async function resolveSummaryModel(database: SqlDatabase): Promise<SummaryModelDecision> {
  if (!(await readFirmSetting(database, summariesEnabledDefinition))) {
    return { kind: "refused", reason: "disabled", modelId: null };
  }
  const chosen = await resolveChosenReasoningModel(database);
  if (chosen === null) return { kind: "model", modelId: onCloudflareReasoningEntry().modelId };
  if (isOnCloudflareModel(chosen)) return { kind: "model", modelId: chosen };
  return (await readFirmSetting(database, aiProcessingEligibilityDefinition))
    ? { kind: "model", modelId: chosen }
    : { kind: "refused", reason: "not-eligible", modelId: chosen };
}

/** The queue consumer for the summary's messages: one run of one summary per message. */
export async function meetingSummaryQueue(
  batch: MessageBatch<MeetingSummaryMessage>,
  env: Bindings,
  options: SummaryOptions = {},
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const result = await runOf(env, message.body, options);
      if (result.retryAfterSeconds === undefined) {
        message.ack();
      } else {
        message.retry({ delaySeconds: result.retryAfterSeconds });
      }
    } catch (caught) {
      // Recorded through the standard pipeline and retried; a member's re-run sends a stranded one on.
      recordRealtimeFailure(realtimeLoggerFor(env), "meetings.summary", caught);
      message.retry({ delaySeconds: Math.min(60, 10 * message.attempts) });
    }
  }
}

/**
 * Writes one summary — or refuses or fails it in the record. Throws only for a fault worth the queue's
 * own retry.
 */
export async function summarizeMeeting(
  env: Bindings,
  message: MeetingSummaryMessage,
  options: SummaryOptions = {},
): Promise<SummaryOutcome> {
  return (await runOf(env, message, options)).outcome;
}

async function runOf(
  env: Bindings,
  message: MeetingSummaryMessage,
  options: SummaryOptions,
): Promise<RunResult> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const summary = await readSummaryById(database, message.summaryId);
  // Settled already — by an earlier delivery — or not this firm's.
  if (summary === undefined || summary.state !== "pending") return { outcome: "nothing-to-do" };

  const leaseMilliseconds = options.claimLeaseMilliseconds ?? SUMMARY_CLAIM_LEASE_MILLISECONDS;
  const claimedAt = new Date().toISOString();
  try {
    await commitEffectBatch(
      database,
      claimSummaryEffect(database, { summary, claimedAt, leaseMilliseconds }),
      { now: () => claimedAt },
    );
  } catch (caught) {
    if (caught instanceof GuardedWriteRefusedError && caught.guard === SUMMARY_CLAIM_GUARD) {
      return await refusedClaim(database, summary, leaseMilliseconds);
    }
    throw caught;
  }
  const run = new SummaryRun();
  try {
    return {
      outcome: await writeClaimedSummary(env, database, message, summary, claimedAt, run, options),
    };
  } catch (caught) {
    if (caught instanceof SummaryUnavailableError) {
      return await modelUnavailable(env, database, message, summary, claimedAt, run, caught);
    }
    if (!(caught instanceof SummaryRefusedError)) throw caught;
    // A RUN THAT CAN NEVER BE FINISHED: failed with an Error ID recorded against a fixed sentence and a
    // closed label — never a line, a sentence or a name — and the tokens it spent metered with it.
    const failureErrorId = recordRealtimeFailure(
      realtimeLoggerFor(env),
      "meetings.summary.refused",
      new Error(caught.message),
    );
    return {
      outcome: (await failClaimedSummary(database, summary, claimedAt, failureErrorId, run))
        ? "failed"
        : "nothing-to-do",
    };
  } finally {
    // Let go of the claim unless the settle or a refusal already did, so a fault the queue retries is
    // picked up by the retry at once rather than after the lease runs out.
    try {
      await commitEffectBatch(
        database,
        {
          statements: [releaseSummaryClaimStatement(database, { id: summary.id, claimedAt })],
          outboxMessages: [],
        },
        { now: () => new Date().toISOString() },
      );
    } catch (caught) {
      recordRealtimeFailure(realtimeLoggerFor(env), "meetings.summary.release", caught);
    }
  }
}

/**
 * WHY THE CLAIM WAS REFUSED, read back off the row: a run another consumer's LIVE lease holds is tried
 * again once that lease has run out; a summary that settled meanwhile has nothing left to do.
 */
async function refusedClaim(
  database: ProxyBatchDatabase,
  read: MeetingSummaryRow,
  leaseMilliseconds: number,
): Promise<RunResult> {
  const now = await readSummaryById(database, read.id);
  if (now === undefined || now.state !== "pending" || now.claimed_at === null) {
    return { outcome: "nothing-to-do" };
  }
  const remaining = Date.parse(now.claimed_at) + leaseMilliseconds - Date.now();
  return {
    outcome: "claimed-elsewhere",
    retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)),
  };
}

/** What one run has spent so far: each call's model and usage, in order — what the meter is written from. */
class SummaryRun {
  readonly calls: { readonly modelId: string; readonly usage: TokenUsage }[] = [];
  snapshotId: string | null = null;
  modelId: string | null = null;

  usage(): SummaryRunUsage {
    return {
      modelId: this.modelId,
      snapshotId: this.snapshotId,
      inputTokens: this.calls.reduce((total, call) => total + call.usage.inputTokens, 0),
      outputTokens: this.calls.reduce((total, call) => total + call.usage.outputTokens, 0),
      modelCalls: this.calls.length,
    };
  }

  /** The token meter's rows for every call made, bucketed on the day they are committed. */
  meterStatements(database: SqlDatabase, nowIso: string): EffectStatement[] {
    return this.calls.flatMap((call) =>
      tokenUsageCommitStatements(
        database,
        tokenUsageKeyForDay(
          nowIso,
          catalogEntryFor(call.modelId)?.slot ?? "reasoning",
          call.modelId,
        ),
        call.usage.inputTokens,
        call.usage.outputTokens,
      ),
    );
  }
}

/** The transcript as the model reads it, and what the answer is checked against. */
interface RenderedTranscript {
  readonly lines: readonly string[];
  readonly participants: readonly SummaryParticipant[];
}

/** A ready transcript's speech, in reading order, as `HH:MM:SS Name: text` lines, read a page at a time. */
async function renderTranscript(
  database: ProxyBatchDatabase,
  transcriptId: MeetingSummaryRow["transcript_id"],
): Promise<RenderedTranscript> {
  const lines: string[] = [];
  const participants = new Map<string, SummaryParticipant>();
  let afterOrdinal = -1;
  for (;;) {
    const page = await listTranscriptSegments(database, transcriptId, {
      afterOrdinal,
      limit: LINE_PAGE_SIZE,
    });
    for (const row of page.slice(0, LINE_PAGE_SIZE)) {
      afterOrdinal = row.ordinal;
      if (row.kind !== "speech" || row.participant_id === null) continue;
      const speaker = row.display_name ?? "";
      lines.push(transcriptLine(row.started_ms, speaker, row.text));
      participants.set(`${row.participant_kind ?? ""}:${row.participant_id}`, {
        displayName: speaker,
        userId: (row.user_id ?? null) as UserId | null,
      });
    }
    if (page.length <= LINE_PAGE_SIZE) break;
  }
  return { lines, participants: [...participants.values()] };
}

/** One call to the model, metered into the run; a refusal for now throws to be outlasted. */
async function callModel(
  port: SummaryPort,
  run: SummaryRun,
  input: {
    readonly modelId: string;
    readonly firmId: FirmId;
    readonly systemPrompt: string;
    readonly member: string;
    readonly maximumOutputTokens: number;
  },
): Promise<string> {
  const answer = await port.generateConversation({
    modelId: input.modelId,
    firmId: input.firmId,
    // Platform-authored and structurally separate from the transcript: no line anybody spoke can occupy
    // this field, because nothing from the transcript is ever written into it.
    systemPrompt: input.systemPrompt,
    messages: [{ role: "member", content: input.member }],
    maximumOutputTokens: input.maximumOutputTokens,
  });
  if (!answer.ok) {
    if (answer.problem?.retryable === true) {
      throw new SummaryUnavailableError(answer.problem.category);
    }
    throw new SummaryRefusedError(
      `the reasoning model refused the summary (${answer.reason}${answer.problem === undefined ? "" : `, ${answer.problem.category}`})`,
    );
  }
  run.calls.push({ modelId: input.modelId, usage: answer.value.usage });
  run.snapshotId = answer.value.snapshotId;
  return answer.value.text;
}

/** The run this consumer has claimed: gated, rendered, sent, read and written — or refused. */
async function writeClaimedSummary(
  env: Bindings,
  database: ProxyBatchDatabase,
  message: MeetingSummaryMessage,
  summary: MeetingSummaryRow,
  claimedAt: string,
  run: SummaryRun,
  options: SummaryOptions,
): Promise<SummaryOutcome> {
  const transcript = await readTranscriptById(database, summary.transcript_id);
  if (transcript?.state !== "ready") {
    throw new SummaryRefusedError("the summary's transcript is not ready");
  }
  const decision = await resolveSummaryModel(database);
  if (decision.kind === "refused") {
    return await refuseClaimedSummary(
      database,
      summary,
      claimedAt,
      decision.reason,
      decision.modelId,
    );
  }
  const modelId = decision.modelId;
  run.modelId = modelId;
  const transcriptRendered = await renderTranscript(database, transcript.id);
  if (transcriptRendered.lines.length === 0) {
    return await refuseClaimedSummary(database, summary, claimedAt, "transcript-empty", null);
  }
  const contextWindowTokens = catalogEntryFor(modelId)?.contextWindowTokens;
  if (contextWindowTokens === undefined) {
    throw new SummaryRefusedError(
      "the chosen reasoning model has no context window in the catalog",
    );
  }
  const parts = splitTranscriptIntoParts(
    transcriptRendered.lines,
    summaryPartByteBudget(contextWindowTokens),
  );
  if (parts === null) {
    throw new SummaryRefusedError("the transcript is longer than one summary run can read");
  }

  const port = options.port ?? deploymentInferencePort(env);
  const participantNames = transcriptRendered.participants.map(
    (participant) => participant.displayName,
  );
  let finalAnswer: string;
  if (parts.length === 1) {
    finalAnswer = await callModel(port, run, {
      modelId,
      firmId: message.firmId,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      member: summaryTranscriptMessage({ participants: participantNames, lines: parts[0] ?? [] }),
      maximumOutputTokens: SUMMARY_ANSWER_MAXIMUM_TOKENS,
    });
  } else {
    // A PART AT A TIME, THEN COMBINED. Each part's answer must itself be the documented structure — a
    // part read badly would be combined into a summary that silently lost it — and is handed to the
    // combining call as the structure it was read into.
    const partAnswers: string[] = [];
    for (const [index, part] of parts.entries()) {
      const answered = await callModel(port, run, {
        modelId,
        firmId: message.firmId,
        systemPrompt: SUMMARY_PART_SYSTEM_PROMPT,
        member: summaryTranscriptMessage({
          participants: participantNames,
          lines: part,
          part: { number: index + 1, of: parts.length },
        }),
        maximumOutputTokens: SUMMARY_PART_ANSWER_MAXIMUM_TOKENS,
      });
      const reading = readSummaryAnswer(answered);
      if (!reading.ok) {
        throw new SummaryRefusedError(
          `the reasoning model's answer for a part was not the summary structure (${reading.refusal})`,
        );
      }
      partAnswers.push(JSON.stringify(reading.answer));
    }
    finalAnswer = await callModel(port, run, {
      modelId,
      firmId: message.firmId,
      systemPrompt: SUMMARY_COMBINE_SYSTEM_PROMPT,
      member: summaryCombineMessage({ participants: participantNames, parts: partAnswers }),
      maximumOutputTokens: SUMMARY_ANSWER_MAXIMUM_TOKENS,
    });
  }

  const parsed = parseSummaryAnswer(finalAnswer, {
    participants: transcriptRendered.participants,
    transcriptText: transcriptRendered.lines.join("\n"),
  });
  if (!parsed.ok) {
    throw new SummaryRefusedError(
      `the reasoning model's answer was not the summary structure (${parsed.refusal})`,
    );
  }

  // ONE BATCH: the summary ready, its action items, its audit row and the meter for every call — guarded
  // on this consumer's claim, so a run whose lease ran out and was taken over writes and meters nothing.
  const nowIso = new Date().toISOString();
  const system = { clock: { now: () => nowIso }, randomSource: cryptoRandomSource };
  try {
    await commitEffectBatch(
      database,
      {
        statements: [
          ...readySummaryStatements(
            database,
            { summary, claimedAt, parsed: parsed.summary, usage: run.usage() },
            system,
          ),
          ...run.meterStatements(database, nowIso),
        ],
        outboxMessages: [],
      },
      { now: () => nowIso },
    );
  } catch (caught) {
    if (caught instanceof GuardedWriteRefusedError && caught.guard === SUMMARY_READY_GUARD) {
      return "nothing-to-do";
    }
    throw caught;
  }
  return "ready";
}

/** REFUSED, with its reason and one audit row — guarded on this consumer's claim. */
async function refuseClaimedSummary(
  database: ProxyBatchDatabase,
  summary: MeetingSummaryRow,
  claimedAt: string,
  reason: MeetingSummaryRefusalReason,
  modelId: string | null,
): Promise<SummaryOutcome> {
  const now = () => new Date().toISOString();
  try {
    await commitEffectBatch(
      database,
      refuseSummaryEffect(
        database,
        { summary, claimedAt, reason, modelId },
        { clock: { now }, randomSource: cryptoRandomSource },
      ),
      { now },
    );
  } catch (caught) {
    if (caught instanceof GuardedWriteRefusedError && caught.guard === SUMMARY_REFUSE_GUARD) {
      return "nothing-to-do";
    }
    throw caught;
  }
  return "refused";
}

/** FAILED, with its Error ID, what it spent metered, and one audit row — guarded on this consumer's claim. */
async function failClaimedSummary(
  database: ProxyBatchDatabase,
  summary: MeetingSummaryRow,
  claimedAt: string,
  failureErrorId: string,
  run: SummaryRun,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const effect = failSummaryEffect(
    database,
    { summary, claimedAt, failureErrorId, usage: run.usage() },
    { clock: { now: () => nowIso }, randomSource: cryptoRandomSource },
  );
  try {
    await commitEffectBatch(
      database,
      {
        statements: [...effect.statements, ...run.meterStatements(database, nowIso)],
        outboxMessages: [],
      },
      { now: () => nowIso },
    );
  } catch (caught) {
    if (caught instanceof GuardedWriteRefusedError && caught.guard === SUMMARY_FAIL_GUARD) {
      return false;
    }
    throw caught;
  }
  return true;
}

/**
 * THE MODEL REFUSED FOR NOW, with this consumer holding the run. Past the limit of refusals in a row the
 * summary fails with an Error ID; otherwise the refusal is counted and the claim let go in one guarded
 * write — with the meter for any call this run did complete — and the run is sent again on a NEW message
 * after the transcript's doubling delay.
 */
async function modelUnavailable(
  env: Bindings,
  database: ProxyBatchDatabase,
  message: MeetingSummaryMessage,
  summary: MeetingSummaryRow,
  claimedAt: string,
  run: SummaryRun,
  caught: SummaryUnavailableError,
): Promise<RunResult> {
  const failures = summary.model_failures + 1;
  const failureErrorId = recordRealtimeFailure(
    realtimeLoggerFor(env),
    "meetings.summary.model-unavailable",
    new Error(
      `the reasoning model refused for now (${caught.message}), ${String(failures)} times in a row`,
    ),
  );
  if (failures >= SUMMARY_MODEL_FAILURE_LIMIT) {
    return {
      outcome: (await failClaimedSummary(database, summary, claimedAt, failureErrorId, run))
        ? "failed"
        : "nothing-to-do",
    };
  }
  const nowIso = new Date().toISOString();
  const effect = summaryModelFailureEffect(
    database,
    { summaryId: summary.id, claimedAt },
    { clock: { now: () => nowIso }, randomSource: cryptoRandomSource },
  );
  try {
    await commitEffectBatch(
      database,
      {
        statements: [...effect.statements, ...run.meterStatements(database, nowIso)],
        outboxMessages: [],
      },
      { now: () => nowIso },
    );
  } catch (refused) {
    // The lease ran out and another consumer took the run: the refusal is theirs to count.
    if (
      refused instanceof GuardedWriteRefusedError &&
      refused.guard === SUMMARY_MODEL_FAILURE_GUARD
    ) {
      return { outcome: "nothing-to-do" };
    }
    throw refused;
  }
  const queue = env.MEETING_RECORDING_COMPOSE;
  if (queue === undefined) throw new Error("no recording queue is bound to send the retry to");
  await queue.send(message, { delaySeconds: transcriptModelRetryDelaySeconds(failures) });
  return { outcome: "retrying" };
}

/**
 * SENDS A SUMMARY'S RUN ON — best effort, after the batch that began it (or asked for it again) has
 * committed. A send that fails is recorded and leaves the summary pending, where a member's request to run
 * it again sends it on.
 */
export async function sendSummaryRun(
  env: Bindings,
  message: MeetingSummaryMessage,
): Promise<boolean> {
  try {
    const queue = env.MEETING_RECORDING_COMPOSE;
    if (queue === undefined) throw new Error("no recording queue is bound to send the summary to");
    await queue.send(message);
    return true;
  } catch (caught) {
    recordRealtimeFailure(realtimeLoggerFor(env), "meetings.summary.hand-on", caught);
    return false;
  }
}
