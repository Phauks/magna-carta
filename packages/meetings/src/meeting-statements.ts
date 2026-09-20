import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { keysetClause, type SortCursor } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FirmEventId,
  MatterEventId,
  MeetingAttendanceId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MeetingLobbyMode } from "./lobby-types.ts";
import type {
  MeetingAttendanceRow,
  MeetingDepartureReason,
  MeetingEventKind,
  MeetingMedium,
  MeetingEventRow,
  MeetingListScope,
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
  "medium",
  "matter_event_id",
  "firm_event_id",
  "status",
  "created_by_user_id",
  "started_at",
  "ended_at",
  "ended_by_user_id",
  "locked_at",
  "locked_by_user_id",
  "lobby",
  "created_at",
  "updated_at",
]
  .map((column) => `${MEETING_TABLE}.${column}`)
  .join(", ");

/**
 * Every column of a stay, named once.
 *
 * Five reads in two modules select exactly this list, and two of them forgot a column the day it was
 * added — a row typed `MeetingAttendanceRow` whose `admitted_at` is undefined reads as "never
 * admitted" and is a waiter who is actually in the room. One list, so the shape a caller is handed
 * is the shape the type promises.
 */
export const MEETING_ATTENDANCE_COLUMNS =
  "id, meeting_id, user_id, joined_at, left_at, ended_reason, waiting_from, admitted_at, " +
  "created_at, updated_at";

// ONE PREDICATE, ONE HOME — the two questions the lobby split in half, as single fragments every
// caller composes rather than re-spells.
//
// Before the door existed, "in the room" and "has an open stay" were the same sentence and it was
// written out at four call sites: the live count, the capacity guard, the roster read and the
// host-presence count. They are no longer the same sentence, because somebody at the door holds an
// open stay and occupies no seat — so the four are composed from here, and cannot drift into
// disagreeing about who is present.
//
// Qualified with the table name, so both survive a join and a correlated subquery. A caller that
// aliases `meeting_attendance` has to spell its own predicate, which no caller does.
export const IN_THE_ROOM_PREDICATE =
  `${MEETING_ATTENDANCE_TABLE}.left_at IS NULL ` +
  `AND (${MEETING_ATTENDANCE_TABLE}.waiting_from IS NULL ` +
  `OR ${MEETING_ATTENDANCE_TABLE}.admitted_at IS NOT NULL)`;

export const WAITING_PREDICATE =
  `${MEETING_ATTENDANCE_TABLE}.left_at IS NULL ` +
  `AND ${MEETING_ATTENDANCE_TABLE}.waiting_from IS NOT NULL ` +
  `AND ${MEETING_ATTENDANCE_TABLE}.admitted_at IS NULL`;

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
//
// Over the stays that are IN THE ROOM and not merely open: somebody at the door is not somebody a
// screen should count as present.
const LIVE_COUNT_COLUMN =
  `(SELECT COUNT(*) FROM ${MEETING_ATTENDANCE_TABLE} ` +
  `WHERE ${MEETING_ATTENDANCE_TABLE}.meeting_id = ${MEETING_TABLE}.id ` +
  `AND ${IN_THE_ROOM_PREDICATE}) AS live_count`;

type MeetingSummaryColumns = MeetingRow & MeetingEventRow & { readonly live_count: number };

