import type { IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. The discovery search-index catalog: one row per immutable Tantivy split in the firm's R2. This
// table exists only in the per-firm database — the caller supplies that handle.
export const INDEX_SPLIT_TABLE = "index_split";

export interface InsertIndexSplitRow {
  readonly id: IndexSplitId;
  readonly matterId: MatterId;
  readonly objectKey: string;
  readonly documentCount: number;
  readonly sizeBytes: number;
  readonly schemaGeneration: number;
  readonly createdAt: string; // ISO-8601 instant
}

// Record a newly published split. A split is immutable, so this is the only INSERT; a split leaves the
// live set through `markSplitSupersededStatement`, never an in-place update of its content.
export function insertIndexSplitStatement(
  database: SqlDatabase,
  row: InsertIndexSplitRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INDEX_SPLIT_TABLE} (id, matter_id, object_key, document_count, size_bytes, schema_generation, created_at, superseded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.objectKey,
      row.documentCount,
      row.sizeBytes,
      row.schemaGeneration,
      row.createdAt,
    );
}

export interface IndexSplitRow {
  readonly id: IndexSplitId;
  readonly matterId: MatterId;
  readonly objectKey: string;
  readonly documentCount: number;
  readonly sizeBytes: number;
  readonly schemaGeneration: number;
  readonly createdAt: string;
}

// The live splits for a matter — the set a query enumerates and range-reads. Excludes splits a
// compaction has superseded, so a query never double-counts a document that a merged split also carries.
// Ordered oldest-first for a stable, deterministic scan.
export async function listLiveSplitsForMatter(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<IndexSplitRow[]> {
  const { results } = await database
    .prepare(
      `SELECT id, matter_id, object_key, document_count, size_bytes, schema_generation, created_at FROM ${INDEX_SPLIT_TABLE} WHERE matter_id = ?1 AND superseded_at IS NULL ORDER BY created_at`,
    )
    .bind(matterId)
    .all<{
      id: string;
      matter_id: string;
      object_key: string;
      document_count: number;
      size_bytes: number;
      schema_generation: number;
      created_at: string;
    }>();
  return results.map((row) => ({
    id: row.id as IndexSplitId,
    matterId: row.matter_id as MatterId,
    objectKey: row.object_key,
    documentCount: row.document_count,
    sizeBytes: row.size_bytes,
    schemaGeneration: row.schema_generation,
    createdAt: row.created_at,
  }));
}

// Mark a split superseded by compaction, dropping it from the live set. The row is kept (not deleted)
// until its R2 object is garbage-collected, so a query mid-flight against the old split still resolves;
// `deleteIndexSplitStatement` removes the row after the object is gone.
export function markSplitSupersededStatement(
  database: SqlDatabase,
  id: IndexSplitId,
  supersededAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INDEX_SPLIT_TABLE} SET superseded_at = ?2 WHERE id = ?1 AND superseded_at IS NULL`,
    )
    .bind(id, supersededAt);
}

// Remove a superseded split's catalog row after its R2 object has been garbage-collected.
export function deleteIndexSplitStatement(
  database: SqlDatabase,
  id: IndexSplitId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${INDEX_SPLIT_TABLE} WHERE id = ?1`).bind(id);
}
