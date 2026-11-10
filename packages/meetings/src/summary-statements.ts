import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterTaskId,
  MeetingId,
  MeetingRecordingId,
  MeetingSummaryActionItemId,
  MeetingSummaryId,
  MeetingTranscriptId,
  UserId,
} from "@magna-carta/identifiers/types";
import { SUMMARY_RUN_ACTION_ITEMS_MAXIMUM } from "./summary-prompt.ts";
import type {
  MeetingSummaryActionItemRow,
  MeetingSummaryMark,
  MeetingSummaryRefusalReason,
  MeetingSummaryRow,
} from "./summary-types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const MEETING_SUMMARY_TABLE = "meeting_summary";
export const MEETING_SUMMARY_ACTION_ITEM_TABLE = "meeting_summary_action_item";

// THE GATE IS THE MEETING'S, ASKED ONE LEVEL UP — the transcript statements' rule, word for word. A member
// reaches a summary through its recording, which is reached through its meeting, which is read through the
// visible-matter predicate; nothing here takes a predicate, because a statement that did would invite a
// caller to reach a summary without first reaching its meeting. The reads marked as the platform's own are
// the summary consumer tending its own record.
//
// NOTHING HERE LOGS, AND NOTHING HERE PUTS TEXT ANYWHERE BUT A SUMMARY OR ACTION-ITEM ROW. The text is
// derived content.

const SUMMARY_COLUMNS = [
  "id",
  "meeting_id",
  "recording_id",
  "transcript_id",
  "state",
  "model_id",
  "snapshot_id",
  "summary_text",
  "input_tokens",
  "output_tokens",
  "model_calls",
  "refusal_reason",
  "failure_error_id",
  "model_failures",
  "model_failure_call",
  "retry_at",
  "claimed_at",
  "progress_at",
  "requested_by_user_id",
  "created_at",
  "updated_at",
].join(", ");

// One positional binding per value, for an `IN (…)` over a page of handles.
function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** One summary by its handle — the summary consumer's own read. */
export async function readSummaryById(
  database: SqlDatabase,
  summaryId: MeetingSummaryId,
): Promise<MeetingSummaryRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM ${MEETING_SUMMARY_TABLE} WHERE id = ?`)
    .bind(summaryId)
    .all<MeetingSummaryRow>();
  return results[0];
}

/**
 * The summary of one transcript — for a caller that has ALREADY reached the transcript through its
 * recording and meeting, which is where the gate was asked.
 */
export async function readSummaryForTranscript(
  database: SqlDatabase,
  transcriptId: MeetingTranscriptId,
): Promise<MeetingSummaryRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${SUMMARY_COLUMNS} FROM ${MEETING_SUMMARY_TABLE} WHERE transcript_id = ?`)
    .bind(transcriptId)
    .all<MeetingSummaryRow>();
  return results[0];
}

/**
 * WHAT A PAGE OF RECORDINGS SAYS ABOUT THEIR SUMMARIES, in one read for the page — the recording list's,
 * whose rows the caller reached through the meeting. A recording with no summary is absent from the map.
 */
export async function readSummaryMarks(
  database: SqlDatabase,
  recordingIds: readonly MeetingRecordingId[],
): Promise<ReadonlyMap<MeetingRecordingId, MeetingSummaryMark>> {
  if (recordingIds.length === 0) return new Map();
  const { results } = await database
    .prepare(
      `SELECT id, recording_id, state, refusal_reason FROM ${MEETING_SUMMARY_TABLE} ` +
        `WHERE recording_id IN (${placeholders(recordingIds.length)})`,
    )
    .bind(...recordingIds)
    .all<{
      id: MeetingSummaryId;
      recording_id: MeetingRecordingId;
      state: MeetingSummaryRow["state"];
      refusal_reason: MeetingSummaryRefusalReason | null;
    }>();
  return new Map(
    results.map((row) => [
      row.recording_id,
      { id: row.id, state: row.state, refusalReason: row.refusal_reason },
    ]),
  );
}

/** An action item with the name its owner is known by now. */
export interface MeetingSummaryActionItemListRow extends MeetingSummaryActionItemRow {
  readonly owner_display_name: string | null;
}

