import type { DatabaseSync } from "node:sqlite";
import { REVIEW_DOCUMENT_INSERT_BATCH_SIZE } from "@magna-carta/discovery/limits";
import type { DiscoveryProbes, DiscoveryVolumeProfile } from "./discovery-generate.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";

// The discovery corpus's volume-shaped operations: the ones whose cost depends on how big a review
// set is, as opposed to the per-document work of the processing lane, which is one indexed row write
// and two object puts however large the corpus.
//
// THE SQL HERE IS A TRANSCRIPTION, and that is a real cost worth naming. The reads it measures are
// built in packages/discovery/src/review-reads.ts and src/processing-statements.ts against a Worker
// database handle those modules take as an argument; node:sqlite is not one, so a measurement cannot
// call them. What keeps the two in step is that they run against the SAME migrated schema — a column
// or index renamed there fails these statements loudly — and that each statement below names the
// module it transcribes. A plan taken over a query the product does not make is a plan about nothing.

// ── The processing lane ──────────────────────────────────────────────────────

// The dispatch walk: one page of a load's still-unprocessed documents with the object each points at.
// A load at the ceiling is 2,500 of these, and the trap is that a review-set-led index narrows nothing
// when the load IS the review set. Transcribes selectDispatchableDocumentsStatement.
export const DISPATCH_PAGE_SQL = `SELECT review_document.id AS id,
    COALESCE(file_version.r2_key, email_message.original_r2_key) AS sourceKey,
    file_version.sniffed_content_type AS contentType,
    COALESCE(file_version.status, 'clean') AS sourceStatus
  FROM review_document
  LEFT JOIN file_version ON file_version.id = review_document.file_version_id
  LEFT JOIN email_message ON email_message.id = review_document.email_message_id
  WHERE review_document.discovery_load_id = ?
    AND review_document.processing_state = 'pending'
    AND review_document.id > ?
  ORDER BY review_document.id ASC LIMIT ?`;

// Loaded against processed plus excepted, over the whole load. An aggregate, and it scans by nature —
// which is exactly why it is measured rather than assumed. Transcribes selectLoadProcessingTally.
export const RECONCILIATION_SQL = `SELECT COUNT(*) AS loaded,
    SUM(CASE WHEN processing_state = 'processed' THEN 1 ELSE 0 END) AS processed,
    SUM(CASE WHEN processing_state = 'excepted' THEN 1 ELSE 0 END) AS excepted,
    SUM(CASE WHEN processing_state IN ('pending', 'processing') THEN 1 ELSE 0 END) AS outstanding
  FROM review_document WHERE discovery_load_id = ?`;

// The allocation insert one load chunk commits, one row per statement. Measured because
// REVIEW_DOCUMENT_INSERT_BATCH_SIZE in packages/discovery/src/limits.ts is derived from D1's walls —
// 100 bound parameters per statement, 1,000 queries per invocation — and those say what the batch may
// NOT exceed while saying nothing about what one costs. The number beside the constant comes from here.
export const ALLOCATION_INSERT_SQL = `INSERT OR IGNORE INTO review_document
    (id, review_set_id, discovery_load_id, record_custodian_id, source_kind, file_version_id,
     family_id, family_role, family_sequence, source_name, source_path, size_bytes, content_sha256,
     processing_state, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'file_version', NULL, ?, 'standalone', 0, ?, NULL, 40960, ?, 'pending', ?, ?)`;

// The claim-and-write pair the processing consumer commits per document.
export const CLAIM_SQL = `UPDATE review_document SET processing_state = 'processing',
    processing_deferred_reason = NULL, updated_at = ?
  WHERE id = ? AND processing_state IN ('pending', 'processing')`;

export const PROCESSED_SQL = `UPDATE review_document SET processing_state = 'processed',
    text_r2_key = ?, metadata_r2_key = ?, format_identified = 'pdf', page_count = 4,
    pages_recognized = 0, extraction_route = 'discovery-engine', text_fingerprint = ?,
    sort_date = ?, sort_date_source = 'documentProperties', processing_deferred_reason = NULL,
    updated_at = ?
  WHERE id = ? AND processing_state = 'processing'`;

