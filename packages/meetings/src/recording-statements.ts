import { AUDIT_LOG_TABLE } from "@magna-carta/data-access/audit-statements";
import { keysetClause, type SortCursor } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FileId,
  FileVersionId,
  MatterId,
  MeetingId,
  MeetingRecordingId,
  MeetingRecordingNoticeId,
  MeetingRecordingTrackId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";
import { MEETING_GUEST_STAY_TABLE } from "./meeting-statements.ts";
import type {
  MeetingRecordingNoticeReason,
  MeetingRecordingNoticeRow,
  MeetingRecordingParticipant,
  MeetingRecordingRow,
  MeetingRecordingState,
  MeetingRecordingStateOfRoom,
  MeetingRecordingStopReason,
  MeetingRecordingTrackRow,
  MeetingRecordingTrackState,
} from "./recording-types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const MEETING_RECORDING_TABLE = "meeting_recording";
export const MEETING_RECORDING_TRACK_TABLE = "meeting_recording_track";
export const MEETING_RECORDING_NOTICE_TABLE = "meeting_recording_notice";

// THE GATE IS THE MEETING'S, AND IT IS ASKED ONE LEVEL UP — the chat and poll statements' rule. Every
// read here is addressed to a meeting the caller has ALREADY been resolved to through `readMeeting`,
// which is where the visible-matter predicate is composed; a recording has no visibility rule of its
// own, and a statement that took a predicate would invite a caller to reach a recording without first
// reaching its meeting. The two exceptions are the recorder's and the sink's reads, which are the
// platform closing and serving its own record rather than a member asking a question, and which say so
// where they are declared.

const RECORDING_COLUMNS = [
  "id",
  "meeting_id",
  "matter_id",
  "breakout_id",
  "state",
  "started_by_user_id",
  "started_at",
  "stopped_by_user_id",
  "stopped_at",
  "stop_reason",
  "track_count",
  "captured_seconds",
  "file_id",
  "file_version_id",
  "failure_error_id",
  "compose_upload_session_id",
  "compose_parts_done",
  "compose_parts",
  "compose_attempts",
  "compose_progress_at",
  "compose_claimed_at",
  "created_at",
  "updated_at",
]
  .map((column) => `${MEETING_RECORDING_TABLE}.${column}`)
  .join(", ");

const TRACK_COLUMNS = [
  "id",
  "recording_id",
  "participant_kind",
  "participant_id",
  "user_id",
  "track_name",
  "adapter_id",
  "staging_key",
  "first_frame_at",
  "last_frame_at",
  "segments",
  "frames_received",
  "frames_dropped",
  "state",
  "created_at",
  "updated_at",
]
  .map((column) => `${MEETING_RECORDING_TRACK_TABLE}.${column}`)
  .join(", ");

// One positional binding per value, for an `IN (…)` over a page of handles. The values themselves
// are always bound — only the count of `?` is spliced.
function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/**
 * The recording running in a meeting's main room, if any. A breakout's recordings are a breakout's,
 * and `breakout_id IS NULL` is the same predicate the one-running index is partial on, so the read and
 * the constraint answer the same question.
 */
export async function readRunningRecording(
  database: SqlDatabase,
  meetingId: MeetingId,
): Promise<MeetingRecordingRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${RECORDING_COLUMNS} FROM ${MEETING_RECORDING_TABLE} ` +
        `WHERE meeting_id = ? AND state = 'recording' AND breakout_id IS NULL`,
    )
    .bind(meetingId)
    .all<MeetingRecordingRow>();
  return results[0];
}

/**
 * One recording, addressed by its own handle AND by the meeting it belongs to — so a recording in a
 * room the caller was never resolved to is as absent as one that names nothing.
 */
export async function readRecording(
  database: SqlDatabase,
  meetingId: MeetingId,
  recordingId: MeetingRecordingId,
): Promise<MeetingRecordingRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${RECORDING_COLUMNS} FROM ${MEETING_RECORDING_TABLE} WHERE id = ? AND meeting_id = ?`,
    )
    .bind(recordingId, meetingId)
    .all<MeetingRecordingRow>();
  return results[0];
}

/**
 * One recording by its handle alone — the RECORDER's read and the SINK's.
 *
 * Deliberately NOT through the meeting: the caller is the platform serving and settling its own
 * record (the recorder Durable Object, keyed by the recording, and the socket the routing service
 * dials), not a member asking a question, and there is no reader here for a gate to protect anything
 * from. Every member-facing read goes through `readRecording` above.
 */
