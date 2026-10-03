import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
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
import { MEETING_GUEST_STAY_TABLE } from "./meeting-statements.ts";
import { MEETING_RECORDING_TRACK_TABLE } from "./recording-statements.ts";
import type {
  MeetingTranscriptMark,
  MeetingTranscriptRow,
  MeetingTranscriptSegmentKind,
  MeetingTranscriptSegmentRow,
} from "./transcript-types.ts";
import type { MeetingContributorKind } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const MEETING_TRANSCRIPT_TABLE = "meeting_transcript";
export const MEETING_TRANSCRIPT_SEGMENT_TABLE = "meeting_transcript_segment";

// THE GATE IS THE MEETING'S, ASKED ONE LEVEL UP — the recording statements' rule, word for word. A
// member reaches a transcript through its recording, which is reached through its meeting, which is
// read through the visible-matter predicate; nothing here takes a predicate, because a statement that
// did would invite a caller to reach a transcript without first reaching its meeting. The reads marked
// as the platform's own are the transcript consumer and the sweep tending their own record.
//
// NOTHING HERE LOGS, AND NOTHING HERE PUTS TEXT ANYWHERE BUT A SEGMENT ROW. The words are content.

const TRANSCRIPT_COLUMNS = [
  "id",
  "meeting_id",
  "recording_id",
  "state",
  "language",
  "model_id",
  "segment_count",
  "word_count",
  "transcribed_seconds",
  "file_id",
  "file_version_id",
  "failure_error_id",
  "cursor_track",
  "cursor_sample",
  "segments_written",
  "upload_session_id",
  "attempts",
  "progress_at",
  "claimed_at",
  "created_at",
  "updated_at",
]
  .map((column) => `${MEETING_TRANSCRIPT_TABLE}.${column}`)
  .join(", ");

// One positional binding per value, for an `IN (…)` over a page of handles.
function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** One transcript by its handle — the transcript consumer's and the sweep's own read. */
export async function readTranscriptById(
  database: SqlDatabase,
  transcriptId: MeetingTranscriptId,
): Promise<MeetingTranscriptRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${TRANSCRIPT_COLUMNS} FROM ${MEETING_TRANSCRIPT_TABLE} WHERE id = ?`)
    .bind(transcriptId)
    .all<MeetingTranscriptRow>();
  return results[0];
}

/**
 * The transcript of one recording — for a caller that has ALREADY reached the recording through its
 * meeting (`readRecording`), which is where the gate was asked.
 */
export async function readTranscriptForRecording(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
): Promise<MeetingTranscriptRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${TRANSCRIPT_COLUMNS} FROM ${MEETING_TRANSCRIPT_TABLE} WHERE recording_id = ?`)
    .bind(recordingId)
    .all<MeetingTranscriptRow>();
  return results[0];
}

/**
 * WHAT A PAGE OF RECORDINGS SAYS ABOUT THEIR TRANSCRIPTS, in one read for the page — the recording
 * list's, whose rows the caller reached through the meeting. A recording with no transcript is absent
 * from the map.
 */
export async function readTranscriptMarks(
  database: SqlDatabase,
  recordingIds: readonly MeetingRecordingId[],
): Promise<ReadonlyMap<MeetingRecordingId, MeetingTranscriptMark>> {
  if (recordingIds.length === 0) return new Map();
  const { results } = await database
    .prepare(
      `SELECT id, recording_id, state, file_id FROM ${MEETING_TRANSCRIPT_TABLE} ` +
        `WHERE recording_id IN (${placeholders(recordingIds.length)})`,
    )
    .bind(...recordingIds)
    .all<{
      id: MeetingTranscriptId;
      recording_id: MeetingRecordingId;
      state: MeetingTranscriptRow["state"];
      file_id: FileId | null;
    }>();
  return new Map(
    results.map((row) => [row.recording_id, { id: row.id, state: row.state, fileId: row.file_id }]),
  );
}

/** The most segments one page of the transcript read carries. */
export const MAX_TRANSCRIPT_SEGMENT_PAGE_SIZE = 200;

/** A segment row with the name its stay is known by. */
export interface MeetingTranscriptSegmentListRow extends MeetingTranscriptSegmentRow {
  readonly display_name: string | null;
}

/**
 * A READY transcript's lines in reading order, from just after `afterOrdinal`, one row past the page
 * (the answer to "is there more"). The name is the member's current display name for a member and the
 * name typed at the door for a guest — read off the stay at the moment of asking, never stored on the
 * line. Only the final, non-negative ordinals are read: a pending transcript's provisional lines are
 * not in any order a reader could use.
 */
