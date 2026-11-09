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
// The member roster, joined only to put a NAME to a member at an office. Never written from here.
export const MEMBER_TABLE = "member";

// The mutable location fields — everything except id, status (close-only), and created_at. A patch
// merge writes all of them so the UPDATE statement stays static (no dynamic SET assembly).
export interface LocationFields {
  readonly name: string;
  readonly jurisdiction: string | null;
  // The office's IANA time zone, and never a fixed offset — an offset is wrong for half the year in
  // every zone that observes daylight saving. Nullable: an office recorded before the column existed
  // has none, and the one function that reads it resolves that to the platform's normalized zone
  // rather than guessing where the office is.
  readonly timeZone: string | null;
  readonly numberCode: string | null;
  readonly addressBlock: string | null;
  readonly footer: string | null;
  readonly remitTo: string | null;
  // The one way to write to this office. Its telephone belongs to each of its addresses.
  readonly email: string | null;
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
      `INSERT INTO ${LOCATION_TABLE} (id, name, status, jurisdiction, time_zone, number_code, address_block, footer, remit_to, email, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
    )
    .bind(
      row.id,
      row.name,
      row.jurisdiction,
      row.timeZone,
      row.numberCode,
      row.addressBlock,
      row.footer,
      row.remitTo,
      row.email,
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
      `UPDATE ${LOCATION_TABLE} SET name = ?2, jurisdiction = ?3, time_zone = ?4, number_code = ?5, address_block = ?6, footer = ?7, remit_to = ?8, email = ?9, updated_at = ?10 WHERE id = ?1`,
    )
    .bind(
      id,
      fields.name,
      fields.jurisdiction,
      fields.timeZone,
      fields.numberCode,
      fields.addressBlock,
      fields.footer,
      fields.remitTo,
      fields.email,
      updatedAt,
    );
}

// The office's letterhead logo, as stored. The BYTES are in the firm's own bucket — bulk content never
// goes in D1 — so the row carries the object key plus what a document needs to draw the mark: what the
// bytes are, their intrinsic pixel size, and the width the office prints them at. There is no stored
// height on purpose: it follows from the intrinsic proportions at render time, so nothing can print a
// stretched logo and swapping a wide mark for a tall one re-lays every letterhead out correctly.
export interface LetterheadLogoFields {
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly widthEmu: number;
}

export function setLetterheadLogoStatement(
  database: SqlDatabase,
  id: LocationId,
  logo: LetterheadLogoFields,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${LOCATION_TABLE} SET letterhead_logo_object_key = ?2, letterhead_logo_content_type = ?3, letterhead_logo_size_bytes = ?4, letterhead_logo_sha256 = ?5, letterhead_logo_width_pixels = ?6, letterhead_logo_height_pixels = ?7, letterhead_logo_width_emu = ?8, letterhead_logo_updated_at = ?9, updated_at = ?9 WHERE id = ?1`,
    )
    .bind(
      id,
      logo.objectKey,
      logo.contentType,
      logo.sizeBytes,
      logo.sha256,
      logo.widthPixels,
      logo.heightPixels,
      logo.widthEmu,
      updatedAt,
    );
}

// Every logo column back to null in one statement. Clearing is a full clear rather than a key-only one:
// a size, a hash and a pixel count describing an object the office no longer uses is stale metadata that
// would eventually be read as current.
export function clearLetterheadLogoStatement(
  database: SqlDatabase,
  id: LocationId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${LOCATION_TABLE} SET letterhead_logo_object_key = NULL, letterhead_logo_content_type = NULL, letterhead_logo_size_bytes = NULL, letterhead_logo_sha256 = NULL, letterhead_logo_width_pixels = NULL, letterhead_logo_height_pixels = NULL, letterhead_logo_width_emu = NULL, letterhead_logo_updated_at = NULL, updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, updatedAt);
}

// The stored logo's descriptive columns — never the bytes. Read by the office settings surface so an
// administrator can see what is configured, and by the clear path so the object it points at can be
// removed from the bucket in the same operation that forgets it.
export function selectLetterheadLogoStatement(database: SqlDatabase, id: LocationId): SqlStatement {
  return database
    .prepare(
      `SELECT letterhead_logo_object_key, letterhead_logo_content_type, letterhead_logo_size_bytes, letterhead_logo_sha256, letterhead_logo_width_pixels, letterhead_logo_height_pixels, letterhead_logo_width_emu, letterhead_logo_updated_at FROM ${LOCATION_TABLE} WHERE id = ?1`,
    )
    .bind(id);
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
      `SELECT id, name, status, jurisdiction, time_zone, number_code, address_block, footer, remit_to, email, letterhead_logo_object_key FROM ${LOCATION_TABLE} WHERE id = ?1`,
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
  readonly streetTwo: string | null;
  readonly dependentLocality: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly sortingCode: string | null;
  readonly country: string | null;
  readonly phone: string | null;
  readonly createdAt: string;
}