export async function readRecordingById(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
): Promise<MeetingRecordingRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${RECORDING_COLUMNS} FROM ${MEETING_RECORDING_TABLE} WHERE id = ?`)
    .bind(recordingId)
    .all<MeetingRecordingRow>();
  return results[0];
}

/** The most recordings one page of a meeting's list carries. */
export const MAX_RECORDING_PAGE_SIZE = 50;

/** A recording row with the two names a surface paints beside it. */
export interface MeetingRecordingListRow extends MeetingRecordingRow {
  readonly started_by_display_name: string;
  readonly stopped_by_display_name: string | null;
}

/**
 * One meeting's recordings, NEWEST FIRST, walked by (started_at, id). Asks for one row past the page,
 * and that row is the answer to "is there more" rather than part of the page. The names are the
 * members' current display names, read through a join rather than copied onto the row.
 */
export async function listRecordings(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: { readonly cursor?: SortCursor; readonly limit: number },
): Promise<readonly MeetingRecordingListRow[]> {
  const bindings: unknown[] = [meetingId];
  const keyset = keysetClause(
    bindings,
    options.cursor,
    `${MEETING_RECORDING_TABLE}.started_at`,
    `${MEETING_RECORDING_TABLE}.id`,
    false,
  );
  const { results } = await database
    .prepare(
      `SELECT ${RECORDING_COLUMNS}, ` +
        `COALESCE(starter.display_name, '') AS started_by_display_name, ` +
        `stopper.display_name AS stopped_by_display_name ` +
        `FROM ${MEETING_RECORDING_TABLE} ` +
        `LEFT JOIN member AS starter ON starter.user_id = ${MEETING_RECORDING_TABLE}.started_by_user_id ` +
        `LEFT JOIN member AS stopper ON stopper.user_id = ${MEETING_RECORDING_TABLE}.stopped_by_user_id ` +
        `WHERE ${MEETING_RECORDING_TABLE}.meeting_id = ? ${keyset}` +
        `ORDER BY ${MEETING_RECORDING_TABLE}.started_at DESC, ${MEETING_RECORDING_TABLE}.id DESC LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<MeetingRecordingListRow>();
  return results;
}

/**
 * THE STATE OF EACH ROOM'S MOST RECENT RECORDING, for a page of meetings at once.
 *
 * One read per PAGE rather than one per row: a meetings list is fifty rows and a subquery per row
 * would be fifty reads to answer a question most rows answer with "none". A room never recorded is
 * absent from the map, which the caller reads as `none`.
 */
export async function readRecordingStatesOfRooms(
  database: SqlDatabase,
  meetingIds: readonly MeetingId[],
): Promise<ReadonlyMap<MeetingId, MeetingRecordingStateOfRoom>> {
  if (meetingIds.length === 0) return new Map();
  const { results } = await database
    .prepare(
      `SELECT latest.meeting_id AS meeting_id, latest.state AS state FROM ${MEETING_RECORDING_TABLE} AS latest ` +
        `WHERE latest.meeting_id IN (${placeholders(meetingIds.length)}) ` +
        `AND latest.breakout_id IS NULL ` +
        `AND NOT EXISTS (SELECT 1 FROM ${MEETING_RECORDING_TABLE} AS later ` +
        `WHERE later.meeting_id = latest.meeting_id AND later.breakout_id IS NULL ` +
        `AND (later.started_at > latest.started_at ` +
        `OR (later.started_at = latest.started_at AND later.id > latest.id)))`,
    )
    .bind(...meetingIds)
    .all<{ meeting_id: MeetingId; state: MeetingRecordingState }>();
  return new Map(results.map((row) => [row.meeting_id, row.state]));
}

/** Every track of one recording, oldest first. Bounded by the track ceiling plus its overflow rows. */
export async function listRecordingTracks(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
): Promise<readonly MeetingRecordingTrackRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${TRACK_COLUMNS} FROM ${MEETING_RECORDING_TRACK_TABLE} WHERE recording_id = ? ` +
        `ORDER BY created_at ASC, id ASC`,
    )
    .bind(recordingId)
    .all<MeetingRecordingTrackRow>();
  return results;
}

/**
 * WHAT THE SINK ASKS BEFORE IT OPENS ANYTHING: is this recording still running, and is this track ROW
 * still open. A token for a settled recording, or for a track the recorder has already closed, opens
 * nothing — the signature proves the token was minted here, and this is what proves it still means
 * something. Addressed by the track's own handle, which is what the token names (never the track name
 * a browser chose), and answered in one read of one row joined to its recording. The platform's own
 * read (see `readRecordingById`).
 */
export async function readSinkTrackById(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  trackId: MeetingRecordingTrackId,
): Promise<
  | {
      readonly recordingState: MeetingRecordingState;
      readonly trackState: MeetingRecordingTrackState;
    }
  | undefined
> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_RECORDING_TABLE}.state AS recording_state, ` +
        `${MEETING_RECORDING_TRACK_TABLE}.state AS track_state ` +
        `FROM ${MEETING_RECORDING_TRACK_TABLE} JOIN ${MEETING_RECORDING_TABLE} ` +
        `ON ${MEETING_RECORDING_TABLE}.id = ${MEETING_RECORDING_TRACK_TABLE}.recording_id ` +
        `WHERE ${MEETING_RECORDING_TRACK_TABLE}.recording_id = ? ` +
        `AND ${MEETING_RECORDING_TRACK_TABLE}.id = ?`,
    )
    .bind(recordingId, trackId)
    .all<{ recording_state: MeetingRecordingState; track_state: MeetingRecordingTrackState }>();
  const row = results[0];
  return row === undefined
    ? undefined
    : { recordingState: row.recording_state, trackState: row.track_state };
}

/** The most notices one page of the consent read carries. */
export const MAX_NOTICE_PAGE_SIZE = 100;

/** A notice row with the name the stay is known by. */
export interface MeetingRecordingNoticeListRow extends MeetingRecordingNoticeRow {
  readonly display_name: string;
}