function toSummary(row: MeetingSummaryColumns): MeetingSummary {
  return {
    id: row.id,
    eventKind: row.event_kind,
    medium: row.medium,
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
    // Derived from the instant rather than stored beside it, for the reason the live count is
    // counted rather than kept: one fact, one answer. The instant is the record of when the door
    // was shut; a boolean is what a screen needs.
    locked: row.locked_at !== null,
    // Carried as the setting rather than as a boolean, because it is a two-value vocabulary the
    // write path also takes — a screen that read `lobby: true` would have to invent the word back
    // to change it.
    lobby: row.lobby,
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

// ---------------------------------------------------------------------------------------------
// THE THREE LISTS A MEETINGS SCREEN PAINTS, and why they are three reads rather than one filtered.
//
// Live, ahead and just-finished are not three filters over one ordering: each wants a different sort
// key and each is walked to a different depth. What is live is ordered by who has been in longest;
// what is ahead is ordered by when it starts, soonest first, because a page of the FIRST ten
// upcoming meetings is the answer and the last ten is not; what has finished is ordered by when it
// ended, newest first. A single ordering would make two of the three pages wrong.
//
// The keyset is over a SORT KEY the query names and returns, so the walk is stable whichever scope
// minted the cursor and the route never has to know which column it was.
// ---------------------------------------------------------------------------------------------

/** One row of a meetings list, with the key the next page continues from. */
export interface MeetingListEntry {
  readonly summary: MeetingSummary;
  readonly sortKey: string;
}

// The upcoming scope orders by DAY and then by wall-clock TIME, which is two columns and one keyset.
// Concatenating them into one comparable text key is what lets the ordinary (sort key, id) keyset
// carry it: both halves are fixed-width text in this schema, so text order is chronological order.
// An all-day entry carries no time and sorts at the start of its day, which is where a person
// reading a day's list expects it.
const UPCOMING_SORT_KEY =
  `(COALESCE(matter_event.starts_on, firm_event.starts_on) || 'T' || ` +
  `COALESCE(matter_event.starts_at_time, firm_event.starts_at_time, '00:00'))`;

const LIST_SCOPES = {
  live: {
    sortKey: `${MEETING_TABLE}.started_at`,
    where: `${MEETING_TABLE}.status = 'live'`,
    ascending: false,
  },
  // Today INCLUDED, and the day comes from the caller: a civil date is a day in a place, and the
  // server has no zone to read one out of an instant with. A member in Honolulu asking at nine in
  // the evening must not lose the meeting they have at eleven because the server's day has already
  // turned over.
  upcoming: {
    sortKey: UPCOMING_SORT_KEY,
    where: `${MEETING_TABLE}.status = 'scheduled' AND ${UPCOMING_SORT_KEY} >= ?`,
    ascending: true,
  },
  // An INSTANT boundary, which is a different thing from a day and is the server's to compute: two
  // instants compare the same in every zone on earth.
  recent: {
    sortKey: `${MEETING_TABLE}.ended_at`,
    where: `${MEETING_TABLE}.status = 'ended' AND ${MEETING_TABLE}.ended_at >= ?`,
    ascending: false,
  },
} as const satisfies Record<
  MeetingListScope,
  { sortKey: string; where: string; ascending: boolean }
>;

/**
 * One page of the meetings a member can reach, in one of the three scopes.
 *
 * The gate rides here exactly as it does on every single-meeting read, so a list can never show a
 * room an id-addressed read would refuse — which is the property that makes the walled-matter
 * question answered once rather than per surface.
 */
export async function listMeetings(
  database: SqlDatabase,
  options: {
    readonly scope: MeetingListScope;
    readonly visibility: VisibleMatterPredicate;
    readonly limit: number;
    readonly cursor?: SortCursor;
    /** The caller's own day, `YYYY-MM-DD`. Required by the upcoming scope and unread by the others. */
    readonly today?: string;
    /** The instant the recent scope reaches back to. Unread by the others. */
    readonly since?: string;
  },
): Promise<readonly MeetingListEntry[]> {
  const scope = LIST_SCOPES[options.scope];
  const bindings: unknown[] = [];
  if (options.scope === "upcoming") bindings.push(`${options.today ?? ""}T00:00`);
  if (options.scope === "recent") bindings.push(options.since ?? "");
  bindings.push(...options.visibility.bindings);
  const keyset = keysetClause(
    bindings,
    options.cursor,
    scope.sortKey,
    `${MEETING_TABLE}.id`,
    scope.ascending,
  );
  const direction = scope.ascending ? "ASC" : "DESC";
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_COLUMNS}, ${EVENT_COLUMNS}, ${LIVE_COUNT_COLUMN}, ` +
        `${scope.sortKey} AS sort_key FROM ${MEETING_TABLE} ${EVENT_JOIN} ` +
        `WHERE ${scope.where} AND ${visibleEventClause(options.visibility, MEETING_TABLE)} ` +
        `${keyset}ORDER BY sort_key ${direction}, ${MEETING_TABLE}.id ${direction} LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<MeetingSummaryColumns & { readonly sort_key: string }>();
  return results.map((row) => ({ summary: toSummary(row), sortKey: row.sort_key }));
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

/** The most stays one page of the attendance record carries. */
export const MAX_ATTENDANCE_PAGE_SIZE = 50;

/**
 * Who was in the room and when, OLDEST ARRIVAL FIRST — the record the meeting exists to leave.
 *
 * Paged on the same keyset every other list here uses, and ascending because the answer is read as a
 * narrative: the first page is the beginning of the gathering, not the end of it. The room's ceiling
 * bounds who can be present at one instant and bounds nothing else — a connection that drops and
 * comes back opens a second stay, and a meeting that runs all afternoon over a bad line accumulates
 * them — so the count is a fact about the day rather than about the dozen chairs.
 *
 * `limit` is what the caller will SHOW; this asks for one more row than that, and the extra row is
 * the answer to "is there another page" without a second count.
 */
export async function listAttendance(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: { readonly cursor?: SortCursor; readonly limit: number },
): Promise<readonly MeetingAttendanceRow[]> {
  const bindings: unknown[] = [meetingId];
  const keyset = keysetClause(bindings, options.cursor, "joined_at", "id", true);
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_ATTENDANCE_COLUMNS} ` +
        `FROM ${MEETING_ATTENDANCE_TABLE} WHERE meeting_id = ? ${keyset}` +
        `ORDER BY joined_at ASC, id ASC LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<MeetingAttendanceRow>();
  return results;
}

/**
 * One stay, by its own handle.
 *
 * The read the socket-loss sweep makes: it holds an attendance id off a roster entry and nothing
 * else, and it needs the meeting the stay belongs to and the member it belongs to before it can
 * record that they are no longer in the room. Deliberately NOT through the visibility gate — the
 * caller is the room closing its own record, not a member asking a question, and there is no reader
 * here for a gate to protect anything from.
 */
export async function readAttendance(
  database: SqlDatabase,
  attendanceId: MeetingAttendanceId,
): Promise<MeetingAttendanceRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_ATTENDANCE_COLUMNS} ` + `FROM ${MEETING_ATTENDANCE_TABLE} WHERE id = ?`,
    )
    .bind(attendanceId)
    .all<MeetingAttendanceRow>();
  return results[0];
}

/** The caller's own open stay, which is what a leave closes and what a repeated join finds. */
export async function readOpenAttendance(
  database: SqlDatabase,
  meetingId: MeetingId,
  userId: UserId,
): Promise<MeetingAttendanceRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_ATTENDANCE_COLUMNS} ` +
        `FROM ${MEETING_ATTENDANCE_TABLE} WHERE meeting_id = ? AND user_id = ? AND left_at IS NULL ` +
        `ORDER BY joined_at DESC, id DESC`,
    )
    .bind(meetingId, userId)
    .all<MeetingAttendanceRow>();
  return results[0];
}

