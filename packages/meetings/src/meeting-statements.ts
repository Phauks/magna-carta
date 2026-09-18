import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FirmEventId,
  MatterEventId,
  MeetingAttendanceId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import type {
  MeetingAttendanceRow,
  MeetingEventKind,
  MeetingEventRow,
  MeetingRow,
  MeetingSummary,
} from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const MEETING_TABLE = "meeting";
export const MEETING_ATTENDANCE_TABLE = "meeting_attendance";

// THE GATE, and it is the one thing in this module worth reading before anything else.
//
// A meeting has no visibility rule of its own. It hangs from a calendar event, and the event's rule
// is the whole of the answer: a matter event is reachable when the member may see the matter, a firm
// event is firm-visible. So every read here composes the visible-matter predicate against the
// event's matter, and it is a REQUIRED argument rather than an option with a default — a source that
// forgets it is a leak, and a required argument makes that a type error rather than a review comment
// nobody makes.
//
// The firm branch is a literal `event_kind = 'firm'` rather than an absence of a clause, so the two
// answers sit beside each other in one expression: a reader can see that the firm case was decided
// rather than left out. The subquery aliases its own table for the reason the predicate itself does
// — an unaliased `matter_event` here would be shadowed by a caller whose own FROM names the same
// table, and the correlation would degenerate into something true of every row.
function visibleEventClause(visibility: VisibleMatterPredicate, meetingExpression: string): string {
  return (
    `(${meetingExpression}.event_kind = 'firm' OR EXISTS (SELECT 1 FROM matter_event AS gate_event ` +
    `WHERE gate_event.id = ${meetingExpression}.matter_event_id ` +
    `AND ${visibility.fragmentFor("gate_event.matter_id")}))`
  );
}

const MEETING_COLUMNS = [
  "id",
  "event_kind",
  "matter_event_id",
  "firm_event_id",
  "status",
  "created_by_user_id",
  "started_at",
  "ended_at",
  "ended_by_user_id",
  "created_at",
  "updated_at",
]
  .map((column) => `${MEETING_TABLE}.${column}`)
  .join(", ");

// The event's own facts, joined rather than copied. LEFT JOIN on both parents, because exactly one
// of them matches and an inner join on either would drop every meeting of the other kind while
// looking like it worked. The COALESCE pairs are safe for the same reason: the row that did not
// match contributes nulls, so the surviving value is always the real parent's.
const EVENT_COLUMNS =
  "COALESCE(matter_event.id, firm_event.id) AS event_id, " +
  "matter_event.matter_id AS matter_id, " +
  "COALESCE(matter_event.title, firm_event.title) AS title, " +
  "COALESCE(matter_event.starts_on, firm_event.starts_on) AS starts_on, " +
  "COALESCE(matter_event.starts_at_time, firm_event.starts_at_time) AS starts_at_time, " +
  "COALESCE(matter_event.ends_at_time, firm_event.ends_at_time) AS ends_at_time, " +
  "COALESCE(matter_event.time_zone, firm_event.time_zone) AS time_zone";

const EVENT_JOIN =
  `LEFT JOIN matter_event ON matter_event.id = ${MEETING_TABLE}.matter_event_id ` +
  `LEFT JOIN firm_event ON firm_event.id = ${MEETING_TABLE}.firm_event_id`;

// WHO IS IN THE ROOM RIGHT NOW, counted off the open stays on every read rather than kept as a
// column. A stored count is a second answer to a question the rows already answer, and the two
// disagree the first time a socket closes without a leave.
const LIVE_COUNT_COLUMN =
  `(SELECT COUNT(*) FROM ${MEETING_ATTENDANCE_TABLE} ` +
  `WHERE ${MEETING_ATTENDANCE_TABLE}.meeting_id = ${MEETING_TABLE}.id ` +
  `AND ${MEETING_ATTENDANCE_TABLE}.left_at IS NULL) AS live_count`;

type MeetingSummaryColumns = MeetingRow & MeetingEventRow & { readonly live_count: number };