/**
 * A summary's action items in order, each with its owner's current display name. Bounded: a summary
 * holds at most `SUMMARY_RUN_ACTION_ITEMS_MAXIMUM`, which the parse enforces before any is written.
 */
export async function listSummaryActionItems(
  database: SqlDatabase,
  summaryId: MeetingSummaryId,
): Promise<readonly MeetingSummaryActionItemListRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_SUMMARY_ACTION_ITEM_TABLE}.id, ${MEETING_SUMMARY_ACTION_ITEM_TABLE}.summary_id, ` +
        `${MEETING_SUMMARY_ACTION_ITEM_TABLE}.ordinal, ${MEETING_SUMMARY_ACTION_ITEM_TABLE}.text, ` +
        `${MEETING_SUMMARY_ACTION_ITEM_TABLE}.owner_user_id, ${MEETING_SUMMARY_ACTION_ITEM_TABLE}.due_on, ` +
        `${MEETING_SUMMARY_ACTION_ITEM_TABLE}.task_id, ${MEETING_SUMMARY_ACTION_ITEM_TABLE}.created_at, ` +
        `${MEETING_SUMMARY_ACTION_ITEM_TABLE}.updated_at, member.display_name AS owner_display_name ` +
        `FROM ${MEETING_SUMMARY_ACTION_ITEM_TABLE} ` +
        `LEFT JOIN member ON member.user_id = ${MEETING_SUMMARY_ACTION_ITEM_TABLE}.owner_user_id ` +
        `WHERE ${MEETING_SUMMARY_ACTION_ITEM_TABLE}.summary_id = ? ` +
        `ORDER BY ${MEETING_SUMMARY_ACTION_ITEM_TABLE}.ordinal ASC LIMIT ?`,
    )
    .bind(summaryId, SUMMARY_RUN_ACTION_ITEMS_MAXIMUM)
    .all<MeetingSummaryActionItemListRow>();
  return results;
}

/** One action item of one summary — for a caller that has already reached the summary. */
export async function readSummaryActionItem(
  database: SqlDatabase,
  summaryId: MeetingSummaryId,
  actionItemId: MeetingSummaryActionItemId,
): Promise<MeetingSummaryActionItemRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, summary_id, ordinal, text, owner_user_id, due_on, task_id, created_at, updated_at ` +
        `FROM ${MEETING_SUMMARY_ACTION_ITEM_TABLE} WHERE id = ? AND summary_id = ?`,
    )
    .bind(actionItemId, summaryId)
    .all<MeetingSummaryActionItemRow>();
  return results[0];
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/** A transcript's summary, pending — begun when the transcript became ready, or by a member's request. */
export function insertSummaryStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryId;
    readonly meetingId: MeetingId;
    readonly recordingId: MeetingRecordingId;
    readonly transcriptId: MeetingTranscriptId;
    readonly requestedByUserId: UserId | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_SUMMARY_TABLE} (id, meeting_id, recording_id, transcript_id, state, ` +
        `requested_by_user_id, progress_at, created_at, updated_at) ` +
        `VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.meetingId,
      input.recordingId,
      input.transcriptId,
      input.requestedByUserId,
      input.now,
      input.now,
      input.now,
    );
}

/**
 * ONE CONSUMER TAKES THE RUN: the claim is stamped on a summary still `pending` that nobody holds — or
 * whose holder's lease ran out — and whose put-off run, if any, is due. Guarded by the caller: a second
 * delivery of the same message stops here before it sends a word to a model, and so does a duplicate of
 * a retry that arrives before the retry was due.
 */
export function claimSummaryStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryId;
    readonly now: string;
    readonly leaseExpiredBefore: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_TABLE} SET claimed_at = ?, retry_at = NULL, updated_at = ? ` +
        `WHERE id = ? AND state = 'pending' AND (claimed_at IS NULL OR claimed_at < ?) ` +
        `AND (retry_at IS NULL OR retry_at <= ?)`,
    )
    .bind(input.now, input.now, input.id, input.leaseExpiredBefore, input.now);
}

/** A claim let go by the consumer that took it, addressed by the instant it was taken at. */
// fitness:unguarded-write — a zero means the run already settled (which lets go of the claim in the same
// write) or the lease ran out and somebody else took it; neither is this consumer's to release.
export function releaseSummaryClaimStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingSummaryId; readonly claimedAt: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_TABLE} SET claimed_at = NULL WHERE id = ? AND claimed_at = ?`,
    )
    .bind(input.id, input.claimedAt);
}