/**
 * Who was told, and when — OLDEST FIRST, because the consent record is read as a narrative: the start,
 * every arrival, the stop. Walked by (delivered_at, id).
 *
 * The name is the member's current display name for a member and the name typed at the door for a
 * guest — read off the stay at the moment of asking, never stored on the notice.
 */
export async function listRecordingNotices(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  options: { readonly cursor?: SortCursor; readonly limit: number },
): Promise<readonly MeetingRecordingNoticeListRow[]> {
  const bindings: unknown[] = [recordingId];
  const keyset = keysetClause(
    bindings,
    options.cursor,
    `${MEETING_RECORDING_NOTICE_TABLE}.delivered_at`,
    `${MEETING_RECORDING_NOTICE_TABLE}.id`,
    true,
  );
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_RECORDING_NOTICE_TABLE}.id, ${MEETING_RECORDING_NOTICE_TABLE}.recording_id, ` +
        `${MEETING_RECORDING_NOTICE_TABLE}.participant_kind, ` +
        `${MEETING_RECORDING_NOTICE_TABLE}.participant_id, ${MEETING_RECORDING_NOTICE_TABLE}.user_id, ` +
        `${MEETING_RECORDING_NOTICE_TABLE}.reason, ${MEETING_RECORDING_NOTICE_TABLE}.delivered_at, ` +
        `${MEETING_RECORDING_NOTICE_TABLE}.created_at, ` +
        `COALESCE(member.display_name, ${MEETING_GUEST_STAY_TABLE}.confirmed_name, '') AS display_name ` +
        `FROM ${MEETING_RECORDING_NOTICE_TABLE} ` +
        `LEFT JOIN member ON member.user_id = ${MEETING_RECORDING_NOTICE_TABLE}.user_id ` +
        `LEFT JOIN ${MEETING_GUEST_STAY_TABLE} ` +
        `ON ${MEETING_RECORDING_NOTICE_TABLE}.participant_kind = 'guest' ` +
        `AND ${MEETING_GUEST_STAY_TABLE}.id = ${MEETING_RECORDING_NOTICE_TABLE}.participant_id ` +
        `WHERE ${MEETING_RECORDING_NOTICE_TABLE}.recording_id = ? ${keyset}` +
        `ORDER BY ${MEETING_RECORDING_NOTICE_TABLE}.delivered_at ASC, ` +
        `${MEETING_RECORDING_NOTICE_TABLE}.id ASC LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<MeetingRecordingNoticeListRow>();
  return results;
}

/** The constraint the one-running index raises when two Record presses race. */
export function isRunningRecordingConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("meeting_recording_one_running_unique_index") ||
    (message.includes("UNIQUE constraint failed") &&
      message.includes("meeting_recording.meeting_id"))
  );
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export interface InsertRecordingInput {
  readonly id: MeetingRecordingId;
  readonly meetingId: MeetingId;
  readonly matterId: MatterId;
  readonly startedByUserId: UserId;
  readonly trackCount: number;
  readonly now: string;
}

/** A recording, running from the instant it is written. The main room's: `breakout_id` is null. */
export function insertRecordingStatement(
  database: SqlDatabase,
  input: InsertRecordingInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_RECORDING_TABLE} (id, meeting_id, matter_id, breakout_id, state, ` +
        `started_by_user_id, started_at, track_count, created_at, updated_at) ` +
        `VALUES (?, ?, ?, NULL, 'recording', ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.meetingId,
      input.matterId,
      input.startedByUserId,
      input.now,
      input.trackCount,
      input.now,
      input.now,
    );
}

export interface InsertRecordingTrackInput extends MeetingRecordingParticipant {
  readonly id: MeetingRecordingTrackId;
  readonly recordingId: MeetingRecordingId;
  readonly trackName: string;
  // `lost` for a track the ceiling refused to hold; `open` for every other.
  readonly state: "open" | "lost";
  readonly now: string;
}

export function insertRecordingTrackStatement(
  database: SqlDatabase,
  input: InsertRecordingTrackInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_RECORDING_TRACK_TABLE} (id, recording_id, participant_kind, ` +
        `participant_id, user_id, track_name, state, created_at, updated_at) ` +
        `VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.recordingId,
      input.participantKind,
      input.participantId,
      input.userId,
      input.trackName,
      input.state,
      input.now,
      input.now,
    );
}

/**
 * One more track counted on a running recording — a late arrival's, or one the ceiling refused.
 */