function toSummary(row: MeetingSummaryColumns): MeetingSummary {
  return {
    id: row.id,
    eventKind: row.event_kind,
    eventId: row.event_id,
    matterId: row.matter_id,
    title: row.title,
    startsOn: row.starts_on,
    startsAtTime: row.starts_at_time,
    endsAtTime: row.ends_at_time,
    timeZone: row.time_zone,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    liveCount: row.live_count,
  };
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

// The event a meeting would hang from, read through the gate before anything is written. This is the
// one place the walled-matter question is answered for the create path, and it answers it by
// returning nothing: an event that does not exist and an event on a matter the reader may not see
// are the same absence, so the caller cannot tell them apart and the route cannot become an
// existence oracle.
export function selectMeetingEventStatement(
  database: SqlDatabase,
  eventKind: MeetingEventKind,
  eventId: string,
  visibility: VisibleMatterPredicate,
): SqlStatement {
  if (eventKind === "firm") {
    // A firm event belongs to no matter, which is why the permission keys bind the firm rather than
    // a matter. `matter_id` is selected as a literal null so both branches return one row shape.
    return database
      .prepare(
        `SELECT firm_event.id AS event_id, NULL AS matter_id, firm_event.title AS title, ` +
          `firm_event.starts_on AS starts_on, firm_event.starts_at_time AS starts_at_time, ` +
          `firm_event.ends_at_time AS ends_at_time, firm_event.time_zone AS time_zone ` +
          `FROM firm_event WHERE firm_event.id = ?`,
      )
      .bind(eventId);
  }
  return database
    .prepare(
      `SELECT matter_event.id AS event_id, matter_event.matter_id AS matter_id, ` +
        `matter_event.title AS title, matter_event.starts_on AS starts_on, ` +
        `matter_event.starts_at_time AS starts_at_time, matter_event.ends_at_time AS ends_at_time, ` +
        `matter_event.time_zone AS time_zone FROM matter_event ` +
        `WHERE matter_event.id = ? AND ${visibility.fragmentFor("matter_event.matter_id")}`,
    )
    .bind(eventId, ...visibility.bindings);
}

export async function readMeetingEvent(
  database: SqlDatabase,
  eventKind: MeetingEventKind,
  eventId: string,
  visibility: VisibleMatterPredicate,
): Promise<MeetingEventRow | undefined> {
  const { results } = await selectMeetingEventStatement(
    database,
    eventKind,
    eventId,
    visibility,
  ).all<MeetingEventRow>();
  return results[0];
}

// The meeting row itself, through the same gate — so an id-addressed write path can never reach a
// room a read could not.
export async function readMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  visibility: VisibleMatterPredicate,
): Promise<MeetingRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_COLUMNS} FROM ${MEETING_TABLE} ` +
        `WHERE ${MEETING_TABLE}.id = ? AND ${visibleEventClause(visibility, MEETING_TABLE)}`,
    )
    .bind(meetingId, ...visibility.bindings)
    .all<MeetingRow>();
  return results[0];
}

/** The meeting a surface paints: the room, its event's facts, and who is in it right now. */
export async function readMeetingSummary(
  database: SqlDatabase,
  meetingId: MeetingId,
  visibility: VisibleMatterPredicate,
): Promise<MeetingSummary | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_COLUMNS}, ${EVENT_COLUMNS}, ${LIVE_COUNT_COLUMN} ` +
        `FROM ${MEETING_TABLE} ${EVENT_JOIN} ` +
        `WHERE ${MEETING_TABLE}.id = ? AND ${visibleEventClause(visibility, MEETING_TABLE)}`,
    )
    .bind(meetingId, ...visibility.bindings)
    .all<MeetingSummaryColumns>();
  const row = results[0];
  return row === undefined ? undefined : toSummary(row);
}

/**
 * The meeting on one event, or nothing when the event has none — which is how an event that nobody
 * has started is told apart from one that has. The gate is composed here too, so asking an event id
 * whether it has a meeting discloses nothing about a matter the reader may not see.
 */
export async function readMeetingForEvent(
  database: SqlDatabase,
  eventKind: MeetingEventKind,
  eventId: string,
  visibility: VisibleMatterPredicate,
): Promise<MeetingSummary | undefined> {
  const column = eventKind === "firm" ? "firm_event_id" : "matter_event_id";
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_COLUMNS}, ${EVENT_COLUMNS}, ${LIVE_COUNT_COLUMN} ` +
        `FROM ${MEETING_TABLE} ${EVENT_JOIN} ` +
        `WHERE ${MEETING_TABLE}.${column} = ? AND ${MEETING_TABLE}.event_kind = ? ` +
        `AND ${visibleEventClause(visibility, MEETING_TABLE)}`,
    )
    .bind(eventId, eventKind, ...visibility.bindings)
    .all<MeetingSummaryColumns>();
  const row = results[0];
  return row === undefined ? undefined : toSummary(row);
}

/**
 * Who was in the room and when, oldest arrival first — the record the meeting exists to leave. Not
 * paged: the room is capped at a dozen people and a stay is opened once per arrival, so the whole
 * answer is a handful of rows by construction.
 */
export async function listAttendance(
  database: SqlDatabase,
  meetingId: MeetingId,
): Promise<readonly MeetingAttendanceRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, meeting_id, user_id, joined_at, left_at, created_at, updated_at ` +
        `FROM ${MEETING_ATTENDANCE_TABLE} WHERE meeting_id = ? ORDER BY joined_at ASC, id ASC`,
    )
    .bind(meetingId)
    .all<MeetingAttendanceRow>();
  return results;
}