/** What one run spent, as the provider counted it. */
export interface SummaryRunUsage {
  readonly modelId: string | null;
  readonly snapshotId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly modelCalls: number;
}

/**
 * THE SUMMARY IS WRITTEN: `ready`, with its text and what the run spent. Guarded by the caller on
 * `pending` and on its own claim, so a consumer whose lease ran out and was taken over writes nothing.
 */
export function readySummaryStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryId;
    readonly claimedAt: string;
    readonly summaryText: string;
    readonly usage: SummaryRunUsage;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_TABLE} SET state = 'ready', summary_text = ?, model_id = ?, ` +
        `snapshot_id = ?, input_tokens = ?, output_tokens = ?, model_calls = ?, model_failures = 0, ` +
        `model_failure_call = NULL, retry_at = NULL, claimed_at = NULL, progress_at = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'pending' AND claimed_at = ?`,
    )
    .bind(
      input.summaryText,
      input.usage.modelId,
      input.usage.snapshotId,
      input.usage.inputTokens,
      input.usage.outputTokens,
      input.usage.modelCalls,
      input.now,
      input.now,
      input.id,
      input.claimedAt,
    );
}

/** One action item of a summary being written. */
export function insertActionItemStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryActionItemId;
    readonly summaryId: MeetingSummaryId;
    readonly ordinal: number;
    readonly text: string;
    readonly ownerUserId: UserId | null;
    readonly dueOn: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_SUMMARY_ACTION_ITEM_TABLE} (id, summary_id, ordinal, text, owner_user_id, ` +
        `due_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.summaryId,
      input.ordinal,
      input.text,
      input.ownerUserId,
      input.dueOn,
      input.now,
      input.now,
    );
}

/**
 * A SUMMARY NOT WRITTEN, AND WHY: `refused` with its closed reason. Guarded by the caller on `pending` and
 * on its own claim.
 */
export function refuseSummaryStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryId;
    readonly claimedAt: string;
    readonly reason: MeetingSummaryRefusalReason;
    readonly modelId: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_TABLE} SET state = 'refused', refusal_reason = ?, model_id = ?, ` +
        `retry_at = NULL, claimed_at = NULL, progress_at = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'pending' AND claimed_at = ?`,
    )
    .bind(input.reason, input.modelId, input.now, input.now, input.id, input.claimedAt);
}

/**
 * A SUMMARY THAT COULD NOT BE WRITTEN: `failed`, with the Error ID the standard pipeline recorded and never
 * a message, and what the run spent before it failed. Guarded by the caller on `pending` and on its own
 * claim.
 */
export function failSummaryStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryId;
    readonly claimedAt: string;
    readonly failureErrorId: string;
    readonly usage: SummaryRunUsage;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_TABLE} SET state = 'failed', failure_error_id = ?, ` +
        `model_id = COALESCE(?, model_id), snapshot_id = COALESCE(?, snapshot_id), ` +
        `input_tokens = ?, output_tokens = ?, model_calls = ?, retry_at = NULL, claimed_at = NULL, ` +
        `progress_at = ?, updated_at = ? WHERE id = ? AND state = 'pending' AND claimed_at = ?`,
    )
    .bind(
      input.failureErrorId,
      input.usage.modelId,
      input.usage.snapshotId,
      input.usage.inputTokens,
      input.usage.outputTokens,
      input.usage.modelCalls,
      input.now,
      input.now,
      input.id,
      input.claimedAt,
    );
}

/**
 * THE MODEL REFUSED FOR NOW, and this consumer lets go of the run: one more refusal counted, the call it
 * came at recorded, the claim released so the retry can take it, the instant the retry is due recorded,
 * and `progress_at` stamped — the retry is scheduled. Guarded by the caller on its own claim.
 */
export function recordSummaryModelFailureStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryId;
    readonly claimedAt: string;
    readonly failedCall: number;
    readonly retryAt: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_TABLE} SET model_failures = model_failures + 1, ` +
        `model_failure_call = ?, retry_at = ?, claimed_at = NULL, progress_at = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'pending' AND claimed_at = ?`,
    )
    .bind(input.failedCall, input.retryAt, input.now, input.now, input.id, input.claimedAt);
}