// ── The reads the review surface sits on ─────────────────────────────────────

// The access predicate every member-facing read composes, spelled once. It is part of every plan
// below on purpose: a page measured without the wall in it is a page nobody will ever serve.
const ACCESS = `EXISTS (SELECT 1 FROM review_set_access
  WHERE review_set_access.review_set_id = review_document.review_set_id
    AND review_set_access.member_user_id = ?)`;

const LIST_COLUMNS = `review_document.id, review_document.record_custodian_id,
  review_document.discovery_load_id, review_document.family_id, review_document.family_role,
  review_document.family_sequence, review_document.source_name, review_document.sort_date,
  review_document.processing_state, review_document.index_state, review_document.is_dedup_primary`;

// The dated segment of the list page, resumed from a cursor deep in the corpus. Transcribes
// selectReviewDocumentPageStatement.
export const LIST_PAGE_SQL = `SELECT ${LIST_COLUMNS} FROM review_document
  WHERE review_document.review_set_id = ?
    AND review_document.sort_date IS NOT NULL
    AND (review_document.sort_date, review_document.id) < (?, ?)
    AND ${ACCESS}
  ORDER BY review_document.sort_date DESC, review_document.id DESC LIMIT ?`;

// The undated tail, which is its own statement for the same reason it is its own segment.
// Transcribes selectUndatedReviewDocumentPageStatement.
export const LIST_UNDATED_PAGE_SQL = `SELECT ${LIST_COLUMNS} FROM review_document
  WHERE review_document.review_set_id = ?
    AND review_document.sort_date IS NULL
    AND review_document.id < ?
    AND ${ACCESS}
  ORDER BY review_document.sort_date DESC, review_document.id DESC LIMIT ?`;

// The same page narrowed to one Custodian of Record — the filter a reviewer uses most, and the one
// whose index has to carry the sort columns or the ORDER BY falls to a temporary b-tree.
export const LIST_PAGE_BY_CUSTODIAN_SQL = `SELECT ${LIST_COLUMNS} FROM review_document
  WHERE review_document.review_set_id = ?
    AND review_document.record_custodian_id = ?
    AND review_document.sort_date IS NOT NULL
    AND (review_document.sort_date, review_document.id) < (?, ?)
    AND ${ACCESS}
  ORDER BY review_document.sort_date DESC, review_document.id DESC LIMIT ?`;

// And narrowed by exception code, which is the one filter that cannot be a column: a document has
// several reasons or none, so it is a semi-join rather than a join.
export const LIST_PAGE_BY_EXCEPTION_SQL = `SELECT ${LIST_COLUMNS} FROM review_document
  WHERE review_document.review_set_id = ?
    AND review_document.sort_date IS NOT NULL
    AND EXISTS (SELECT 1 FROM review_document_exception AS filtered_exception
      WHERE filtered_exception.review_document_id = review_document.id
        AND filtered_exception.code = ?)
    AND ${ACCESS}
  ORDER BY review_document.sort_date DESC, review_document.id DESC LIMIT ?`;

// The exception surface's spine: how many documents carry each reason, over the whole review set.
export const EXCEPTION_COUNTS_SQL = `SELECT code, COUNT(DISTINCT review_document_id) AS document_count
  FROM review_document_exception WHERE review_set_id = ? GROUP BY code ORDER BY code ASC`;

// One page of the exceptions themselves, keyset-paged on the (document, exception) pair.
export const EXCEPTION_PAGE_SQL = `SELECT exception.id AS exception_id,
    exception.review_document_id AS review_document_id, exception.stage AS stage,
    exception.code AS code, document.record_custodian_id AS record_custodian_id,
    document.source_name AS source_name, document.processing_state AS processing_state
  FROM review_document_exception AS exception
  JOIN review_document AS document ON document.id = exception.review_document_id
  WHERE exception.review_set_id = ?
    AND (exception.review_document_id > ?
      OR (exception.review_document_id = ? AND exception.id > ?))
    AND EXISTS (SELECT 1 FROM review_set_access
      WHERE review_set_access.review_set_id = exception.review_set_id
        AND review_set_access.member_user_id = ?)
  ORDER BY exception.review_document_id ASC, exception.id ASC LIMIT ?`;

