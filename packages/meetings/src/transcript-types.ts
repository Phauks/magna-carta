import type {
  FileId,
  FileVersionId,
  MeetingId,
  MeetingRecordingId,
  MeetingRecordingTrackId,
  MeetingTranscriptId,
  MeetingTranscriptSegmentId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { RecordingDocumentState } from "./recording-document-state.ts";
import type { MeetingContributorKind } from "./types.ts";

// A FILED RECORDING'S TRANSCRIPT: the vocabularies, the stored rows, and what a surface is given.
//
// Every vocabulary below is also a SQLite CHECK on the per-firm schema. The transcript is a PARENT
// table (its segments point at it), so both of its vocabularies are whole from the migration that made
// it — `pending`, `ready` and `failed`, and the two kinds of segment.
//
// THE SEGMENT TEXT IS CONTENT — what somebody said in a meeting on a matter — and it is held to the
// rule every content column in this package is: never in a log line, never in an audit row, never in an
// Error ID's payload, never in a telemetry field. Only the rows, the filed document and the read route
// carry it.

// WHERE ONE TRANSCRIPT IS. `pending` while its tracks are being transcribed (it reads the recording's
// staged audio, which is kept until it settles); `ready` once every track is transcribed and the
// document is filed beside the audio; `failed` when it could not be finished — and `ready` and `failed`
// are the two ways it SETTLES, at which point the staged audio is let go of either way.
export const MEETING_TRANSCRIPT_STATES = Object.freeze(["pending", "ready", "failed"] as const);
export type MeetingTranscriptState = (typeof MEETING_TRANSCRIPT_STATES)[number];

// WHAT ONE SEGMENT IS. `speech` is something somebody said, attributed to the track it came from; `gap`
// is a span the transcript could not hear — a track that was lost, one the recording's ceiling refused
// to hold, or one whose audio was not there to read — said out loud, because a transcript that silently
// omitted a speaker is worse than one that says it could not hear them.
export const MEETING_TRANSCRIPT_SEGMENT_KINDS = Object.freeze(["speech", "gap"] as const);
export type MeetingTranscriptSegmentKind = (typeof MEETING_TRANSCRIPT_SEGMENT_KINDS)[number];

export interface MeetingTranscriptRow {
  readonly id: MeetingTranscriptId;
  readonly meeting_id: MeetingId;
  readonly recording_id: MeetingRecordingId;
  readonly state: MeetingTranscriptState;
  // The language the model reported for the first piece long enough to name one with confidence
  // (`LANGUAGE_DETECTION_MINIMUM_MILLISECONDS`), as it reported it; null until then, and for good when no
  // piece was that long.
  readonly language: string | null;
  // The model that produced it, as the model reported itself; null until the first piece is answered.
  readonly model_id: string | null;
  readonly segment_count: number | null;
  readonly word_count: number | null;
  // The milliseconds of audio sent to the model, which is what it is billed by — added up exactly, so a
  // half-second "yes" is counted rather than rounded away.
  readonly transcribed_milliseconds: number;
  readonly file_id: FileId | null;
  readonly file_version_id: FileVersionId | null;
  readonly failure_error_id: string | null;
  // THE CURSOR: the track it is on (an index into the recording's tracks in their stored order), the
  // staged sample of that track the next region begins at, and how many segments it has written.
  readonly cursor_track: number;
  readonly cursor_sample: number;
  readonly segments_written: number;
  // The upload session the document is being filed through, once the filing has begun.
  readonly upload_session_id: string | null;
  // How many times the sweep handed a stalled transcript on with no progress between.
  readonly attempts: number;
  // How many windows in a row met a speech model that refused for now (busy, unreachable) with no
  // progress between them. Progress resets it; past `TRANSCRIPT_MODEL_FAILURE_LIMIT` the transcript fails.
  readonly model_failures: number;
  // The last progress, sweep hand-on or scheduled retry — what a stall is measured from.
  readonly progress_at: string | null;
  // When the consumer working on the current window claimed it; null when nobody holds it.
  readonly claimed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MeetingTranscriptSegmentRow {
  readonly id: MeetingTranscriptSegmentId;
  readonly transcript_id: MeetingTranscriptId;
  // Chronological from zero once the transcript is ready. While it is pending a segment carries a
  // NEGATIVE provisional ordinal — the order it was written in — because its place among the other
  // tracks' segments is not known until every track has been transcribed; nothing reads a pending
  // transcript's segments.
  readonly ordinal: number;
  readonly kind: MeetingTranscriptSegmentKind;
  // The track it came from, and the stay that track was — null together on a gap that is nobody's.
  readonly track_id: MeetingRecordingTrackId | null;
  readonly participant_kind: MeetingContributorKind | null;
  readonly participant_id: string | null;
  readonly user_id: UserId | null;
  // Milliseconds from the recording's start, on the composite's own timeline.
  readonly started_ms: number;
  readonly ended_ms: number;
  readonly text: string;
  readonly created_at: string;
}

/** Who said a segment — the stay the track was — and the name the stay is known by. */
export interface MeetingTranscriptSpeaker {
  readonly participantKind: MeetingContributorKind;
  readonly participantId: string;
  readonly userId: UserId | null;
  readonly displayName: string;
}

/** One segment as a surface paints it. */
export interface MeetingTranscriptSegmentEntry {
  readonly id: MeetingTranscriptSegmentId;
  readonly ordinal: number;
  readonly kind: MeetingTranscriptSegmentKind;
  readonly startedMs: number;
  readonly endedMs: number;
  readonly text: string;
  readonly speaker: MeetingTranscriptSpeaker | null;
}

/** A transcript's header, as a surface paints it: identifiers, counts, a state — no content. */
export interface MeetingTranscriptSummary {
  readonly id: MeetingTranscriptId;
  readonly recordingId: MeetingRecordingId;
  readonly state: MeetingTranscriptState;
  readonly language: string | null;
  readonly segmentCount: number | null;
  readonly wordCount: number | null;
  readonly fileId: FileId | null;
  readonly failureErrorId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What the recording list carries about a recording's transcript. */
export interface MeetingTranscriptMark {
  readonly id: MeetingTranscriptId;
  readonly state: MeetingTranscriptState;
  readonly fileId: FileId | null;
}

/** One stored transcript as a surface paints its header. */
export function toTranscriptSummary(row: MeetingTranscriptRow): MeetingTranscriptSummary {
  return {
    id: row.id,
    recordingId: row.recording_id,
    state: row.state,
    language: row.language,
    segmentCount: row.segment_count,
    wordCount: row.word_count,
    fileId: row.file_id,
    failureErrorId: row.failure_error_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// WHY A READY TRANSCRIPT'S LINES ARE NOT BEING SERVED. The lines are a second copy of what the filed
// WebVTT document holds, so they are read only while that document could itself be opened: the version
// the transcript filed still exists, is not in the trash, and is not held by the scan. Otherwise the
// read answers the header with no lines and one of these, which the screen words:
//
//   - `removed` — the document was moved to the trash;
//   - `held` — the scan quarantined or flagged it;
//   - `unavailable` — the version is gone (purged, or never completed) or the file was moved onto a
//     matter the reader may not see.
export const MEETING_TRANSCRIPT_WITHHELD_REASONS = Object.freeze([
  "removed",
  "held",
  "unavailable",
] as const);
export type MeetingTranscriptWithheldReason = (typeof MEETING_TRANSCRIPT_WITHHELD_REASONS)[number];

/**
 * Whether the lines may be read, from where the transcript's own filed version stands: null when they
 * may, the reason when they may not. A version still being scanned, or one a later upload replaced on
 * the file, still exists and is still the transcript's — so it does not withhold the lines.
 */
export function transcriptLinesWithheldBy(
  documentState: RecordingDocumentState,
): MeetingTranscriptWithheldReason | null {
  return documentState === "pending" ||
    documentState === "available" ||
    documentState === "replaced"
    ? null
    : documentState;
}
