import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  FirmEventId,
  MatterEventId,
  MatterId,
  MeetingId,
  MeetingPersonalRoomId,
  UserId,
} from "@magna-carta/identifiers/types";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import type { MeetingLobbyMode } from "./lobby-types.ts";
import {
  MEETING_ATTENDANCE_TABLE,
  MEETING_GUEST_STAY_TABLE,
  MEETING_TABLE,
  inTheRoomCount,
  waitingCount,
} from "./meeting-statements.ts";
import type {
  FirmRoomRow,
  SharedRoomRow,
  MeetingPersonalRoomRow,
  PersonalRoomAtLink,
  PersonalRoomOpenSession,
} from "./personal-room-types.ts";
import type { MeetingEventKind, MeetingMedium } from "./types.ts";

// The personal room's SQL. Every read here is addressed by the caller's own user id or by a link
// code, and a link code is an address behind sign-in: what a session READS of a matter still goes
// through the meeting reads and their visibility predicate, never through this module.

export const MEETING_PERSONAL_ROOM_TABLE = "meeting_personal_room";

const ROOM_COLUMNS = [
  "id",
  "owner_user_id",
  "link_code",
  "medium",
  "lobby",
  "link_replaced_at",
  "address_name",
  "kind",
  "title",
  "retired_at",
  "created_at",
  "updated_at",
]
  .map((column) => `${MEETING_PERSONAL_ROOM_TABLE}.${column}`)
  .join(", ");

export async function readPersonalRoomForOwner(
  database: SqlDatabase,
  ownerUserId: UserId,
): Promise<MeetingPersonalRoomRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${ROOM_COLUMNS} FROM ${MEETING_PERSONAL_ROOM_TABLE} ` +
        `WHERE ${MEETING_PERSONAL_ROOM_TABLE}.owner_user_id = ? ` +
        `AND ${MEETING_PERSONAL_ROOM_TABLE}.kind = 'personal'`,
    )
    .bind(ownerUserId)
    .all<MeetingPersonalRoomRow>();
  return results[0];
}

export async function readPersonalRoomByAddressName(
  database: SqlDatabase,
  addressName: string,
): Promise<PersonalRoomAtLink | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${ROOM_COLUMNS}, member.display_name AS owner_display_name, ` +
        `(member.status = 'active') AS owner_active ` +
        `FROM ${MEETING_PERSONAL_ROOM_TABLE} ` +
        `JOIN member ON member.user_id = ${MEETING_PERSONAL_ROOM_TABLE}.owner_user_id ` +
        // A room is reached by its address name (/room/trevor) and nothing else. A retired shared
        // room has none, so it is never reached.
        `WHERE ${MEETING_PERSONAL_ROOM_TABLE}.address_name = ?1 ` +
        `AND ${MEETING_PERSONAL_ROOM_TABLE}.retired_at IS NULL`,
    )
    .bind(addressName)
    .all<PersonalRoomAtLink>();
  return results[0];
}

/**
 * Which of a room's candidate address names, and their numbered forms, another room already has.
 */
export async function readTakenRoomAddressNames(
  database: SqlDatabase,
  candidates: readonly string[],
): Promise<ReadonlySet<string>> {
  const base = candidates.at(-1) ?? "";
  const { results } = await database
    .prepare(
      `SELECT address_name FROM ${MEETING_PERSONAL_ROOM_TABLE} ` +
        `WHERE address_name IN (SELECT value FROM json_each(?1)) ` +
        `OR address_name GLOB ?2`,
    )
    .bind(JSON.stringify(candidates), `${base}-[0-9]*`)
    .all<{ address_name: string }>();
  return new Set(results.map((row) => row.address_name));
}

/** The owner's display name, which the event's title is made from. */
export async function readMemberDisplayName(
  database: SqlDatabase,
  userId: UserId,
): Promise<string | undefined> {
  const { results } = await database
    .prepare(`SELECT display_name FROM member WHERE user_id = ?`)
    .bind(userId)
    .all<{ display_name: string }>();
  return results[0]?.display_name;
}

