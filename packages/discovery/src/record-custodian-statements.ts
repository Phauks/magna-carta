import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RecordCustodianId, ReviewSetId } from "@magna-carta/identifiers/types";
import type { RecordCustodianKind } from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const RECORD_CUSTODIAN_TABLE = "record_custodian";

export interface RecordCustodianRow {
  readonly id: RecordCustodianId;
  readonly review_set_id: ReviewSetId;
  readonly display_name: string;
  readonly directory_entity_id: string | null;
  readonly kind: RecordCustodianKind;
  readonly created_at: string;
  readonly updated_at: string;
}

const RECORD_CUSTODIAN_COLUMNS =
  "id, review_set_id, display_name, directory_entity_id, kind, created_at, updated_at";

export function selectRecordCustodianStatement(
  database: SqlDatabase,
  id: RecordCustodianId,
): SqlStatement {
  return database
    .prepare(`SELECT ${RECORD_CUSTODIAN_COLUMNS} FROM ${RECORD_CUSTODIAN_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readRecordCustodian(
  database: SqlDatabase,
  id: RecordCustodianId,
): Promise<RecordCustodianRow | undefined> {
  const { results } = await selectRecordCustodianStatement(database, id).all<RecordCustodianRow>();
  return results[0];
}

export function selectRecordCustodianIdByNameStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  displayName: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id FROM ${RECORD_CUSTODIAN_TABLE} WHERE review_set_id = ?1 AND display_name = ?2`,
    )
    .bind(reviewSetId, displayName);
}

export async function readRecordCustodianIdByName(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  displayName: string,
): Promise<RecordCustodianId | undefined> {
  const { results } = await selectRecordCustodianIdByNameStatement(
    database,
    reviewSetId,
    displayName,
  ).all<{ id: RecordCustodianId }>();
  return results[0]?.id;
}

export function insertRecordCustodianStatement(
  database: SqlDatabase,
  row: {
    id: RecordCustodianId;
    reviewSetId: ReviewSetId;
    displayName: string;
    directoryEntityId: string | null;
    kind: RecordCustodianKind;
    now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${RECORD_CUSTODIAN_TABLE} ` +
        `(id, review_set_id, display_name, directory_entity_id, kind, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
    )
    .bind(row.id, row.reviewSetId, row.displayName, row.directoryEntityId, row.kind, row.now);
}

// The display name and the Directory link are editable — a production that named "J. Smith" and the
// person the firm later identified are the same custodian, and forcing a new row would split the
// attribution of documents already loaded under the old one. The KIND is editable too, for the same
// reason: "unattributed" resolving into a named person is the ordinary progression of a production.
export function updateRecordCustodianStatement(
  database: SqlDatabase,
  id: RecordCustodianId,
  patch: {
    displayName: string;
    directoryEntityId: string | null;
    kind: RecordCustodianKind;
    now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${RECORD_CUSTODIAN_TABLE} SET display_name = ?2, directory_entity_id = ?3, ` +
        `kind = ?4, updated_at = ?5 WHERE id = ?1`,
    )
    .bind(id, patch.displayName, patch.directoryEntityId, patch.kind, patch.now);
}

// A review set's custodians, by name. review_set_id leads the unique index, so this is an index walk
// rather than a scan of every custodian the firm has ever recorded.
export function selectRecordCustodiansStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${RECORD_CUSTODIAN_COLUMNS} FROM ${RECORD_CUSTODIAN_TABLE} WHERE review_set_id = ?1 ` +
        `ORDER BY display_name ASC LIMIT ?2`,
    )
    .bind(reviewSetId, limit);
}

export async function readRecordCustodians(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  limit: number,
): Promise<RecordCustodianRow[]> {
  const { results } = await selectRecordCustodiansStatement(
    database,
    reviewSetId,
    limit,
  ).all<RecordCustodianRow>();
  return results;
}