export function insertLocationAddressStatement(
  database: SqlDatabase,
  row: InsertLocationAddressRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${LOCATION_ADDRESS_TABLE} (id, location_id, kind, street, street_two, dependent_locality, city, region, postal, sorting_code, country, phone, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
    )
    .bind(
      row.id,
      row.locationId,
      row.kind,
      row.street,
      row.streetTwo,
      row.dependentLocality,
      row.city,
      row.region,
      row.postal,
      row.sortingCode,
      row.country,
      row.phone,
      row.createdAt,
    );
}

/** One of an office's addresses, as stored. */
export interface LocationAddressRow {
  readonly id: LocationAddressId;
  readonly locationId: LocationId;
  readonly kind: "physical" | "mailing";
  readonly street: string | null;
  readonly streetTwo: string | null;
  readonly dependentLocality: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal: string | null;
  readonly sortingCode: string | null;
  readonly country: string | null;
  readonly phone: string | null;
}

interface RawLocationAddressRow {
  id: LocationAddressId;
  location_id: LocationId;
  kind: "physical" | "mailing";
  street: string | null;
  street_two: string | null;
  dependent_locality: string | null;
  city: string | null;
  region: string | null;
  postal: string | null;
  sorting_code: string | null;
  country: string | null;
  phone: string | null;
}

function addressRowOf(row: RawLocationAddressRow): LocationAddressRow {
  return {
    id: row.id,
    locationId: row.location_id,
    kind: row.kind,
    street: row.street,
    streetTwo: row.street_two,
    dependentLocality: row.dependent_locality,
    city: row.city,
    region: row.region,
    postal: row.postal,
    sortingCode: row.sorting_code,
    country: row.country,
    phone: row.phone,
  };
}

const ADDRESS_COLUMNS =
  "id, location_id, kind, street, street_two, dependent_locality, city, region, postal, sorting_code, country, phone";

/** One office's addresses, the physical one first. */
export async function readLocationAddresses(
  database: SqlDatabase,
  locationId: LocationId,
): Promise<readonly LocationAddressRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${ADDRESS_COLUMNS} FROM ${LOCATION_ADDRESS_TABLE} WHERE location_id = ?1 ORDER BY kind DESC, id`,
    )
    .bind(locationId)
    .all<RawLocationAddressRow>();
  return results.map(addressRowOf);
}

/**
 * Every office's addresses in one read, for the register. At most two rows per office by the
 * one-of-each-kind rule, so this is bounded the way the office list itself is.
 */
export async function readAllLocationAddresses(
  database: SqlDatabase,
): Promise<readonly LocationAddressRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${ADDRESS_COLUMNS} FROM ${LOCATION_ADDRESS_TABLE} ORDER BY location_id, kind DESC, id`,
    )
    .all<RawLocationAddressRow>();
  return results.map(addressRowOf);
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

export interface LocationUsageRow {
  readonly id: LocationId;
  readonly name: string;
  readonly status: "active" | "closed";
  readonly members: number; // staffed through member_location; a member at two offices counts at both
}

// One row per location (active and closed alike) with its staffing count, for the firm-usage
// snapshot. Matter counts per location belong to the matter domain and are joined by the caller.
export async function readLocationUsageRows(
  database: SqlDatabase,
): Promise<readonly LocationUsageRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${LOCATION_TABLE}.id AS id, ${LOCATION_TABLE}.name AS name, ${LOCATION_TABLE}.status AS status, (SELECT COUNT(*) FROM ${MEMBER_LOCATION_TABLE} WHERE ${MEMBER_LOCATION_TABLE}.location_id = ${LOCATION_TABLE}.id) AS members FROM ${LOCATION_TABLE} ORDER BY ${LOCATION_TABLE}.name, ${LOCATION_TABLE}.id`,
    )
    .all<{ id: LocationId; name: string; status: "active" | "closed"; members: number }>();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    members: row.members,
  }));
}

/** One office as the register lists it: every stored field except the letterhead text, plus counts. */
export interface LocationRegisterRow {
  readonly id: LocationId;
  readonly name: string;
  readonly status: "active" | "closed";
  readonly jurisdiction: string | null;
  readonly timeZone: string | null;
  readonly numberCode: string | null;
  readonly email: string | null;
  readonly members: number;
  readonly hasLetterheadLogo: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// The register read: every office, with how many members staff it and whether it prints its own
// mark. The letterhead TEXT (address block, footer, remit-to) stays on the detail read — it is the
// office's own record, not a column anybody scans a register by.
export async function readLocationRegisterRows(
  database: SqlDatabase,
): Promise<readonly LocationRegisterRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${LOCATION_TABLE}.id AS id, ${LOCATION_TABLE}.name AS name, ${LOCATION_TABLE}.status AS status, ${LOCATION_TABLE}.jurisdiction AS jurisdiction, ${LOCATION_TABLE}.time_zone AS time_zone, ${LOCATION_TABLE}.number_code AS number_code, ${LOCATION_TABLE}.email AS email, ${LOCATION_TABLE}.letterhead_logo_object_key AS letterhead_logo_object_key, ${LOCATION_TABLE}.created_at AS created_at, ${LOCATION_TABLE}.updated_at AS updated_at, (SELECT COUNT(*) FROM ${MEMBER_LOCATION_TABLE} WHERE ${MEMBER_LOCATION_TABLE}.location_id = ${LOCATION_TABLE}.id) AS members FROM ${LOCATION_TABLE} ORDER BY ${LOCATION_TABLE}.name, ${LOCATION_TABLE}.id`,
    )
    .all<{
      id: LocationId;
      name: string;
      status: "active" | "closed";
      jurisdiction: string | null;
      time_zone: string | null;
      number_code: string | null;
      email: string | null;
      letterhead_logo_object_key: string | null;
      created_at: string;
      updated_at: string;
      members: number;
    }>();
  return results.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    jurisdiction: row.jurisdiction,
    timeZone: row.time_zone,
    numberCode: row.number_code,
    email: row.email,
    members: row.members,
    hasLetterheadLogo: row.letterhead_logo_object_key !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** A member at an office, named. */
