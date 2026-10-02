import { AUDIT_LOG_TABLE } from "@magna-carta/data-access/audit-statements";
import { keysetClause, type SortCursor } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MatterId,
  MeetingId,
  MeetingRecordingId,
  MeetingRecordingNoticeId,
  MeetingRecordingTrackId,
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
 * WHAT THE SINK ASKS BEFORE IT OPENS ANYTHING: is this recording still running, and is this track
 * still open. A token for a settled recording, or for a track the recorder has already closed, opens
 * nothing — the signature proves the token was minted here, and this is what proves it still means
 * something. The platform's own read (see `readRecordingById`).
 */
export async function readSinkTrack(
  database: SqlDatabase,
  recordingId: MeetingRecordingId,
  trackName: string,
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
        `AND ${MEETING_RECORDING_TRACK_TABLE}.track_name = ?`,
    )
    .bind(recordingId, trackName)
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
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_RECORDING_TRACK_TABLE} SET frames_received = ?, frames_dropped = ?, ` +
        `first_frame_at = ?, last_frame_at = ?, ` +
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