// fitness:unguarded-write — a zero means the recording stopped between the recorder's read and this
// write, and the track row written beside it is still the truth about an arrival the room saw; the
// count on a stopped recording is settled by the stop itself.
export function incrementTrackCountStatement(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET track_count = track_count + 1, updated_at = ? ` +
        `WHERE id = ? AND state = 'recording'`,
    )
    .bind(now, recordingId);
}

export interface InsertRecordingNoticeInput extends MeetingRecordingParticipant {
  readonly id: MeetingRecordingNoticeId;
  readonly recordingId: MeetingRecordingId;
  readonly reason: MeetingRecordingNoticeReason;
  readonly deliveredAt: string;
}

export function insertRecordingNoticeStatement(
  database: SqlDatabase,
  input: InsertRecordingNoticeInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_RECORDING_NOTICE_TABLE} (id, recording_id, participant_kind, ` +
        `participant_id, user_id, reason, delivered_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.recordingId,
      input.participantKind,
      input.participantId,
      input.userId,
      input.reason,
      input.deliveredAt,
      input.deliveredAt,
    );
}

/**
 * The stop, on a recording that is still running — guarded, so a stop that lost a race with another
 * (a second Stop, the meeting ending, the recorder giving up on every track) rolls its whole batch back
 * rather than moving an instant and a reason a record already carries.
 */
export function stopRecordingStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingRecordingId;
    readonly stoppedByUserId: UserId | null;
    readonly stopReason: MeetingRecordingStopReason;
    readonly trackCount: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET state = 'composing', stopped_by_user_id = ?, ` +
        `stopped_at = ?, stop_reason = ?, track_count = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'recording'`,
    )
    .bind(
      input.stoppedByUserId,
      input.now,
      input.stopReason,
      input.trackCount,
      input.now,
      input.id,
    );
}

/**
 * EVERY OPEN TRACK CLOSED AT ONE INSTANT, which is what a stop is.
 */
// fitness:unguarded-write — a zero is the ordinary outcome for a recording whose participants had all
// left or been lost already; the stop itself is guarded on the recording row.
export function closeOpenTracksStatement(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TRACK_TABLE} SET state = 'closed', updated_at = ? ` +
        `WHERE recording_id = ? AND state = 'open'`,
    )
    .bind(now, recordingId);
}

/**
 * The adapter carrying a track, and where its audio is staged — written once the recorder has both.
 */
// fitness:unguarded-write — a zero means the track closed (its participant left, or the recording
// stopped) while the adapter was being opened; the recorder closes that adapter on its own next pass,
// and nothing about the closed row needs the handle.
export function recordTrackSinkStatement(
  database: SqlDatabase,
  input: {
    readonly recordingId: MeetingRecordingId;
    readonly trackName: string;
    readonly adapterId: string;
    readonly stagingKey: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TRACK_TABLE} SET adapter_id = ?, staging_key = ?, updated_at = ? ` +
        `WHERE recording_id = ? AND track_name = ? AND state = 'open'`,
    )
    .bind(input.adapterId, input.stagingKey, input.now, input.recordingId, input.trackName);
}

/**
 * WHAT ONE TRACK ACTUALLY CARRIED, written when the recorder lets go of it — and, when `state` is
 * given, the state it ends in (`closed` for a participant who left, `lost` for a socket that did not
 * come back). Counts and instants only.
 */
// fitness:unguarded-write — the counts are a measurement the recorder took, and they are true whatever
// state the row reached in the meantime: a stop that closed the row first is not a reason to discard
// how many frames arrived before it.
export function settleTrackStatement(
  database: SqlDatabase,
  input: {
    readonly recordingId: MeetingRecordingId;
    readonly trackName: string;
    readonly framesReceived: number;
    readonly framesDropped: number;
    readonly firstFrameAt: string | null;
    readonly lastFrameAt: string | null;
    readonly state: MeetingRecordingTrackState | null;
    // True when the staged object was abandoned because nothing was captured into it, so the row
    // stops pointing at an object that does not exist.
    readonly stagingDiscarded?: boolean;
    // Where each stretch of the staged object belongs in time (JSON of
    // `MeetingRecordingTrackSegment[]`); absent or null leaves what the row already says.
    readonly segments?: string | null;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TRACK_TABLE} SET frames_received = ?, frames_dropped = ?, ` +
        `first_frame_at = ?, last_frame_at = ?, segments = COALESCE(?, segments), ` +
        // A track already LOST stays lost: a later close is not evidence it was heard after all.
        `state = CASE WHEN ? IS NULL OR state = 'lost' THEN state ELSE ? END, ` +
        `staging_key = CASE WHEN ? = 1 THEN NULL ELSE staging_key END, updated_at = ? ` +
        `WHERE recording_id = ? AND track_name = ?`,
    )
    .bind(
      input.framesReceived,
      input.framesDropped,
      input.firstFrameAt,
      input.lastFrameAt,
      input.segments ?? null,
      input.state,
      input.state,
      input.stagingDiscarded === true ? 1 : 0,
      input.now,
      input.recordingId,
      input.trackName,
    );
}

/**
 * A participant who left and came back, on the same track: the track is open again and its audio
 * continues into the same staged object, so the record is one track with a gap rather than two.
 */
// fitness:unguarded-write — a zero means the track was lost or the recording stopped while the
// recorder was reopening it; the recorder's own state is what decides whether frames are taken, and a
// lost track staying lost is the rule `settleTrackStatement` keeps too.
export function reopenTrackStatement(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  trackName: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TRACK_TABLE} SET state = 'open', updated_at = ? ` +
        `WHERE recording_id = ? AND track_name = ? AND state = 'closed'`,
    )
    .bind(now, recordingId, trackName);
}

/**
 * How many seconds the recording's tracks actually span — what a composite of them could contain,
 * which is never more than was captured.
 */
// fitness:unguarded-write — the measurement is true whatever state the row reached since; a sweep or
// a compose that moved it on is not a reason to discard what the recorder counted.
export function recordCapturedSecondsStatement(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  capturedSeconds: number,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET captured_seconds = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(capturedSeconds, now, recordingId);
}

