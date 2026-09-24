import { keysetClause, type SortCursor } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  MeetingGuestInvitationId,
  MeetingGuestStayId,
  MeetingId,
  UserId,
} from "@magna-carta/identifiers/types";
import type {
  GuestEventFacts,
  MeetingGuestEntityKind,
  MeetingGuestInvitationRow,
  MeetingGuestStayRow,
} from "./guest-types.ts";
import {
  MEETING_GUEST_INVITATION_TABLE,
  MEETING_GUEST_STAY_TABLE,
  MEETING_TABLE,
  waitingCount,
} from "./meeting-statements.ts";
import type { MeetingDepartureReason, MeetingRow } from "./types.ts";

// THE GUEST'S OWN SQL: the link's row, the guest's stay, and the three facts an invitation is minted
// from — the event's participant, the Directory's name, and the Directory's address.
//
// TWO KINDS OF READ, AND THEY ANSWER TO DIFFERENT GATES. The HOST's reads — minting, rotating,
// revoking, listing — reach the meeting through `readMeeting` and the visible-matter predicate first,
// in the service, exactly as every other host act does; nothing here re-states that gate. The GUEST's
// reads are addressed by a signed credential the chokepoint has already verified against the row, so
// the meeting they reach is a fact of the credential rather than of anything the guest typed, and
// there is no member for a visibility predicate to be about.

const INVITATION_COLUMNS =
  "id, meeting_id, entity_kind, entity_id, invited_name, directory_email_id, token_secret_hash, " +
  "secret_version, issued_by_user_id, expires_at, revoked_at, revoked_by_user_id, arrival_count, " +
  "last_arrival_at, created_at, updated_at";

const GUEST_STAY_COLUMNS =
  "id, meeting_id, invitation_id, confirmed_name, joined_at, waiting_from, admitted_at, " +
  "admitted_by_user_id, left_at, ended_reason, created_at, updated_at";

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

// ---------------------------------------------------------------------------------------------
// The meeting and its event, as a credential reaches them
// ---------------------------------------------------------------------------------------------

/**
 * The meeting a guest credential names, with its event's own facts — and NO visibility predicate.
 *
 * Deliberately ungated, and only ever called with a meeting id taken off a credential the chokepoint
 * has already verified against its invitation row. A guest is not a member, so the walled-matter
 * question has nobody to be asked about; what stands between a stranger and this read is the
 * signature, the live row and the meeting id the firm put in the token. A host's path never calls
 * this: it reaches the meeting through `readMeeting`.
 */