// MAKING THE ROOM, find-or-make. Two first reads racing both compose this; the unique index on the
// owner turns the second into nothing, and both callers read the one row back after the commit.
//
// fitness:unguarded-write — a conflict means the room already exists, which is the answer both
// callers wanted; refusing the batch would turn a won race into an error.
export function insertPersonalRoomStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingPersonalRoomId;
    readonly ownerUserId: UserId;
    readonly linkCode: string;
    // The room's address by name; the unique index refuses a name another room took in between,
    // which rolls the make back to be tried again.
    readonly addressName: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_PERSONAL_ROOM_TABLE} (id, owner_user_id, link_code, medium, lobby, ` +
        `link_replaced_at, address_name, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, 'video', 'on', NULL, ?5, ?4, ?4) ` +
        `ON CONFLICT (owner_user_id) WHERE kind = 'personal' DO NOTHING`,
    )
    .bind(input.id, input.ownerUserId, input.linkCode, input.now, input.addressName);
}

/** One room by its handle, whichever kind it is. */
export async function readRoomById(
  database: SqlDatabase,
  roomId: MeetingPersonalRoomId,
): Promise<MeetingPersonalRoomRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${ROOM_COLUMNS} FROM ${MEETING_PERSONAL_ROOM_TABLE} ` +
        `WHERE ${MEETING_PERSONAL_ROOM_TABLE}.id = ?1`,
    )
    .bind(roomId)
    .all<MeetingPersonalRoomRow>();
  return results[0];
}

// A ROOM THE FIRM SHARES. The unique address index refuses a name another room took in between,
// which rolls the batch back; the route answers it as a changed room.
//
// fitness:unguarded-write — a new row under a fresh handle; the indexes are its guard.
export function insertSharedRoomStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingPersonalRoomId;
    readonly setUpByUserId: UserId;
    readonly linkCode: string;
    readonly addressName: string;
    readonly title: string;
    readonly medium: MeetingMedium;
    readonly lobby: MeetingLobbyMode;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_PERSONAL_ROOM_TABLE} (id, owner_user_id, link_code, medium, lobby, ` +
        `link_replaced_at, address_name, kind, title, retired_at, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, 'shared', ?7, NULL, ?8, ?8)`,
    )
    .bind(
      input.id,
      input.setUpByUserId,
      input.linkCode,
      input.medium,
      input.lobby,
      input.addressName,
      input.title,
      input.now,
    );
}

// A ROOM'S NAME, AND THE ADDRESS THAT FOLLOWS IT. Guarded on the address it read, so two renames
// racing leave one name rather than one silently overwriting the other with an address it did not
// check was free.
export function renameRoomStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingPersonalRoomId;
    readonly previousAddressName: string | null;
    readonly title: string | null;
    readonly addressName: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_PERSONAL_ROOM_TABLE} SET title = ?1, address_name = ?2, updated_at = ?3 ` +
        `WHERE id = ?4 AND address_name IS ?5 AND retired_at IS NULL`,
    )
    .bind(input.title, input.addressName, input.now, input.id, input.previousAddressName);
}

// A SHARED ROOM TAKEN OFF THE LIST. Its address is given up, so the link names nothing and the name
// is free for another room; its sessions stay on the record. Guarded on its still being in use.
export function retireSharedRoomStatement(
  database: SqlDatabase,
  input: { readonly id: MeetingPersonalRoomId; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_PERSONAL_ROOM_TABLE} SET retired_at = ?1, address_name = NULL, updated_at = ?1 ` +
        `WHERE id = ?2 AND kind = 'shared' AND retired_at IS NULL`,
    )
    .bind(input.now, input.id);
}

// A NEW LINK. Guarded by the caller on the code it read, so two replacements racing leave one code
// rather than one replacement silently overwriting the other.
export function replacePersonalRoomLinkStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingPersonalRoomId;
    readonly previousLinkCode: string;
    readonly linkCode: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_PERSONAL_ROOM_TABLE} SET link_code = ?1, link_replaced_at = ?2, ` +
        `updated_at = ?2 WHERE id = ?3 AND link_code = ?4`,
    )
    .bind(input.linkCode, input.now, input.id, input.previousLinkCode);
}

