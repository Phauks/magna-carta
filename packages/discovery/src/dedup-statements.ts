import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DiscoveryLoadId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewDocumentOccurrenceId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import { REVIEW_DOCUMENT_TABLE } from "./review-document-statements.ts";
import type { ReviewDocumentProcessingState } from "./types.ts";

// DEDUPLICATION DECIDES WHAT A REVIEWER NEVER SEES, so every rule in this module is written to make
// that decision inspectable rather than convenient.
//
// THE DUPLICATE ROW SURVIVES. It is marked non-primary, it keeps its own record custodian and its
// own load, and an occurrence row names which primary it was suppressed behind. "Which custodians
// held this document" is asked under oath, and a deduplication that answers it with "we deleted
// that" is a defect rather than an optimization. What deduplication buys is that the expensive
// operations — extraction, indexing, embedding — run once per group; it never buys a smaller corpus.
//
// PRIMACY IS RECORDED, EXACTLY ONCE, AND NEVER MOVES. It is taken by a single statement whose WHERE
// clause refuses it while another member holds it, and the partial unique index on
// (review_set_id, dedup_group_id) WHERE is_dedup_primary = 1 is the same rule held by the database
// for the write path nobody has written yet. A member that finds primacy already taken is a
// duplicate of the holder and reads its outcome; it never takes a second primacy, and it is never
// dropped.

export const REVIEW_DOCUMENT_OCCURRENCE_TABLE = "review_document_occurrence";

export interface DedupPrimaryRow {
  readonly id: ReviewDocumentId;
  readonly processing_state: ReviewDocumentProcessingState;
  readonly text_r2_key: string | null;
  readonly metadata_r2_key: string | null;
  readonly format_identified: string | null;
  readonly page_count: number | null;
  readonly pages_recognized: number | null;
  readonly extraction_route: string | null;
  readonly text_fingerprint: string | null;
  readonly content_md5: string | null;
  readonly content_sha1: string | null;
  readonly sort_date: string | null;
  readonly sort_date_source: string | null;
}

// Who holds primacy in this group, and everything a suppressed copy needs to state the same facts
// about itself. One indexed read against (review_set_id, dedup_group_id) — the index the shipped
// schema already carries for exactly this question.
export function selectDedupPrimaryStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  dedupGroupId: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, processing_state, text_r2_key, metadata_r2_key, format_identified, page_count, ` +
        `pages_recognized, extraction_route, text_fingerprint, content_md5, content_sha1, ` +
        `sort_date, sort_date_source FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE review_set_id = ?1 AND dedup_group_id = ?2 AND is_dedup_primary = 1 ` +
        // The unique index permits exactly one such row; the ORDER BY is here so the read is
        // deterministic even in a database where the index has not been applied yet, rather than
        // returning whichever row the planner reached first.
        `ORDER BY id ASC LIMIT 1`,
    )
    .bind(reviewSetId, dedupGroupId);
}

export async function readDedupPrimary(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  dedupGroupId: string,
): Promise<DedupPrimaryRow | undefined> {
  const { results } = await selectDedupPrimaryStatement(
    database,
    reviewSetId,
    dedupGroupId,
  ).all<DedupPrimaryRow>();
  return results[0];
}

// Take primacy for this group, or take nothing. ONE STATEMENT, because the guard and the write have
// to be the same act: a read followed by a write would let two consumers each read "nobody holds it"
// and each write itself in, and a group with two primaries is a group whose duplicates were
// extracted twice and attributed to neither.
//
// The caller learns which happened by reading the group back rather than from a row count, so the
// answer is the same whether this statement wrote the row or a concurrent one did.
// fitness:unguarded-write — take primacy or take nothing — under at-least-once another consumer holding the group is the ordinary outcome, not a refusal
export function claimDedupPrimaryStatement(
  database: SqlDatabase,
  id: ReviewDocumentId,
  reviewSetId: ReviewSetId,
  dedupGroupId: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TABLE} SET dedup_group_id = ?3, is_dedup_primary = 1, ` +
        `updated_at = ?4 WHERE id = ?1 AND NOT EXISTS (` +
        `SELECT 1 FROM ${REVIEW_DOCUMENT_TABLE} AS holder ` +
        `WHERE holder.review_set_id = ?2 AND holder.dedup_group_id = ?3 ` +
        `AND holder.is_dedup_primary = 1 AND holder.id <> ?1)`,
    )
    .bind(id, reviewSetId, dedupGroupId, now);
}