export interface LocationMemberRow {
  readonly userId: UserId;
  readonly displayName: string;
  readonly status: "active" | "deactivated";
  readonly isPrimary: boolean;
}

// Who staffs an office, with the name the roster gives them. The roster is joined for the name
// alone: this package never writes a member row.
export async function readLocationMembers(
  database: SqlDatabase,
  locationId: LocationId,
): Promise<readonly LocationMemberRow[]> {
  const { results } = await database
    .prepare(
      `SELECT ${MEMBER_LOCATION_TABLE}.member_user_id AS member_user_id, ${MEMBER_LOCATION_TABLE}.is_primary AS is_primary, ${MEMBER_TABLE}.display_name AS display_name, ${MEMBER_TABLE}.status AS status FROM ${MEMBER_LOCATION_TABLE} JOIN ${MEMBER_TABLE} ON ${MEMBER_TABLE}.user_id = ${MEMBER_LOCATION_TABLE}.member_user_id WHERE ${MEMBER_LOCATION_TABLE}.location_id = ?1 ORDER BY ${MEMBER_TABLE}.display_name, ${MEMBER_LOCATION_TABLE}.member_user_id`,
    )
    .bind(locationId)
    .all<{
      member_user_id: UserId;
      is_primary: number;
      display_name: string;
      status: "active" | "deactivated";
    }>();
  return results.map((row) => ({
    userId: row.member_user_id,
    displayName: row.display_name,
    status: row.status,
    isPrimary: row.is_primary === 1,
  }));
}

/** One member's office assignments, as stored. */
export interface MemberLocationRow {
  readonly locationId: LocationId;
  readonly isPrimary: boolean;
}

// A member's current assignments — what a per-office add or remove composes its replace-set from.
export async function readMemberLocations(
  database: SqlDatabase,
  memberUserId: UserId,
): Promise<readonly MemberLocationRow[]> {
  const { results } = await database
    .prepare(
      `SELECT location_id, is_primary FROM ${MEMBER_LOCATION_TABLE} WHERE member_user_id = ?1 ORDER BY is_primary DESC, location_id`,
    )
    .bind(memberUserId)
    .all<{ location_id: LocationId; is_primary: number }>();
  return results.map((row) => ({ locationId: row.location_id, isPrimary: row.is_primary === 1 }));
}

/** The region and country of a member's primary office, as its physical address records them. */
export interface MemberPrimaryOfficeRegion {
  readonly region: string;
  readonly country: string;
}

// Where a member's primary office is, to the region. Only the physical address answers: a mailing
// address can be a post-office box in another state, and the question is where the member works.
// Null for a member with no primary office, or one whose address does not say.
export async function readMemberPrimaryOfficeRegion(
  database: SqlDatabase,
  memberUserId: UserId,
): Promise<MemberPrimaryOfficeRegion | null> {
  const { results } = await database
    .prepare(
      `SELECT ${LOCATION_ADDRESS_TABLE}.region AS region, ${LOCATION_ADDRESS_TABLE}.country AS country FROM ${MEMBER_LOCATION_TABLE} JOIN ${LOCATION_ADDRESS_TABLE} ON ${LOCATION_ADDRESS_TABLE}.location_id = ${MEMBER_LOCATION_TABLE}.location_id WHERE ${MEMBER_LOCATION_TABLE}.member_user_id = ?1 AND ${MEMBER_LOCATION_TABLE}.is_primary = 1 AND ${LOCATION_ADDRESS_TABLE}.kind = 'physical' AND ${LOCATION_ADDRESS_TABLE}.region IS NOT NULL AND ${LOCATION_ADDRESS_TABLE}.country IS NOT NULL LIMIT 1`,
    )
    .bind(memberUserId)
    .all<{ region: string; country: string }>();
  const row = results[0];
  return row === undefined ? null : { region: row.region, country: row.country };
}

// Per-firm count of all locations (active and closed alike).
export async function readLocationCount(database: SqlDatabase): Promise<number> {
  const { results } = await database
    .prepare(`SELECT COUNT(*) AS c FROM ${LOCATION_TABLE}`)
    .all<{ c: number }>();
  return results[0]?.c ?? 0;
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