export async function listTranscriptSegments(
  database: SqlDatabase,
  transcriptId: MeetingTranscriptId,
  options: { readonly afterOrdinal?: number; readonly limit: number },
): Promise<readonly MeetingTranscriptSegmentListRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.id, ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.transcript_id, ` +
        `${MEETING_TRANSCRIPT_SEGMENT_TABLE}.ordinal, ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.kind, ` +
        `${MEETING_TRANSCRIPT_SEGMENT_TABLE}.track_id, ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.participant_kind, ` +
        `${MEETING_TRANSCRIPT_SEGMENT_TABLE}.participant_id, ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.user_id, ` +
        `${MEETING_TRANSCRIPT_SEGMENT_TABLE}.started_ms, ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.ended_ms, ` +
        `${MEETING_TRANSCRIPT_SEGMENT_TABLE}.text, ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.created_at, ` +
        `CASE WHEN ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.participant_id IS NULL THEN NULL ` +
        `ELSE COALESCE(member.display_name, ${MEETING_GUEST_STAY_TABLE}.confirmed_name, '') END ` +
        `AS display_name ` +
        `FROM ${MEETING_TRANSCRIPT_SEGMENT_TABLE} ` +
        `LEFT JOIN member ON member.user_id = ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.user_id ` +
        `LEFT JOIN ${MEETING_GUEST_STAY_TABLE} ` +
        `ON ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.participant_kind = 'guest' ` +
        `AND ${MEETING_GUEST_STAY_TABLE}.id = ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.participant_id ` +
        `WHERE ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.transcript_id = ? ` +
        `AND ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.ordinal > ? ` +
        `ORDER BY ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.ordinal ASC LIMIT ?`,
    )
    .bind(transcriptId, options.afterOrdinal ?? -1, options.limit + 1)
    .all<MeetingTranscriptSegmentListRow>();
  return results;
}

/**
 * The words of the line one track wrote LAST — the prompt for that track's next piece. A provisional
 * ordinal is minus the order of writing, so the most recent is the lowest. The consumer's own read.
 */
export async function readLastTrackWords(
  database: SqlDatabase,
  transcriptId: MeetingTranscriptId,
  trackId: MeetingRecordingTrackId,
): Promise<string | null> {
  const { results } = await database
    .prepare(
      `SELECT text FROM ${MEETING_TRANSCRIPT_SEGMENT_TABLE} ` +
        `WHERE transcript_id = ? AND track_id = ? AND kind = 'speech' ` +
        `ORDER BY ordinal ASC LIMIT 1`,
    )
    .bind(transcriptId, trackId)
    .all<{ text: string }>();
  return results[0]?.text ?? null;
}

/** Whether a transcript holds any speech at all — the settle's read. */
export async function hasTranscriptSpeech(
  database: SqlDatabase,
  transcriptId: MeetingTranscriptId,
): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM ${MEETING_TRANSCRIPT_SEGMENT_TABLE} ` +
        `WHERE transcript_id = ? AND kind = 'speech') AS heard`,
    )
    .bind(transcriptId)
    .all<{ heard: number }>();
  return (results[0]?.heard ?? 0) === 1;
}

/** The most transcripts one sweep reads for one firm in one pass. */
export const TRANSCRIPT_SWEEP_BATCH = 50;

// When anything last touched a pending transcript: its creation, its last window's claim, its last
// progress or hand-on. Text instants in one format compare as instants; the creation is never null.
const TRANSCRIPT_LAST_TOUCHED = `MAX(created_at, COALESCE(progress_at, ''), COALESCE(claimed_at, ''))`;

/**
 * Transcripts still `pending` that nothing has touched since an instant — the sweep's candidates for
 * a hand-on, least recently touched first, a bounded batch. The sweep's own read.
 */
