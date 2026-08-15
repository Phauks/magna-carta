import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DiscoveryLoadId,
  ReviewDocumentExceptionId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import { REVIEW_DOCUMENT_TABLE } from "./review-document-statements.ts";
import type { ReviewDocumentExceptionCode, ReviewDocumentExceptionStage } from "./types.ts";

// The processing stage's writes and the one read the dispatch walk makes. Everything here composes
// into `composeEffectBatch`; nothing executes on its own.

export const REVIEW_DOCUMENT_EXCEPTION_TABLE = "review_document_exception";

// ---------------------------------------------------------------------------------------------
// The dispatch read
//
// One page of a load's documents that still need processing, with the bytes each one points at.
// KEYSET-PAGED BY `id`, never by OFFSET: a load at the ceiling is a quarter of a million rows and an
// offset walk is quadratic in it, and the rows under an offset move as the walk itself marks them.

export interface DispatchableReviewDocument {
  readonly id: ReviewDocumentId;
  readonly sourceKey: string;
  readonly contentType: string | null;
  // The scan gate's verdict on the bytes, carried so the consumer can refuse to open a quarantined
  // document WITHOUT reading it. A flagged file in discovery is evidence: it stays in the corpus, it
  // appears in the report, and no parser is pointed at it.
  readonly sourceStatus: string;
}

// The join is deliberately a LEFT JOIN on both sides with a COALESCE, rather than two queries or a
// UNION. A review document points at exactly one of a file version or an email message (a CHECK holds
// it), so exactly one side of each row is populated, and one indexed pass over the load beats two
// passes plus a merge the caller would have to keep ordered.
//
// An email message's bytes are its verbatim original and its status is `clean` by construction: the
// capture path files a message only after its attachments have crossed the same ingest gate, and the
// message body itself is not a file the scanner holds a verdict on.
export function selectDispatchableDocumentsStatement(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  afterId: string | null,
  limit: number,
): SqlStatement {
  return (
    database
      .prepare(
        `SELECT review_document.id AS id, ` +
          `COALESCE(file_version.r2_key, email_message.original_r2_key) AS sourceKey, ` +
          `file_version.sniffed_content_type AS contentType, ` +
          `COALESCE(file_version.status, 'clean') AS sourceStatus ` +
          `FROM ${REVIEW_DOCUMENT_TABLE} ` +
          `LEFT JOIN file_version ON file_version.id = review_document.file_version_id ` +
          `LEFT JOIN email_message ON email_message.id = review_document.email_message_id ` +
          `WHERE review_document.discovery_load_id = ?1 ` +
          `AND review_document.processing_state = 'pending' ` +
          `AND review_document.id > ?2 ` +
          `ORDER BY review_document.id ASC LIMIT ?3`,
      )
      // The empty string is below every identifier in lexicographic order, which is what makes "start
      // from the beginning" the same query shape as "resume from here" rather than a second statement.
      .bind(loadId, afterId ?? "", limit)
  );
}

export async function readDispatchableDocuments(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  afterId: string | null,
  limit: number,
): Promise<DispatchableReviewDocument[]> {
  const { results } = await selectDispatchableDocumentsStatement(
    database,
    loadId,
    afterId,
    limit,
  ).all<DispatchableReviewDocument>();
  return results;
}

// ---------------------------------------------------------------------------------------------
// The processing writes

