import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { MatterId, ReviewSetId, UserId } from "@magna-carta/identifiers/types";
import type { ReviewSetState } from "./types.ts";

// Table names tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const REVIEW_SET_TABLE = "review_set";

export interface ReviewSetRow {
  readonly id: ReviewSetId;
  readonly matter_id: MatterId;
  readonly name: string;
  readonly state: ReviewSetState;
  readonly document_ceiling: number;
  readonly document_count: number;
  readonly semantic_index_enabled: number;
  readonly created_by: UserId;
  readonly locked_at: string | null;
  readonly closed_at: string | null;
  readonly derived_artifacts_released_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const REVIEW_SET_COLUMNS =
  "id, matter_id, name, state, document_ceiling, document_count, semantic_index_enabled, " +
  "created_by, locked_at, closed_at, derived_artifacts_released_at, created_at, updated_at";

export function selectReviewSetStatement(database: SqlDatabase, id: ReviewSetId): SqlStatement {
  return database
    .prepare(`SELECT ${REVIEW_SET_COLUMNS} FROM ${REVIEW_SET_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readReviewSet(
  database: SqlDatabase,
  id: ReviewSetId,
): Promise<ReviewSetRow | undefined> {
  const { results } = await selectReviewSetStatement(database, id).all<ReviewSetRow>();
  return results[0];
}

export function selectReviewSetIdByNameStatement(
  database: SqlDatabase,
  matterId: MatterId,
  name: string,
): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${REVIEW_SET_TABLE} WHERE matter_id = ?1 AND name = ?2`)
    .bind(matterId, name);
}

export async function reviewSetNameIsTaken(
  database: SqlDatabase,
  matterId: MatterId,
  name: string,
): Promise<boolean> {
  const { results } = await selectReviewSetIdByNameStatement(database, matterId, name).all<{
    id: ReviewSetId;
  }>();
  return results.length > 0;
}

export function insertReviewSetStatement(
  database: SqlDatabase,
  row: {
    id: ReviewSetId;
    matterId: MatterId;
    name: string;
    documentCeiling: number;
    semanticIndexEnabled: boolean;
    createdBy: UserId;
    now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${REVIEW_SET_TABLE} ` +
        `(id, matter_id, name, state, document_ceiling, document_count, semantic_index_enabled, ` +
        `created_by, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, 'open', ?4, 0, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.name,
      row.documentCeiling,
      row.semanticIndexEnabled ? 1 : 0,
      row.createdBy,
      row.now,
    );
}

export function renameReviewSetStatement(
  database: SqlDatabase,
  id: ReviewSetId,
  name: string,
  now: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${REVIEW_SET_TABLE} SET name = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, name, now);
}

// The semantic half is a per-corpus choice a firm makes and can change: turning it on afterwards
// drains the corpus without re-extracting, because the text is already in R2.
export function setSemanticIndexEnabledStatement(
  database: SqlDatabase,
  id: ReviewSetId,
  enabled: boolean,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_SET_TABLE} SET semantic_index_enabled = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, enabled ? 1 : 0, now);
}

// Forward-only, and the WHERE clause says so as well as the trigger does: a transition statement
// that named the wrong source state would silently update nothing rather than aborting, which is
// why the service reads the row first and the trigger backs both of them.
export function lockReviewSetStatement(
  database: SqlDatabase,
  id: ReviewSetId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_SET_TABLE} SET state = 'locked', locked_at = ?2, updated_at = ?2 ` +
        `WHERE id = ?1 AND state = 'open'`,
    )
    .bind(id, now);
}

// Closing releases the DERIVED artifacts for collection — extracted text, metadata sidecars, and
// index splits, all of which are rebuildable from source. It keeps every row, every manifest, and
// every exception report, which are records rather than caches.
export function closeReviewSetStatement(
  database: SqlDatabase,
  id: ReviewSetId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_SET_TABLE} SET state = 'closed', closed_at = ?2, updated_at = ?2 ` +
        `WHERE id = ?1 AND state IN ('open', 'locked')`,
    )
    .bind(id, now);
}

export function markDerivedArtifactsReleasedStatement(
  database: SqlDatabase,
  id: ReviewSetId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_SET_TABLE} SET derived_artifacts_released_at = ?2, updated_at = ?2 ` +
        `WHERE id = ?1 AND state = 'closed'`,
    )
    .bind(id, now);
}

// The maintained count, advanced in the SAME batch as the rows it counts. Relative rather than
// absolute so two concurrent chunk commits cannot lose each other's rows.
export function advanceReviewSetDocumentCountStatement(
  database: SqlDatabase,
  id: ReviewSetId,
  delta: number,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_SET_TABLE} SET document_count = document_count + ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, delta, now);
}

// The matter's review sets, newest first. Bounded and indexed — every discovery read is "within this
// matter" or "within this review set", and neither is ever a firm-wide scan.
export function selectReviewSetsForMatterStatement(
  database: SqlDatabase,
  matterId: MatterId,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${REVIEW_SET_COLUMNS} FROM ${REVIEW_SET_TABLE} WHERE matter_id = ?1 ` +
        `ORDER BY created_at DESC, id DESC LIMIT ?2`,
    )
    .bind(matterId, limit);
}

export async function readReviewSetsForMatter(
  database: SqlDatabase,
  matterId: MatterId,
  limit: number,
): Promise<ReviewSetRow[]> {
  const { results } = await selectReviewSetsForMatterStatement(
    database,
    matterId,
    limit,
  ).all<ReviewSetRow>();
  return results;
}
