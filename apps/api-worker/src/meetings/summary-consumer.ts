import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type EffectWrite,
} from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { tokenUsageCommitStatements } from "@magna-carta/data-access/token-usage-statements";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { catalogEntryFor, onCloudflareReasoningEntry } from "@magna-carta/inference/catalog";
import type { InferencePort, TokenUsage } from "@magna-carta/inference/port";
import { aiProcessingEligibilityDefinition } from "@magna-carta/inference/settings";
import {
  readRecordingDocumentFacts,
  recordingDocumentStateOf,
} from "@magna-carta/meetings/recording-document-state";
import { summariesEnabledDefinition } from "@magna-carta/meetings/settings";
import {
  parseSummaryAnswer,
  readCombinedSummaryAnswer,
  readSummaryAnswer,
  settlePartedSummary,
  type SummaryAnswer,
  type SummaryParticipant,
  type SummarySettleContext,
} from "@magna-carta/meetings/summary-parse";
import {
  estimatedTokens,
  SUMMARY_ANSWER_MAXIMUM_TOKENS,
  SUMMARY_COMBINE_SYSTEM_PROMPT,
  SUMMARY_PART_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  splitTranscriptIntoParts,
  spokenWords,
  summaryCombineMessage,
  summaryParticipantBlock,
  summaryPartTokenBudget,
  summaryTranscriptMessage,
  transcriptLine,
} from "@magna-carta/meetings/summary-prompt";
import {
  claimSummaryEffect,
  failSummaryEffect,
  readySummaryStatements,
  refuseSummaryEffect,
  restartSummaryEffect,
  SUMMARY_CLAIM_GUARD,
  SUMMARY_FAIL_GUARD,
  SUMMARY_MODEL_FAILURE_GUARD,
  SUMMARY_READY_GUARD,
  SUMMARY_REFUSE_GUARD,
  SUMMARY_RESTART_GUARD,
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
import {
  transcriptLinesWithheldBy,
  type MeetingTranscriptRow,
  type MeetingTranscriptWithheldReason,
} from "@magna-carta/meetings/transcript-types";
import type { Bindings } from "../bindings.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { deploymentInferencePort, resolveChosenReasoningModel } from "../inference/call-site.ts";
import { tokenUsageKeyForDay } from "../background/inference/inference-consumer.ts";
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
// WHETHER AT ALL, AND WHICH MODEL — read when the summary is run, never when it was begun, and read again
// before every call after the first, so a firm that switches something off mid-run is honoured before
// another word is sent:
//
//   - `meetings.summariesEnabled` off: REFUSED, `disabled`.
//   - the firm's AI-processing eligibility off: REFUSED, `not-eligible`, naming the model it would have
//     run on. A summary sends a privileged conversation to a reasoning model whichever model that is, so
//     it needs the firm's leave on every path — including the platform's own model hosted on Cloudflare.
//   - the firm has not chosen a reasoning model: the catalog's platform-reasoning model, HOSTED ON
//     CLOUDFLARE, so the conversation does not leave the platform unless the firm has chosen a model that
//     sends it elsewhere;
//   - the firm chose a third-party model: that one — never swapped for another behind its back;
//   - the transcript's filed document in the trash, held by the scan or gone: FAILED with an Error ID,
//     because words the firm cannot open are not words to send anywhere;
//   - a transcript with no speech: REFUSED, `transcript-empty`.
//
// A TRANSCRIPT TOO LONG FOR ONE CALL is summarized a part at a time and the parts' accounts combined, every
// call inside the one message — the bound on the parts and its arithmetic are in
// `@magna-carta/meetings/summary-prompt`, measured against the chosen model's context window from the
// catalog. The parts' action items are kept as the parts gave them; only the prose is combined.
//
// THE WALL CLOCK IS ENFORCED, NOT ESTIMATED. A whole run is one consumer invocation, which may run fifteen
// minutes. A call is started only while the run has `SUMMARY_CALL_ALLOWANCE_MILLISECONDS` left of
// `SUMMARY_RUN_BUDGET_MILLISECONDS`; otherwise the run is let go as if the model had refused for now, and
// tried again — so a run is never killed mid-call by the platform with its claim held for the lease.
//
// EACH CALL IS METERED AS IT COMPLETES. The provider's authoritative usage from each answer is written to
// the firm's token meter in a batch of its own, straight after the answer — not when the run settles — so
// tokens spent on a run that did not finish, that lost its claim, or that was cut off are counted as
// surely as a finished one's. Only a fault between an answer and its own meter write can lose one call.
//
// A MODEL THAT REFUSES FOR NOW is outlasted exactly as the transcript's speech model is: the refusal is
// counted on the row in the write that lets go of the claim, the run is sent again on a NEW message after
// the transcript's own doubling delay (the row records when it is due, so nothing claims it sooner and a
// member asking in between sends nothing), and the transcript's limit of refusals in a row fails it with
// an Error ID. Nothing the binding throws says whether a refusal is an outage or an input the model will
// never take, so one more rule bounds the second: a run refused at the SAME call as the run before it,
// after every earlier call of the run was answered, fails — the model is evidently up, and the call is
// one it will not take. An answer that is not the documented structure fails it at once — a model that
// answered badly is not a model that is down — and a member may run it again.
//
// THE TEXT IS DERIVED CONTENT. Nothing here logs a line of the transcript, a sentence of the answer, a
// name, or the instruction; every Error ID is recorded against a fixed sentence and a closed label.

/** How long a consumer's claim on a run holds: fifteen minutes, a consumer's longest run. */
export const SUMMARY_CLAIM_LEASE_MILLISECONDS = 15 * 60 * 1000;

/**
 * How long one run may spend before its last call starts and the settle is written: one minute short of
 * the fifteen a consumer may run, the minute kept for the writes that settle it.
 */
export const SUMMARY_RUN_BUDGET_MILLISECONDS = 14 * 60 * 1000;

/**
 * The time a call is allowed: a call starts only while this much of the run's budget is left. Five minutes
 * covers reading a context window's worth of transcript and writing the whole answer room at a slow pace.
 */
export const SUMMARY_CALL_ALLOWANCE_MILLISECONDS = 5 * 60 * 1000;

/**
 * How many runs in a row may meet a model that refuses for now before the summary fails: the transcript's
 * own limit, with the transcript's own delays between them — the same outage, outlasted the same way.
 */
export const SUMMARY_MODEL_FAILURE_LIMIT = TRANSCRIPT_MODEL_FAILURE_LIMIT;

/** How many transcript lines are read at once while rendering them. */
const LINE_PAGE_SIZE = 500;

/** The conversation operation, which is all of the model port this consumer reaches. */
export type SummaryPort = Pick<InferencePort, "generateConversation">;

/** What one delivery may be given, for a test: its model port, its lease, and its clock for the budget. */
export interface SummaryOptions {
  readonly port?: SummaryPort;
  readonly claimLeaseMilliseconds?: number;
  // The milliseconds the run's budget is measured in; `Date.now` unless a test moves time on.
  readonly elapsedClock?: () => number;
}

/** What one delivery did. */
export type SummaryOutcome =
  | "ready"
  | "refused"
  | "failed"
  | "retrying"
  | "claimed-elsewhere"
  | "not-yet-due"
  | "nothing-to-do";

interface RunResult {
  readonly outcome: SummaryOutcome;
  readonly retryAfterSeconds?: number;
}

/** A run that cannot be finished, whatever is retried: failed with an Error ID. The message is fixed. */
class SummaryRefusedError extends Error {}

/**
 * The model refused for now — busy or unreachable — or the run ran out of time before a call, so the run
 * is worth another attempt. `call` is the call of the run, from zero, it came at; `label` a closed one.
 */
class SummaryUnavailableError extends Error {
  constructor(
    readonly label: string,
    readonly call: number,
  ) {
    super(label);
  }
}

/** The firm's settings now refuse the summary they allowed when the run began. */
class SummaryGateClosedError extends Error {
  constructor(
    readonly reason: Exclude<MeetingSummaryRefusalReason, "transcript-empty">,
    readonly modelId: string | null,
  ) {
    super(reason);
  }
}

/** The firm's choice of model changed while the run was reading: it starts over on the new one. */
class SummaryRestartError extends Error {}

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
 * chosen reasoning model, and its AI-processing eligibility. Both switches are needed whatever the model,
 * because every model this could reach is sent a privileged conversation to reason over.
 */
export async function resolveSummaryModel(database: SqlDatabase): Promise<SummaryModelDecision> {
  if (!(await readFirmSetting(database, summariesEnabledDefinition))) {
    return { kind: "refused", reason: "disabled", modelId: null };
  }
  const modelId =
    (await resolveChosenReasoningModel(database)) ?? onCloudflareReasoningEntry().modelId;
  return (await readFirmSetting(database, aiProcessingEligibilityDefinition))
    ? { kind: "model", modelId }
    : { kind: "refused", reason: "not-eligible", modelId };
}

/**
 * Whether a transcript's words are withheld — its filed document in the trash, held by the scan, or gone —
 * and why; null while they may be read. The same reading the transcript's and the summary's routes make.
 */
export async function transcriptWordsWithheld(
  database: SqlDatabase,
  transcript: Pick<MeetingTranscriptRow, "file_version_id">,
): Promise<MeetingTranscriptWithheldReason | null> {
  if (transcript.file_version_id === null) return "unavailable";
  const facts = (
    await readRecordingDocumentFacts(
      database,
      [transcript.file_version_id],
      visibleMatterPredicate(),
    )
  ).get(transcript.file_version_id);
  return facts === undefined
    ? "unavailable"
    : transcriptLinesWithheldBy(recordingDocumentStateOf(facts));
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
  const elapsedClock = options.elapsedClock ?? Date.now;
  const startedAt = elapsedClock();
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
  const run = new SummaryRun(env, database, () => elapsedClock() - startedAt);
  try {
    return {
      outcome: await writeClaimedSummary(env, database, message, summary, claimedAt, run, options),
    };
  } catch (caught) {
    if (caught instanceof SummaryUnavailableError) {
      return await modelUnavailable(env, database, message, summary, claimedAt, run, caught);
    }
    if (caught instanceof SummaryGateClosedError) {
      return {
        outcome: await refuseClaimedSummary(
          database,
          summary,
          claimedAt,
          caught.reason,
          caught.modelId,
        ),
      };
    }
    if (caught instanceof SummaryRestartError) {
      return await restartRun(env, database, message, summary, claimedAt);
    }
    if (!(caught instanceof SummaryRefusedError)) throw caught;
    // A RUN THAT CAN NEVER BE FINISHED: failed with an Error ID recorded against a fixed sentence and a
    // closed label — never a line, a sentence or a name. What it spent is metered already.
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

/** Whole seconds from now until `instant` (milliseconds), never fewer than one — a queue retry's delay. */
function secondsUntil(instant: number): number {
  return Math.max(1, Math.ceil((instant - Date.now()) / 1000));
}

/**
 * WHY THE CLAIM WAS REFUSED, read back off the row: a run put off until later is tried when it is due; a
 * run another consumer's LIVE lease holds is tried again once that lease has run out; a summary that
 * settled meanwhile has nothing left to do.
 */
async function refusedClaim(
  database: ProxyBatchDatabase,
  read: MeetingSummaryRow,
  leaseMilliseconds: number,
): Promise<RunResult> {
  const now = await readSummaryById(database, read.id);
  if (now === undefined || now.state !== "pending") return { outcome: "nothing-to-do" };
  if (now.retry_at !== null && Date.parse(now.retry_at) > Date.now()) {
    return { outcome: "not-yet-due", retryAfterSeconds: secondsUntil(Date.parse(now.retry_at)) };
  }
  if (now.claimed_at === null) return { outcome: "nothing-to-do" };
  return {
    outcome: "claimed-elsewhere",
    retryAfterSeconds: secondsUntil(Date.parse(now.claimed_at) + leaseMilliseconds),
  };
}

/**
 * What one run has spent so far — each call's model and usage, in order, each already on the firm's meter —
 * and how long it has been running.
 */
class SummaryRun {
  readonly calls: { readonly modelId: string; readonly usage: TokenUsage }[] = [];
  snapshotId: string | null = null;
  modelId: string | null = null;

  constructor(
    private readonly env: Bindings,
    private readonly database: ProxyBatchDatabase,
    readonly elapsedMilliseconds: () => number,
  ) {}

  usage(): SummaryRunUsage {
    return {
      modelId: this.modelId,
      snapshotId: this.snapshotId,
      inputTokens: this.calls.reduce((total, call) => total + call.usage.inputTokens, 0),
      outputTokens: this.calls.reduce((total, call) => total + call.usage.outputTokens, 0),
      modelCalls: this.calls.length,
    };
  }

  /**
   * ONE ANSWERED CALL, counted and put on the firm's token meter at once, in a batch of its own — the
   * tokens were spent whatever becomes of the run. A meter write that fails is recorded and the run goes
   * on: failing the run would spend every call again for a counter.
   */
  async answered(modelId: string, usage: TokenUsage, snapshotId: string): Promise<void> {
    this.calls.push({ modelId, usage });
    this.snapshotId = snapshotId;
    const nowIso = new Date().toISOString();
    try {
      await commitEffectBatch(
        this.database,
        {
          statements: tokenUsageCommitStatements(
            this.database,
            tokenUsageKeyForDay(nowIso, catalogEntryFor(modelId)?.slot ?? "reasoning", modelId),
            usage.inputTokens,
            usage.outputTokens,
          ),
          outboxMessages: [],
        },
        { now: () => nowIso },
      );
    } catch (caught) {
      recordRealtimeFailure(realtimeLoggerFor(this.env), "meetings.summary.meter", caught);
    }
  }
}

/** The transcript as the model reads it, and what the answer is checked against. */
interface RenderedTranscript {
  readonly lines: readonly string[];
  // What each person said, as the model read it after the line's time and name.
  readonly speech: readonly string[];
  readonly participants: readonly SummaryParticipant[];
}

/** A ready transcript's speech, in reading order, as `HH:MM:SS Name: text` lines, read a page at a time. */
async function renderTranscript(
  database: ProxyBatchDatabase,
  transcriptId: MeetingSummaryRow["transcript_id"],
): Promise<RenderedTranscript> {
  const lines: string[] = [];
  const speech: string[] = [];
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
      speech.push(spokenWords(row.text));
      participants.set(`${row.participant_kind ?? ""}:${row.participant_id}`, {
        displayName: speaker,
        userId: (row.user_id ?? null) as UserId | null,
      });
    }
    if (page.length <= LINE_PAGE_SIZE) break;
  }
  return { lines, speech, participants: [...participants.values()] };
}

/** What every call of one run shares. */
interface RunCalls {
  readonly port: SummaryPort;
  readonly run: SummaryRun;
  readonly database: ProxyBatchDatabase;
  readonly modelId: string;
  readonly firmId: FirmId;
}

/**
 * ONE CALL TO THE MODEL, the `call`th of the run (from zero). Before any call after the first, the time
 * left and the firm's settings are read again; a refusal for now throws to be outlasted.
 */
async function callModel(
  calls: RunCalls,
  call: number,
  input: { readonly systemPrompt: string; readonly member: string },
): Promise<string> {
  const { run } = calls;
  if (
    run.elapsedMilliseconds() + SUMMARY_CALL_ALLOWANCE_MILLISECONDS >
    SUMMARY_RUN_BUDGET_MILLISECONDS
  ) {
    throw new SummaryUnavailableError("out-of-time", call);
  }
  if (call > 0) {
    const decision = await resolveSummaryModel(calls.database);
    if (decision.kind === "refused") {
      throw new SummaryGateClosedError(decision.reason, decision.modelId);
    }
    if (decision.modelId !== calls.modelId) throw new SummaryRestartError();
  }
  const answer = await calls.port.generateConversation({
    modelId: calls.modelId,
    firmId: calls.firmId,
    // Platform-authored and structurally separate from the transcript: no line anybody spoke can occupy
    // this field, because nothing from the transcript is ever written into it.
    systemPrompt: input.systemPrompt,
    messages: [{ role: "member", content: input.member }],
    maximumOutputTokens: SUMMARY_ANSWER_MAXIMUM_TOKENS,
    // The answer is one JSON object, asked of the model in its own terms where it has them, so a line
    // somebody spoke asking for prose cannot change the answer's form.
    answerFormat: "json-object",
  });
  if (!answer.ok) {
    if (answer.problem?.retryable === true) {
      throw new SummaryUnavailableError(answer.problem.category, call);
    }
    throw new SummaryRefusedError(
      `the reasoning model refused the summary (${answer.reason}${answer.problem === undefined ? "" : `, ${answer.problem.category}`})`,
    );
  }
  await run.answered(calls.modelId, answer.value.usage, answer.value.snapshotId);
  return answer.value.text;
}

/** The years a due date stated without its year may fall in: the year the summary was begun, give or take one. */
function dueYearsFor(summary: MeetingSummaryRow): { earliestYear: number; latestYear: number } {
  const begunYear = Number(summary.created_at.slice(0, 4));
  return { earliestYear: begunYear - 1, latestYear: begunYear + 1 };
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
  // The words go nowhere the firm itself could not open them from.
  const withheld = await transcriptWordsWithheld(database, transcript);
  if (withheld !== null) {
    throw new SummaryRefusedError(`the transcript's document is withheld (${withheld})`);
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
  const participantNames = transcriptRendered.participants.map(
    (participant) => participant.displayName,
  );
  const parts = splitTranscriptIntoParts(
    transcriptRendered.lines,
    summaryPartTokenBudget(
      contextWindowTokens,
      estimatedTokens(summaryParticipantBlock(participantNames)),
    ),
  );
  if (parts === null) {
    throw new SummaryRefusedError("the transcript is longer than one summary run can read");
  }

  const calls: RunCalls = {
    port: options.port ?? deploymentInferencePort(env),
    run,
    database,
    modelId,
    firmId: message.firmId,
  };
  const settleContext: SummarySettleContext = {
    participants: transcriptRendered.participants,
    speech: transcriptRendered.speech,
    ...dueYearsFor(summary),
  };
  let parsed: ReturnType<typeof parseSummaryAnswer>;
  if (parts.length === 1) {
    parsed = parseSummaryAnswer(
      await callModel(calls, 0, {
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        member: summaryTranscriptMessage({ participants: participantNames, lines: parts[0] ?? [] }),
      }),
      settleContext,
    );
  } else {
    // A PART AT A TIME, THEN THE PROSE COMBINED. Each part's answer must itself be the documented
    // structure — a part read badly would be combined into a summary that silently lost it. Its action
    // items are kept as it gave them; only its account is handed to the combining call.
    const partAnswers: SummaryAnswer[] = [];
    for (const [index, part] of parts.entries()) {
      const reading = readSummaryAnswer(
        await callModel(calls, index, {
          systemPrompt: SUMMARY_PART_SYSTEM_PROMPT,
          member: summaryTranscriptMessage({
            participants: participantNames,
            lines: part,
            part: { number: index + 1, of: parts.length },
          }),
        }),
      );
      if (!reading.ok) {
        throw new SummaryRefusedError(
          `the reasoning model's answer for a part was not the summary structure (${reading.refusal})`,
        );
      }
      partAnswers.push(reading.answer);
    }
    const combined = readCombinedSummaryAnswer(
      await callModel(calls, parts.length, {
        systemPrompt: SUMMARY_COMBINE_SYSTEM_PROMPT,
        member: summaryCombineMessage({
          participants: participantNames,
          parts: partAnswers.map((answer) => answer.summary),
        }),
      }),
    );
    if (!combined.ok) {
      throw new SummaryRefusedError(
        `the reasoning model's combined answer was not the summary structure (${combined.refusal})`,
      );
    }
    parsed = settlePartedSummary(combined.summary, partAnswers, settleContext);
  }
  if (!parsed.ok) {
    throw new SummaryRefusedError(
      `the reasoning model's answer was not the summary structure (${parsed.refusal})`,
    );
  }

  // ONE BATCH: the summary ready, its action items and its audit row — guarded on this consumer's claim,
  // so a run whose lease ran out and was taken over writes nothing. Its calls are on the meter already.
  const nowIso = new Date().toISOString();
  const system = { clock: { now: () => nowIso }, randomSource: cryptoRandomSource };
  try {
    await commitEffectBatch(
      database,
      {
        statements: readySummaryStatements(
          database,
          { summary, claimedAt, parsed: parsed.summary, usage: run.usage() },
          system,
        ),
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

/** FAILED, with its Error ID, what it spent, and one audit row — guarded on this consumer's claim. */
async function failClaimedSummary(
  database: ProxyBatchDatabase,
  summary: MeetingSummaryRow,
  claimedAt: string,
  failureErrorId: string,
  run: SummaryRun,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  try {
    await commitEffectBatch(
      database,
      failSummaryEffect(
        database,
        { summary, claimedAt, failureErrorId, usage: run.usage() },
        { clock: { now: () => nowIso }, randomSource: cryptoRandomSource },
      ),
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

/** Commits a write that lets go of the claim, answering false when the claim was no longer this run's. */
async function letGo(
  database: ProxyBatchDatabase,
  write: EffectWrite,
  guard: string,
  nowIso: string,
): Promise<boolean> {
  try {
    await commitEffectBatch(database, write, { now: () => nowIso });
  } catch (refused) {
    // The lease ran out and another consumer took the run: what happens next is theirs.
    if (refused instanceof GuardedWriteRefusedError && refused.guard === guard) return false;
    throw refused;
  }
  return true;
}

/** Sends a run on to the recording queue, after `delaySeconds`. */
async function sendRunLater(
  env: Bindings,
  message: MeetingSummaryMessage,
  delaySeconds: number,
): Promise<void> {
  const queue = env.MEETING_RECORDING_COMPOSE;
  if (queue === undefined) throw new Error("no recording queue is bound to send the retry to");
  await queue.send(message, delaySeconds > 0 ? { delaySeconds } : undefined);
}

/**
 * THE MODEL REFUSED FOR NOW — or the run ran out of time before a call — with this consumer holding the
 * run. It fails with an Error ID past the limit of refusals in a row, or when this run was refused at the
 * same call as the run before it after every earlier call was answered (the model is up; the call is one
 * it will not take). Otherwise the refusal and its call are counted, the instant the retry is due
 * recorded, and the claim let go in one guarded write, and the run is sent again on a NEW message after
 * the transcript's doubling delay.
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
  const sameCallAgain = caught.call > 0 && summary.model_failure_call === caught.call;
  const failureErrorId = recordRealtimeFailure(
    realtimeLoggerFor(env),
    "meetings.summary.model-unavailable",
    new Error(
      `the reasoning model refused for now (${caught.label}) at call ${String(caught.call)}, ` +
        `${String(failures)} times in a row${sameCallAgain ? ", at the same call as the run before" : ""}`,
    ),
  );
  if (failures >= SUMMARY_MODEL_FAILURE_LIMIT || sameCallAgain) {
    return {
      outcome: (await failClaimedSummary(database, summary, claimedAt, failureErrorId, run))
        ? "failed"
        : "nothing-to-do",
    };
  }
  const delaySeconds = transcriptModelRetryDelaySeconds(failures);
  const nowMilliseconds = Date.now();
  const nowIso = new Date(nowMilliseconds).toISOString();
  const retryAt = new Date(nowMilliseconds + delaySeconds * 1000).toISOString();
  const effect = summaryModelFailureEffect(
    database,
    { summaryId: summary.id, claimedAt, failedCall: caught.call, retryAt },
    { clock: { now: () => nowIso }, randomSource: cryptoRandomSource },
  );
  if (!(await letGo(database, effect, SUMMARY_MODEL_FAILURE_GUARD, nowIso))) {
    return { outcome: "nothing-to-do" };
  }
  await sendRunLater(env, message, delaySeconds);
  return { outcome: "retrying" };
}

/**
 * THE FIRM'S CHOICE OF MODEL CHANGED MID-RUN: what was read on the old model is set aside, nothing is
 * counted against the summary, and the run is sent again at once to start over on the new one.
 */
async function restartRun(
  env: Bindings,
  database: ProxyBatchDatabase,
  message: MeetingSummaryMessage,
  summary: MeetingSummaryRow,
  claimedAt: string,
): Promise<RunResult> {
  const nowIso = new Date().toISOString();
  const effect = restartSummaryEffect(
    database,
    { summaryId: summary.id, claimedAt, retryAt: nowIso },
    { clock: { now: () => nowIso }, randomSource: cryptoRandomSource },
  );
  if (!(await letGo(database, effect, SUMMARY_RESTART_GUARD, nowIso))) {
    return { outcome: "nothing-to-do" };
  }
  await sendRunLater(env, message, 0);
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