/**
 * A stopped recording that captured nothing usable: `failed`, with the Error ID the standard pipeline
 * recorded and never a message. Conditional on the state it is failed from, so a compose that already
 * moved it on is not overwritten.
 */
// fitness:unguarded-write — a zero means the recording had already moved past `composing` (filed by a
// compose, or closed by a sweep) when the failure was written, and that later state is the truth.
export function failRecordingStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingRecordingId;
    readonly failureErrorId: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET state = 'failed', failure_error_id = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'composing'`,
    )
    .bind(input.failureErrorId, input.now, input.id);
}

/**
 * A STOPPED RECORDING WHOSE RECORDER COULD NOT BE REACHED to let go of it: the Error ID of that
 * failure, written onto the row while it is `composing`, so the record says a fault happened at the
 * stop rather than leaving it to a log nobody reads beside it.
 *
 * The state is NOT moved. Whether anything was captured is the recorder's to say, and a recorder that
 * missed the stop settles itself on its next pass once it reads that the record is no longer
 * `recording` — failing the row then if nothing was captured (which replaces this Error ID with its
 * own, the one that names the outcome), or handing it on to be composed if something was. So an
 * Error ID on a recording that is not `failed` names a fault on the way, never the outcome.
 */
// fitness:unguarded-write — a zero means the recording had already moved past `composing`, or already
// carries an Error ID, by the time this was written; either of those is the truer record.
export function recordRecorderUnreachableStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingRecordingId;
    readonly failureErrorId: string;
    readonly now: string;
  },
): SqlStatement {
  return recordFaultOnTheWayStatement(database, input);
}

/**
 * A FAULT ON THE WAY TO FILING, written onto a `composing` row that carries none yet: the Error ID of
 * something that went wrong and did not decide the outcome — the recorder that could not be reached at
 * the stop, or a staged track that was not in the bucket when the compose began and was composed
 * without. The state is not moved; the row says a fault happened, and whatever settles the recording
 * says how it ended.
 */
// fitness:unguarded-write — a zero means the recording had already moved past `composing`, or already
// carries an Error ID, by the time this was written; either of those is the truer record.
export function recordFaultOnTheWayStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingRecordingId;
    readonly failureErrorId: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET failure_error_id = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'composing' AND failure_error_id IS NULL`,
    )
    .bind(input.failureErrorId, input.now, input.id);
}

/**
 * THE AUDIT ROW FOR A RECORDING THAT FAILED, written only when the failure it names is the one the
 * record kept.
 *
 * Two parts of the Worker can give up on one recording — the start route when the room or the
 * recorder could not take it, and the recorder when it settles having captured nothing — and both
 * write `failed` beside this row. `failRecordingStatement` lets only the first of them move the state
 * (it is conditional on `composing`), so a second failure changes nothing in the record; an
 * unconditional audit row beside it would still say the recording failed twice. This one is written
 * only when the row, as the same batch has just left it, is `failed` with THIS Error ID — so the
 * failure that lost the race leaves no row behind, and the log and the record tell one story.
 *
 * The same columns `insertAuditLogStatement` writes, and the metadata is canonical JSON of handles
 * only (the meeting and the Error ID) — the caller composes it, and nothing in it can carry content.
 */