// The owner's standing choices. Last write wins, because the two values are whole answers a person
// picked rather than counts something else was built on.
//
// fitness:unguarded-write — the row is the caller's own and the statement sets whole values; a lost
// race leaves the other choice the owner made a moment later, which is the one they meant.
export function updatePersonalRoomDefaultsStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingPersonalRoomId;
    readonly medium: MeetingMedium;
    readonly lobby: MeetingLobbyMode;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_PERSONAL_ROOM_TABLE} SET medium = ?1, lobby = ?2, updated_at = ?3 WHERE id = ?4`,
    )
    .bind(input.medium, input.lobby, input.now, input.id);
}

// THE SESSION OPEN NOW, if any, with the two facts that decide whether it is still in use: how many
// people are in the room or at its door, and when the last of them left.
export async function readPersonalRoomOpenSession(
  database: SqlDatabase,
  roomId: MeetingPersonalRoomId,
): Promise<PersonalRoomOpenSession | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_TABLE}.id, ${MEETING_TABLE}.join_code, ${MEETING_TABLE}.status, ` +
        `${MEETING_TABLE}.event_kind, ${MEETING_TABLE}.matter_event_id, ${MEETING_TABLE}.firm_event_id, ${MEETING_TABLE}.started_at, ` +
        `COALESCE(matter_event.time_zone, firm_event.time_zone) AS time_zone, ` +
        `(${inTheRoomCount(`${MEETING_TABLE}.id`)}) + (${waitingCount(`${MEETING_TABLE}.id`)}) AS present_count, ` +
        `(SELECT MAX(left_at) FROM (` +
        `SELECT left_at FROM ${MEETING_ATTENDANCE_TABLE} WHERE meeting_id = ${MEETING_TABLE}.id ` +
        `UNION ALL SELECT left_at FROM ${MEETING_GUEST_STAY_TABLE} WHERE meeting_id = ${MEETING_TABLE}.id` +
        `)) AS last_left_at ` +
        `FROM ${MEETING_TABLE} ` +
        `LEFT JOIN matter_event ON matter_event.id = ${MEETING_TABLE}.matter_event_id ` +
        `LEFT JOIN firm_event ON firm_event.id = ${MEETING_TABLE}.firm_event_id ` +
        `WHERE ${MEETING_TABLE}.personal_room_id = ? AND ${MEETING_TABLE}.status <> 'ended'`,
    )
    .bind(roomId)
    .all<PersonalRoomOpenSession>();
  return results[0];
}

// THE EVENT A SESSION HANGS FROM, closed at the instant the session ended: its end is written in the
// event's own zone, as a civil date and a wall-clock time like every event's, and it has happened.
// A session runs across midnight now and then, so the end date is its own column rather than assumed
// to be the start's.
//
// fitness:unguarded-write — it rides the batch that ends the session, which carries that act's own
// guard; on its own it moves a row nothing else writes while the session is open.
export function settleSessionEventStatement(
  database: SqlDatabase,
  input: {
    readonly eventKind: MeetingEventKind;
    readonly eventId: MatterEventId | FirmEventId;
    readonly timeZone: string;
    readonly endedAt: string;
    readonly now: string;
  },
): SqlStatement {
  const reading = zonedReading(Date.parse(input.endedAt), input.timeZone);
  const table = input.eventKind === "matter" ? "matter_event" : "firm_event";
  return database
    .prepare(
      `UPDATE ${table} SET ends_on = ?1, ends_at_time = ?2, status = 'occurred', updated_at = ?3 ` +
        `WHERE id = ?4 AND status = 'scheduled'`,
    )
    .bind(reading.civilDate, reading.wallClockTime, input.now, input.eventId);
}

// What the event a session hangs from says, read to settle it when the session ends.
export async function readSessionEventZone(
  database: SqlDatabase,
  meetingId: MeetingId,
): Promise<string | undefined> {
  const { results } = await database
    .prepare(
      `SELECT COALESCE(matter_event.time_zone, firm_event.time_zone) AS time_zone FROM ${MEETING_TABLE} ` +
        `LEFT JOIN matter_event ON matter_event.id = ${MEETING_TABLE}.matter_event_id ` +
        `LEFT JOIN firm_event ON firm_event.id = ${MEETING_TABLE}.firm_event_id ` +
        `WHERE ${MEETING_TABLE}.id = ?`,
    )
    .bind(meetingId)
    .all<{ time_zone: string }>();
  return results[0]?.time_zone;
}

