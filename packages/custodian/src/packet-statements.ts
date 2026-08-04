import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  CustodyItemId,
  CustodyItemTypeId,
  CustodyLocationId,
  CustodyOwnerId,
  CustodyPacketId,
  MatterId,
} from "@magna-carta/identifiers/types";
import type { CustodyItemStatus, CustodyPacketStatus } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const CUSTODY_PACKET_TABLE = "custody_packet";
export const CUSTODY_ITEM_TABLE = "custody_item";
export const CUSTODY_OWNER_TABLE = "custody_owner";

export interface CustodyPacketRow {
  readonly id: CustodyPacketId;
  readonly custody_number: string;
  readonly number_source: "drawn" | "manual";
  readonly name: string;
  readonly current_location_id: CustodyLocationId | null;
  readonly status: CustodyPacketStatus;
  readonly matter_id: MatterId | null;
  readonly depositor_entity_id: string | null;
  readonly deposited_at: string | null;
  readonly review_on: string | null;
  readonly review_interval_months: number | null;
  readonly notes: string | null;
}

const PACKET_COLUMNS =
  "id, custody_number, number_source, name, current_location_id, status, matter_id, depositor_entity_id, deposited_at, review_on, review_interval_months, notes";

export interface InsertCustodyPacketRow {
  readonly id: CustodyPacketId;
  readonly custodyNumber: string;
  readonly numberSource: "drawn" | "manual";
  readonly name: string;
  readonly currentLocationId: CustodyLocationId | null;
  readonly matterId: MatterId | null;
  readonly depositorEntityId: string | null;
  readonly depositedAt: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
}

export function insertCustodyPacketStatement(
  database: SqlDatabase,
  row: InsertCustodyPacketRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_PACKET_TABLE} (id, custody_number, number_source, name, current_location_id, status, matter_id, depositor_entity_id, deposited_at, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'held', ?6, ?7, ?8, ?9, ?10, ?10)`,
    )
    .bind(
      row.id,
      row.custodyNumber,
      row.numberSource,
      row.name,
      row.currentLocationId,
      row.matterId,
      row.depositorEntityId,
      row.depositedAt,
      row.notes,
      row.createdAt,
    );
}

// A losing draw whose RENDERED string collides — with a concurrent winner, or with a manual number
// a firm carried in from a paper register. The allocation primary key catches the general race; this
// catches the manual-number collision the counter cannot see.
export function isCustodyNumberConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(`${CUSTODY_PACKET_TABLE}.custody_number`)
  );
}

// Descriptive fields ONLY. Status is derived by the movement write path and location changes with a
// movement, so neither is settable here — there is deliberately no route that sets a status directly.
export function updateCustodyPacketFieldsStatement(
  database: SqlDatabase,
  id: CustodyPacketId,
  fields: {
    readonly name: string;
    readonly matterId: MatterId | null;
    readonly depositorEntityId: string | null;
    readonly depositedAt: string | null;
    readonly reviewOn: string | null;
    readonly reviewIntervalMonths: number | null;
    readonly notes: string | null;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_PACKET_TABLE} SET name = ?2, matter_id = ?3, depositor_entity_id = ?4, deposited_at = ?5, review_on = ?6, review_interval_months = ?7, notes = ?8, updated_at = ?9 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.name,
      fields.matterId,
      fields.depositorEntityId,
      fields.depositedAt,
      fields.reviewOn,
      fields.reviewIntervalMonths,
      fields.notes,
      updatedAt,
    );
}

// THE PRECONDITION FENCE. D1 has no interactive transaction, so a status read taken before the batch
// can be stale by the time the batch runs — and a guarded UPDATE that matches zero rows is not an
// error in SQLite, so on its own it would let a movement commit against a state that no longer
// holds. This statement makes the guard fail LOUD: it re-inserts the packet's own row (colliding
// with its own primary key, aborting the whole batch) exactly when the status is NOT what the caller
// observed, and inserts nothing at all when it is. Composed FIRST in the movement batch, so a stale
// precondition rolls the movement back rather than recording a false one.
export function assertCustodyPacketStatusStatement(
  database: SqlDatabase,
  id: CustodyPacketId,
  expectedStatus: CustodyPacketStatus,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_PACKET_TABLE} (id, custody_number, number_source, name, status, created_at, updated_at)
         SELECT id, custody_number, number_source, name, status, created_at, updated_at
           FROM ${CUSTODY_PACKET_TABLE} WHERE id = ?1 AND status <> ?2`,
    )
    .bind(id, expectedStatus);
}

