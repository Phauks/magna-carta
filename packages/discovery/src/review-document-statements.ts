import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DiscoveryLoadId,
  EmailMessageId,
  FileVersionId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import type {
  ReviewDocumentFamilyRole,
  ReviewDocumentProcessingState,
  ReviewDocumentSourceKind,
} from "./types.ts";

// Table name tracked against @magna-carta/database's per-firm schema by the schema-name-sync
// fitness test.
export const REVIEW_DOCUMENT_TABLE = "review_document";

export interface ReviewDocumentRow {
  readonly id: ReviewDocumentId;
  readonly review_set_id: ReviewSetId;
  readonly discovery_load_id: DiscoveryLoadId;
  readonly record_custodian_id: RecordCustodianId;
  readonly source_kind: ReviewDocumentSourceKind;
  readonly file_version_id: FileVersionId | null;
  readonly email_message_id: EmailMessageId | null;
  readonly family_id: ReviewDocumentId;
  readonly family_role: ReviewDocumentFamilyRole;
  readonly family_sequence: number;
  readonly source_name: string | null;
  readonly source_path: string | null;
  readonly size_bytes: number | null;
  readonly content_sha256: string | null;
  readonly content_md5: string | null;
  readonly content_sha1: string | null;
  readonly text_r2_key: string | null;
  readonly metadata_r2_key: string | null;
  readonly page_count: number | null;
  readonly text_fingerprint: string | null;
  readonly dedup_group_id: string | null;
  readonly is_dedup_primary: number;
  readonly processing_state: ReviewDocumentProcessingState;
  readonly format_identified: string | null;
  readonly sort_date: string | null;
  readonly sort_date_source: string | null;
  readonly extraction_route: string | null;
  readonly pages_recognized: number | null;
  readonly processing_deferred_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const REVIEW_DOCUMENT_COLUMNS =
  "id, review_set_id, discovery_load_id, record_custodian_id, source_kind, file_version_id, " +
  "email_message_id, family_id, family_role, family_sequence, source_name, source_path, " +
  "size_bytes, content_sha256, content_md5, content_sha1, text_r2_key, metadata_r2_key, " +
  "page_count, text_fingerprint, dedup_group_id, is_dedup_primary, processing_state, " +
  "format_identified, sort_date, sort_date_source, extraction_route, pages_recognized, " +
  "processing_deferred_reason, created_at, updated_at";

// What one allocated review document carries at LOAD time. Everything processing derives — the text
// key, the page count, the fingerprint, the identified format — is absent here and filled in later,
// because a load moves no bytes and reads none.
export interface ReviewDocumentAllocation {
  readonly id: ReviewDocumentId;
  readonly reviewSetId: ReviewSetId;
  readonly discoveryLoadId: DiscoveryLoadId;
  readonly recordCustodianId: RecordCustodianId;
  readonly sourceKind: ReviewDocumentSourceKind;
  readonly fileVersionId: FileVersionId | null;
  readonly emailMessageId: EmailMessageId | null;
  readonly familyId: ReviewDocumentId;
  readonly familyRole: ReviewDocumentFamilyRole;
  readonly familySequence: number;
  readonly sourceName: string | null;
  readonly sourcePath: string | null;
  readonly sizeBytes: number | null;
  // Already computed at ingest for a file and already recorded for a message, so exact dedup is free
  // at load time and nothing has to re-read a byte to get it.
  readonly contentSha256: string | null;
}

// One row per statement rather than a multi-row VALUES list, deliberately: 100 bound parameters is a
// per-STATEMENT wall, and a batch of single-row inserts stays inside it at any chunk size while a
// multi-row insert would have to be re-chunked every time a column is added. The caller chunks
// against REVIEW_DOCUMENT_INSERT_BATCH_SIZE for the per-invocation query wall.
//
// `INSERT OR IGNORE` rather than a plain insert, against the partial unique index on (review set,
// file version): a redelivered or retried load converges on the rows it already wrote instead of
// aborting the batch. That is structural idempotency — derived from the key rather than guarded by a
// read the next write path could forget.
export function insertReviewDocumentStatement(
  database: SqlDatabase,
  row: ReviewDocumentAllocation,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO ${REVIEW_DOCUMENT_TABLE} ` +
        `(id, review_set_id, discovery_load_id, record_custodian_id, source_kind, ` +
        `file_version_id, email_message_id, family_id, family_role, family_sequence, ` +
        `source_name, source_path, size_bytes, content_sha256, processing_state, ` +
        `created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'pending', ?15, ?15)`,
    )
    .bind(
      row.id,
      row.reviewSetId,
      row.discoveryLoadId,
      row.recordCustodianId,
      row.sourceKind,
      row.fileVersionId,
      row.emailMessageId,
      row.familyId,
      row.familyRole,
      row.familySequence,
      row.sourceName,
      row.sourcePath,
      row.sizeBytes,
      row.contentSha256,
      now,
    );
}

export function selectReviewDocumentStatement(
  database: SqlDatabase,
  id: ReviewDocumentId,
): SqlStatement {
  return database
    .prepare(`SELECT ${REVIEW_DOCUMENT_COLUMNS} FROM ${REVIEW_DOCUMENT_TABLE} WHERE id = ?1`)
    .bind(id);
}

export async function readReviewDocument(
  database: SqlDatabase,
  id: ReviewDocumentId,
): Promise<ReviewDocumentRow | undefined> {
  const { results } = await selectReviewDocumentStatement(database, id).all<ReviewDocumentRow>();
  return results[0];
}

// Which of a set of file versions this review set already holds. The internal file lane asks this
// before allocating, so a re-load reports what it skipped rather than silently writing nothing.
export function selectLoadedFileVersionIdsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  fileVersionIds: readonly FileVersionId[],
): SqlStatement {
  const placeholders = fileVersionIds.map((_, position) => `?${position + 2}`).join(", ");
  return database
    .prepare(
      `SELECT file_version_id FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE review_set_id = ?1 AND file_version_id IN (${placeholders})`,
    )
    .bind(reviewSetId, ...fileVersionIds);
}

export async function readLoadedFileVersionIds(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  fileVersionIds: readonly FileVersionId[],
): Promise<Set<FileVersionId>> {
  if (fileVersionIds.length === 0) return new Set();
  const { results } = await selectLoadedFileVersionIdsStatement(
    database,
    reviewSetId,
    fileVersionIds,
  ).all<{ file_version_id: FileVersionId }>();
  return new Set(results.map((result) => result.file_version_id));
}

// A family is ONE indexed read — the whole reason family_id sits on the row rather than in a junction
// table, and the read every production and every privilege call will make.
export function selectFamilyStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  familyId: ReviewDocumentId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${REVIEW_DOCUMENT_COLUMNS} FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE review_set_id = ?1 AND family_id = ?2 ORDER BY family_sequence ASC, id ASC`,
    )
    .bind(reviewSetId, familyId);
}

export async function readFamily(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  familyId: ReviewDocumentId,
): Promise<ReviewDocumentRow[]> {
  const { results } = await selectFamilyStatement(
    database,
    reviewSetId,
    familyId,
  ).all<ReviewDocumentRow>();
  return results;
}

// How many documents one load actually put in. Read at completion for the reconciliation, and cheap
// because (review_set_id, discovery_load_id) is indexed.
export function selectLoadDocumentCountStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  loadId: DiscoveryLoadId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS document_count FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE review_set_id = ?1 AND discovery_load_id = ?2`,
    )
    .bind(reviewSetId, loadId);
}

export async function readLoadDocumentCount(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  loadId: DiscoveryLoadId,
): Promise<number> {
  const { results } = await selectLoadDocumentCountStatement(database, reviewSetId, loadId).all<{
    document_count: number;
  }>();
  return results[0]?.document_count ?? 0;
}