// MOVING A SESSION ONTO A MATTER: the meeting re-pointed from the firm event to the matter event that
// replaces it. Guarded by the caller on the meeting still hanging from the firm event the move read,
// so two moves racing land one and roll the other back whole.
export function moveMeetingToMatterEventStatement(
  database: SqlDatabase,
  input: {
    readonly meetingId: MeetingId;
    readonly firmEventId: FirmEventId;
    readonly matterEventId: MatterEventId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_TABLE} SET event_kind = 'matter', matter_event_id = ?1, firm_event_id = NULL, ` +
        `updated_at = ?2 WHERE id = ?3 AND event_kind = 'firm' AND firm_event_id = ?4 ` +
        `AND personal_room_id IS NOT NULL`,
    )
    .bind(input.matterEventId, input.now, input.meetingId, input.firmEventId);
}

// The firm event a moved session leaves behind, and its participant rows, deleted after the matter
// event that replaces it is written. Guarded by the caller: an event something else still points at
// (a booking, a link, another meeting) fails the delete at its foreign key, and the whole move rolls
// back rather than leaving two events for one gathering.
export function deleteMovedFirmEventParticipantsStatement(
  database: SqlDatabase,
  firmEventId: FirmEventId,
): SqlStatement {
  // fitness:unguarded-write — the participant rows are copied onto the matter event in the same
  // batch; zero rows is a firm event nobody else was on.
  return database
    .prepare(`DELETE FROM firm_event_participant WHERE firm_event_id = ?`)
    .bind(firmEventId);
}

export function deleteMovedFirmEventStatement(
  database: SqlDatabase,
  firmEventId: FirmEventId,
): SqlStatement {
  return database
    .prepare(
      `DELETE FROM firm_event WHERE id = ? ` +
        `AND NOT EXISTS (SELECT 1 FROM ${MEETING_TABLE} WHERE ${MEETING_TABLE}.firm_event_id = firm_event.id)`,
    )
    .bind(firmEventId);
}

// A member arriving on the link joins the session's event, so it is on their calendar and the
// event's participants say who was there. Written only when they are not on it already.
//
// fitness:unguarded-write — zero rows means the member is already a participant, which is the state
// the arrival wanted.
export function addSessionParticipantStatement(
  database: SqlDatabase,
  input: {
    readonly id: string;
    readonly eventKind: MeetingEventKind;
    readonly eventId: MatterEventId | FirmEventId;
    readonly userId: UserId;
    readonly now: string;
  },
): SqlStatement {
  const [table, eventColumn] =
    input.eventKind === "matter"
      ? ["matter_event_participant", "event_id"]
      : ["firm_event_participant", "firm_event_id"];
  return database
    .prepare(
      `INSERT INTO ${table} (id, ${eventColumn}, participant_kind, member_user_id, entity_id, ` +
        `participant_name, role, created_at, updated_at) ` +
        `SELECT ?1, ?2, 'member', ?3, NULL, NULL, NULL, ?4, ?4 WHERE NOT EXISTS (` +
        `SELECT 1 FROM ${table} WHERE ${eventColumn} = ?2 AND member_user_id = ?3)`,
    )
    .bind(input.id, input.eventId, input.userId, input.now);
}

/** A firm event's participants, copied when the session moves onto a matter. */
export async function readFirmEventParticipantsForMove(
  database: SqlDatabase,
  firmEventId: FirmEventId,
): Promise<
  readonly {
    readonly participant_kind: "member" | "entity" | "external";
    readonly member_user_id: UserId | null;
    readonly entity_id: string | null;
    readonly participant_name: string | null;
    readonly role: string | null;
  }[]
> {
  const { results } = await database
    .prepare(
      `SELECT participant_kind, member_user_id, entity_id, participant_name, role ` +
        `FROM firm_event_participant WHERE firm_event_id = ? ORDER BY created_at, id`,
    )
    .bind(firmEventId)
    .all<{
      participant_kind: "member" | "entity" | "external";
      member_user_id: UserId | null;
      entity_id: string | null;
      participant_name: string | null;
      role: string | null;
    }>();
  return results;
}

/** The firm event a session hangs from, read whole so the move can copy it onto the matter. */
export async function readFirmEventForMove(
  database: SqlDatabase,
  firmEventId: FirmEventId,
): Promise<
  | {
      readonly title: string;
      readonly description: string | null;
      readonly status: "scheduled" | "occurred" | "cancelled";
      readonly starts_on: string;
      readonly starts_at_time: string | null;
      readonly ends_on: string | null;
      readonly ends_at_time: string | null;
      readonly time_zone: string;
    }
  | undefined
> {
  const { results } = await database
    .prepare(
      `SELECT title, description, status, starts_on, starts_at_time, ends_on, ends_at_time, time_zone ` +
        `FROM firm_event WHERE id = ?`,
    )
    .bind(firmEventId)
    .all<{
      title: string;
      description: string | null;
      status: "scheduled" | "occurred" | "cancelled";
      starts_on: string;
      starts_at_time: string | null;
      ends_on: string | null;
      ends_at_time: string | null;
      time_zone: string;
    }>();
  return results[0];
}

/**
 * The matter a session is opened on or moved onto, through the visibility predicate: a matter the
 * caller may not see and one that does not exist are the same absence.
 */
export async function readVisibleMatter(
  database: SqlDatabase,
  matterId: MatterId,
  visibility: VisibleMatterPredicate,
): Promise<{ readonly id: MatterId } | undefined> {
  const { results } = await database
    .prepare(
      `SELECT matter.id FROM matter WHERE matter.id = ? AND ${visibility.fragmentFor("matter.id")}`,
    )
    .bind(matterId, ...visibility.bindings)
    .all<{ id: MatterId }>();
  return results[0];
}

/**
 * EVERY ACTIVE MEMBER'S ROOM, for the Meetings page's Firm Rooms list: the member, their room's link
 * code where they have one, and the session it has open with how many people are in the room.
 *
 * It reads no matter. A room's link is an address behind sign-in that any member may already be sent,
 * and the open session is named only by its id and a count; what the session is ABOUT stays behind
 * the meeting reads and their visibility predicate. Ordered by name, so the list reads like a
 * directory.
 */
export async function listFirmRooms(database: SqlDatabase): Promise<FirmRoomRow[]> {
  const { results } = await database
    .prepare(
      `SELECT member.user_id AS user_id, member.display_name AS display_name, ` +
        `${MEETING_PERSONAL_ROOM_TABLE}.link_code AS link_code, ` +
        `${MEETING_PERSONAL_ROOM_TABLE}.address_name AS address_name, ` +
        `${MEETING_PERSONAL_ROOM_TABLE}.title AS title, ` +
        `${MEETING_PERSONAL_ROOM_TABLE}.medium AS medium, ` +
        `open_session.id AS open_meeting_id, ` +
        `CASE WHEN open_session.id IS NULL THEN 0 ELSE ${inTheRoomCount("open_session.id")} END AS live_count ` +
        `FROM member ` +
        `LEFT JOIN ${MEETING_PERSONAL_ROOM_TABLE} ` +
        `ON ${MEETING_PERSONAL_ROOM_TABLE}.owner_user_id = member.user_id ` +
        `AND ${MEETING_PERSONAL_ROOM_TABLE}.kind = 'personal' ` +
        `LEFT JOIN ${MEETING_TABLE} AS open_session ` +
        `ON open_session.personal_room_id = ${MEETING_PERSONAL_ROOM_TABLE}.id ` +
        `AND open_session.status <> 'ended' ` +
        `WHERE member.status = 'active' ` +
        `ORDER BY member.display_name COLLATE NOCASE, member.user_id`,
    )
    .all<FirmRoomRow>();
  return results;
}

/**
 * THE FIRM'S SHARED ROOMS, for the Meetings page: each room still in use, who set it up, and the
 * session it has open with how many people are in it. Ordered by name, like a list of places.
 */
export async function listSharedRooms(database: SqlDatabase): Promise<SharedRoomRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_PERSONAL_ROOM_TABLE}.id AS id, ${MEETING_PERSONAL_ROOM_TABLE}.title AS title, ` +
        `${MEETING_PERSONAL_ROOM_TABLE}.address_name AS address_name, ` +
        `${MEETING_PERSONAL_ROOM_TABLE}.medium AS medium, ${MEETING_PERSONAL_ROOM_TABLE}.lobby AS lobby, ` +
        `member.display_name AS set_up_by, ` +
        `open_session.id AS open_meeting_id, ` +
        `CASE WHEN open_session.id IS NULL THEN 0 ELSE ${inTheRoomCount("open_session.id")} END AS live_count ` +
        `FROM ${MEETING_PERSONAL_ROOM_TABLE} ` +
        `JOIN member ON member.user_id = ${MEETING_PERSONAL_ROOM_TABLE}.owner_user_id ` +
        `LEFT JOIN ${MEETING_TABLE} AS open_session ` +
        `ON open_session.personal_room_id = ${MEETING_PERSONAL_ROOM_TABLE}.id ` +
        `AND open_session.status <> 'ended' ` +
        `WHERE ${MEETING_PERSONAL_ROOM_TABLE}.kind = 'shared' ` +
        `AND ${MEETING_PERSONAL_ROOM_TABLE}.retired_at IS NULL ` +
        `ORDER BY ${MEETING_PERSONAL_ROOM_TABLE}.title COLLATE NOCASE, ${MEETING_PERSONAL_ROOM_TABLE}.id`,
    )
    .all<SharedRoomRow>();
  return results;
}
