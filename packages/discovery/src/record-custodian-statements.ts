import {
  decodeCursor,
  encodeCursor,
  keysetClause,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
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
// person the firm later identified are one record custodian, and forcing a new row would split the
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

// A review set's record custodians, by name. review_set_id leads the unique index, so this is an
// index walk rather than a scan of every row the firm has ever recorded.
//
// The identifier joins the sort key. `display_name` alone is not a total order — two custodians in
// one review set may share a name, which is exactly why the row carries an identifier and not a name
// — and a keyset over a non-total order skips or repeats rows at a page boundary. The visible order
// among same-named custodians was arbitrary before and is stable now.
export function selectRecordCustodiansStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  limit: number,
  cursor?: SortCursor,
): SqlStatement {
  const bindings: unknown[] = [reviewSetId];
  const cursorClause = keysetClause(bindings, cursor, "display_name", "id", true);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${RECORD_CUSTODIAN_COLUMNS} FROM ${RECORD_CUSTODIAN_TABLE} WHERE review_set_id = ? ` +
        cursorClause +
        `ORDER BY display_name ASC, id ASC LIMIT ?`,
    )
    .bind(...bindings);
}

/**
 * Whose records are in this review set, by name, a page at a time.
 *
 * Ascending and alphabetical, because that is how a person looks a record custodian up. The list
 * carried a LIMIT and no cursor, and a matter with more record custodians than fit a page answered
 * with the ones whose names sort first and nothing saying the rest existed.
 */
export async function readRecordCustodians(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  pageSize: number,
  cursor?: string,
): Promise<Page<RecordCustodianRow>> {
  const { results } = await selectRecordCustodiansStatement(
    database,
    reviewSetId,
    // One more than the page, as the has-more probe.
    pageSize + 1,
    decodeCursor(cursor),
  ).all<RecordCustodianRow>();
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.display_name, last.id) : null,
  };
}