export function insertRecordingFailedAuditStatement(
  database: SqlDatabase,
  input: {
    readonly auditLogId: string;
    readonly recordingId: MeetingRecordingId;
    readonly failureErrorId: string;
    readonly metadata: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${AUDIT_LOG_TABLE} (id, event, actor_user_id, subject_id, metadata, created_at) ` +
        `SELECT ?1, 'meetings.recording.failed', NULL, ?2, ?3, ?4 ` +
        `WHERE EXISTS (SELECT 1 FROM ${MEETING_RECORDING_TABLE} WHERE id = ?2 ` +
        `AND state = 'failed' AND failure_error_id = ?5)`,
    )
    .bind(input.auditLogId, input.recordingId, input.metadata, input.now, input.failureErrorId);
}

// ---------------------------------------------------------------------------------------------
// Composing, filing, and the sweep that tends what nothing else will
// ---------------------------------------------------------------------------------------------

/**
 * WHAT A FILED RECORDING IS CALLED AFTER: its event's title and the zone the event is kept in, so the
 * document's name carries the start as the people in the meeting would have read it. The compose
 * step's own read — the platform filing its own record — so it is addressed by the recording and
 * composes no visibility predicate (see `readRecordingById`).
 */
export async function readRecordingFilingFacts(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
): Promise<{ readonly title: string; readonly timeZone: string } | undefined> {
  const { results } = await database
    .prepare(
      `SELECT matter_event.title AS title, matter_event.time_zone AS time_zone ` +
        `FROM ${MEETING_RECORDING_TABLE} ` +
        `JOIN meeting ON meeting.id = ${MEETING_RECORDING_TABLE}.meeting_id ` +
        `JOIN matter_event ON matter_event.id = meeting.matter_event_id ` +
        `WHERE ${MEETING_RECORDING_TABLE}.id = ?`,
    )
    .bind(recordingId)
    .all<{ title: string; time_zone: string }>();
  const row = results[0];
  return row === undefined ? undefined : { title: row.title, timeZone: row.time_zone };
}

/**
 * WHERE THE COMPOSITE IS BEING WRITTEN: the upload session the compose began, its pending version and
 * file, the key the pipeline minted, the multipart upload at that key, the session's status and the
 * size it was declared at. Read through the session rather than copied onto the recording, so the file
 * pipeline's own rows stay the one answer to where the document's bytes go. The compose step's own
 * read.
 *
 * IT READS THE FILE MANAGER'S OWN TABLES, deliberately. `loadUploadSession` in the file manager answers
 * the same session, but not the declared size or the file the version belongs to, and both are what the
 * compose checks: the declared size is the composite's length as the compose first laid it out, so a
 * later window that lays the tracks out to a different length is refused rather than writing a header
 * whose lengths disagree with the data; and the status says whether the session is still open to be
 * written into at all. The read is addressed by the session handle the recording itself recorded, in
 * the firm's own database, so it can reach nothing another firm or another upload holds.
 */
export async function readComposeTarget(
  database: SqlDatabase,
  uploadSessionId: UploadSessionId,
): Promise<
  | {
      readonly sessionId: UploadSessionId;
      readonly fileVersionId: FileVersionId;
      readonly fileId: FileId;
      readonly r2Key: string;
      readonly r2UploadId: string | null;
      readonly status: string;
      readonly declaredSize: number | null;
    }
  | undefined
> {
  const { results } = await database
    .prepare(
      `SELECT upload_session.id AS session_id, file_version.id AS file_version_id, ` +
        `file_version.file_id AS file_id, file_version.r2_key AS r2_key, ` +
        `upload_session.r2_upload_id AS r2_upload_id, upload_session.status AS status, ` +
        `upload_session.declared_size AS declared_size ` +
        `FROM upload_session JOIN file_version ON file_version.id = upload_session.file_version_id ` +
        `WHERE upload_session.id = ?`,
    )
    .bind(uploadSessionId)
    .all<{
      session_id: UploadSessionId;
      file_version_id: FileVersionId;
      file_id: FileId;
      r2_key: string;
      r2_upload_id: string | null;
      status: string;
      declared_size: number | null;
    }>();
  const row = results[0];
  return row === undefined
    ? undefined
    : {
        sessionId: row.session_id,
        fileVersionId: row.file_version_id,
        fileId: row.file_id,
        r2Key: row.r2_key,
        r2UploadId: row.r2_upload_id,
        status: row.status,
        declaredSize: row.declared_size,
      };
}

/** The most recordings one sweep reads in one state for one firm in one pass. */
export const RECORDING_SWEEP_BATCH = 50;

/**
 * WHETHER A FIRM HAS ANYTHING THE SWEEP TENDS: a recording still running or composing, or a staged
 * object a row still names. One read that answers "no" for every firm that has never recorded — most
 * of them — so the sweep does not spend three on each. Deliberately not the `meetings.recordingEnabled`
 * switch: a firm that turned recording off with a recording mid-compose still needs that recording
 * filed, and its staging still needs releasing. The sweep's own read.
 */
export async function hasRecordingsToTend(database: SqlDatabase): Promise<boolean> {
  const { results } = await database
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM ${MEETING_RECORDING_TABLE} ` +
        `WHERE state IN ('recording', 'composing')) ` +
        `OR EXISTS (SELECT 1 FROM ${MEETING_RECORDING_TRACK_TABLE} WHERE staging_key IS NOT NULL) ` +
        `AS tend`,
    )
    .all<{ tend: number }>();
  return (results[0]?.tend ?? 0) === 1;
}

/**
 * Recordings still `recording` that STARTED before an instant — the sweep's candidates for a recorder
 * that stopped reconciling. Oldest first, a bounded batch; the next pass takes the rest. The sweep's
 * own read (see `readRecordingById`).
 */
export async function listRunningRecordingsStartedBefore(
  database: SqlDatabase,
  startedBefore: string,
): Promise<readonly MeetingRecordingRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${RECORDING_COLUMNS} FROM ${MEETING_RECORDING_TABLE} ` +
        `WHERE state = 'recording' AND started_at < ? ORDER BY started_at ASC, id ASC LIMIT ?`,
    )
    .bind(startedBefore, RECORDING_SWEEP_BATCH)
    .all<MeetingRecordingRow>();
  return results;
}

// When anything last touched a compose: its stop, its last window's claim, its last progress or hand-on.
// Text instants in one format compare as instants, and `MAX` over them is the latest; the stop is
// never null on a `composing` row, so neither is the answer.
const COMPOSE_LAST_TOUCHED = `MAX(stopped_at, COALESCE(compose_progress_at, ''), COALESCE(compose_claimed_at, ''))`;

/**
 * Recordings `composing` that nothing has touched since an instant: no window CLAIMED since then (a
 * window being composed is work, however long the mix takes), no progress recorded and no hand-on, and
 * — for one that never began — stopped before it. The latest of the three is the measure, so a message
 * that waited in the queue is measured from when it was sent, and a window still being mixed from when
 * it was picked up. The least recently touched first — so a batch the sweep has just handed on goes
 * to the back rather than taking the whole of every later pass — a bounded batch. The sweep's own read.
 */
export async function listStalledComposingRecordings(
  database: SqlDatabase,
  stalledSince: string,
): Promise<readonly MeetingRecordingRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${RECORDING_COLUMNS} FROM ${MEETING_RECORDING_TABLE} ` +
        `WHERE state = 'composing' AND ${COMPOSE_LAST_TOUCHED} < ? ` +
        `ORDER BY ${COMPOSE_LAST_TOUCHED} ASC, id ASC LIMIT ?`,
    )
    .bind(stalledSince, RECORDING_SWEEP_BATCH)
    .all<MeetingRecordingRow>();
  return results;
}

