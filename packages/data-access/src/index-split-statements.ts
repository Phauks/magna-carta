import type { FileId, IndexSplitId, MatterId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync fitness
// test. The discovery search-index catalog: one row per immutable Tantivy split in the firm's R2. This
// table exists only in the per-firm database — the caller supplies that handle.
export const INDEX_SPLIT_TABLE = "index_split";

export interface InsertIndexSplitRow {
  readonly id: IndexSplitId;
  readonly matterId: MatterId;
  // The one document version this split indexes — null for a split that spans many documents, the shape
  // a later compaction pass publishes when it merges the per-document splits.
  readonly documentId: FileId | null;
  readonly version: number | null;
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
      `INSERT INTO ${INDEX_SPLIT_TABLE} (id, matter_id, document_id, version, object_key, document_count, size_bytes, schema_generation, created_at, superseded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL)`,
    )
    .bind(
      row.id,
      row.matterId,
      row.documentId,
      row.version,
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
  readonly documentId: FileId | null;
  readonly version: number | null;
  readonly objectKey: string;
  readonly documentCount: number;
  readonly sizeBytes: number;
  readonly schemaGeneration: number;
  readonly createdAt: string;
}

// One home for the projection and its row mapping, so every read of this table returns the same shape
// and a new column cannot be added to one query and forgotten in another.
const SELECT_SPLIT_COLUMNS = `SELECT id, matter_id, document_id, version, object_key, document_count, size_bytes, schema_generation, created_at FROM ${INDEX_SPLIT_TABLE}`;

interface IndexSplitColumns {
  id: string;
  matter_id: string;
  document_id: string | null;
  version: number | null;
  object_key: string;
  document_count: number;
  size_bytes: number;
  schema_generation: number;
  created_at: string;
}

function toIndexSplitRow(row: IndexSplitColumns): IndexSplitRow {
  return {
    id: row.id as IndexSplitId,
    matterId: row.matter_id as MatterId,
    documentId: row.document_id as FileId | null,
    version: row.version,
    objectKey: row.object_key,
    documentCount: row.document_count,
    sizeBytes: row.size_bytes,
    schemaGeneration: row.schema_generation,
    createdAt: row.created_at,
  };
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
      `${SELECT_SPLIT_COLUMNS} WHERE matter_id = ?1 AND superseded_at IS NULL ORDER BY created_at`,
    )
    .bind(matterId)
    .all<IndexSplitColumns>();
  return results.map(toIndexSplitRow);
}

// Every split row this catalog has recorded for one document, across all its versions and whether or not
// a compaction has superseded them. The write pipeline reads this immediately before publishing: the
// rows name the R2 objects a re-index has to delete, and deleting the objects before the rows is what
// keeps a retry from leaking orphaned bytes into the firm's bucket.
export async function listSplitsForDocument(
  database: SqlDatabase,
  documentId: FileId,
): Promise<IndexSplitRow[]> {
  const { results } = await database
    .prepare(`${SELECT_SPLIT_COLUMNS} WHERE document_id = ?1 ORDER BY created_at`)
    .bind(documentId)
    .all<IndexSplitColumns>();
  return results.map(toIndexSplitRow);
}

// Drop every catalog row for a document. Paired with insertIndexSplitStatement in ONE batch, this is the
// convergence rule the whole write pipeline rests on: publishing a document's split is a delete-then-
// insert, not an upsert, so re-indexing a document at any version leaves exactly one live row no matter
// how many times the job ran or how far a previous attempt got. Delete (not supersede) is right here
// because a per-document split has no reader to protect — the replacement covers the same document, so a
// query that resolves the new split sees everything the old one held.
export function deleteSplitsForDocumentStatement(
  database: SqlDatabase,
  documentId: FileId,
): SqlStatement {
  return database
    .prepare(`DELETE FROM ${INDEX_SPLIT_TABLE} WHERE document_id = ?1`)
    .bind(documentId);
}

// The publish batch: replace a document's catalog rows with the one row for the version just built.
// Returned as an ordered pair for a single atomic batch — split across two batches, a crash between them
// would leave the document uncataloged and therefore invisible to search, which is exactly the silent
// drop the pipeline must never produce.
export function replaceDocumentSplitStatements(
  database: SqlDatabase,
  row: InsertIndexSplitRow & { readonly documentId: FileId },
): SqlStatement[] {
  return [
    deleteSplitsForDocumentStatement(database, row.documentId),
    insertIndexSplitStatement(database, row),
  ];
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
export function deleteIndexSplitStatement(database: SqlDatabase, id: IndexSplitId): SqlStatement {
  return database.prepare(`DELETE FROM ${INDEX_SPLIT_TABLE} WHERE id = ?1`).bind(id);
}
