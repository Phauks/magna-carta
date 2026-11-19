import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { VisibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type {
  CustodyPacketId,
  InOutEntryId,
  InOutEntryRecipientId,
  MatterId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { InOutEntryStatus, InOutParty, InOutPartyKind } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const IN_OUT_ENTRY_TABLE = "in_out_entry";
export const IN_OUT_ENTRY_RECIPIENT_TABLE = "in_out_entry_recipient";

// Every read composes the visible-matter predicate as a REQUIRED argument. An entry with no matter
// is visible to everybody who may read the log; an entry on a matter is visible exactly when the
// matter is, so the platform-owned custody holding matter, and any information barrier built later,
// reach this log without a change here.

export interface InOutEntryRow {
  readonly id: InOutEntryId;
  readonly number: string;
  readonly description: string;
  readonly from_kind: InOutPartyKind;
  readonly from_user_id: UserId | null;
  readonly from_entity_id: string | null;
  readonly from_name: string;
  readonly matter_id: MatterId | null;
  // Resolved by the read from the matter's own row, so the screen names the matter the way the
  // matter names itself rather than keeping a copy that could drift.
  readonly matter_title: string | null;
  readonly matter_number: string | null;
  readonly kept_at: string | null;
  readonly notes: string | null;
  readonly status: InOutEntryStatus;
  readonly dropped_off_at: string;
  readonly recorded_by_user_id: UserId;
  readonly picked_up_at: string | null;
  readonly picked_up_by_kind: InOutPartyKind | null;
  readonly picked_up_by_user_id: UserId | null;
  readonly picked_up_by_entity_id: string | null;
  readonly picked_up_by_name: string | null;
  readonly identity_checked: number | null;
  readonly handed_over_by_user_id: UserId | null;
  readonly custody_packet_id: CustodyPacketId | null;
  // The packet's own custody number, read from the packet, for the link the log shows.
  readonly custody_number: string | null;
  readonly moved_to_custodian_at: string | null;
  readonly moved_by_user_id: UserId | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface InOutEntryRecipientRow {
  readonly id: InOutEntryRecipientId;
  readonly entry_id: InOutEntryId;
  readonly position: number;
  readonly kind: InOutPartyKind;
  readonly user_id: UserId | null;
  readonly entity_id: string | null;
  readonly name: string;
}

const ENTRY_COLUMNS = [
  "id",
  "number",
  "description",
  "from_kind",
  "from_user_id",
  "from_entity_id",
  "from_name",
  "matter_id",
  "kept_at",
  "notes",
  "status",
  "dropped_off_at",
  "recorded_by_user_id",
  "picked_up_at",
  "picked_up_by_kind",
  "picked_up_by_user_id",
  "picked_up_by_entity_id",
  "picked_up_by_name",
  "identity_checked",
  "handed_over_by_user_id",
  "custody_packet_id",
  "moved_to_custodian_at",
  "moved_by_user_id",
  "created_at",
  "updated_at",
]
  .map((column) => `${IN_OUT_ENTRY_TABLE}.${column}`)
  .join(", ");

// The SELECT every read shares: the entry, its matter's name and number, and the packet's custody
// number where it was moved into Custodian. LEFT JOINs, because most entries carry neither.
function selectEntries(visibility: VisibleMatterPredicate): string {
  return (
    `SELECT ${ENTRY_COLUMNS}, entry_matter.title AS matter_title, ` +
    `entry_matter.matter_number AS matter_number, entry_packet.custody_number AS custody_number ` +
    `FROM ${IN_OUT_ENTRY_TABLE} ` +
    `LEFT JOIN matter AS entry_matter ON entry_matter.id = ${IN_OUT_ENTRY_TABLE}.matter_id ` +
    `LEFT JOIN custody_packet AS entry_packet ON entry_packet.id = ${IN_OUT_ENTRY_TABLE}.custody_packet_id ` +
    `WHERE (${IN_OUT_ENTRY_TABLE}.matter_id IS NULL OR ${visibility.fragmentFor(`${IN_OUT_ENTRY_TABLE}.matter_id`)})`
  );
}

export interface InsertEntryInput {
  readonly id: InOutEntryId;
  readonly number: string;
  readonly description: string;
  readonly from: InOutParty;
  readonly matterId: MatterId | null;
  readonly keptAt: string | null;
  readonly notes: string | null;
  readonly recordedByUserId: UserId;
  readonly now: string;
}

export function insertEntryStatement(database: SqlDatabase, input: InsertEntryInput): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${IN_OUT_ENTRY_TABLE} (id, number, description, from_kind, from_user_id, ` +
        `from_entity_id, from_name, matter_id, kept_at, notes, status, dropped_off_at, ` +
        `recorded_by_user_id, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'waiting', ?11, ?12, ?11, ?11)`,
    )
    .bind(
      input.id,
      input.number,
      input.description,
      input.from.kind,
      input.from.userId,
      input.from.entityId,
      input.from.name,
      input.matterId,
      input.keptAt,
      input.notes,
      input.now,
      input.recordedByUserId,
    );
}

export function insertRecipientStatement(
  database: SqlDatabase,
  input: {
    readonly id: InOutEntryRecipientId;
    readonly entryId: InOutEntryId;
    readonly position: number;
    readonly recipient: InOutParty;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${IN_OUT_ENTRY_RECIPIENT_TABLE} (id, entry_id, position, kind, user_id, ` +
        `entity_id, name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      input.id,
      input.entryId,
      input.position,
      input.recipient.kind,
      input.recipient.userId,
      input.recipient.entityId,
      input.recipient.name,
    );
}

// Recording the pick up. Guarded on `status = 'waiting'`: two people at the desk pressing Pick Up on
// one envelope must not both be told they handed it over.
export function pickUpEntryStatement(
  database: SqlDatabase,
  input: {
    readonly id: InOutEntryId;
    readonly collector: InOutParty;
    readonly identityChecked: boolean;
    readonly handedOverByUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${IN_OUT_ENTRY_TABLE} SET status = 'picked_up', picked_up_at = ?1, ` +
        `picked_up_by_kind = ?2, picked_up_by_user_id = ?3, picked_up_by_entity_id = ?4, ` +
        `picked_up_by_name = ?5, identity_checked = ?6, handed_over_by_user_id = ?7, updated_at = ?1 ` +
        `WHERE id = ?8 AND status = 'waiting'`,
    )
    .bind(
      input.now,
      input.collector.kind,
      input.collector.userId,
      input.collector.entityId,
      input.collector.name,
      input.identityChecked ? 1 : 0,
      input.handedOverByUserId,
      input.id,
    );
}

// Linking the entry to the custody packet it became. Guarded on `status = 'waiting'` for the same
// reason as the pick up.
export function moveEntryToCustodianStatement(
  database: SqlDatabase,
  input: {
    readonly id: InOutEntryId;
    readonly packetId: CustodyPacketId;
    readonly movedByUserId: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${IN_OUT_ENTRY_TABLE} SET status = 'moved_to_custodian', custody_packet_id = ?1, ` +
        `moved_to_custodian_at = ?2, moved_by_user_id = ?3, updated_at = ?2 ` +
        `WHERE id = ?4 AND status = 'waiting'`,
    )
    .bind(input.packetId, input.now, input.movedByUserId, input.id);
}

// Deleting a mistaken entry, which is allowed only while it is still waiting: once something has been
// handed over or put into custody the row is the record of that, and the log keeps it.
export function deleteRecipientsStatement(
  database: SqlDatabase,
  entryId: InOutEntryId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${IN_OUT_ENTRY_RECIPIENT_TABLE} WHERE entry_id = ?1`)
    .bind(entryId);
}

export function deleteAllocationStatement(
  database: SqlDatabase,
  entryId: InOutEntryId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM in_out_entry_number_allocation WHERE entry_id = ?1`)
    .bind(entryId);
}

export function deleteWaitingEntryStatement(
  database: SqlDatabase,
  entryId: InOutEntryId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${IN_OUT_ENTRY_TABLE} WHERE id = ?1 AND status = 'waiting'`)
    .bind(entryId);
}