/**
 * THE RUN STARTS OVER, counting nothing: the firm's choice of model changed while it ran, so what it had
 * read is set aside and the run is due again at `retryAt`. Guarded by the caller on its own claim.
 */
export function restartSummaryStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryId;
    readonly claimedAt: string;
    readonly retryAt: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_TABLE} SET retry_at = ?, claimed_at = NULL, progress_at = ?, ` +
        `updated_at = ? WHERE id = ? AND state = 'pending' AND claimed_at = ?`,
    )
    .bind(input.retryAt, input.now, input.now, input.id, input.claimedAt);
}

/**
 * A MEMBER ASKS FOR THE SUMMARY AGAIN: a settled summary back to `pending`, its text, its spend, its
 * reason and its Error ID cleared, and the member recorded as who asked. Guarded by the caller on the
 * state and the instant it READ, so two requests racing each other start one run, and a run settling
 * between the read and this write is not undone.
 */
export function rerunSummaryStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryId;
    readonly readState: MeetingSummaryRow["state"];
    readonly readUpdatedAt: string;
    readonly requestedByUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_TABLE} SET state = 'pending', summary_text = NULL, model_id = NULL, ` +
        `snapshot_id = NULL, input_tokens = 0, output_tokens = 0, model_calls = 0, ` +
        `refusal_reason = NULL, failure_error_id = NULL, model_failures = 0, ` +
        `model_failure_call = NULL, retry_at = NULL, claimed_at = NULL, ` +
        `requested_by_user_id = ?, progress_at = ?, updated_at = ? ` +
        `WHERE id = ? AND state = ? AND state <> 'pending' AND updated_at = ?`,
    )
    .bind(
      input.requestedByUserId,
      input.now,
      input.now,
      input.id,
      input.readState,
      input.readUpdatedAt,
    );
}

/** A summary's action items, gone with the text they were read out of — a re-run's other half. */
// fitness:unguarded-write — a zero is a summary that listed no action items, or one that was refused or
// failed and never wrote any; the re-run it is composed with is guarded on the summary row.
export function deleteSummaryActionItemsStatement(
  database: SqlDatabase,
  summaryId: MeetingSummaryId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MEETING_SUMMARY_ACTION_ITEM_TABLE} WHERE summary_id = ?`)
    .bind(summaryId);
}

/**
 * AN ACTION ITEM BECAME A TASK: the task recorded on the item, once. Guarded by the caller on the item
 * having no task yet, so two presses of Create task make one task — the loser's whole batch, its task
 * included, rolls back.
 */
export function recordActionItemTaskStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingSummaryActionItemId;
    readonly summaryId: MeetingSummaryId;
    readonly taskId: MatterTaskId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_ACTION_ITEM_TABLE} SET task_id = ?, updated_at = ? ` +
        `WHERE id = ? AND summary_id = ? AND task_id IS NULL`,
    )
    .bind(input.taskId, input.now, input.id, input.summaryId);
}

/**
 * A TASK MADE OF AN ACTION ITEM IS BEING DELETED: the item stops naming it, so the delete is not refused
 * by the item's reference and the item reads as one nobody has made a task of — a member may make it
 * one again. Composed by the task subsystem's own delete into the batch that removes the task, BEFORE the
 * delete, because the reference is enforced and the task row must have nothing pointing at it when it
 * goes.
 */
// fitness:unguarded-write — a zero is a task no action item was ever made into, which is nearly every
// task; the delete it is composed with is guarded by the task subsystem on the task row itself.
export function clearActionItemTaskStatement(
  database: SqlDatabase,
  input: { readonly taskId: MatterTaskId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_SUMMARY_ACTION_ITEM_TABLE} SET task_id = NULL, updated_at = ? ` +
        `WHERE task_id = ?`,
    )
    .bind(input.now, input.taskId);
}

/**
 * Whether a failed write was a second summary for one transcript — two first requests for a summary
 * racing each other. The unique index settles it; the loser answers with the winner's summary.
 */
export function isSummaryPerTranscriptConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MEETING_SUMMARY_TABLE}.transcript_id`)
  );
}