export async function listStalledPendingTranscripts(
  database: SqlDatabase,
  stalledSince: string,
): Promise<readonly MeetingTranscriptRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${TRANSCRIPT_COLUMNS} FROM ${MEETING_TRANSCRIPT_TABLE} ` +
        `WHERE state = 'pending' AND ${TRANSCRIPT_LAST_TOUCHED} < ? ` +
        `ORDER BY ${TRANSCRIPT_LAST_TOUCHED} ASC, id ASC LIMIT ?`,
    )
    .bind(stalledSince, TRANSCRIPT_SWEEP_BATCH)
    .all<MeetingTranscriptRow>();
  return results;
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/** A recording's transcript, pending from the instant the recording is filed. */
export function insertTranscriptStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingTranscriptId;
    readonly meetingId: MeetingId;
    readonly recordingId: MeetingRecordingId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_TRANSCRIPT_TABLE} (id, meeting_id, recording_id, state, created_at, ` +
        `updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(input.id, input.meetingId, input.recordingId, input.now, input.now);
}

/** Where a transcript's work stands — what a claim and a progress are both stamped against. */
export interface TranscriptCursor {
  readonly track: number;
  readonly sample: number;
  readonly segmentsWritten: number;
}

/**
 * ONE CONSUMER TAKES THE NEXT WINDOW: the claim is stamped on a transcript still `pending` whose cursor
 * is where this consumer read it, and that nobody holds — or whose holder's lease ran out. Guarded by
 * the caller: a second delivery of the same message stops here before it sends a byte to the model.
 */
export function claimTranscriptWindowStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingTranscriptId;
    readonly cursor: TranscriptCursor;
    readonly now: string;
    readonly leaseExpiredBefore: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TRANSCRIPT_TABLE} SET claimed_at = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'pending' AND cursor_track = ? AND cursor_sample = ? ` +
        `AND segments_written = ? AND (claimed_at IS NULL OR claimed_at < ?)`,
    )
    .bind(
      input.now,
      input.now,
      input.id,
      input.cursor.track,
      input.cursor.sample,
      input.cursor.segmentsWritten,
      input.leaseExpiredBefore,
    );
}

/**
 * A CLAIM LET GO by the consumer that took it, addressed by the instant it was taken at, so it can
 * never release a claim somebody else holds.
 */
// fitness:unguarded-write — a zero means the claim was already released by the window's own progress,
// or the transcript settled, or the lease ran out and somebody else took it; none is this consumer's.
export function releaseTranscriptClaimStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingTranscriptId; readonly claimedAt: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TRANSCRIPT_TABLE} SET claimed_at = NULL WHERE id = ? AND claimed_at = ?`,
    )
    .bind(input.id, input.claimedAt);
}

/** One line of a transcript, written with its provisional ordinal. */
export function insertTranscriptSegmentStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingTranscriptSegmentId;
    readonly transcriptId: MeetingTranscriptId;
    readonly ordinal: number;
    readonly kind: MeetingTranscriptSegmentKind;
    readonly trackId: MeetingRecordingTrackId | null;
    readonly participantKind: MeetingContributorKind | null;
    readonly participantId: string | null;
    readonly userId: UserId | null;
    readonly startedMs: number;
    readonly endedMs: number;
    readonly text: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_TRANSCRIPT_SEGMENT_TABLE} (id, transcript_id, ordinal, kind, track_id, ` +
        `participant_kind, participant_id, user_id, started_ms, ended_ms, text, created_at) ` +
        `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.transcriptId,
      input.ordinal,
      input.kind,
      input.trackId,
      input.participantKind,
      input.participantId,
      input.userId,
      input.startedMs,
      input.endedMs,
      input.text,
      input.now,
    );
}

/**
 * THE CURSOR MOVED: from where this consumer claimed it to where it now stands, with the segments it
 * wrote counted, the seconds of audio the model was sent added, and the model and language recorded the
 * first time the model names them. Guarded by the caller on the cursor it moved FROM and on its own
 * claim, so a consumer whose lease ran out and was taken over writes nothing. Progress resets the
 * hand-on count. With `releaseClaim` the claim is let go in the same write — the consumer is handing
 * the next window to the queue.
 */
export function recordTranscriptProgressStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingTranscriptId;
    readonly claimedAt: string;
    readonly from: TranscriptCursor;
    readonly to: TranscriptCursor;
    readonly transcribedSeconds: number;
    readonly modelId: string | null;
    readonly language: string | null;
    readonly releaseClaim: boolean;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TRANSCRIPT_TABLE} SET cursor_track = ?, cursor_sample = ?, ` +
        `segments_written = ?, transcribed_seconds = transcribed_seconds + ?, ` +
        `model_id = COALESCE(model_id, ?), language = COALESCE(language, ?), ` +
        `progress_at = ?, attempts = 0, ` +
        `claimed_at = CASE WHEN ? = 1 THEN NULL ELSE claimed_at END, updated_at = ? ` +
        `WHERE id = ? AND state = 'pending' AND claimed_at = ? AND cursor_track = ? ` +
        `AND cursor_sample = ? AND segments_written = ?`,
    )
    .bind(
      input.to.track,
      input.to.sample,
      input.to.segmentsWritten,
      input.transcribedSeconds,
      input.modelId,
      input.language,
      input.now,
      input.releaseClaim ? 1 : 0,
      input.now,
      input.id,
      input.claimedAt,
      input.from.track,
      input.from.sample,
      input.from.segmentsWritten,
    );
}