// Claim the document. `WHERE processing_state = 'pending'` is the optimistic-concurrency guard: a
// redelivered message whose first delivery is still running updates nothing and the consumer sees the
// row is not its to process, so two consumers cannot both extract one document and write two texts to
// one key.
export function claimReviewDocumentStatement(
  database: SqlDatabase,
  id: ReviewDocumentId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TABLE} SET processing_state = 'processing', ` +
        `processing_deferred_reason = NULL, updated_at = ?2 ` +
        `WHERE id = ?1 AND processing_state IN ('pending', 'processing')`,
    )
    .bind(id, now);
}

export interface ProcessedReviewDocumentFacts {
  readonly textR2Key: string;
  readonly metadataR2Key: string;
  readonly formatIdentified: string;
  readonly pageCount: number | null;
  readonly pagesRecognized: number;
  readonly extractionRoute: string;
  readonly textFingerprint: string | null;
  readonly sortDate: string | null;
  readonly sortDateSource: string | null;
}

// The success write. Every derived scalar and both R2 keys land in one statement, and the state moves
// to its terminal value in the same one — a document whose text is written and whose row still says
// `processing` is a document nothing will ever come back for.
//
// `format_identified` and `extraction_route` are NOT NULL in the bound values rather than in the
// schema, because SQLite cannot add a CHECK to a shipped table without a rebuild and the per-firm
// lineage is additive-only. `aProcessedDocumentAlwaysNamesItsRouteAndFormat` in
// test/processing-statements.test.ts holds the rule where the schema cannot.
export function markReviewDocumentProcessedStatement(
  database: SqlDatabase,
  id: ReviewDocumentId,
  facts: ProcessedReviewDocumentFacts,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TABLE} SET processing_state = 'processed', ` +
        `text_r2_key = ?2, metadata_r2_key = ?3, format_identified = ?4, page_count = ?5, ` +
        `pages_recognized = ?6, extraction_route = ?7, text_fingerprint = ?8, sort_date = ?9, ` +
        `sort_date_source = ?10, processing_deferred_reason = NULL, updated_at = ?11 ` +
        `WHERE id = ?1 AND processing_state = 'processing'`,
    )
    .bind(
      id,
      facts.textR2Key,
      facts.metadataR2Key,
      facts.formatIdentified,
      facts.pageCount,
      facts.pagesRecognized,
      facts.extractionRoute,
      facts.textFingerprint,
      facts.sortDate,
      facts.sortDateSource,
      now,
    );
}