// The item-side twin of the fence above, for an item-scoped movement.
export function assertCustodyItemStatusStatement(
  database: SqlDatabase,
  id: CustodyItemId,
  expectedStatus: CustodyItemStatus,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_ITEM_TABLE} (id, packet_id, ordinal, description, intrinsic_value, status, created_at, updated_at)
         SELECT id, packet_id, ordinal, description, intrinsic_value, status, created_at, updated_at
           FROM ${CUSTODY_ITEM_TABLE} WHERE id = ?1 AND status <> ?2`,
    )
    .bind(id, expectedStatus);
}

// The derived-status write. `expectedStatus` repeats the fence's predicate on the update itself, so
// the two cannot disagree even if the batch is reordered.
export function setCustodyPacketStatusStatement(
  database: SqlDatabase,
  id: CustodyPacketId,
  nextStatus: CustodyPacketStatus,
  expectedStatus: CustodyPacketStatus,
  currentLocationId: CustodyLocationId | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_PACKET_TABLE} SET status = ?2, current_location_id = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?5`,
    )
    .bind(id, nextStatus, currentLocationId, updatedAt, expectedStatus);
}

// A pure location change with no status effect (a `moved` movement), guarded the same way.
export function setCustodyPacketLocationStatement(
  database: SqlDatabase,
  id: CustodyPacketId,
  currentLocationId: CustodyLocationId | null,
  expectedStatus: CustodyPacketStatus,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_PACKET_TABLE} SET current_location_id = ?2, updated_at = ?3 WHERE id = ?1 AND status = ?4`,
    )
    .bind(id, currentLocationId, updatedAt, expectedStatus);
}

export function selectCustodyPacketStatement(
  database: SqlDatabase,
  id: CustodyPacketId,
): SqlStatement {
  return database
    .prepare(`SELECT ${PACKET_COLUMNS} FROM ${CUSTODY_PACKET_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readCustodyPacket(
  database: SqlDatabase,
  id: CustodyPacketId,
): Promise<CustodyPacketRow | undefined> {
  const { results } = await selectCustodyPacketStatement(database, id).all<CustodyPacketRow>();
  return results[0];
}

// ---- items ----

export interface CustodyItemRow {
  readonly id: CustodyItemId;
  readonly packet_id: CustodyPacketId;
  readonly ordinal: number;
  readonly item_type_id: CustodyItemTypeId | null;
  readonly description: string;
  readonly instrument_date: string | null;
  readonly intrinsic_value: number;
  readonly declared_value_amount_minor: number | null;
  readonly declared_value_currency: string | null;
  readonly status: CustodyItemStatus;
  readonly review_on: string | null;
  readonly review_interval_months: number | null;
}

const ITEM_COLUMNS =
  "id, packet_id, ordinal, item_type_id, description, instrument_date, intrinsic_value, declared_value_amount_minor, declared_value_currency, status, review_on, review_interval_months";

export interface InsertCustodyItemRow {
  readonly id: CustodyItemId;
  readonly packetId: CustodyPacketId;
  readonly ordinal: number;
  readonly itemTypeId: CustodyItemTypeId | null;
  readonly description: string;
  readonly instrumentDate: string | null;
  readonly intrinsicValue: boolean;
  readonly declaredValueAmountMinor: number | null;
  readonly declaredValueCurrency: string | null;
  readonly createdAt: string;
}

export function insertCustodyItemStatement(
  database: SqlDatabase,
  row: InsertCustodyItemRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_ITEM_TABLE} (id, packet_id, ordinal, item_type_id, description, instrument_date, intrinsic_value, declared_value_amount_minor, declared_value_currency, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'held', ?10, ?10)`,
    )
    .bind(
      row.id,
      row.packetId,
      row.ordinal,
      row.itemTypeId,
      row.description,
      row.instrumentDate,
      row.intrinsicValue ? 1 : 0,
      row.declaredValueAmountMinor,
      row.declaredValueCurrency,
      row.createdAt,
    );
}

export function updateCustodyItemFieldsStatement(
  database: SqlDatabase,
  id: CustodyItemId,
  fields: {
    readonly itemTypeId: CustodyItemTypeId | null;
    readonly description: string;
    readonly instrumentDate: string | null;
    readonly intrinsicValue: boolean;
    readonly declaredValueAmountMinor: number | null;
    readonly declaredValueCurrency: string | null;
    readonly reviewOn: string | null;
    readonly reviewIntervalMonths: number | null;
  },
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_ITEM_TABLE} SET item_type_id = ?2, description = ?3, instrument_date = ?4, intrinsic_value = ?5, declared_value_amount_minor = ?6, declared_value_currency = ?7, review_on = ?8, review_interval_months = ?9, updated_at = ?10 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.itemTypeId,
      fields.description,
      fields.instrumentDate,
      fields.intrinsicValue ? 1 : 0,
      fields.declaredValueAmountMinor,
      fields.declaredValueCurrency,
      fields.reviewOn,
      fields.reviewIntervalMonths,
      updatedAt,
    );
}

export function setCustodyItemStatusStatement(
  database: SqlDatabase,
  id: CustodyItemId,
  nextStatus: CustodyItemStatus,
  expectedStatus: CustodyItemStatus,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_ITEM_TABLE} SET status = ?2, updated_at = ?3 WHERE id = ?1 AND status = ?4`,
    )
    .bind(id, nextStatus, updatedAt, expectedStatus);
}