export async function readEntry(
  database: SqlDatabase,
  entryId: InOutEntryId,
  visibility: VisibleMatterPredicate,
): Promise<InOutEntryRow | undefined> {
  const row = await database
    .prepare(`${selectEntries(visibility)} AND ${IN_OUT_ENTRY_TABLE}.id = ?`)
    .bind(...visibility.bindings, entryId)
    .first<InOutEntryRow>();
  return row ?? undefined;
}

export interface EntryPageOptions {
  // `waiting` reads Waiting for Pickup, oldest first, which is the order a desk works through it;
  // absent reads the whole log, newest first.
  readonly status?: "waiting";
  readonly search?: string;
  readonly cursor?: { readonly droppedOffAt: string; readonly id: string };
  readonly limit: number;
}

// One page of the log. Keyset-paginated on (dropped_off_at, id), so a walk never skips or repeats.
// The search matches the number, what it is, who it came from, who it is to, and the matter's name.
export function selectEntriesStatement(
  database: SqlDatabase,
  visibility: VisibleMatterPredicate,
  options: EntryPageOptions,
): SqlStatement {
  const conditions: string[] = [];
  const bindings: unknown[] = [...visibility.bindings];
  const waiting = options.status === "waiting";
  if (waiting) conditions.push(`${IN_OUT_ENTRY_TABLE}.status = 'waiting'`);
  if (options.search !== undefined && options.search.trim() !== "") {
    const pattern = `%${options.search.trim().replace(/[\\%_]/gu, (match) => `\\${match}`)}%`;
    conditions.push(
      `(${IN_OUT_ENTRY_TABLE}.number LIKE ? ESCAPE '\\' OR ${IN_OUT_ENTRY_TABLE}.description LIKE ? ESCAPE '\\' ` +
        `OR ${IN_OUT_ENTRY_TABLE}.from_name LIKE ? ESCAPE '\\' OR entry_matter.title LIKE ? ESCAPE '\\' ` +
        `OR EXISTS (SELECT 1 FROM ${IN_OUT_ENTRY_RECIPIENT_TABLE} AS search_recipient ` +
        `WHERE search_recipient.entry_id = ${IN_OUT_ENTRY_TABLE}.id AND search_recipient.name LIKE ? ESCAPE '\\'))`,
    );
    bindings.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (options.cursor !== undefined) {
    conditions.push(
      waiting
        ? `(${IN_OUT_ENTRY_TABLE}.dropped_off_at, ${IN_OUT_ENTRY_TABLE}.id) > (?, ?)`
        : `(${IN_OUT_ENTRY_TABLE}.dropped_off_at, ${IN_OUT_ENTRY_TABLE}.id) < (?, ?)`,
    );
    bindings.push(options.cursor.droppedOffAt, options.cursor.id);
  }
  const direction = waiting ? "ASC" : "DESC";
  const where = conditions.map((condition) => ` AND ${condition}`).join("");
  return database
    .prepare(
      `${selectEntries(visibility)}${where} ORDER BY ${IN_OUT_ENTRY_TABLE}.dropped_off_at ${direction}, ` +
        `${IN_OUT_ENTRY_TABLE}.id ${direction} LIMIT ?`,
    )
    .bind(...bindings, options.limit);
}

// The people every entry on a page is To, in ONE bounded read keyed by the page's entries, never one
// read per entry.
export async function readRecipients(
  database: SqlDatabase,
  entryIds: readonly InOutEntryId[],
): Promise<InOutEntryRecipientRow[]> {
  if (entryIds.length === 0) return [];
  const placeholders = entryIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT id, entry_id, position, kind, user_id, entity_id, name FROM ${IN_OUT_ENTRY_RECIPIENT_TABLE} ` +
        `WHERE entry_id IN (${placeholders}) ORDER BY entry_id, position`,
    )
    .bind(...entryIds)
    .all<InOutEntryRecipientRow>();
  return results;
}

// Whether a matter exists and the reader may see it — the precondition for recording an entry on it.
export async function matterIsVisible(
  database: SqlDatabase,
  matterId: MatterId,
  visibility: VisibleMatterPredicate,
): Promise<boolean> {
  const row = await database
    .prepare(`SELECT 1 AS present FROM (SELECT ? AS candidate) WHERE ${visibility.fragmentFor("candidate")}`)
    .bind(matterId, ...visibility.bindings)
    .first<{ present: number }>();
  return row !== null;
}

// Which of these user ids are members of the firm. A member named on an entry must be one, because
// the name the screen shows for them and the notification they may later get both hang off it.
export async function readKnownMembers(
  database: SqlDatabase,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const placeholders = userIds.map(() => "?").join(", ");
  const { results } = await database
    .prepare(`SELECT user_id FROM member WHERE user_id IN (${placeholders})`)
    .bind(...userIds)
    .all<{ user_id: string }>();
  return new Set(results.map((row) => row.user_id));
}

export async function packetExists(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<boolean> {
  const row = await database
    .prepare(`SELECT 1 AS present FROM custody_packet WHERE id = ?`)
    .bind(packetId)
    .first<{ present: number }>();
  return row !== null;
}