/**
 * How many people are IN THE ROOM, which is what the room's cap is measured against.
 *
 * Not "how many stays are open": somebody at the door holds one and is not in the room. This read is
 * what produces the REASON a member is given; the ceiling itself is held in the admission
 * statement's own WHERE, a round trip later — see `admitAttendanceUnderCapStatement` in
 * ./lobby-statements.ts.
 */
export async function countOpenAttendance(
  database: SqlDatabase,
  meetingId: MeetingId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM ${MEETING_ATTENDANCE_TABLE} ` +
        `WHERE ${MEETING_ATTENDANCE_TABLE}.meeting_id = ? AND ${IN_THE_ROOM_PREDICATE}`,
    )
    .bind(meetingId)
    .all<{ readonly count: number }>();
  return results[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------------------------
// The two races the database settles, recognised by the error it settles them with.
//
// Each read-then-write below is right about the ordinary case and blind to the instant it does not
// span. The partial unique indexes are what actually hold the rule; these turn the abort they cause
// into the answer the caller wanted, which in both cases is the state somebody else just created.
// Matched on the exact qualified columns rather than on "UNIQUE" anywhere in the message, so one
// race is never mistaken for the other — and so an unrelated constraint keeps surfacing as the fault
// it is.
// ---------------------------------------------------------------------------------------------

/** Two members pressed Start on one event in the same instant, and one of them lost. */
export function isMeetingPerEventConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    (error.message.includes(`${MEETING_TABLE}.matter_event_id`) ||
      error.message.includes(`${MEETING_TABLE}.firm_event_id`))
  );
}

/** One member's browser opened two joins at once — a double-clicked button is the whole of it. */
export function isOpenStayConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MEETING_ATTENDANCE_TABLE}.meeting_id`) &&
    error.message.includes(`${MEETING_ATTENDANCE_TABLE}.user_id`)
  );
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export interface InsertMeetingInput {
  readonly id: MeetingId;
  readonly eventKind: MeetingEventKind;
  readonly medium: MeetingMedium;
  readonly lobby: MeetingLobbyMode;
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
      `INSERT INTO ${MEETING_TABLE} (id, event_kind, medium, lobby, matter_event_id, ` +
        `firm_event_id, status, created_by_user_id, started_at, ended_at, ended_by_user_id, ` +
        `created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'scheduled', ?7, NULL, NULL, NULL, ?8, ?8)`,
    )
    .bind(
      input.id,
      input.eventKind,
      input.medium,
      input.lobby,
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

// CLOSING A ROOM NOBODY ENTERED, because the sitting it hangs from is being cancelled — and the
// whole of the precondition is in the WHERE rather than in the read the caller made a round trip
// earlier.
//
// Three conditions, and each of them is a separate way the caller's read can be stale by the time
// the batch commits. `status = 'scheduled'` is the one that matters most: the general ending
// statement above matches `status <> 'ended'`, so a meeting that went LIVE between the cancel's read
// and its commit would be ended under the people sitting in it, by somebody editing a calendar.
// `ended_at IS NULL` says the host did not close it in that same window — then the closing is a
// no-op rather than a second ending with a different instant and a different actor on it. And the
// NOT EXISTS is the one the status alone cannot answer: an arrival writes its stay and flips the
// room live in ONE batch, so there is no instant where the two disagree — but a stay is the fact
// that somebody is in the room, and reading it here means the room is safe from this statement even
// if some later path opens a stay without touching the status.
//
// Guarded at its call site: matching no row means the cancel lost the race, and the whole batch —
// the cancelled event with it — rolls back so the route can answer what actually happened instead of
// cancelling the sitting and silently leaving the room open.
export function endScheduledMeetingStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingId; readonly endedByUserId: UserId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TABLE} SET status = 'ended', ended_at = ?1, ended_by_user_id = ?2, ` +
        `updated_at = ?1 WHERE id = ?3 AND status = 'scheduled' AND ended_at IS NULL ` +
        `AND NOT EXISTS (SELECT 1 FROM ${MEETING_ATTENDANCE_TABLE} ` +
        `WHERE meeting_id = ?3 AND left_at IS NULL)`,
    )
    .bind(input.now, input.endedByUserId, input.id);
}

export interface InsertAttendanceInput {
  readonly id: MeetingAttendanceId;
  readonly meetingId: MeetingId;
  readonly userId: UserId;
  readonly now: string;
}

// ONE ARRIVAL, AND THE CEILING IN THE SAME STATEMENT. `left_at` is null and is the only thing that
// says the person is still here, which is what makes the roster and the cap a fact about the table
// rather than a number somebody maintains.
//
// The INSERT is a SELECT with a WHERE rather than a VALUES, so the count of who is present is taken
// by the database at the instant of the write. The service's own count, read a round trip earlier,
// settles the ordinary case and says so with a reason a member can read; it cannot settle the case
// it was not there for — one seat left and three browsers pressing Join together, where every one
// of them reads the same free seat and every one of them is right. A row inserted past the ceiling
// is a tile nobody's layout has and a cap that means nothing thereafter, so the write is GUARDED:
// it matches no row, and the whole batch — the stay, the live flip, the audit — rolls back rather
// than half-landing.
//
// `?5` is bound rather than interpolated even though it is a constant on this side: the ceiling is
// the domain's number and travels as data, so a reader never has to ask whether the SQL was built
// from something a caller supplied.
export function insertAttendanceUnderCapStatement(
  database: SqlDatabase,
  input: InsertAttendanceInput & { readonly capacity: number },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_ATTENDANCE_TABLE} (id, meeting_id, user_id, joined_at, left_at, ` +
        `waiting_from, admitted_at, created_at, updated_at) ` +
        `SELECT ?1, ?2, ?3, ?4, NULL, NULL, NULL, ?4, ?4 WHERE ` +
        `(SELECT COUNT(*) FROM ${MEETING_ATTENDANCE_TABLE} WHERE meeting_id = ?2 ` +
        `AND ${IN_THE_ROOM_PREDICATE}) < ?5`,
    )
    .bind(input.id, input.meetingId, input.userId, input.now, input.capacity);
}

// ONE PERSON LEAVING, and only that person: the statement names the stay by its own id, so a leave
// can never reach across the roster. The `left_at IS NULL` in the WHERE is the precondition the
// caller read — a stay already closed must not have its instant moved, because that instant is in
// somebody's record of what happened.
//
// The REASON travels with the instant rather than on a later update, because the two are one fact:
// a stay that was closed and then labelled would have an instant during which the record could not
// say how the person left.
export function closeAttendanceStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingAttendanceId;
    readonly reason: MeetingDepartureReason;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_ATTENDANCE_TABLE} SET left_at = ?1, ended_reason = ?2, updated_at = ?1 ` +
        `WHERE id = ?3 AND left_at IS NULL`,
    )
    .bind(input.now, input.reason, input.id);
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
