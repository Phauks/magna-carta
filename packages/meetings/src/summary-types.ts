import type {
  MatterTaskId,
  MeetingId,
  MeetingRecordingId,
  MeetingSummaryActionItemId,
  MeetingSummaryId,
  MeetingTranscriptId,
  UserId,
} from "@magna-carta/identifiers/types";

// A READY TRANSCRIPT'S SUMMARY: the vocabularies, the stored rows, and what a surface is given.
//
// Every vocabulary below is also a SQLite CHECK on the per-firm schema, and the summary is a PARENT
// table (its action items point at it), so both are whole from the migration that made it.
//
// THE SUMMARY TEXT AND EVERY ACTION ITEM'S TEXT ARE DERIVED CONTENT AND WORK PRODUCT — the platform's
// characterization of a privileged conversation — and are held to the rule the transcript's words are:
// never in a log line, never in an audit row, never in an Error ID's payload, never in a telemetry field.
// Only the rows and the read route carry them.

// WHERE ONE SUMMARY IS. `pending` while a model is writing it; `ready` once it is written; `failed` when
// it could not be written (with an Error ID, and a member may run it again); `refused` when it was never
// going to be written, with the reason.
export const MEETING_SUMMARY_STATES = Object.freeze([
  "pending",
  "ready",
  "failed",
  "refused",
] as const);
export type MeetingSummaryState = (typeof MEETING_SUMMARY_STATES)[number];

// WHY A SUMMARY WAS NOT WRITTEN. None is an error and none carries an Error ID:
//
//   - `disabled` — the firm has not switched meeting summaries on;
//   - `not-eligible` — the firm chose a reasoning model run by a third-party provider and has not allowed
//     its content to reach one (the firm's AI-processing eligibility);
//   - `transcript-empty` — the transcript holds no speech, so there is nothing to summarize.
export const MEETING_SUMMARY_REFUSAL_REASONS = Object.freeze([
  "not-eligible",
  "disabled",
  "transcript-empty",
] as const);
export type MeetingSummaryRefusalReason = (typeof MEETING_SUMMARY_REFUSAL_REASONS)[number];

export interface MeetingSummaryRow {
  readonly id: MeetingSummaryId;
  readonly meeting_id: MeetingId;
  readonly recording_id: MeetingRecordingId;
  readonly transcript_id: MeetingTranscriptId;
  readonly state: MeetingSummaryState;
  // The model the run was sent to and the snapshot that answered; null until a run reaches a model.
  readonly model_id: string | null;
  readonly snapshot_id: string | null;
  // What the model wrote, once ready. Derived content.
  readonly summary_text: string | null;
  // The provider's own usage, added up across every call the run made.
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly model_calls: number;
  readonly refusal_reason: MeetingSummaryRefusalReason | null;
  readonly failure_error_id: string | null;
  // How many runs in a row met a model that refused for now; past the consumer's limit it fails.
  readonly model_failures: number;
  // When the consumer writing it claimed it; null when nobody holds it.
  readonly claimed_at: string | null;
  // The last claim released, retry scheduled or run settled.
  readonly progress_at: string | null;
  // Who asked for the run now on the row; null for the platform's own first run.
  readonly requested_by_user_id: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MeetingSummaryActionItemRow {
  readonly id: MeetingSummaryActionItemId;
  readonly summary_id: MeetingSummaryId;
  readonly ordinal: number;
  readonly text: string;
  readonly owner_user_id: UserId | null;
  readonly due_on: string | null;
  readonly task_id: MatterTaskId | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** An action item as a surface paints it: its owner's name is read at the moment of asking. */
export interface MeetingSummaryActionItemEntry {
  readonly id: MeetingSummaryActionItemId;
  readonly ordinal: number;
  readonly text: string;
  readonly owner: { readonly userId: UserId; readonly displayName: string } | null;
  readonly dueOn: string | null;
  readonly taskId: MatterTaskId | null;
}

/** A summary's header, as a surface paints it: handles, a state, the model — and no content. */
export interface MeetingSummaryHeader {
  readonly id: MeetingSummaryId;
  readonly transcriptId: MeetingTranscriptId;
  readonly recordingId: MeetingRecordingId;
  readonly state: MeetingSummaryState;
  readonly refusalReason: MeetingSummaryRefusalReason | null;
  readonly failureErrorId: string | null;
  readonly modelId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What the recording list carries about a recording's summary. */
export interface MeetingSummaryMark {
  readonly id: MeetingSummaryId;
  readonly state: MeetingSummaryState;
  readonly refusalReason: MeetingSummaryRefusalReason | null;
}

/** One stored summary's header. */
export function toSummaryHeader(row: MeetingSummaryRow): MeetingSummaryHeader {
  return {
    id: row.id,
    transcriptId: row.transcript_id,
    recordingId: row.recording_id,
    state: row.state,
    refusalReason: row.refusal_reason,
    failureErrorId: row.failure_error_id,
    modelId: row.model_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** One action item parsed out of a model's answer, before it is written. */
export interface ParsedActionItem {
  readonly text: string;
  readonly ownerUserId: UserId | null;
  readonly dueOn: string | null;
}

/** A summary parsed out of a model's answer, before it is written. */
export interface ParsedSummary {
  readonly summaryText: string;
  readonly actionItems: readonly ParsedActionItem[];
}
