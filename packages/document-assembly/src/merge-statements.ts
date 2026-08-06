import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LocationId, MatterId } from "@magna-carta/identifiers/types";

// The reads the merge-context resolver issues, one per source. Table names are tracked against
// @magna-carta/database's per-firm schema by the schema-name-sync fitness test.
//
// Each projection lists exactly the columns the dictionary's entries for that source read. That is not
// tidiness: a `SELECT *` here would silently widen what an assembly pulls into memory every time a table
// gained a column, including a column nothing in a document should ever carry.

export const MATTER_TABLE = "matter";
export const LOCATION_TABLE = "location";
export const MATTER_PARTY_TABLE = "matter_party";
export const DIRECTORY_PERSON_TABLE = "directory_person";
export const DIRECTORY_ORGANIZATION_TABLE = "directory_organization";

export interface MatterMergeRow {
  readonly id: MatterId;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly locationId: LocationId | null;
  readonly clientDisplayName: string | null;
  readonly clientCode: string | null;
  readonly matterNumber: string | null;
  readonly openedAt: string | null;
  readonly eBilling: number;
}

export function selectMatterForMergeStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, title, description, status, location_id, client_display_name, client_code, matter_number, opened_at, e_billing FROM ${MATTER_TABLE} WHERE id = ?1`,
    )
    .bind(matterId);
}

export interface MatterMergeColumns {
  id: string;
  title: string;
  description: string | null;
  status: string;
  location_id: string | null;
  client_display_name: string | null;
  client_code: string | null;
  matter_number: string | null;
  opened_at: string | null;
  e_billing: number;
}

export function toMatterMergeRow(row: MatterMergeColumns): MatterMergeRow {
  return {
    id: row.id as MatterId,
    title: row.title,
    description: row.description,
    status: row.status,
    locationId: row.location_id as LocationId | null,
    clientDisplayName: row.client_display_name,
    clientCode: row.client_code,
    matterNumber: row.matter_number,
    openedAt: row.opened_at,
    eBilling: row.e_billing ?? 0,
  };
}

export interface LocationMergeRow {
  readonly id: LocationId;
  readonly name: string;
  readonly jurisdiction: string | null;
  readonly addressBlock: string | null;
  readonly footer: string | null;
  readonly remitTo: string | null;
  // The letterhead logo, as a REFERENCE rather than as bytes: the object key plus the box the office set
  // for it. The bytes live in the firm's own bucket and are fetched through the reader the caller
  // supplies, so this module keeps its one job — reading the firm's database — and no merge read ever
  // pulls a megabyte of image out of D1. The stored content type is deliberately NOT read: resolution
  // decides what the bytes are by reading them, so carrying the claim here would only invite trusting it.
  readonly letterheadLogoObjectKey: string | null;
  readonly letterheadLogoWidthEmu: number | null;
}

export function selectLocationForMergeStatement(
  database: SqlDatabase,
  locationId: LocationId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, name, jurisdiction, address_block, footer, remit_to, letterhead_logo_object_key, letterhead_logo_width_emu FROM ${LOCATION_TABLE} WHERE id = ?1`,
    )
    .bind(locationId);
}

export interface LocationMergeColumns {
  id: string;
  name: string;
  jurisdiction: string | null;
  address_block: string | null;
  footer: string | null;
  remit_to: string | null;
  letterhead_logo_object_key: string | null;
  letterhead_logo_width_emu: number | null;
}

// The matter's linked parties, as ONE read for the whole collection. A repeating block over a
// collection never costs a read per item — that is the same batching rule every other source obeys, and
// a repeat is the first place it could plausibly be broken.
//
// The Directory name is joined here rather than fetched per party for the same reason. A party whose
// Directory entity is soft-deleted or missing still appears, with no name: a document that silently
// omitted a party would be worse than one that shows the gap.
export interface MatterPartyMergeRow {
  readonly displayName: string | null;
  readonly role: string;
  readonly kind: "person" | "organisation" | "unknown";
  // The recorded name PARTS, projected on the read that already joins the Directory name tables for the
  // display name. A format can only render what the value carries — "Ashcroft, Rowan" is not derivable
  // from "Rowan Ashcroft" — so the parts ride here rather than becoming a second read, and a part the
  // record does not separate out stays null, which is a declared absence at rendering rather than a
  // guess. An organisation has none of them.
  readonly namePrefix: string | null;
  readonly nameGiven: string | null;
  readonly nameMiddle: string | null;
  readonly nameFamily: string | null;
  readonly nameSuffix: string | null;
  // The Directory entity the link points at. Read because a protected merge field has to name WHOSE
  // sealed identifier it wants, and the client's link is the fact that says so — one column on a read
  // that already happens, rather than a second query to find out who the client is. It is never a merge
  // VALUE: a handle is not a fact a document can state, which is the same reason a reference custom
  // field prints its record's label instead.
  readonly entityId: string;
}

export function selectMatterPartiesForMergeStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT matter_party.role AS role,
              matter_party.entity_id AS entity_id,
              COALESCE(directory_person.display_name, directory_organization.display_name, directory_organization.legal_name) AS display_name,
              directory_person.name_prefix AS name_prefix,
              directory_person.name_given AS name_given,
              directory_person.name_middle AS name_middle,
              directory_person.name_family AS name_family,
              directory_person.name_suffix AS name_suffix,
              CASE
                WHEN directory_person.id IS NOT NULL THEN 'person'
                WHEN directory_organization.id IS NOT NULL THEN 'organisation'
                ELSE 'unknown'
              END AS kind
         FROM ${MATTER_PARTY_TABLE} AS matter_party
         LEFT JOIN ${DIRECTORY_PERSON_TABLE} AS directory_person
                ON directory_person.id = matter_party.entity_id AND directory_person.deleted_at IS NULL
         LEFT JOIN ${DIRECTORY_ORGANIZATION_TABLE} AS directory_organization
                ON directory_organization.id = matter_party.entity_id AND directory_organization.deleted_at IS NULL
        WHERE matter_party.matter_id = ?1
          AND matter_party.deleted_at IS NULL
        ORDER BY matter_party.role, matter_party.created_at, matter_party.id`,
    )
    .bind(matterId);
}

export interface MatterPartyMergeColumns {
  role: string;
  entity_id: string;
  display_name: string | null;
  name_prefix: string | null;
  name_given: string | null;
  name_middle: string | null;
  name_family: string | null;
  name_suffix: string | null;
  kind: string;
}

export function toMatterPartyMergeRow(row: MatterPartyMergeColumns): MatterPartyMergeRow {
  return {
    displayName: row.display_name,
    role: row.role,
    entityId: row.entity_id,
    namePrefix: row.name_prefix ?? null,
    nameGiven: row.name_given ?? null,
    nameMiddle: row.name_middle ?? null,
    nameFamily: row.name_family ?? null,
    nameSuffix: row.name_suffix ?? null,
    kind:
      row.kind === "person" ? "person" : row.kind === "organisation" ? "organisation" : "unknown",
  };
}

export function toLocationMergeRow(row: LocationMergeColumns): LocationMergeRow {
  return {
    id: row.id as LocationId,
    name: row.name,
    jurisdiction: row.jurisdiction,
    addressBlock: row.address_block,
    footer: row.footer,
    remitTo: row.remit_to,
    letterheadLogoObjectKey: row.letterhead_logo_object_key,
    letterheadLogoWidthEmu: row.letterhead_logo_width_emu,
  };
}
