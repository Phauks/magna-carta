import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MeetingAttendanceId,
  MeetingHostId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MeetingHostRole, MeetingHostRow } from "./hosting-types.ts";
import {
  IN_THE_ROOM_PREDICATE,
  MEETING_ATTENDANCE_COLUMNS,
  MEETING_ATTENDANCE_TABLE,
  MEETING_TABLE,
} from "./meeting-statements.ts";
import type { MeetingAttendanceRow } from "./types.ts";

// The grants, the door, and the one read that decides whether somebody may come back in.
//
// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test.
export const MEETING_HOST_TABLE = "meeting_host";

const HOST_COLUMNS =
  "id, meeting_id, user_id, role, granted_by_user_id, granted_at, revoked_at, " +
  "revoked_by_user_id, created_at, updated_at";

// NO VISIBILITY PREDICATE ON ANY READ HERE, and that is not an omission. A grant hangs from a
// meeting and a meeting hangs from a calendar event, which is where the walled-matter question is
// answered — every caller in this package reaches the meeting through `readMeeting` first, and a
// second gate composed here would be a second answer to a question already answered. The one thing
// that would make it a leak is a caller that skipped the meeting read, which is exactly what the
// service layer is arranged to prevent.

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/**
 * The grants that stand right now, the host first.
 *
 * Ordered by role rather than by instant because the room draws a badge from it and a list whose
 * first entry was whoever happened to be granted earliest would make "who is running this" a thing a
 * reader has to search for. `'co-host' < 'host'` asciibetically, so the order is stated as a CASE
 * rather than left to the text: the ordering is a decision, not a coincidence of spelling.
 */
export async function readLiveHostGrants(
  database: SqlDatabase,
  meetingId: MeetingId,
): Promise<readonly MeetingHostRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${HOST_COLUMNS} FROM ${MEETING_HOST_TABLE} ` +
        `WHERE meeting_id = ? AND revoked_at IS NULL ` +
        `ORDER BY CASE role WHEN 'host' THEN 0 ELSE 1 END, granted_at ASC, id ASC`,
    )
    .bind(meetingId)
    .all<MeetingHostRow>();
  return results;
}

/** One member's live grant on one meeting, which is the whole of the authority question. */
export async function readLiveHostGrant(
  database: SqlDatabase,
  meetingId: MeetingId,
  userId: UserId,
): Promise<MeetingHostRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${HOST_COLUMNS} FROM ${MEETING_HOST_TABLE} ` +
        `WHERE meeting_id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(meetingId, userId)
    .all<MeetingHostRow>();
  return results[0];
}

/**
 * WHETHER ANYBODY IS ACTUALLY RUNNING THE ROOM — a live HOST grant held by somebody in the room.
 *
 * This is the question a claim is refused on, and it is deliberately not "is there a live grant".
 * Hosting does not pass on its own when a host leaves: a host whose tunnel drops for ninety seconds
 * has not stopped hosting, and a rule that reassigned the room on a socket loss would hand a client
 * meeting to whoever happened to be next in the roster. So the grant stands while its holder is
 * away, and what the claim asks instead is whether the HOST is in the room.
 *
 * TWO WORDS DO THE WORK, AND BOTH WERE WRONG ONCE. "In the room" excludes a grant-holder standing at
 * the door, who cannot admit anybody including themselves — counting them refused the claim that is
 * the lobby's one way out of a hostless room. And "host" excludes a co-host: counting every role
 * meant two co-hosts in a room whose host had gone each saw the other and neither could claim, which
 * left the meeting permanently without a host. A co-host does not prevent the claim; the host does.
 */
export async function countOtherHostsPresent(
  database: SqlDatabase,
  meetingId: MeetingId,
  exceptUserId: UserId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM ${MEETING_HOST_TABLE} ` +
        `WHERE ${MEETING_HOST_TABLE}.meeting_id = ?1 AND ${MEETING_HOST_TABLE}.revoked_at IS NULL ` +
        `AND ${MEETING_HOST_TABLE}.user_id <> ?2 ` +
        // A HOST'S GRANT AND NOT A CO-HOST'S, and that word is the whole of this predicate. A
        // co-host is running the meeting WITH somebody; they are not the somebody. Counting them
        // here refused the claim in exactly the room that needs it most — two co-hosts present and
        // the host gone — because each of them saw the other and neither could take a room that
        // nobody was holding. The result was a meeting permanently without a host, which is the
        // state the claim exists to end.
        `AND ${MEETING_HOST_TABLE}.role = 'host' ` +
        `AND EXISTS (SELECT 1 FROM ${MEETING_ATTENDANCE_TABLE} ` +
        `WHERE ${MEETING_ATTENDANCE_TABLE}.meeting_id = ?1 ` +
        `AND ${MEETING_ATTENDANCE_TABLE}.user_id = ${MEETING_HOST_TABLE}.user_id ` +
        // IN THE ROOM, not merely holding an open stay. A grant-holder waiting at the door is not
        // running the meeting — they cannot admit anybody, including themselves — so counting them
        // here would refuse the claim that is the lobby's one way out of a hostless room.
        `AND ${IN_THE_ROOM_PREDICATE})`,
    )
    .bind(meetingId, exceptUserId)
    .all<{ readonly count: number }>();
  return results[0]?.count ?? 0;
}