export async function readMeetingForGuest(
  database: SqlDatabase,
  meetingId: MeetingId,
): Promise<(MeetingRow & { readonly event: GuestEventFacts }) | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${MEETING_COLUMNS}, ` +
        `COALESCE(matter_event.title, firm_event.title) AS event_title, ` +
        `COALESCE(matter_event.starts_on, firm_event.starts_on) AS event_starts_on, ` +
        `COALESCE(matter_event.ends_on, firm_event.ends_on) AS event_ends_on, ` +
        `COALESCE(matter_event.starts_at_time, firm_event.starts_at_time) AS event_starts_at_time, ` +
        `COALESCE(matter_event.ends_at_time, firm_event.ends_at_time) AS event_ends_at_time, ` +
        `COALESCE(matter_event.time_zone, firm_event.time_zone) AS event_time_zone ` +
        `FROM ${MEETING_TABLE} ` +
        `LEFT JOIN matter_event ON matter_event.id = ${MEETING_TABLE}.matter_event_id ` +
        `LEFT JOIN firm_event ON firm_event.id = ${MEETING_TABLE}.firm_event_id ` +
        `WHERE ${MEETING_TABLE}.id = ?`,
    )
    .bind(meetingId)
    .all<
      MeetingRow & {
        readonly event_title: string;
        readonly event_starts_on: string;
        readonly event_ends_on: string | null;
        readonly event_starts_at_time: string | null;
        readonly event_ends_at_time: string | null;
        readonly event_time_zone: string;
      }
    >();
  const row = results[0];
  if (row === undefined) return undefined;
  const {
    event_title: title,
    event_starts_on: startsOn,
    event_ends_on: endsOn,
    event_starts_at_time: startsAtTime,
    event_ends_at_time: endsAtTime,
    event_time_zone: timeZone,
    ...meeting
  } = row;
  return {
    ...meeting,
    event: { title, startsOn, endsOn, startsAtTime, endsAtTime, timeZone },
  };
}

/**
 * How one Directory entity is on a meeting's event, if it is at all.
 *
 * Only the ENTITY shape can be invited. An external participant carries a name and nothing the record
 * can resolve or write to, and a member is a member — so the service asks for the entity row
 * specifically and refuses everything else as not invitable.
 */
export async function isEntityOnMeetingEvent(
  database: SqlDatabase,
  meeting: Pick<MeetingRow, "event_kind" | "matter_event_id" | "firm_event_id">,
  entityId: string,
): Promise<boolean> {
  const statement =
    meeting.event_kind === "matter"
      ? database
          .prepare(
            `SELECT 1 AS present FROM matter_event_participant ` +
              `WHERE event_id = ?1 AND participant_kind = 'entity' AND entity_id = ?2`,
          )
          .bind(meeting.matter_event_id, entityId)
      : database
          .prepare(
            `SELECT 1 AS present FROM firm_event_participant ` +
              `WHERE firm_event_id = ?1 AND participant_kind = 'entity' AND entity_id = ?2`,
          )
          .bind(meeting.firm_event_id, entityId);
  const { results } = await statement.all<{ readonly present: number }>();
  return results.length > 0;
}

/**
 * The Directory's name for an entity TODAY — which the invitation freezes at mint.
 *
 * A person's display name, or their given and family names where no display name was recorded; an
 * organization's display name, or its legal name. An entity that has been deleted or merged away is
 * not somebody a link should be minted for, so it answers nothing and the caller refuses.
 */
export async function readDirectoryEntityName(
  database: SqlDatabase,
  entityKind: MeetingGuestEntityKind,
  entityId: string,
): Promise<string | undefined> {
  const { results } =
    entityKind === "person"
      ? await database
          .prepare(
            `SELECT COALESCE(NULLIF(TRIM(display_name), ''), ` +
              `NULLIF(TRIM(COALESCE(name_given, '') || ' ' || COALESCE(name_family, '')), '')) AS name ` +
              `FROM directory_person WHERE id = ? AND deleted_at IS NULL AND status = 'active'`,
          )
          .bind(entityId)
          .all<{ readonly name: string | null }>()
      : await database
          .prepare(
            `SELECT COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(legal_name), '')) AS name ` +
              `FROM directory_organization WHERE id = ? AND deleted_at IS NULL AND status = 'active'`,
          )
          .bind(entityId)
          .all<{ readonly name: string | null }>();
  const name = results[0]?.name;
  return name === null || name === undefined ? undefined : name;
}

/**
 * The contact point a link is sent to: the one the host named, or the entity's primary, or its
 * preferred — and only an address the person has not asked the firm never to use.
 *
 * The ADDRESS is read here and handed to the caller for the one send; it is never written anywhere.
 * The invitation records only which row it came from.
 */
export async function readGuestEmail(
  database: SqlDatabase,
  entityId: string,
  directoryEmailId: string | undefined,
): Promise<{ readonly id: string; readonly address: string } | undefined> {
  const { results } = await database
    .prepare(
      `SELECT id, address FROM directory_email ` +
        `WHERE entity_id = ?1 AND deleted_at IS NULL AND contact_permitted = 1 ` +
        `AND (?2 IS NULL OR id = ?2) ` +
        `ORDER BY is_primary DESC, contact_preferred DESC, created_at ASC, id ASC LIMIT 1`,
    )
    .bind(entityId, directoryEmailId ?? null)
    .all<{ readonly id: string; readonly address: string }>();
  return results[0];
}

// ---------------------------------------------------------------------------------------------
// The link's row
// ---------------------------------------------------------------------------------------------

/** One invitation by its own handle — the read the chokepoint's guest lane makes on every request. */
export async function readGuestInvitation(
  database: SqlDatabase,
  invitationId: MeetingGuestInvitationId,
): Promise<MeetingGuestInvitationRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${INVITATION_COLUMNS} FROM ${MEETING_GUEST_INVITATION_TABLE} WHERE id = ?`)
    .bind(invitationId)
    .all<MeetingGuestInvitationRow>();
  return results[0];
}