/** The caller's own open stay, which is what a leave closes and what a repeated join finds. */
export async function readOpenAttendance(
  database: SqlDatabase,
  meetingId: MeetingId,
  userId: UserId,
): Promise<MeetingAttendanceRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, meeting_id, user_id, joined_at, left_at, created_at, updated_at ` +
        `FROM ${MEETING_ATTENDANCE_TABLE} WHERE meeting_id = ? AND user_id = ? AND left_at IS NULL ` +
        `ORDER BY joined_at DESC, id DESC`,
    )
    .bind(meetingId, userId)
    .all<MeetingAttendanceRow>();
  return results[0];
}

/** How many people are in the room, which is what the cap is measured against. */
export async function countOpenAttendance(
  database: SqlDatabase,
  meetingId: MeetingId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM ${MEETING_ATTENDANCE_TABLE} ` +
        `WHERE meeting_id = ? AND left_at IS NULL`,
    )
    .bind(meetingId)
    .all<{ readonly count: number }>();
  return results[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export interface InsertMeetingInput {
  readonly id: MeetingId;
  readonly eventKind: MeetingEventKind;
  readonly matterEventId: MatterEventId | null;
  readonly firmEventId: FirmEventId | null;
  readonly createdByUserId: UserId;
  readonly now: string;
}

// The room, created by whoever pressed Start. `status` is the literal 'scheduled' rather than an
// argument: a room is not live because somebody made it, and a create path able to declare a meeting
// live would be able to record a gathering nobody attended.
//
// The partial unique index on each event column is what holds one-meeting-per-event under a race.
// The service's read-then-insert settles the ordinary case; the index settles the case the read
// cannot, where two members press Start in the same instant. The loser's whole batch aborts rather
// than a second room appearing, so a retry finds the winner's room — which is the outcome both
// members wanted, since what they asked for was to be in the same place.
export function insertMeetingStatement(
  database: SqlDatabase,
  input: InsertMeetingInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_TABLE} (id, event_kind, matter_event_id, firm_event_id, status, ` +
        `created_by_user_id, started_at, ended_at, ended_by_user_id, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, 'scheduled', ?5, NULL, NULL, NULL, ?6, ?6)`,
    )
    .bind(
      input.id,
      input.eventKind,
      input.matterEventId,
      input.firmEventId,
      input.createdByUserId,
      input.now,
    );
}

// THE FIRST ARRIVAL, which is what makes a room live — not the creation, and not the hour the event
// was scheduled for. A host who starts a meeting and is then called away leaves a record saying
// exactly that.
//
// fitness:unguarded-write — a zero means another member's join flipped it live first, and that join
// is still good: the arrival this statement accompanies opened its own stay either way, so refusing
// the batch would turn a won race into a member who cannot get into a live room.
export function startMeetingStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TABLE} SET status = 'live', started_at = ?1, updated_at = ?1 ` +
        `WHERE id = ?2 AND status = 'scheduled'`,
    )
    .bind(input.now, input.id);
}

// ENDING IT. The status, the instant and the actor move together, because a meeting that has ended
// without saying who ended it is a record nobody can question — which the schema also refuses.
export function endMeetingStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingId; readonly endedByUserId: UserId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TABLE} SET status = 'ended', ended_at = ?1, ended_by_user_id = ?2, ` +
        `updated_at = ?1 WHERE id = ?3 AND status <> 'ended'`,
    )
    .bind(input.now, input.endedByUserId, input.id);
}

export interface InsertAttendanceInput {
  readonly id: MeetingAttendanceId;
  readonly meetingId: MeetingId;
  readonly userId: UserId;
  readonly now: string;
}

// One arrival. `left_at` is null and is the only thing that says the person is still here, which is
// what makes the roster and the cap a fact about the table rather than a number somebody maintains.
export function insertAttendanceStatement(
  database: SqlDatabase,
  input: InsertAttendanceInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_ATTENDANCE_TABLE} (id, meeting_id, user_id, joined_at, left_at, ` +
        `created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?4, ?4)`,
    )
    .bind(input.id, input.meetingId, input.userId, input.now);
}

// ONE PERSON LEAVING, and only that person: the statement names the stay by its own id, so a leave
// can never reach across the roster. The `left_at IS NULL` in the WHERE is the precondition the
// caller read — a stay already closed must not have its instant moved, because that instant is in
// somebody's record of what happened.
export function closeAttendanceStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingAttendanceId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_ATTENDANCE_TABLE} SET left_at = ?1, updated_at = ?1 ` +
        `WHERE id = ?2 AND left_at IS NULL`,
    )
    .bind(input.now, input.id);
}

// EVERY OPEN STAY, AT ONE INSTANT. One statement rather than a loop over the roster, because the
// meeting ended once: a set of rows carrying instants a few milliseconds apart would say people left
// at slightly different times, which is not what happened and is exactly the sort of detail a record
// of a gathering is read for.
//
// fitness:unguarded-write — a zero is the ordinary outcome for a room nobody was in when it closed,
// and a host must be able to close an empty room; the end itself is guarded on the meeting row.
export function closeAllAttendanceStatement(
  database: SqlDatabase,
  input: { readonly meetingId: MeetingId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_ATTENDANCE_TABLE} SET left_at = ?1, updated_at = ?1 ` +
        `WHERE meeting_id = ?2 AND left_at IS NULL`,
    )
    .bind(input.now, input.meetingId);
}
