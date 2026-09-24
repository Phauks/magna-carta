import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MeetingAttendanceId,
  MeetingGuestStayId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { MeetingLobbyEntry, MeetingLobbyMode } from "./lobby-types.ts";
import {
  DOOR_QUEUES_PREDICATE,
  GUEST_WAITING_PREDICATE,
  inTheRoomCount,
  MEETING_ATTENDANCE_TABLE,
  MEETING_GUEST_INVITATION_TABLE,
  MEETING_GUEST_STAY_TABLE,
  MEETING_TABLE,
  WAITING_PREDICATE,
  waitingCount,
  type InsertAttendanceInput,
} from "./meeting-statements.ts";
import type { MeetingParticipantHandle, MeetingParticipantKind } from "./types.ts";

// THE DOOR'S OWN SQL: who is waiting at one meeting, how many, the setting that puts them there, and
// the two ways a stay stops waiting.
//
// It is a module of its own rather than four more exports on ./meeting-statements.ts, on the same
// rule the hosting concern's trio follows: a concern is types, statements and service, and the
// lobby is a concern. What stays next door is what the lobby did not invent — the two presence
// predicates, which the live count and the roster compose as well, and the column lists.
//
// NO VISIBILITY PREDICATE ON ANY READ HERE, exactly as the hosting statements have none. A stay
// hangs from a meeting and a meeting hangs from a calendar event, which is where the walled-matter
// question is answered; every caller reaches the meeting through `readMeeting` first, and a second
// gate composed here would be a second answer to a question already answered.

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** How many people are at the door, which is what the lobby's own smaller cap is measured against. */
export async function countWaitingAttendance(
  database: SqlDatabase,
  meetingId: MeetingId,
): Promise<number> {
  // Both kinds of stay: the door is one door, and its ceiling is one ceiling over members and guests.
  const { results } = await database
    .prepare(`SELECT ${waitingCount("?1")} AS count`)
    .bind(meetingId)
    .all<{ readonly count: number }>();
  return results[0]?.count ?? 0;
}

/**
 * WHO IS AT THE DOOR, oldest arrival first — the host's panel, and the frame the room sends them.
 *
 * Read whole rather than paged, and bounded by construction: `MAX_MEETING_LOBBY` is what the door
 * insert's own guard holds, so this cannot come back longer than a hundred rows however long a
 * meeting runs. The limit is bound anyway, one past the ceiling, so a lobby that somehow exceeded it
 * shows up as a list that is too long rather than as a read of the whole table.
 *
 * The name is joined from the firm's own member row rather than copied onto the stay, for the reason
 * a meeting carries nothing the event carries: a second copy is a second answer, and this one would
 * be the name somebody had when they knocked.
 */