/**
 * The stay a host closed against this member, if there is one — the barred-entry predicate.
 *
 * A MEMBER PUT OUT OF A MEETING DOES NOT COME BACK INTO IT, and neither does one turned away at the
 * door. The join path asks this, which is why the reason is a column and not only a label on the
 * audit row: a refusal that had to walk a matter's audit log to decide would be a read of the wrong
 * record entirely.
 *
 * BARRED ENTRY IS ONE RULE WITH TWO LABELS. `removed` is out of the room and `denied` is turned away
 * at the door; both bar the member for as long as this meeting runs, because a denial that did not
 * bar would be a button that does nothing — the member presses Join again and is back at the front
 * of the queue. The row carries which one it was, so only the sentence differs.
 *
 * It is the MEETING they are barred from and not the event — a new meeting on the same event is a
 * new room, and a host who wants them back starts one.
 */
export async function readBarredStay(
  database: SqlDatabase,
  meetingId: MeetingId,
  userId: UserId,
): Promise<MeetingAttendanceRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_ATTENDANCE_COLUMNS} ` +
        `FROM ${MEETING_ATTENDANCE_TABLE} ` +
        `WHERE meeting_id = ? AND user_id = ? AND ended_reason IN ('removed', 'denied') ` +
        `ORDER BY left_at DESC, id DESC`,
    )
    .bind(meetingId, userId)
    .all<MeetingAttendanceRow>();
  return results[0];
}

// ---------------------------------------------------------------------------------------------
// The race the database settles, recognised by the error it settles it with.
//
// Matched on the index name rather than on "UNIQUE" anywhere in the message, so a grant race is
// never mistaken for the open-stay race next door and an unrelated constraint keeps surfacing as the
// fault it is.
// ---------------------------------------------------------------------------------------------

/**
 * Two members handed the room to two different people in the same instant, and one of them lost.
 *
 * Every write path here is a read-then-write and is blind to the instant it does not span, so the
 * partial unique indexes are what actually hold "one live host, one live grant per member". The
 * loser's whole batch rolls back rather than a second host appearing.
 */
export function isHostGrantConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MEETING_HOST_TABLE}.meeting_id`)
  );
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export interface InsertHostGrantInput {
  readonly id: MeetingHostId;
  readonly meetingId: MeetingId;
  readonly userId: UserId;
  readonly role: MeetingHostRole;
  /** Null for the starter's own grant and for a claim: neither was given by anybody. */
  readonly grantedByUserId: UserId | null;
  readonly now: string;
}