/** One staged object the sweep may delete, and the track row that names it. */
export interface ExpiredStagingTrack {
  readonly trackId: MeetingRecordingTrackId;
  readonly recordingId: MeetingRecordingId;
  readonly stagingKey: string;
}

/** The most staged objects one sweep deletes for one firm in one pass. */
export const STAGING_SWEEP_BATCH = 200;

/**
 * STAGED OBJECTS WHOSE RECORDING NO LONGER NEEDS THEM: a recording that `failed` or was `abandoned`
 * and has not changed since `unsettledBefore` (its staging is the only copy of what was captured, so
 * it is kept for a retention window in case of a retry), and a recording `filed` before `filedBefore`
 * whose own compose did not get to delete them. The sweep's own read, a bounded batch.
 */
export async function listExpiredStagingTracks(
  database: SqlDatabase,
  input: { readonly unsettledBefore: string; readonly filedBefore: string },
): Promise<readonly ExpiredStagingTrack[]> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_RECORDING_TRACK_TABLE}.id AS track_id, ` +
        `${MEETING_RECORDING_TRACK_TABLE}.recording_id AS recording_id, ` +
        `${MEETING_RECORDING_TRACK_TABLE}.staging_key AS staging_key ` +
        `FROM ${MEETING_RECORDING_TRACK_TABLE} JOIN ${MEETING_RECORDING_TABLE} ` +
        `ON ${MEETING_RECORDING_TABLE}.id = ${MEETING_RECORDING_TRACK_TABLE}.recording_id ` +
        `WHERE ${MEETING_RECORDING_TRACK_TABLE}.staging_key IS NOT NULL AND (` +
        `(${MEETING_RECORDING_TABLE}.state IN ('failed', 'abandoned') ` +
        `AND ${MEETING_RECORDING_TABLE}.updated_at < ?) OR ` +
        `(${MEETING_RECORDING_TABLE}.state = 'filed' AND ${MEETING_RECORDING_TABLE}.updated_at < ?)) ` +
        `LIMIT ?`,
    )
    .bind(input.unsettledBefore, input.filedBefore, STAGING_SWEEP_BATCH)
    .all<{
      track_id: MeetingRecordingTrackId;
      recording_id: MeetingRecordingId;
      staging_key: string;
    }>();
  return results.map((row) => ({
    trackId: row.track_id,
    recordingId: row.recording_id,
    stagingKey: row.staging_key,
  }));
}

/**
 * THE COMPOSE HAS BEGUN: the upload session its document is written through, on a recording nothing has
 * begun composing yet. Guarded by the caller — a second invocation that began the same recording in the
 * same instant rolls its whole batch back, its upload session included, and lets go of its upload.
 */
export function beginComposeStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingRecordingId;
    readonly uploadSessionId: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET compose_upload_session_id = ?, ` +
        `compose_progress_at = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'composing' AND compose_upload_session_id IS NULL`,
    )
    .bind(input.uploadSessionId, input.now, input.now, input.id);
}

/**
 * PARTS UPLOADED: the cursor moved from where this invocation found it to where it left it, with every
 * part's tag. Guarded by the caller on the cursor it started from, so two deliveries of one message
 * never both advance it — the second is refused and stops.
 *
 * PROGRESS RESETS THE ATTEMPTS. `compose_attempts` counts hand-ons of a compose that was going nowhere;
 * a compose that moved has proved it is going somewhere, so a long recording that was nudged once early
 * on does not carry that against it for the rest of its seventy-odd windows. And when `releaseClaim`,
 * the window's claim is let go in the same write — the invocation is handing the next window to the
 * queue, and whoever picks it up claims it afresh; otherwise the claim is kept, because the same
 * invocation goes on to file the composite.
 */
export function recordComposeProgressStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingRecordingId;
    readonly fromPartsDone: number;
    readonly partsDone: number;
    readonly parts: string;
    readonly releaseClaim: boolean;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET compose_parts_done = ?, compose_parts = ?, ` +
        `compose_progress_at = ?, compose_attempts = 0, ` +
        `compose_claimed_at = CASE WHEN ? = 1 THEN NULL ELSE compose_claimed_at END, updated_at = ? ` +
        `WHERE id = ? AND state = 'composing' AND compose_parts_done = ?`,
    )
    .bind(
      input.partsDone,
      input.parts,
      input.now,
      input.releaseClaim ? 1 : 0,
      input.now,
      input.id,
      input.fromPartsDone,
    );
}

/**
 * ONE CONSUMER TAKES THE NEXT WINDOW: the claim is stamped on a recording still `composing` whose
 * cursor is where this consumer read it, and that nobody else holds — or whose holder's lease has run
 * out, because a consumer cannot run longer than its platform's limit and one that has is gone. Guarded
 * by the caller: a second delivery of the same message, or a sweep's hand-on racing the queue's own,
 * is refused here and stops before it reads a byte, so two consumers never write the same part of the
 * composite at once.
 */
export function claimComposeWindowStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingRecordingId;
    readonly partsDone: number;
    readonly now: string;
    readonly leaseExpiredBefore: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET compose_claimed_at = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'composing' AND compose_parts_done = ? ` +
        `AND (compose_claimed_at IS NULL OR compose_claimed_at < ?)`,
    )
    .bind(input.now, input.now, input.id, input.partsDone, input.leaseExpiredBefore);
}