/** One invitation, addressed by its handle AND the meeting it must belong to. */
export async function readGuestInvitationInMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  invitationId: MeetingGuestInvitationId,
): Promise<MeetingGuestInvitationRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${INVITATION_COLUMNS} FROM ${MEETING_GUEST_INVITATION_TABLE} ` +
        `WHERE id = ? AND meeting_id = ?`,
    )
    .bind(invitationId, meetingId)
    .all<MeetingGuestInvitationRow>();
  return results[0];
}

/** The one invitation a meeting holds for an entity, if it holds one. */
export async function readGuestInvitationForEntity(
  database: SqlDatabase,
  meetingId: MeetingId,
  entityId: string,
): Promise<MeetingGuestInvitationRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${INVITATION_COLUMNS} FROM ${MEETING_GUEST_INVITATION_TABLE} ` +
        `WHERE meeting_id = ? AND entity_id = ?`,
    )
    .bind(meetingId, entityId)
    .all<MeetingGuestInvitationRow>();
  return results[0];
}

/**
 * The invitations on one meeting, withdrawn ones included, oldest first — one page of them.
 *
 * An invitation is one per Directory entity on the event, so in practice this is the length of the
 * event's own participant list; it is paged all the same, on the platform's list contract, because
 * nothing in the schema caps how many entities an event may carry. `limit` is what the caller will
 * show, and one row more is read to answer whether there is another page.
 */
export async function listGuestInvitationRows(
  database: SqlDatabase,
  meetingId: MeetingId,
  options: { readonly cursor?: SortCursor; readonly limit: number },
): Promise<readonly MeetingGuestInvitationRow[]> {
  const bindings: unknown[] = [meetingId];
  const keyset = keysetClause(bindings, options.cursor, "created_at", "id", true);
  const { results } = await database
    .prepare(
      `SELECT ${INVITATION_COLUMNS} FROM ${MEETING_GUEST_INVITATION_TABLE} ` +
        `WHERE meeting_id = ? ${keyset}ORDER BY created_at ASC, id ASC LIMIT ?`,
    )
    .bind(...bindings, options.limit + 1)
    .all<MeetingGuestInvitationRow>();
  return results;
}

/** Two mints for one entity in the same instant, and one of them lost. */
export function isGuestInvitationConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MEETING_GUEST_INVITATION_TABLE}.meeting_id`)
  );
}

// ---------------------------------------------------------------------------------------------
// The guest's stay
// ---------------------------------------------------------------------------------------------

/** One guest stay by its own handle — the read the socket-loss sweep makes. Ungated, as its twin is. */
export async function readGuestStay(
  database: SqlDatabase,
  stayId: MeetingGuestStayId,
): Promise<MeetingGuestStayRow | undefined> {
  const { results } = await database
    .prepare(`SELECT ${GUEST_STAY_COLUMNS} FROM ${MEETING_GUEST_STAY_TABLE} WHERE id = ?`)
    .bind(stayId)
    .all<MeetingGuestStayRow>();
  return results[0];
}

/** One guest stay, within one meeting — what an admission, a denial and a removal are addressed to. */
export async function readGuestStayInMeeting(
  database: SqlDatabase,
  meetingId: MeetingId,
  stayId: MeetingGuestStayId,
): Promise<MeetingGuestStayRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${GUEST_STAY_COLUMNS} FROM ${MEETING_GUEST_STAY_TABLE} WHERE id = ? AND meeting_id = ?`,
    )
    .bind(stayId, meetingId)
    .all<MeetingGuestStayRow>();
  return results[0];
}

/** The stay this link holds open on this meeting, if any — what a second arrival finds. */
export async function readOpenGuestStay(
  database: SqlDatabase,
  meetingId: MeetingId,
  invitationId: MeetingGuestInvitationId,
): Promise<MeetingGuestStayRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${GUEST_STAY_COLUMNS} FROM ${MEETING_GUEST_STAY_TABLE} ` +
        `WHERE meeting_id = ? AND invitation_id = ? AND left_at IS NULL`,
    )
    .bind(meetingId, invitationId)
    .all<MeetingGuestStayRow>();
  return results[0];
}

/**
 * A stay this link held that a host closed — removed from the room, or denied at the door.
 *
 * The guest half of barred entry. Without it, a removal would be undone by the person removed simply
 * reopening their e-mail. It is the MEETING they are barred from, and a host who wants them back
 * starts a new one — which leaves a record of exactly that.
 */
export async function readBarredGuestStay(
  database: SqlDatabase,
  meetingId: MeetingId,
  invitationId: MeetingGuestInvitationId,
): Promise<MeetingGuestStayRow | undefined> {
  const { results } = await database
    .prepare(
      `SELECT ${GUEST_STAY_COLUMNS} FROM ${MEETING_GUEST_STAY_TABLE} ` +
        `WHERE meeting_id = ? AND invitation_id = ? AND ended_reason IN ('removed', 'denied') ` +
        `ORDER BY left_at DESC, id DESC`,
    )
    .bind(meetingId, invitationId)
    .all<MeetingGuestStayRow>();
  return results[0];
}

/** Two browsers spent one link in the same instant, and one of them lost. */
export function isOpenGuestStayConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${MEETING_GUEST_STAY_TABLE}.invitation_id`)
  );
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