// ONE GRANT OPENED. The two partial unique indexes are the ceiling on it, which is why this is a
// plain insert with no precondition in its WHERE: what it races against is another batch's insert
// rather than a row this one could have read, and a guard on a read-shaped condition would settle
// nothing the read a round trip earlier did not already settle.
export function insertHostGrantStatement(
  database: SqlDatabase,
  input: InsertHostGrantInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_HOST_TABLE} (id, meeting_id, user_id, role, granted_by_user_id, ` +
        `granted_at, revoked_at, revoked_by_user_id, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?6, ?6)`,
    )
    .bind(input.id, input.meetingId, input.userId, input.role, input.grantedByUserId, input.now);
}

// ONE GRANT CLOSED, never deleted: the interval is what the record is read for. Addressed by the
// member and the meeting rather than by the grant's own handle, because that is how every caller
// holds it — and `revoked_at IS NULL` in the WHERE is the precondition the caller read, so a grant
// already withdrawn does not have its instant moved.
//
// Guarded at every call site: matching no row means somebody else closed this grant between the
// read and the commit, and a hand-over whose outgoing half quietly did nothing would leave the room
// with two hosts — which the index then refuses anyway, one statement later and with a worse answer.
export function revokeHostGrantStatement(
  database: SqlDatabase,
  input: {
    readonly meetingId: MeetingId;
    readonly userId: UserId;
    readonly revokedByUserId: UserId;
    readonly now: string;
    /**
     * The role this closes, where the caller is closing a PARTICULAR grant rather than whatever the
     * member holds.
     *
     * A member holds at most one live grant — a partial unique index refuses a second — so
     * addressing by member alone is exact against any COMMITTED state, and every caller relied on
     * that. It stops being exact inside a batch that closes one grant and opens another for the same
     * member, which is what a hand-over now does: the outgoing host steps down to co-host in the
     * same transaction. A second hand-over composed against the state before that one would then
     * close the co-host grant it had never read, pass its own guard on a row it did not mean, and
     * fail one statement later on the live-host index — a raw constraint error where the guard was
     * the thing meant to catch it. Naming the role makes the statement say which grant it is
     * closing, so the guard fires where it should.
     */
    readonly role?: MeetingHostRole;
  },
): SqlStatement {
  const roleClause = input.role === undefined ? "" : ` AND role = ?5`;
  const statement = database.prepare(
    `UPDATE ${MEETING_HOST_TABLE} SET revoked_at = ?1, revoked_by_user_id = ?2, updated_at = ?1 ` +
      `WHERE meeting_id = ?3 AND user_id = ?4 AND revoked_at IS NULL${roleClause}`,
  );
  return input.role === undefined
    ? statement.bind(input.now, input.revokedByUserId, input.meetingId, input.userId)
    : statement.bind(input.now, input.revokedByUserId, input.meetingId, input.userId, input.role);
}

// THE DOOR, SHUT OR OPENED. One statement for both directions, because they are one act with
// different arguments and two statements would be two places for the pair to drift: the instant and
// the actor move together or not at all, which the schema also refuses.
//
// The WHERE carries the state the caller read, so locking a room somebody else has already locked
// matches no row rather than overwriting whose door it was — guarded at the call site, where a
// no-op is answered as the success it is rather than as a fault.
export function setMeetingLockStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingId;
    readonly locked: boolean;
    readonly lockedByUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return input.locked
    ? database
        .prepare(
          `UPDATE ${MEETING_TABLE} SET locked_at = ?1, locked_by_user_id = ?2, updated_at = ?1 ` +
            `WHERE id = ?3 AND locked_at IS NULL AND status <> 'ended'`,
        )
        .bind(input.now, input.lockedByUserId, input.id)
    : database
        .prepare(
          `UPDATE ${MEETING_TABLE} SET locked_at = NULL, locked_by_user_id = NULL, updated_at = ?1 ` +
            `WHERE id = ?2 AND locked_at IS NOT NULL AND status <> 'ended'`,
        )
        .bind(input.now, input.id);
}

/** One stay, by its own handle and within one meeting — what a removal is addressed to. */
export async function readAttendanceInMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  attendanceId: MeetingAttendanceId,
): Promise<MeetingAttendanceRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_ATTENDANCE_COLUMNS} ` +
        `FROM ${MEETING_ATTENDANCE_TABLE} WHERE id = ? AND meeting_id = ?`,
    )
    .bind(attendanceId, meetingId)
    .all<MeetingAttendanceRow>();
  return results[0];
}
