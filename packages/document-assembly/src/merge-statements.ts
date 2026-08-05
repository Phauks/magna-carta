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
}

export function selectMatterForMergeStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, title, description, status, location_id, client_display_name, client_code, matter_number, opened_at FROM ${MATTER_TABLE} WHERE id = ?1`,
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
  };
}

export interface LocationMergeRow {
  readonly id: LocationId;
  readonly name: string;
  readonly jurisdiction: string | null;
  readonly addressBlock: string | null;
  readonly footer: string | null;
  readonly remitTo: string | null;
}

export function selectLocationForMergeStatement(
  database: SqlDatabase,
  locationId: LocationId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, name, jurisdiction, address_block, footer, remit_to FROM ${LOCATION_TABLE} WHERE id = ?1`,
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
}

export function toLocationMergeRow(row: LocationMergeColumns): LocationMergeRow {
  return {
    id: row.id as LocationId,
    name: row.name,
    jurisdiction: row.jurisdiction,
    addressBlock: row.address_block,
    footer: row.footer,
    remitTo: row.remit_to,
  };
}