export async function listWaitingAttendance(
  database: SqlDatabase,
  meetingId: MeetingId,
  limit: number,
): Promise<readonly MeetingLobbyEntry[]> {
  // BOTH STAY TABLES, in one arrival order. A guest at the door carries the name typed there and the
  // Directory name the link was minted for, side by side, because that pair is what a host reads
  // before deciding — see `MeetingLobbyEntry`.
  const { results } = await database
    .prepare(
      `SELECT door.* FROM (` +
        `SELECT ${MEETING_ATTENDANCE_TABLE}.id AS participant_id, 'member' AS kind, ` +
        `${MEETING_ATTENDANCE_TABLE}.user_id AS user_id, ` +
        `COALESCE(member.display_name, '') AS display_name, NULL AS invited_name, ` +
        `${MEETING_ATTENDANCE_TABLE}.waiting_from AS waiting_from ` +
        `FROM ${MEETING_ATTENDANCE_TABLE} ` +
        `LEFT JOIN member ON member.user_id = ${MEETING_ATTENDANCE_TABLE}.user_id ` +
        `WHERE ${MEETING_ATTENDANCE_TABLE}.meeting_id = ?1 AND ${WAITING_PREDICATE} ` +
        `UNION ALL ` +
        `SELECT ${MEETING_GUEST_STAY_TABLE}.id, 'guest', NULL, ` +
        `${MEETING_GUEST_STAY_TABLE}.confirmed_name, ${MEETING_GUEST_INVITATION_TABLE}.invited_name, ` +
        `${MEETING_GUEST_STAY_TABLE}.waiting_from ` +
        `FROM ${MEETING_GUEST_STAY_TABLE} ` +
        `JOIN ${MEETING_GUEST_INVITATION_TABLE} ` +
        `ON ${MEETING_GUEST_INVITATION_TABLE}.id = ${MEETING_GUEST_STAY_TABLE}.invitation_id ` +
        `WHERE ${MEETING_GUEST_STAY_TABLE}.meeting_id = ?1 AND ${GUEST_WAITING_PREDICATE}` +
        `) AS door ORDER BY door.waiting_from ASC, door.participant_id ASC LIMIT ?2`,
    )
    .bind(meetingId, limit)
    .all<{
      readonly participant_id: MeetingParticipantHandle;
      readonly kind: MeetingParticipantKind;
      readonly user_id: UserId | null;
      readonly display_name: string;
      readonly invited_name: string | null;
      readonly waiting_from: string;
    }>();
  return results.map((row) => ({
    participantId: row.participant_id,
    kind: row.kind,
    userId: row.user_id,
    displayName: row.display_name,
    invitedName: row.invited_name,
    waitingFrom: row.waiting_from,
  }));
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

// THE DOOR, OPENED OR CLOSED. One statement for both directions, on the lock's own precedent: they
// are one act with different arguments, and two statements would be two places for one setting to
// drift.
//
// The WHERE carries the state the caller read, so a host flipping a switch somebody else already
// flipped matches no row rather than writing a second identical value — guarded at the call site,
// where the answer is the success it is.
//
// `status <> 'ended'` is not decoration: an ended meeting's door is a fact about a gathering that is
// over, and moving it would change a record nobody can act on.
export function setMeetingLobbyStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingId; readonly lobby: MeetingLobbyMode; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TABLE} SET lobby = ?1, updated_at = ?2 ` +
        `WHERE id = ?3 AND lobby <> ?1 AND status <> 'ended'`,
    )
    .bind(input.lobby, input.now, input.id);
}

// ONE ARRIVAL AT THE DOOR, and the LOBBY's ceiling in the same statement. Shaped exactly like the
// arrival above and carrying a different number, because the two are different questions: three
// hundred is what a browser and the signaling room can carry, and a hundred is how many rows a firm
// should be able to accumulate in a queue nobody may ever be let out of.
//
// `waiting_from` is what makes this a stay at the door rather than in the room — every predicate,
// every count and every roster reads it — and `admitted_at` stays null until a host decides.
// `joined_at` carries the same instant, because this is genuinely when the stay began.
//
// Guarded, on the arrival's own reasoning: a row inserted past the ceiling is a ceiling that means
// nothing thereafter, and the service's count is a round trip earlier than the write.
export function insertWaitingAttendanceUnderCapStatement(
  database: SqlDatabase,
  input: InsertAttendanceInput & { readonly lobbyCapacity: number },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_ATTENDANCE_TABLE} (id, meeting_id, user_id, joined_at, left_at, ` +
        `waiting_from, admitted_at, created_at, updated_at) ` +
        `SELECT ?1, ?2, ?3, ?4, NULL, ?4, NULL, ?4, ?4 WHERE ` +
        `${waitingCount("?2")} < ?5 ` +
        // AND THE DOOR ITSELF, at the instant of the write rather than a round trip earlier — the
        // arrival's own predicate inverted, because this row belongs at a door that is there to
        // stand at. See `DOOR_QUEUES_PREDICATE`.
        `AND ${DOOR_QUEUES_PREDICATE}`,
    )
    .bind(input.id, input.meetingId, input.userId, input.now, input.lobbyCapacity);
}