// The other side of the same decision. The row stays, and what changes is that it is no longer the
// copy the corpus extracts — not whether it exists, and not whose records it came from.
export function markReviewDocumentDuplicateStatement(
  database: SqlDatabase,
  id: ReviewDocumentId,
  dedupGroupId: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TABLE} SET dedup_group_id = ?2, is_dedup_primary = 0, ` +
        `updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, dedupGroupId, now);
}

// A document that carries no identity at all keeps its group NULL and stays its own primary. Written
// rather than left to the column default so the row states the decision, and so a re-processing of a
// document that once had a hash and no longer does cannot leave a stale group behind it.
export function clearDedupGroupStatement(
  database: SqlDatabase,
  id: ReviewDocumentId,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${REVIEW_DOCUMENT_TABLE} SET dedup_group_id = NULL, is_dedup_primary = 1, ` +
        `updated_at = ?2 WHERE id = ?1`,
    )
    .bind(id, now);
}

export interface ReviewDocumentOccurrenceInsert {
  readonly id: ReviewDocumentOccurrenceId;
  readonly reviewSetId: ReviewSetId;
  readonly primaryReviewDocumentId: ReviewDocumentId;
  readonly duplicateReviewDocumentId: ReviewDocumentId;
  readonly recordCustodianId: RecordCustodianId;
  readonly discoveryLoadId: DiscoveryLoadId;
}

// THE ROW THAT KEEPS A SUPPRESSED COPY REACHABLE. It names the primary a reviewer will actually
// open, the copy that was suppressed behind it, and — the two facts the deduplication would
// otherwise destroy — whose records that copy came from and which load brought it in.
//
// `INSERT OR IGNORE` against the unique index on the duplicate: a redelivery converges on the row it
// already wrote instead of aborting the batch, and one copy can never be recorded as a duplicate of
// two different primaries.
export function insertReviewDocumentOccurrenceStatement(
  database: SqlDatabase,
  row: ReviewDocumentOccurrenceInsert,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO ${REVIEW_DOCUMENT_OCCURRENCE_TABLE} ` +
        `(id, review_set_id, primary_review_document_id, duplicate_review_document_id, ` +
        `record_custodian_id, discovery_load_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      row.id,
      row.reviewSetId,
      row.primaryReviewDocumentId,
      row.duplicateReviewDocumentId,
      row.recordCustodianId,
      row.discoveryLoadId,
      now,
    );
}

export interface ReviewDocumentOccurrenceRow {
  readonly id: ReviewDocumentOccurrenceId;
  readonly primary_review_document_id: ReviewDocumentId;
  readonly duplicate_review_document_id: ReviewDocumentId;
  readonly record_custodian_id: RecordCustodianId;
  readonly discovery_load_id: DiscoveryLoadId;
  readonly created_at: string;
}

// "WHICH CUSTODIANS HELD THIS DOCUMENT", and it is one indexed read against
// (review_set_id, primary_review_document_id) rather than a scan of the corpus for matching hashes.
// This is the read that makes a suppressed copy reachable from the copy a reviewer is looking at:
// every occurrence names a document row that still exists, with its own record custodian and its
// own load.
export function selectOccurrencesForPrimaryStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  primaryReviewDocumentId: ReviewDocumentId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, primary_review_document_id, duplicate_review_document_id, record_custodian_id, ` +
        `discovery_load_id, created_at FROM ${REVIEW_DOCUMENT_OCCURRENCE_TABLE} ` +
        `WHERE review_set_id = ?1 AND primary_review_document_id = ?2 ` +
        `ORDER BY duplicate_review_document_id ASC`,
    )
    .bind(reviewSetId, primaryReviewDocumentId);
}

export async function readOccurrencesForPrimary(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  primaryReviewDocumentId: ReviewDocumentId,
): Promise<ReviewDocumentOccurrenceRow[]> {
  const { results } = await selectOccurrencesForPrimaryStatement(
    database,
    reviewSetId,
    primaryReviewDocumentId,
  ).all<ReviewDocumentOccurrenceRow>();
  return results;
}