// "Which custodians held this document", asked under oath and answered from one index.
export const OCCURRENCES_SQL = `SELECT id, primary_review_document_id, duplicate_review_document_id,
    record_custodian_id, discovery_load_id, created_at
  FROM review_document_occurrence
  WHERE review_set_id = ? AND primary_review_document_id = ?
    AND EXISTS (SELECT 1 FROM review_set_access
      WHERE review_set_access.review_set_id = review_document_occurrence.review_set_id
        AND review_set_access.member_user_id = ?)
  ORDER BY duplicate_review_document_id ASC LIMIT ?`;

// A family is ONE indexed read — the reason family_id sits on the row rather than in a junction table.
export const FAMILY_SQL = `SELECT ${LIST_COLUMNS} FROM review_document
  WHERE review_document.review_set_id = ? AND review_document.family_id = ?
  ORDER BY review_document.family_sequence ASC, review_document.id ASC`;

// What the review set is still owed by the index, over its processed documents.
export const INDEX_BACKLOG_SQL = `SELECT
    SUM(CASE WHEN index_state = 'indexed' THEN 1 ELSE 0 END) AS indexed,
    SUM(CASE WHEN index_state = 'deferred' THEN 1 ELSE 0 END) AS deferred,
    SUM(CASE WHEN index_state = 'failed' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN index_state IS NULL THEN 1 ELSE 0 END) AS unattempted
  FROM review_document WHERE review_set_id = ? AND processing_state = 'processed'`;

// Documents parked because an engine was not there.
export const PARKED_COUNT_SQL = `SELECT COUNT(*) AS document_count FROM review_document
  WHERE review_set_id = ? AND processing_state = 'pending'
    AND processing_deferred_reason IS NOT NULL`;

// The corpus's split catalog, enumerated by CORPUS — the read a query resolves its keys from.
export const CORPUS_SPLIT_CATALOG_SQL = `SELECT id, matter_id, corpus_kind, corpus_id, document_id,
    version, object_key, document_count, size_bytes, schema_generation, created_at, superseded_at
  FROM index_split WHERE corpus_id = ? AND superseded_at IS NULL ORDER BY created_at`;

// ── Plans ────────────────────────────────────────────────────────────────────

// Operations that scan BY NATURE and are allowlisted rather than pretended away. Each is a whole-set
// aggregate: "count every document in this load and add them up" has no index that makes it not a
// scan, and the honest thing is to measure it and say so.
export const DISCOVERY_ALLOWED_SCANS: readonly string[] = ["reconciliationTally", "indexBacklog"];

export function discoveryHotPathPlans(
  raw: DatabaseSync,
  profile: DiscoveryVolumeProfile,
  probes: DiscoveryProbes,
): LabeledPlan[] {
  return [
    {
      label: "dispatchPage",
      details: explainStatement(raw, DISPATCH_PAGE_SQL, [
        probes.busiestLoadId,
        probes.midWalkCursorId,
        profile.dispatchPageSize,
      ]),
    },
    {
      label: "reconciliationTally",
      details: explainStatement(raw, RECONCILIATION_SQL, [probes.busiestLoadId]),
    },
    {
      label: "listPage",
      details: explainStatement(raw, LIST_PAGE_SQL, [
        probes.reviewSetId,
        probes.midListCursorSortDate,
        probes.midListCursorId,
        probes.memberUserId,
        profile.listPageSize,
      ]),
    },
    {
      label: "listUndatedPage",
      details: explainStatement(raw, LIST_UNDATED_PAGE_SQL, [
        probes.reviewSetId,
        probes.undatedCursorId,
        probes.memberUserId,
        profile.listPageSize,
      ]),
    },
    {
      label: "listPageByRecordCustodian",
      details: explainStatement(raw, LIST_PAGE_BY_CUSTODIAN_SQL, [
        probes.reviewSetId,
        probes.filterRecordCustodianId,
        probes.midListCursorSortDate,
        probes.midListCursorId,
        probes.memberUserId,
        profile.listPageSize,
      ]),
    },
    {
      label: "listPageByExceptionCode",
      details: explainStatement(raw, LIST_PAGE_BY_EXCEPTION_SQL, [
        probes.reviewSetId,
        "encrypted",
        probes.memberUserId,
        profile.listPageSize,
      ]),
    },
    {
      label: "exceptionCountsByCode",
      details: explainStatement(raw, EXCEPTION_COUNTS_SQL, [probes.reviewSetId]),
    },
    {
      label: "exceptionPage",
      details: explainStatement(raw, EXCEPTION_PAGE_SQL, [
        probes.reviewSetId,
        probes.midListCursorId,
        probes.midListCursorId,
        "",
        probes.memberUserId,
        profile.listPageSize,
      ]),
    },
    {
      label: "occurrences",
      details: explainStatement(raw, OCCURRENCES_SQL, [
        probes.reviewSetId,
        probes.dedupPrimaryId,
        probes.memberUserId,
        profile.listPageSize,
      ]),
    },
    {
      label: "family",
      details: explainStatement(raw, FAMILY_SQL, [probes.reviewSetId, probes.filterFamilyId]),
    },
    {
      label: "indexBacklog",
      details: explainStatement(raw, INDEX_BACKLOG_SQL, [probes.reviewSetId]),
    },
    {
      label: "parkedDocumentCount",
      details: explainStatement(raw, PARKED_COUNT_SQL, [probes.reviewSetId]),
    },
    {
      label: "corpusSplitCatalog",
      details: explainStatement(raw, CORPUS_SPLIT_CATALOG_SQL, [probes.reviewSetId]),
    },
  ];
}