/**
 * EVERY LINE TO ITS PLACE: the transcript's lines renumbered from zero in reading order — when each
 * began, then when it ended, then its handle (`compareLines` in `transcript-assembly.ts` is the same
 * order). One statement over a window function. The lines it moves all carry negative provisional
 * ordinals, and a negative ordinal never collides with a final one, so no row is ever refused by the
 * unique index on its way to its place.
 */
// fitness:unguarded-write — a zero is the ordinary outcome for a recording in which nothing was heard
// and nothing was lost; the settle that composes it is guarded on the transcript row.
export function renumberTranscriptSegmentsStatement(
  database: SqlDatabase,
  transcriptId: MeetingTranscriptId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TRANSCRIPT_SEGMENT_TABLE} SET ordinal = placed.position FROM (` +
        `SELECT id, ROW_NUMBER() OVER (ORDER BY started_ms ASC, ended_ms ASC, id ASC) - 1 AS position ` +
        `FROM ${MEETING_TRANSCRIPT_SEGMENT_TABLE} WHERE transcript_id = ?) AS placed ` +
        `WHERE ${MEETING_TRANSCRIPT_SEGMENT_TABLE}.id = placed.id`,
    )
    .bind(transcriptId);
}

/**
 * THE FILING HAS BEGUN: the upload session the document is written through, on a transcript nobody has
 * begun filing, by the consumer that holds it. Guarded by the caller, and committed in ONE batch with
 * the session itself, the gap lines and the renumbering — so the transcript is assembled exactly once,
 * and a second delivery that got this far is refused whole.
 */
export function beginTranscriptFilingStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingTranscriptId;
    readonly uploadSessionId: string;
    readonly claimedAt: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TRANSCRIPT_TABLE} SET upload_session_id = ?, progress_at = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'pending' AND upload_session_id IS NULL AND claimed_at = ?`,
    )
    .bind(input.uploadSessionId, input.now, input.now, input.id, input.claimedAt);
}

/**
 * THE TRANSCRIPT IS ON THE MATTER: `ready`, naming the document and its version, with the counts. Guarded
 * by the caller on `pending`, so a transcript the sweep failed in the meantime is not filed over.
 */
export function readyTranscriptStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingTranscriptId;
    readonly fileId: FileId;
    readonly fileVersionId: FileVersionId;
    readonly segmentCount: number;
    readonly wordCount: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TRANSCRIPT_TABLE} SET state = 'ready', file_id = ?, file_version_id = ?, ` +
        `segment_count = ?, word_count = ?, claimed_at = NULL, progress_at = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'pending'`,
    )
    .bind(
      input.fileId,
      input.fileVersionId,
      input.segmentCount,
      input.wordCount,
      input.now,
      input.now,
      input.id,
    );
}

/**
 * A TRANSCRIPT THAT CANNOT BE FINISHED: `failed`, with the Error ID the standard pipeline recorded and
 * never a message. Guarded by the caller on `pending`, so a failure that lost the race to a filing rolls
 * back whole rather than abandoning the version of a document already on the matter.
 */
export function failTranscriptStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingTranscriptId;
    readonly failureErrorId: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TRANSCRIPT_TABLE} SET state = 'failed', failure_error_id = ?, ` +
        `claimed_at = NULL, updated_at = ? WHERE id = ? AND state = 'pending'`,
    )
    .bind(input.failureErrorId, input.now, input.id);
}

/** A stalled transcript handed on again: one more attempt counted, the stall measured from now. */
// fitness:unguarded-write — a zero means the transcript moved, settled or was claimed between the
// sweep's read and this write; the message sent beside it then finds nothing to do, which is the
// outcome either way.
export function recordTranscriptRetryStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingTranscriptId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TRANSCRIPT_TABLE} SET attempts = attempts + 1, progress_at = ?, ` +
        `updated_at = ? WHERE id = ? AND state = 'pending'`,
    )
    .bind(input.now, input.now, input.id);
}

/** The tracks a transcript's recording holds that still name a staged object — the settle's release. */
export async function listStagedTracksOfRecording(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
): Promise<readonly { readonly id: MeetingRecordingTrackId; readonly stagingKey: string }[]> {
  const { results } = await database
    .prepare(
      `SELECT id, staging_key FROM ${MEETING_RECORDING_TRACK_TABLE} ` +
        `WHERE recording_id = ? AND staging_key IS NOT NULL`,
    )
    .bind(recordingId)
    .all<{ id: MeetingRecordingTrackId; staging_key: string }>();
  return results.map((row) => ({ id: row.id, stagingKey: row.staging_key }));
}