export function selectCustodyItemStatement(database: SqlDatabase, id: CustodyItemId): SqlStatement {
  return database
    .prepare(`SELECT ${ITEM_COLUMNS} FROM ${CUSTODY_ITEM_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readCustodyItem(
  database: SqlDatabase,
  id: CustodyItemId,
): Promise<CustodyItemRow | undefined> {
  const { results } = await selectCustodyItemStatement(database, id).all<CustodyItemRow>();
  return results[0];
}

export function selectCustodyItemsStatement(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${ITEM_COLUMNS} FROM ${CUSTODY_ITEM_TABLE} WHERE packet_id = ?1 ORDER BY ordinal ASC`,
    )
    .bind(packetId);
}

export async function readCustodyItems(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<CustodyItemRow[]> {
  const { results } = await selectCustodyItemsStatement(database, packetId).all<CustodyItemRow>();
  return results;
}

// The next packet-relative ordinal. Read separately rather than derived from a count so a withdrawn
// item's ordinal is never handed out twice — an item number that once meant a will must not later
// mean a deed.
export async function readNextCustodyItemOrdinal(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COALESCE(MAX(ordinal), 0) AS highest FROM ${CUSTODY_ITEM_TABLE} WHERE packet_id = ?1`,
    )
    .bind(packetId)
    .all<{ highest: number }>();
  return (results[0]?.highest ?? 0) + 1;
}

// ---- owners ----

export interface CustodyOwnerRow {
  readonly id: CustodyOwnerId;
  readonly packet_id: CustodyPacketId;
  readonly entity_id: string;
  readonly ownership_role: string | null;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

const OWNER_COLUMNS = "id, packet_id, entity_id, ownership_role, effective_from, effective_to";

export function insertCustodyOwnerStatement(
  database: SqlDatabase,
  row: {
    readonly id: CustodyOwnerId;
    readonly packetId: CustodyPacketId;
    readonly entityId: string;
    readonly ownershipRole: string | null;
    readonly effectiveFrom: string;
    readonly createdAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${CUSTODY_OWNER_TABLE} (id, packet_id, entity_id, ownership_role, effective_from, effective_to, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)`,
    )
    .bind(row.id, row.packetId, row.entityId, row.ownershipRole, row.effectiveFrom, row.createdAt);
}

// Ownership ends temporally, never by a delete: who owned what, and when, is exactly the question a
// custody register is kept to answer, and a deleted link takes that answer with it.
export function endCustodyOwnerStatement(
  database: SqlDatabase,
  id: CustodyOwnerId,
  effectiveTo: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${CUSTODY_OWNER_TABLE} SET effective_to = ?2, updated_at = ?2 WHERE id = ?1 AND effective_to IS NULL`,
    )
    .bind(id, effectiveTo);
}

export function selectCustodyOwnersStatement(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${OWNER_COLUMNS} FROM ${CUSTODY_OWNER_TABLE} WHERE packet_id = ?1 ORDER BY effective_from ASC, id ASC`,
    )
    .bind(packetId);
}

export async function readCustodyOwners(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<CustodyOwnerRow[]> {
  const { results } = await selectCustodyOwnersStatement(database, packetId).all<CustodyOwnerRow>();
  return results;
}

export async function readCurrentCustodyOwnerCount(
  database: SqlDatabase,
  packetId: CustodyPacketId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS owners FROM ${CUSTODY_OWNER_TABLE} WHERE packet_id = ?1 AND effective_to IS NULL`,
    )
    .bind(packetId)
    .all<{ owners: number }>();
  return results[0]?.owners ?? 0;
}
