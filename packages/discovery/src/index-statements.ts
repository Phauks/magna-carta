import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { ReviewDocumentId, ReviewSetId } from "@magna-carta/identifiers/types";
import { REVIEW_DOCUMENT_TABLE } from "./review-document-statements.ts";
import type { ReviewDocumentIndexState } from "./types.ts";

// Where a review document stands with the SEARCH INDEX, written on the document's own row.
//
// The index is a stage AFTER processing, run by a different engine with a different deploy state, so
// it needs its own answer: a document can be read, produced and reviewed while the engine that would
// make it searchable does not exist. Recording that as a processing exception would say the platform
// tried to read the document and could not — untrue — and would put a line in the report a firm hands
// to another party that a later deploy silently removes.
//
// ON THE ROW rather than only in the index job's Durable Object, which is the whole point: an
// unindexed document has to be countable and pageable from the corpus, by somebody who does not know
// which Durable Object to open. This is the same shape `processing_deferred_reason` already gives the
// stage before.
//
// THESE STATEMENTS TAKE NO ACCESS PREDICATE, on the same rule as the processing writes beside them:
// the index consumer runs off a queue with no member and no session, over a corpus the platform put
// there itself. There is nobody to check, and composing a predicate with nobody bound would be a
// clause matching whatever the previous binding happened to be. Everything a MEMBER reaches goes
// through the access-scoped read builders and their fitness pass.

// The one writer of `index_state`, so the closed vocabulary in types.ts is held here where SQLite
// cannot hold it: the column was added to a shipped table and there is no ALTER TABLE ADD CONSTRAINT.
function writeIndexStateStatement(
  database: SqlDatabase,
  reviewDocumentId: ReviewDocumentId,
  state: ReviewDocumentIndexState,
  reason: string | null,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TABLE} SET index_state = ?2, index_deferred_reason = ?3, ` +
        `updated_at = ?4 WHERE id = ?1`,
    )
    .bind(reviewDocumentId, state, reason, now);
}

// The document is in the corpus's index. The reason is cleared in the same write, so a document that
// was parked and has since drained cannot keep a stale sentence about an engine that is now deployed.
export function markReviewDocumentIndexedStatement(
  database: SqlDatabase,
  reviewDocumentId: ReviewDocumentId,
  now: string,
): SqlStatement {
  return writeIndexStateStatement(database, reviewDocumentId, "indexed", null, now);
}

// The index engine is not deployed. Not a verdict on the document, and not terminal: the replay after
// a deploy drains it into the same derived split, because the split's identity comes from the review
// document rather than from the attempt.
export function markReviewDocumentIndexDeferredStatement(
  database: SqlDatabase,
  reviewDocumentId: ReviewDocumentId,
  reason: string,
  now: string,
): SqlStatement {
  return writeIndexStateStatement(database, reviewDocumentId, "deferred", reason, now);
}

// The index refused this document and no retry can change that. The reason is kept for the same
// purpose as a deferral's — so the row can say why without anybody opening a queue.
export function markReviewDocumentIndexFailedStatement(
  database: SqlDatabase,
  reviewDocumentId: ReviewDocumentId,
  reason: string,
  now: string,
): SqlStatement {
  return writeIndexStateStatement(database, reviewDocumentId, "failed", reason, now);
}

// ---------------------------------------------------------------------------------------------
// The backlog reads

export interface ReviewSetIndexBacklog {
  readonly indexed: number;
  readonly deferred: number;
  readonly failed: number;
  // Documents the corpus has never asked the index about. Distinct from `deferred`: nothing has tried
  // yet, which is what a review set looks like between processing and the first index turn.
  readonly unattempted: number;
}

// What a review set owes the index, in one grouped read off `(review_set_id, index_state)`.
//
// A processed document is the only one that can be indexed at all — an excepted one has no text and a
// pending one has not been read — so the denominator is the processed corpus rather than every row.
// Counting the whole review set instead would report a permanent backlog for every document that was
// correctly never indexable.
export function selectReviewSetIndexBacklogStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): SqlStatement {
  return database
    .prepare(
      `SELECT ` +
        `SUM(CASE WHEN index_state = 'indexed' THEN 1 ELSE 0 END) AS indexed, ` +
        `SUM(CASE WHEN index_state = 'deferred' THEN 1 ELSE 0 END) AS deferred, ` +
        `SUM(CASE WHEN index_state = 'failed' THEN 1 ELSE 0 END) AS failed, ` +
        `SUM(CASE WHEN index_state IS NULL THEN 1 ELSE 0 END) AS unattempted ` +
        `FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE review_set_id = ?1 AND processing_state = 'processed'`,
    )
    .bind(reviewSetId);
}

export async function readReviewSetIndexBacklog(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
): Promise<ReviewSetIndexBacklog> {
  const { results } = await selectReviewSetIndexBacklogStatement(database, reviewSetId).all<{
    indexed: number | null;
    deferred: number | null;
    failed: number | null;
    unattempted: number | null;
  }>();
  const row = results[0];
  // SUM over no rows is NULL in SQLite, and a null that reached a progress figure would read as a
  // count nobody could compare. Zero is what "none of them" means.
  return {
    indexed: row?.indexed ?? 0,
    deferred: row?.deferred ?? 0,
    failed: row?.failed ?? 0,
    unattempted: row?.unattempted ?? 0,
  };
}

// One page of the documents a review set still owes the index — the replay a deploy drains the
// backlog with. Keyset-paged by id, never by OFFSET: at the ceiling a review set is a quarter of a
// million rows, and the rows under an offset move as the replay itself marks them.
export function selectUnindexedReviewDocumentPageStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  afterId: string | null,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT id FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE review_set_id = ?1 AND processing_state = 'processed' ` +
        `AND (index_state IS NULL OR index_state <> 'indexed') AND id > ?2 ` +
        `ORDER BY id ASC LIMIT ?3`,
    )
    .bind(reviewSetId, afterId ?? "", limit);
}

export async function readUnindexedReviewDocumentPage(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  afterId: string | null,
  limit: number,
): Promise<ReviewDocumentId[]> {
  const { results } = await selectUnindexedReviewDocumentPageStatement(
    database,
    reviewSetId,
    afterId,
    limit,
  ).all<{ id: ReviewDocumentId }>();
  return results.map((row) => row.id);
}