export interface InsertGuestInvitationInput {
  readonly id: MeetingGuestInvitationId;
  readonly meetingId: MeetingId;
  readonly entityKind: MeetingGuestEntityKind;
  readonly entityId: string;
  readonly invitedName: string;
  readonly directoryEmailId: string | null;
  readonly tokenSecretHash: string;
  readonly issuedByUserId: UserId;
  readonly expiresAt: string;
  readonly now: string;
}

// A NEW LINK. A plain insert: the one-per-entity unique index is the ceiling, and a second mint that
// raced this one is refused by it rather than by anything a read could settle.
export function insertGuestInvitationStatement(
  database: SqlDatabase,
  input: InsertGuestInvitationInput,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_GUEST_INVITATION_TABLE} (id, meeting_id, entity_kind, entity_id, ` +
        `invited_name, directory_email_id, token_secret_hash, secret_version, issued_by_user_id, ` +
        `expires_at, revoked_at, revoked_by_user_id, arrival_count, last_arrival_at, created_at, ` +
        `updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9, NULL, NULL, 0, NULL, ?10, ?10)`,
    )
    .bind(
      input.id,
      input.meetingId,
      input.entityKind,
      input.entityId,
      input.invitedName,
      input.directoryEmailId,
      input.tokenSecretHash,
      input.issuedByUserId,
      input.expiresAt,
      input.now,
    );
}

// A FRESH SECRET ON THE SAME ROW — a rotation, and the second mint that is one. The version moves, so
// every token of the old one stops verifying at once; a withdrawn row is reinstated, because minting
// again is how a host sends a link they had taken back.
//
// THE ARRIVAL COUNT STARTS AGAIN, because what it bounds is a LINK, and this is a new one. The count
// exists to stop one link forwarded to a crowd being spent without limit; the old link stops working
// in this same statement, so nothing spent on it can be spent again. Carried forward instead, a guest
// whose connection failed twenty times would be locked out of the meeting with no remedy a host could
// apply — sending them a fresh link would arrive already used up. A host sending one is the
// deliberate act that earns a fresh budget, and it is never the guest's own.
//
// The WHERE carries the version the caller read, so two rotations racing do not both land a secret —
// guarded at the call site, where the loser re-reads.
export function reissueGuestInvitationStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingGuestInvitationId;
    readonly readVersion: number;
    readonly tokenSecretHash: string;
    readonly invitedName: string;
    readonly directoryEmailId: string | null;
    readonly issuedByUserId: UserId;
    readonly expiresAt: string;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_GUEST_INVITATION_TABLE} SET token_secret_hash = ?1, ` +
        `secret_version = secret_version + 1, invited_name = ?2, directory_email_id = ?3, ` +
        `issued_by_user_id = ?4, expires_at = ?5, revoked_at = NULL, revoked_by_user_id = NULL, ` +
        `arrival_count = 0, updated_at = ?6 WHERE id = ?7 AND secret_version = ?8`,
    )
    .bind(
      input.tokenSecretHash,
      input.invitedName,
      input.directoryEmailId,
      input.issuedByUserId,
      input.expiresAt,
      input.now,
      input.id,
      input.readVersion,
    );
}

// A LINK WITHDRAWN, and the row kept: who was invited is part of what the record says happened.
// `revoked_at IS NULL` is the precondition the caller read, so a second withdrawal moves nothing.
export function revokeGuestInvitationStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingGuestInvitationId;
    readonly revokedByUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_GUEST_INVITATION_TABLE} SET revoked_at = ?1, revoked_by_user_id = ?2, ` +
        `updated_at = ?1 WHERE id = ?3 AND revoked_at IS NULL`,
    )
    .bind(input.now, input.revokedByUserId, input.id);
}

// ONE SPEND OF THE LINK AT THE DOOR, and every condition that makes it spendable in the same WHERE —
// not withdrawn, still the version the credential carried, under the ceiling, not expired. A
// withdrawal or a rotation that lands between the credential's check and this write matches no row,
// and the guarded batch rolls back whole rather than opening a stay on a link the firm has taken back.
export function recordGuestArrivalStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingGuestInvitationId;
    readonly secretVersion: number;
    readonly maximumArrivals: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_GUEST_INVITATION_TABLE} SET arrival_count = arrival_count + 1, ` +
        `last_arrival_at = ?1, updated_at = ?1 WHERE id = ?2 AND revoked_at IS NULL ` +
        `AND secret_version = ?3 AND arrival_count < ?4 AND expires_at > ?1`,
    )
    .bind(input.now, input.id, input.secretVersion, input.maximumArrivals);
}

