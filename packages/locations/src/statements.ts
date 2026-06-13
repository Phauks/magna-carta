import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  LocationAddressId,
  LocationId,
  MemberLocationId,
  UserId,
} from "@magna-carta/identifiers/types";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const LOCATION_TABLE = "location";
export const LOCATION_ADDRESS_TABLE = "location_address";
export const MEMBER_LOCATION_TABLE = "member_location";

// The mutable location fields — everything except id, status (close-only), and created_at. A patch
// merge writes all of them so the UPDATE statement stays static (no dynamic SET assembly).
export interface LocationFields {
  readonly name: string;
  readonly jurisdiction: string | null;
  readonly numberCode: string | null;
  readonly addressBlock: string | null;
  readonly footer: string | null;
  readonly remitTo: string | null;
}

export interface InsertLocationRow extends LocationFields {
  readonly id: LocationId;
  readonly createdAt: string;
}

// status is baked 'active' — a new location is always active; closeLocationStatement is the only
// transition.
export function insertLocationStatement(
  database: SqlDatabase,
  row: InsertLocationRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${LOCATION_TABLE} (id, name, status, jurisdiction, number_code, address_block, footer, remit_to, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
    )
    .bind(
      row.id,
      row.name,
      row.jurisdiction,
      row.numberCode,
      row.addressBlock,
      row.footer,
      row.remitTo,
      row.createdAt,
    );
}

export function updateLocationFieldsStatement(
  database: SqlDatabase,
  id: LocationId,
  fields: LocationFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${LOCATION_TABLE} SET name = ?2, jurisdiction = ?3, number_code = ?4, address_block = ?5, footer = ?6, remit_to = ?7, updated_at = ?8 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.name,
      fields.jurisdiction,
      fields.numberCode,
      fields.addressBlock,
      fields.footer,
      fields.remitTo,
      updatedAt,
    );
}

export function closeLocationStatement(
  database: SqlDatabase,
  id: LocationId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${LOCATION_TABLE} SET status = 'closed', updated_at = ?2 WHERE id = ?1`)
    .bind(id, updatedAt);
}

// The existence + current-fields read: closeLocation/updateLocation must confirm the row before
// composing, and updateLocation merges its patch onto these values (D1 has no interactive
// transactions — read before composing the batch).
export function selectLocationStatement(database: SqlDatabase, id: LocationId): SqlStatement {
  return database
    .prepare(
      `SELECT id, name, status, jurisdiction, number_code, address_block, footer, remit_to FROM ${LOCATION_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

export function deleteLocationAddressesStatement(
  database: SqlDatabase,
  locationId: LocationId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${LOCATION_ADDRESS_TABLE} WHERE location_id = ?1`)
    .bind(locationId);
}

export interface InsertLocationAddressRow {
  readonly id: LocationAddressId;
  readonly locationId: LocationId;
  readonly kind: "physical" | "mailing";
  readonly street: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly phone: string | null;
  readonly createdAt: string;
}

export function insertLocationAddressStatement(
  database: SqlDatabase,
  row: InsertLocationAddressRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${LOCATION_ADDRESS_TABLE} (id, location_id, kind, street, city, region, postal, phone, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    )
    .bind(
      row.id,
      row.locationId,
      row.kind,
      row.street,
      row.city,
      row.region,
      row.postal,
      row.phone,
      row.createdAt,
    );
}

export function deleteMemberLocationsStatement(
  database: SqlDatabase,
  memberUserId: UserId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${MEMBER_LOCATION_TABLE} WHERE member_user_id = ?1`)
    .bind(memberUserId);
}

export interface InsertMemberLocationRow {
  readonly id: MemberLocationId;
  readonly memberUserId: UserId;
  readonly locationId: LocationId;
  readonly isPrimary: boolean;
  readonly createdAt: string;
}

export function insertMemberLocationStatement(
  database: SqlDatabase,
  row: InsertMemberLocationRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${MEMBER_LOCATION_TABLE} (id, member_user_id, location_id, is_primary, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(row.id, row.memberUserId, row.locationId, row.isPrimary ? 1 : 0, row.createdAt);
}