// The other terminal state. The identified format is written even here — and especially here: "we
// could not read this, and it was an encrypted Word document" is a sentence a firm can say to a
// court, where "extraction failed" is not.
export function markReviewDocumentExceptedStatement(
  database: SqlDatabase,
  id: ReviewDocumentId,
  formatIdentified: string | null,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TABLE} SET processing_state = 'excepted', ` +
        `format_identified = COALESCE(?2, format_identified), ` +
        `processing_deferred_reason = NULL, updated_at = ?3 ` +
        `WHERE id = ?1 AND processing_state = 'processing'`,
    )
    .bind(id, formatIdentified, now);
}

// PARKED, AND VISIBLE. An engine that is not deployed, or a service that did not answer, is not this
// document's fault and is not a verdict on it — so the row goes back to `pending` carrying the reason
// it did not get further. That reason is what makes the backlog enumerable from the corpus itself
// rather than only from a dead-letter queue somebody has to know to look in.
export function parkReviewDocumentStatement(
  database: SqlDatabase,
  id: ReviewDocumentId,
  reason: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TABLE} SET processing_state = 'pending', ` +
        `processing_deferred_reason = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, reason, now);
}

// One named reason a document did not process. Several per document is normal — a container that was
// both encrypted and oversize — so this inserts rather than upserts, and the derived identifier is
// what keeps a redelivery from writing the same reason twice.
export function insertReviewDocumentExceptionStatement(
  database: SqlDatabase,
  row: {
    readonly id: ReviewDocumentExceptionId;
    readonly reviewSetId: ReviewSetId;
    readonly reviewDocumentId: ReviewDocumentId;
    readonly stage: ReviewDocumentExceptionStage;
    readonly code: ReviewDocumentExceptionCode;
    // NEVER FILE CONTENT. The whole pipeline handles privileged material, so a detail carrying a
    // fragment of a document is a redaction failure wearing an error message. A stable sentence about
    // the document's condition, and nothing read out of it.
    readonly detail: string | null;
  },
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO ${REVIEW_DOCUMENT_EXCEPTION_TABLE} ` +
        `(id, review_set_id, review_document_id, stage, code, detail, created_at) ` +
        `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(row.id, row.reviewSetId, row.reviewDocumentId, row.stage, row.code, row.detail, now);
}

// ---------------------------------------------------------------------------------------------
// The reads the report and the reconciliation stand on

export interface ExceptionCodeCount {
  readonly code: ReviewDocumentExceptionCode;
  readonly document_count: number;
}

// The exception report's spine: how many documents carry each code, over the whole review set. One
// indexed group-by against `(review_set_id, code)` — the reason that index exists, and the reason the
// exception table carries its own `review_set_id` rather than reaching one through the document.
//
// DISTINCT on the document, because a document with two exceptions is one document with a problem and
// not two. A report that counted rows would overstate the corpus's trouble to opposing counsel, which
// is a different kind of wrong from understating it and no better.
export function selectExceptionCountsByCodeStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): SqlStatement {
  return database
    .prepare(
      `SELECT code, COUNT(DISTINCT review_document_id) AS document_count ` +
        `FROM ${REVIEW_DOCUMENT_EXCEPTION_TABLE} WHERE review_set_id = ?1 ` +
        `GROUP BY code ORDER BY code ASC`,
    )
    .bind(reviewSetId);
}

export async function readExceptionCountsByCode(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): Promise<ExceptionCodeCount[]> {
  const { results } = await selectExceptionCountsByCodeStatement(
    database,
    reviewSetId,
  ).all<ExceptionCodeCount>();
  return results;
}

export interface LoadProcessingTally {
  readonly loaded: number;
  readonly processed: number;
  readonly excepted: number;
  readonly outstanding: number;
}

// THE RECONCILIATION, computed from the rows rather than from the counters. The counters on the load
// are advanced relatively as chunks commit and are what the row CHECK holds; this counts what is
// actually there. Two numbers that must agree, derived two different ways — which is the whole point,
// because a report that reconciled against the same number it was drawn from would reconcile with
// anything.
export function selectLoadProcessingTallyStatement(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS loaded, ` +
        `SUM(CASE WHEN processing_state = 'processed' THEN 1 ELSE 0 END) AS processed, ` +
        `SUM(CASE WHEN processing_state = 'excepted' THEN 1 ELSE 0 END) AS excepted, ` +
        `SUM(CASE WHEN processing_state IN ('pending', 'processing') THEN 1 ELSE 0 END) ` +
        `AS outstanding ` +
        `FROM ${REVIEW_DOCUMENT_TABLE} WHERE discovery_load_id = ?1`,
    )
    .bind(loadId);
}

export async function readLoadProcessingTally(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
): Promise<LoadProcessingTally> {
  const { results } = await selectLoadProcessingTallyStatement(database, loadId).all<{
    loaded: number;
    processed: number | null;
    excepted: number | null;
    outstanding: number | null;
  }>();
  const row = results[0];
  return {
    loaded: row?.loaded ?? 0,
    // SUM over no rows is NULL in SQLite, and a null that reached the reconciliation would read as a
    // count nobody could compare. Zero is what "none of them" means.
    processed: row?.processed ?? 0,
    excepted: row?.excepted ?? 0,
    outstanding: row?.outstanding ?? 0,
  };
}

// Documents parked because an engine was not there. Enumerable from the corpus, which is what makes
// "what is this review set still owed" a question a person can ask without reading a queue.
export function selectParkedDocumentCountStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COUNT(*) AS document_count FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE review_set_id = ?1 AND processing_state = 'pending' ` +
        `AND processing_deferred_reason IS NOT NULL`,
    )
    .bind(reviewSetId);
}

export async function readParkedDocumentCount(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): Promise<number> {
  const { results } = await selectParkedDocumentCountStatement(database, reviewSetId).all<{
    document_count: number;
  }>();
  return results[0]?.document_count ?? 0;
}