// A GUEST AT THE DOOR, the lobby's ceiling and the door itself in the same statement.
//
// A guest ALWAYS waits, so there is no direct-admission twin: `waiting_from` is the arrival instant
// and `admitted_at` stays null until a host decides. The ceiling is the ONE lobby ceiling over both
// kinds of stay, and the door is read at the instant of the write — a locked room, or one that ended
// in the round trip since the service's read, matches no row and the guarded batch rolls back.
export function insertGuestStayAtTheDoorStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingGuestStayId;
    readonly meetingId: MeetingId;
    readonly invitationId: MeetingGuestInvitationId;
    readonly confirmedName: string;
    readonly lobbyCapacity: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEETING_GUEST_STAY_TABLE} (id, meeting_id, invitation_id, confirmed_name, ` +
        `joined_at, waiting_from, admitted_at, admitted_by_user_id, left_at, ended_reason, ` +
        `created_at, updated_at) ` +
        `SELECT ?1, ?2, ?3, ?4, ?5, ?5, NULL, NULL, NULL, NULL, ?5, ?5 WHERE ` +
        `${waitingCount("?2")} < ?6 ` +
        `AND EXISTS (SELECT 1 FROM ${MEETING_TABLE} WHERE ${MEETING_TABLE}.id = ?2 ` +
        `AND ${MEETING_TABLE}.locked_at IS NULL AND ${MEETING_TABLE}.status <> 'ended')`,
    )
    .bind(
      input.id,
      input.meetingId,
      input.invitationId,
      input.confirmedName,
      input.now,
      input.lobbyCapacity,
    );
}

// AN ARRIVAL ON A STAY THAT IS ALREADY OPEN, which puts that stay BACK AT THE DOOR under the name just
// typed. Whoever holds the link now is not known to be whoever a host let in: the link proves a
// mailbox, and a second browser on it may be the same person reconnecting or somebody the link was
// forwarded to. So a host's admission does not carry over to them — the stay waits again, and the host
// reads the new name beside the invited one before deciding.
//
// A stay that was ALREADY WAITING keeps its place in the queue: nothing a host decided is undone, and
// losing a connection at the door is not going to the back of the line. A stay that had been admitted
// starts a new wait now, and counts against the door's ceiling from now, which is why the ceiling is
// in this statement's own WHERE for that case alone. The stay itself must still be open: one a host
// closed in the round trip matches no row, and the guarded batch rolls back whole.
export function returnGuestStayToTheDoorStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingGuestStayId;
    readonly meetingId: MeetingId;
    readonly confirmedName: string;
    readonly lobbyCapacity: number;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_GUEST_STAY_TABLE} SET confirmed_name = ?1, ` +
        `waiting_from = CASE WHEN admitted_at IS NULL THEN waiting_from ELSE ?2 END, ` +
        `admitted_at = NULL, admitted_by_user_id = NULL, updated_at = ?2 ` +
        `WHERE id = ?3 AND meeting_id = ?4 AND left_at IS NULL ` +
        `AND (admitted_at IS NULL OR ${waitingCount("?4")} < ?5)`,
    )
    .bind(input.confirmedName, input.now, input.id, input.meetingId, input.lobbyCapacity);
}

// ONE GUEST STAY CLOSED, with how it ended — the member table's `closeAttendanceStatement`, for the
// second table, on the same terms: a stay already closed does not have its instant moved.
export function closeGuestStayStatement(
  database: SqlDatabase,
  input: {
    readonly id: MeetingGuestStayId;
    readonly reason: MeetingDepartureReason;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${MEETING_GUEST_STAY_TABLE} SET left_at = ?1, ended_reason = ?2, updated_at = ?1 ` +
        `WHERE id = ?3 AND left_at IS NULL`,
    )
    .bind(input.now, input.reason, input.id);
}