// THE CEILING'S REAL HOME, which is here rather than at the door.
//
// `MAX_MEETING_PARTICIPANTS` counts the stays that are in the room, so the door insert cannot be the
// statement that holds it: somebody waiting occupies no seat, and a queue refused at three hundred
// would refuse a hundred people for a room they may never enter. The ADMISSION is where a waiter
// becomes somebody in the room, so the count rides its WHERE and the write is guarded — a host
// admitting five people into two free seats gets three refusals naming the people who did not get
// in, rather than a room of three hundred and three.
//
// The three lobby conditions are the other half of the same WHERE and are the precondition the
// service read: a stay that has been denied, that has left, or that a second admission already let
// in must not have an instant written over the one its record carries.
export function admitAttendanceUnderCapStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingAttendanceId;
    readonly meetingId: MeetingId;
    readonly capacity: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_ATTENDANCE_TABLE} SET admitted_at = ?1, updated_at = ?1 ` +
        `WHERE id = ?2 AND meeting_id = ?3 AND left_at IS NULL AND waiting_from IS NOT NULL ` +
        `AND admitted_at IS NULL AND ${inTheRoomCount("?3")} < ?4`,
    )
    .bind(input.now, input.id, input.meetingId, input.capacity);
}

// A GUEST LET IN, under the same one ceiling. The guest table's twin of the admission above, in the
// same batch and under the same count — `MAX_MEETING_PARTICIPANTS` is one number over members and
// guests, so a host admitting a guest into a full room is refused that one admission exactly as they
// would be for a member, and the guest stays at the door rather than being dropped.
//
// It carries the host who decided, which a member's admission does not: a guest's stay has a column
// for it because letting somebody from outside the firm into a meeting on a matter is the act the
// record is read for afterwards.
export function admitGuestStayUnderCapStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingGuestStayId;
    readonly meetingId: MeetingId;
    readonly admittedByUserId: UserId;
    readonly capacity: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_GUEST_STAY_TABLE} SET admitted_at = ?1, admitted_by_user_id = ?2, ` +
        `updated_at = ?1 WHERE id = ?3 AND meeting_id = ?4 AND left_at IS NULL ` +
        `AND admitted_at IS NULL AND ${inTheRoomCount("?4")} < ?5`,
    )
    .bind(input.now, input.admittedByUserId, input.id, input.meetingId, input.capacity);
}

/**
 * The same admission with NO ceiling in it — the one a host's own grant drags behind it.
 *
 * A HOST DOES NOT WAIT IN THEIR OWN LOBBY, which is what dissolves the lobby's one deadlock: a
 * meeting whose host has gone leaves everybody queued for somebody who will never admit them, and
 * the exit is a key-holder claiming the room from inside the lobby. So a grant written for a member
 * whose stay is waiting admits that stay in the SAME batch — there is no instant in which somebody
 * is hosting a room they are not in.
 *
 * It carries no capacity count, and that is the decision worth defending rather than an oversight:
 * refusing the claimer for a full room would restore exactly the deadlock the claim exists to end,
 * and would do it in the meeting most likely to be full. One seat over the ceiling, held by the
 * person running the room, is the cheaper of the two wrongs.
 *
 * Guarded all the same: a zero here means the stay closed under the grant — they gave up, or another
 * host denied them — and a grant handed to somebody who is not in the meeting is not a thing the
 * batch should leave behind.
 */
export function admitWaitingAttendanceStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingAttendanceId;
    readonly meetingId: MeetingId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_ATTENDANCE_TABLE} SET admitted_at = ?1, updated_at = ?1 ` +
        `WHERE id = ?2 AND meeting_id = ?3 AND left_at IS NULL AND waiting_from IS NOT NULL ` +
        `AND admitted_at IS NULL`,
    )
    .bind(input.now, input.id, input.meetingId);
}