/**
 * A CLAIM LET GO by the consumer that took it — after a failure it will retry, or a window it stopped
 * short of — addressed by the instant it was taken at, so it can never release a claim somebody else
 * has taken since.
 */
// fitness:unguarded-write — a zero means the claim was already released by the window's own progress,
// or taken over after its lease ran out; either way it is not this consumer's to let go of.
export function releaseComposeClaimStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingRecordingId; readonly claimedAt: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET compose_claimed_at = NULL ` +
        `WHERE id = ? AND compose_claimed_at = ?`,
    )
    .bind(input.id, input.claimedAt);
}

/**
 * A COMPOSED RECORDING ON THE MATTER: `filed`, naming the document and the version its audio is.
 * Guarded by the caller on `composing`, so a recording a sweep failed in the meantime is not filed over.
 *
 * THE CAPTURED LENGTH NEVER CLAIMS MORE THAN WAS FILED. The recorder counted what its tracks spanned;
 * a track whose staged object was not there to compose leaves the document shorter than that count, so
 * the row is brought down to the composite's own length — and never raised above the recorder's.
 */
export function fileRecordingStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingRecordingId;
    readonly fileId: string;
    readonly fileVersionId: string;
    readonly composedSeconds: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET state = 'filed', file_id = ?, file_version_id = ?, ` +
        `captured_seconds = MIN(COALESCE(captured_seconds, ?), ?), ` +
        `compose_progress_at = ?, compose_claimed_at = NULL, updated_at = ? ` +
        `WHERE id = ? AND state = 'composing'`,
    )
    .bind(
      input.fileId,
      input.fileVersionId,
      input.composedSeconds,
      input.composedSeconds,
      input.now,
      input.now,
      input.id,
    );
}

/**
 * A STALLED COMPOSE HANDED ON AGAIN: one more attempt counted, and the stall measured afresh from now.
 */
// fitness:unguarded-write — a zero means the compose made progress, filed or failed between the
// sweep's read and this write; the message it sends beside it then finds nothing to do, which is the
// outcome either way.
export function recordComposeRetryStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingRecordingId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET compose_attempts = compose_attempts + 1, ` +
        `compose_progress_at = ?, updated_at = ? WHERE id = ? AND state = 'composing'`,
    )
    .bind(input.now, input.now, input.id);
}

/**
 * A RECORDING WHOSE RECORDER DISAPPEARED: `abandoned`, with the instant the sweep found it and nobody
 * behind it. Guarded by the caller on `recording`, so a stop that committed first is the one the record
 * keeps.
 */
export function abandonRecordingStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingRecordingId; readonly trackCount: number; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TABLE} SET state = 'abandoned', stopped_at = ?, ` +
        `stop_reason = 'abandoned', track_count = ?, updated_at = ? ` +
        `WHERE id = ? AND state = 'recording'`,
    )
    .bind(input.now, input.trackCount, input.now, input.id);
}

/**
 * EVERY OPEN TRACK LOST AT ONE INSTANT — the recorder that was hearing them is gone, so the record says
 * it could not hear them from then on rather than that they left.
 */
// fitness:unguarded-write — a zero is the ordinary outcome for a recording whose tracks had all closed
// or been lost already; the abandonment itself is guarded on the recording row.
export function loseOpenTracksStatement(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TRACK_TABLE} SET state = 'lost', updated_at = ? ` +
        `WHERE recording_id = ? AND state = 'open'`,
    )
    .bind(now, recordingId);
}

/**
 * THE MOST TRACK HANDLES ONE CLEARING STATEMENT BINDS. A Durable Object's SQLite refuses a statement
 * with more than a hundred bound variables, and the instant takes one of them — so the sweep's page of
 * two hundred staged objects is cleared in several statements of one batch, never one that fails.
 */
export const STAGING_KEYS_PER_STATEMENT = 90;

/**
 * Staged objects deleted: the rows stop naming them. One statement per `STAGING_KEYS_PER_STATEMENT`
 * tracks, the handles bound and only the count of `?` spliced; committed together in one batch.
 */
export function clearStagingKeysStatements(
  database: SqlDatabase,
  trackIds: readonly MeetingRecordingTrackId[],
  now: string,
): SqlStatement[] {
  const statements: SqlStatement[] = [];
  for (let start = 0; start < trackIds.length; start += STAGING_KEYS_PER_STATEMENT) {
    const page = trackIds.slice(start, start + STAGING_KEYS_PER_STATEMENT);
    statements.push(
      database
        .prepare(
          `UPDATE ${MEETING_RECORDING_TRACK_TABLE} SET staging_key = NULL, updated_at = ? ` +
            `WHERE id IN (${placeholders(page.length)})`,
        )
        .bind(now, ...page),
    );
  }
  return statements;
}