// ── Measurements ─────────────────────────────────────────────────────────────

export interface DiscoveryHandle {
  readonly raw: DatabaseSync;
  readonly profile: DiscoveryVolumeProfile;
  readonly probes: DiscoveryProbes;
}

export function discoveryMeasurements(): Measurement<DiscoveryHandle>[] {
  let writeCursor = 0;
  let allocationCursor = 0;
  return [
    {
      name: "discovery-dispatch.page-mid-walk",
      operation: async ({ raw, profile, probes }) => {
        raw
          .prepare(DISPATCH_PAGE_SQL)
          .all(probes.busiestLoadId, probes.midWalkCursorId, profile.dispatchPageSize);
      },
    },
    {
      name: "discovery-load.reconciliation-tally",
      operation: async ({ raw, probes }) => {
        raw.prepare(RECONCILIATION_SQL).all(probes.busiestLoadId);
      },
    },
    {
      // THE READ THE REVIEW SURFACE SITS ON, measured mid-corpus rather than at its head.
      name: "discovery-review.list-page-mid-corpus",
      operation: async ({ raw, profile, probes }) => {
        raw
          .prepare(LIST_PAGE_SQL)
          .all(
            probes.reviewSetId,
            probes.midListCursorSortDate,
            probes.midListCursorId,
            probes.memberUserId,
            profile.listPageSize,
          );
      },
    },
    {
      name: "discovery-review.list-page-undated-tail",
      operation: async ({ raw, profile, probes }) => {
        raw
          .prepare(LIST_UNDATED_PAGE_SQL)
          .all(
            probes.reviewSetId,
            probes.undatedCursorId,
            probes.memberUserId,
            profile.listPageSize,
          );
      },
    },
    {
      name: "discovery-review.list-page-by-record-custodian",
      operation: async ({ raw, profile, probes }) => {
        raw
          .prepare(LIST_PAGE_BY_CUSTODIAN_SQL)
          .all(
            probes.reviewSetId,
            probes.filterRecordCustodianId,
            probes.midListCursorSortDate,
            probes.midListCursorId,
            probes.memberUserId,
            profile.listPageSize,
          );
      },
    },
    {
      name: "discovery-review.list-page-by-exception-code",
      operation: async ({ raw, profile, probes }) => {
        raw
          .prepare(LIST_PAGE_BY_EXCEPTION_SQL)
          .all(probes.reviewSetId, "encrypted", probes.memberUserId, profile.listPageSize);
      },
    },
    {
      name: "discovery-report.exception-counts-by-code",
      operation: async ({ raw, probes }) => {
        raw.prepare(EXCEPTION_COUNTS_SQL).all(probes.reviewSetId);
      },
    },
    {
      name: "discovery-report.exception-page",
      operation: async ({ raw, profile, probes }) => {
        raw
          .prepare(EXCEPTION_PAGE_SQL)
          .all(
            probes.reviewSetId,
            probes.midListCursorId,
            probes.midListCursorId,
            "",
            probes.memberUserId,
            profile.listPageSize,
          );
      },
    },
    {
      name: "discovery-review.occurrences",
      operation: async ({ raw, profile, probes }) => {
        raw
          .prepare(OCCURRENCES_SQL)
          .all(
            probes.reviewSetId,
            probes.dedupPrimaryId,
            probes.memberUserId,
            profile.listPageSize,
          );
      },
    },
    {
      name: "discovery-review.family",
      operation: async ({ raw, probes }) => {
        raw.prepare(FAMILY_SQL).all(probes.reviewSetId, probes.filterFamilyId);
      },
    },
    {
      name: "discovery-review.index-backlog",
      operation: async ({ raw, probes }) => {
        raw.prepare(INDEX_BACKLOG_SQL).all(probes.reviewSetId);
      },
    },
    {
      name: "discovery-report.parked-document-count",
      operation: async ({ raw, probes }) => {
        raw.prepare(PARKED_COUNT_SQL).all(probes.reviewSetId);
      },
    },
    {
      name: "discovery-search.corpus-split-catalog",
      operation: async ({ raw, probes }) => {
        raw.prepare(CORPUS_SPLIT_CATALOG_SQL).all(probes.reviewSetId);
      },
    },
    {
      // ONE ALLOCATION CHUNK, at the size the load actually commits. Each iteration writes its own
      // block of identifiers, because the insert is OR IGNORE against a partial unique index and
      // re-running it over the same rows would measure a batch that writes nothing.
      name: "discovery-load.allocation-batch",
      operation: async ({ raw, probes }) => {
        const statement = raw.prepare(ALLOCATION_INSERT_SQL);
        const block = allocationCursor;
        allocationCursor += 1;
        raw.exec("BEGIN");
        for (let index = 0; index < REVIEW_DOCUMENT_INSERT_BATCH_SIZE; index += 1) {
          const id = `reviewDocument_alloc${String(block).padStart(4, "0")}${String(index).padStart(
            4,
            "0",
          )}`;
          statement.run(
            id,
            probes.reviewSetId,
            probes.busiestLoadId,
            probes.filterRecordCustodianId,
            id,
            `ALLOC${id}.pdf`,
            `sha256-alloc-${id}`,
            "2026-08-19T00:00:00.000Z",
            "2026-08-19T00:00:00.000Z",
          );
        }
        raw.exec("COMMIT");
      },
    },
    {
      // Claim plus the terminal write, which is the pair the consumer commits per document. Each
      // iteration takes its own document, because a claim is not idempotent in cost: re-running it
      // against an already-processed row would measure an update that matches nothing.
      name: "discovery-processing.per-document-write",
      operation: async ({ raw, probes }) => {
        const id = probes.writableIds[writeCursor % probes.writableIds.length]!;
        writeCursor += 1;
        raw.prepare(CLAIM_SQL).run("2026-08-19T00:00:00.000Z", id);
        raw
          .prepare(PROCESSED_SQL)
          .run(
            `discovery/${probes.reviewSetId}/text/${id}.txt`,
            `discovery/${probes.reviewSetId}/metadata/${id}.json`,
            "9f2c1a04bb37de55",
            "2024-03-01T00:00:00.000Z",
            "2026-08-19T00:00:00.000Z",
            id,
          );
      },
    },
  ];
}

// The database's own size, which is the number the per-review-set ceiling is derived from. A review
// set is the only object in the platform whose size is set by an outside party, and the ceiling exists
// because this arithmetic has an end.
export function measuredDatabaseSizeMebibytes(raw: DatabaseSync): number {
  const pageSize = raw.prepare("PRAGMA page_size").get() as { page_size: number };
  const pageCount = raw.prepare("PRAGMA page_count").get() as { page_count: number };
  return Math.round((pageSize.page_size * pageCount.page_count) / 1024 / 1024);
}
