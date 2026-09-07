import {
  assemblePage,
  decodeCursor,
  encodeCursor,
  keysetClause,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DiscoveryLoadId,
  MatterId,
  RecordCustodianId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import { DISCOVERY_LOAD_TABLE, type DiscoveryLoadRow } from "./load-statements.ts";
import { REVIEW_DOCUMENT_EXCEPTION_TABLE } from "./processing-statements.ts";
import { REVIEW_DOCUMENT_OCCURRENCE_TABLE } from "./dedup-statements.ts";
import { REVIEW_DOCUMENT_TABLE } from "./review-document-statements.ts";
import { REVIEW_SET_TABLE, type ReviewSetRow } from "./review-set-statements.ts";
import type { ReviewSetAccessPredicate } from "./review-set-visibility.ts";
import type {
  ReviewDocumentExceptionCode,
  ReviewDocumentExceptionStage,
  ReviewDocumentFamilyRole,
  ReviewDocumentIndexState,
  ReviewDocumentProcessingState,
} from "./types.ts";

// THE MEMBER-FACING READS of the review-set model — the ones a person's session reaches, as opposed to
// the pipeline reads beside them that run off a queue with no member at all.
//
// Every builder here takes the access predicate as a REQUIRED argument and composes it into the WHERE
// clause ahead of the LIMIT. `test/review-set-visibility-fitness.test.ts` proves that for every builder
// in ACCESS_SCOPED_REVIEW_READS below, from one table-driven pass, and scans this file's source to
// prove the registry has not fallen behind it. A read that forgets the predicate is a disclosure of
// material that may be attorney's-eyes-only under a protective order — which is why it is a required
// argument first and a fitness failure second, rather than a review comment nobody makes.

// ---------------------------------------------------------------------------------------------
// Review sets

// The matter's review sets a member may actually reach — the list surface, and the answer to "does
// this matter have a corpus" for somebody who is not on its access list, which is NO.
//
// It replaces an unscoped list that predated the access list. The list was the last place a walled
// review set's NAME was visible to anybody holding the matter's discovery permission, and a name is
// enough: "Plaintiff's production, Ridgeway settlement" tells a reader what exists.
export function selectVisibleReviewSetsForMatterStatement(
  database: SqlDatabase,
  matterId: MatterId,
  access: ReviewSetAccessPredicate,
  limit: number,
  cursor?: SortCursor,
): SqlStatement {
  const bindings: unknown[] = [matterId, ...access.bindings];
  // The keyset clause goes between the access fragment and the ORDER BY, so the predicate still
  // precedes the LIMIT — the property the visibility fitness pass asserts on every builder here.
  const cursorClause = keysetClause(bindings, cursor, "created_at", "id", false);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${REVIEW_SET_COLUMNS} FROM ${REVIEW_SET_TABLE} ` +
        `WHERE matter_id = ? AND ${access.fragmentFor(`${REVIEW_SET_TABLE}.id`)} ` +
        cursorClause +
        `ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export async function readVisibleReviewSetsForMatter(
  database: SqlDatabase,
  matterId: MatterId,
  access: ReviewSetAccessPredicate,
  pageSize: number,
  cursor?: string,
): Promise<Page<ReviewSetRow>> {
  const { results } = await selectVisibleReviewSetsForMatterStatement(
    database,
    matterId,
    access,
    // One more than the page, as the has-more probe.
    pageSize + 1,
    decodeCursor(cursor),
  ).all<ReviewSetRow>();
  return assemblePage(results, pageSize, (row) => row);
}

// EVERY review set this member may reach, across every matter — the firm-wide register's read.
//
// It is the matter-scoped builder above with its matter clause removed, and that is the whole
// difference: the wall is the access list and never matter access, so scoping this by the matters a
// member can open would hide from a contract reviewer precisely the corpora they were brought in to
// work. The order is the matter-scoped read's, so a member holding review sets on four matters walks
// one list in one order rather than four interleaved by a client-side merge.
export function selectVisibleReviewSetsStatement(
  database: SqlDatabase,
  access: ReviewSetAccessPredicate,
  limit: number,
  cursor?: SortCursor,
): SqlStatement {
  const bindings: unknown[] = [...access.bindings];
  const cursorClause = keysetClause(bindings, cursor, "created_at", "id", false);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${REVIEW_SET_COLUMNS} FROM ${REVIEW_SET_TABLE} ` +
        `WHERE ${access.fragmentFor(`${REVIEW_SET_TABLE}.id`)} ` +
        cursorClause +
        `ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export async function readVisibleReviewSets(
  database: SqlDatabase,
  access: ReviewSetAccessPredicate,
  pageSize: number,
  cursor?: string,
): Promise<Page<ReviewSetRow>> {
  const { results } = await selectVisibleReviewSetsStatement(
    database,
    access,
    pageSize + 1,
    decodeCursor(cursor),
  ).all<ReviewSetRow>();
  return assemblePage(results, pageSize, (row) => row);
}

export function selectVisibleReviewSetStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${REVIEW_SET_COLUMNS} FROM ${REVIEW_SET_TABLE} ` +
        `WHERE id = ? AND ${access.fragmentFor(`${REVIEW_SET_TABLE}.id`)} LIMIT ?`,
    )
    .bind(reviewSetId, ...access.bindings, 1);
}

// Undefined means ABSENT, not refused. A member who is not on the list gets the same answer as one
// asking about a review set that does not exist, because the difference between the two is itself
// information about a corpus they may not know about.
export async function readVisibleReviewSet(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): Promise<ReviewSetRow | undefined> {
  const { results } = await selectVisibleReviewSetStatement(
    database,
    reviewSetId,
    access,
  ).all<ReviewSetRow>();
  return results[0];
}

const REVIEW_SET_COLUMNS =
  "id, matter_id, name, state, document_ceiling, document_count, semantic_index_enabled, " +
  "created_by, locked_at, closed_at, derived_artifacts_released_at, created_at, updated_at";

// ---------------------------------------------------------------------------------------------
// The load status read

// Kept in step with load-statements.ts by the shape of DiscoveryLoadRow, which both projections
// produce: a column added there and forgotten here is a type error at the read below.
const DISCOVERY_LOAD_COLUMNS =
  "id, review_set_id, lane, state, transcript_scope, declared_document_count, " +
  "loaded_document_count, processed_count, exception_count, default_record_custodian_id, " +
  "source_description, initiated_by, initiated_at, completed_at, manifest_r2_key, " +
  "exception_report_r2_key, created_at, updated_at";

export function selectVisibleDiscoveryLoadStatement(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${DISCOVERY_LOAD_COLUMNS} FROM ${DISCOVERY_LOAD_TABLE} ` +
        `WHERE id = ? AND ${access.fragmentFor(`${DISCOVERY_LOAD_TABLE}.review_set_id`)} LIMIT ?`,
    )
    .bind(loadId, ...access.bindings, 1);
}

export async function readVisibleDiscoveryLoad(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  access: ReviewSetAccessPredicate,
): Promise<DiscoveryLoadRow | undefined> {
  const { results } = await selectVisibleDiscoveryLoadStatement(
    database,
    loadId,
    access,
  ).all<DiscoveryLoadRow>();
  return results[0];
}

export function selectVisibleDiscoveryLoadsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  limit: number,
  cursor?: SortCursor,
): SqlStatement {
  const bindings: unknown[] = [reviewSetId, ...access.bindings];
  const cursorClause = keysetClause(bindings, cursor, "initiated_at", "id", false);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT ${DISCOVERY_LOAD_COLUMNS} FROM ${DISCOVERY_LOAD_TABLE} ` +
        `WHERE review_set_id = ? ` +
        `AND ${access.fragmentFor(`${DISCOVERY_LOAD_TABLE}.review_set_id`)} ` +
        cursorClause +
        `ORDER BY initiated_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

/**
 * The provenance record, newest first, a page at a time.
 *
 * The cursor rides `initiated_at` rather than `created_at`, so the page order is the order a person
 * reads this list in: when the load was STARTED, which is the fact the record is about.
 */
export async function readVisibleDiscoveryLoads(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  pageSize: number,
  cursor?: string,
): Promise<Page<DiscoveryLoadRow>> {
  const { results } = await selectVisibleDiscoveryLoadsStatement(
    database,
    reviewSetId,
    access,
    // One more than the page, as the has-more probe.
    pageSize + 1,
    decodeCursor(cursor),
  ).all<DiscoveryLoadRow>();
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.initiated_at, last.id) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// The review-document list page — the read every review surface sits on

// What a page of the list carries. Deliberately the row's own columns and nothing joined: at the
// ceiling this table is a quarter of a million rows and the page is the hot read of the whole
// subsystem, so anything that needs a join (tags, occurrence counts) is a second bounded read over
// the page's own identifiers rather than a widening of this one.
export interface ReviewDocumentListRow {
  readonly id: ReviewDocumentId;
  readonly record_custodian_id: RecordCustodianId;
  readonly discovery_load_id: DiscoveryLoadId;
  readonly family_id: ReviewDocumentId;
  readonly family_role: ReviewDocumentFamilyRole;
  readonly family_sequence: number;
  readonly source_name: string | null;
  readonly source_path: string | null;
  readonly size_bytes: number | null;
  readonly page_count: number | null;
  readonly format_identified: string | null;
  readonly sort_date: string | null;
  readonly sort_date_source: string | null;
  readonly processing_state: ReviewDocumentProcessingState;
  readonly processing_deferred_reason: string | null;
  readonly index_state: ReviewDocumentIndexState | null;
  readonly is_dedup_primary: number;
  readonly extraction_route: string | null;
  readonly pages_recognized: number | null;
  readonly created_at: string;
}

const LIST_COLUMNS =
  `${REVIEW_DOCUMENT_TABLE}.id AS id, ` +
  `${REVIEW_DOCUMENT_TABLE}.record_custodian_id AS record_custodian_id, ` +
  `${REVIEW_DOCUMENT_TABLE}.discovery_load_id AS discovery_load_id, ` +
  `${REVIEW_DOCUMENT_TABLE}.family_id AS family_id, ` +
  `${REVIEW_DOCUMENT_TABLE}.family_role AS family_role, ` +
  `${REVIEW_DOCUMENT_TABLE}.family_sequence AS family_sequence, ` +
  `${REVIEW_DOCUMENT_TABLE}.source_name AS source_name, ` +
  `${REVIEW_DOCUMENT_TABLE}.source_path AS source_path, ` +
  `${REVIEW_DOCUMENT_TABLE}.size_bytes AS size_bytes, ` +
  `${REVIEW_DOCUMENT_TABLE}.page_count AS page_count, ` +
  `${REVIEW_DOCUMENT_TABLE}.format_identified AS format_identified, ` +
  `${REVIEW_DOCUMENT_TABLE}.sort_date AS sort_date, ` +
  `${REVIEW_DOCUMENT_TABLE}.sort_date_source AS sort_date_source, ` +
  `${REVIEW_DOCUMENT_TABLE}.processing_state AS processing_state, ` +
  `${REVIEW_DOCUMENT_TABLE}.processing_deferred_reason AS processing_deferred_reason, ` +
  `${REVIEW_DOCUMENT_TABLE}.index_state AS index_state, ` +
  `${REVIEW_DOCUMENT_TABLE}.is_dedup_primary AS is_dedup_primary, ` +
  `${REVIEW_DOCUMENT_TABLE}.extraction_route AS extraction_route, ` +
  `${REVIEW_DOCUMENT_TABLE}.pages_recognized AS pages_recognized, ` +
  `${REVIEW_DOCUMENT_TABLE}.created_at AS created_at`;

// The filters the review surface actually offers. Each one is a column on the row except the last,
// which is a semi-join to the exception table — the one filter that cannot be a column, because a
// document has several reasons or none.
export interface ReviewDocumentListFilters {
  readonly recordCustodianId?: RecordCustodianId;
  readonly discoveryLoadId?: DiscoveryLoadId;
  readonly familyId?: ReviewDocumentId;
  readonly processingState?: ReviewDocumentProcessingState;
  readonly exceptionCode?: ReviewDocumentExceptionCode;
}

// WHERE THE LAST PAGE ENDED, as the pair the order is on.
//
// `sortDate` is null in two different situations and the read has to tell them apart: no cursor at all
// (the first page), and a cursor sitting on a document that HAS no date. The first is `undefined`; the
// second is an explicit null with an id beside it. Collapsing them would restart the walk at the top
// every time it reached the undated tail.
export interface ReviewDocumentListCursor {
  readonly sortDate: string | null;
  readonly id: string;
}

// The order is newest document first, undated documents last, then by identifier to break ties.
//
// TWO SEGMENTS RATHER THAN ONE CLAUSE, and that is what keeps the page bounded. A document with no
// derivable date is normal in a received production — a scan with no metadata, a file whose only date
// is the day it was copied — and in SQLite a descending sort puts those rows after every dated one.
// A single keyset predicate over a nullable column either drops the whole undated tail (any comparison
// with NULL is NULL) or has to be written as an OR that the planner cannot turn into an index range,
// which makes page N cost N pages of skipping. Splitting the walk into the dated segment and the
// undated tail gives each one a clean range over the same index.
type Segment = "dated" | "undated";

function filterClauses(filters: ReviewDocumentListFilters, bindings: unknown[]): string[] {
  const clauses: string[] = [];
  if (filters.recordCustodianId !== undefined) {
    clauses.push(`${REVIEW_DOCUMENT_TABLE}.record_custodian_id = ?`);
    bindings.push(filters.recordCustodianId);
  }
  if (filters.discoveryLoadId !== undefined) {
    clauses.push(`${REVIEW_DOCUMENT_TABLE}.discovery_load_id = ?`);
    bindings.push(filters.discoveryLoadId);
  }
  if (filters.familyId !== undefined) {
    clauses.push(`${REVIEW_DOCUMENT_TABLE}.family_id = ?`);
    bindings.push(filters.familyId);
  }
  if (filters.processingState !== undefined) {
    clauses.push(`${REVIEW_DOCUMENT_TABLE}.processing_state = ?`);
    bindings.push(filters.processingState);
  }
  if (filters.exceptionCode !== undefined) {
    // EXISTS rather than a join: a document with two exceptions of the same code would be returned
    // twice by a join, and a page that can contain the same document twice is a page whose size means
    // nothing. The subquery reads the (review_document_id) index the exception table already carries.
    clauses.push(
      `EXISTS (SELECT 1 FROM ${REVIEW_DOCUMENT_EXCEPTION_TABLE} AS filtered_exception ` +
        `WHERE filtered_exception.review_document_id = ${REVIEW_DOCUMENT_TABLE}.id ` +
        `AND filtered_exception.code = ?)`,
    );
    bindings.push(filters.exceptionCode);
  }
  return clauses;
}

function reviewDocumentPageStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  filters: ReviewDocumentListFilters,
  cursor: ReviewDocumentListCursor | undefined,
  limit: number,
  segment: Segment,
): SqlStatement {
  // Positional `?` placeholders throughout, never numbered ones, and every binding is pushed in the
  // order its clause is appended. The access predicate's own fragment carries a bare `?`, so mixing a
  // numbered scheme in would silently renumber that one the moment a filter was added.
  const bindings: unknown[] = [reviewSetId];
  const clauses = [`${REVIEW_DOCUMENT_TABLE}.review_set_id = ?`];
  clauses.push(
    segment === "dated"
      ? `${REVIEW_DOCUMENT_TABLE}.sort_date IS NOT NULL`
      : `${REVIEW_DOCUMENT_TABLE}.sort_date IS NULL`,
  );
  clauses.push(...filterClauses(filters, bindings));

  if (cursor !== undefined) {
    if (segment === "dated" && cursor.sortDate !== null) {
      // A ROW VALUE, not the equivalent `a < ? OR (a = ? AND b < ?)`. The two mean the same thing and
      // cost differently by an order of magnitude: SQLite turns a row-value comparison into a seek on
      // the matching index and turns the OR form into a scan from the end of the index down to the
      // cursor. At a quarter-million documents that is the difference between a page and a walk of
      // half the corpus — measured, in packages/fixtures/src/load-profile/discovery-measurements.ts.
      // Both columns are non-null in this segment, which is what makes the row value well-defined.
      clauses.push(`(${REVIEW_DOCUMENT_TABLE}.sort_date, ${REVIEW_DOCUMENT_TABLE}.id) < (?, ?)`);
      bindings.push(cursor.sortDate, cursor.id);
    } else if (segment === "undated" && cursor.sortDate === null) {
      clauses.push(`${REVIEW_DOCUMENT_TABLE}.id < ?`);
      bindings.push(cursor.id);
    }
    // A dated cursor asking for the undated segment takes no cursor clause at all: the tail has not
    // been entered yet, so it starts at its own beginning. An undated cursor asking for the dated
    // segment cannot happen — the reader stops asking for dated rows once the tail is entered.
  }

  // The access predicate goes in LAST among the WHERE clauses and always BEFORE the LIMIT, so the
  // page is filled from rows the member may see rather than filled and then thinned.
  clauses.push(access.fragmentFor(`${REVIEW_DOCUMENT_TABLE}.review_set_id`));
  bindings.push(...access.bindings);
  bindings.push(limit);

  return database
    .prepare(
      `SELECT ${LIST_COLUMNS} FROM ${REVIEW_DOCUMENT_TABLE} WHERE ${clauses.join(" AND ")} ` +
        `ORDER BY ${REVIEW_DOCUMENT_TABLE}.sort_date DESC, ${REVIEW_DOCUMENT_TABLE}.id DESC ` +
        `LIMIT ?`,
    )
    .bind(...bindings);
}

// The dated segment of the list page: documents whose date is known, newest first.
export function selectReviewDocumentPageStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  filters: ReviewDocumentListFilters,
  cursor: ReviewDocumentListCursor | undefined,
  limit: number,
): SqlStatement {
  return reviewDocumentPageStatement(
    database,
    reviewSetId,
    access,
    filters,
    cursor,
    limit,
    "dated",
  );
}

// The undated tail: documents a production gave no date for. Its own statement so each segment is a
// clean index range rather than one predicate the planner cannot use.
export function selectUndatedReviewDocumentPageStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  filters: ReviewDocumentListFilters,
  cursor: ReviewDocumentListCursor | undefined,
  limit: number,
): SqlStatement {
  return reviewDocumentPageStatement(
    database,
    reviewSetId,
    access,
    filters,
    cursor,
    limit,
    "undated",
  );
}

export interface ReviewDocumentPage {
  readonly documents: readonly ReviewDocumentListRow[];
  // Null on the final page. Present only when a row beyond the page was actually seen — the read asks
  // for one more than it returns, so a cursor is a fact about rows that exist rather than a guess from
  // a full page.
  readonly nextCursor: ReviewDocumentListCursor | null;
}

// One page of the list, across both segments.
//
// The dated segment is drained first and the undated tail continues it, so a caller sees one
// continuous newest-first walk and never has to know the corpus holds two shapes of date.
export async function readReviewDocumentPage(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  filters: ReviewDocumentListFilters,
  cursor: ReviewDocumentListCursor | undefined,
  pageSize: number,
): Promise<ReviewDocumentPage> {
  // One more than the page, as the has-more probe. Split across two segments it is still one extra
  // row overall, because the tail is only asked for what the dated segment did not fill.
  const wanted = pageSize + 1;
  const documents: ReviewDocumentListRow[] = [];
  const inUndatedTail = cursor !== undefined && cursor.sortDate === null;

  if (!inUndatedTail) {
    const { results } = await selectReviewDocumentPageStatement(
      database,
      reviewSetId,
      access,
      filters,
      cursor,
      wanted,
    ).all<ReviewDocumentListRow>();
    documents.push(...results);
  }

  if (documents.length < wanted) {
    const { results } = await selectUndatedReviewDocumentPageStatement(
      database,
      reviewSetId,
      access,
      filters,
      inUndatedTail ? cursor : undefined,
      wanted - documents.length,
    ).all<ReviewDocumentListRow>();
    documents.push(...results);
  }

  const hasMore = documents.length > pageSize;
  const page = hasMore ? documents.slice(0, pageSize) : documents;
  const last = page.at(-1);
  return {
    documents: page,
    nextCursor: hasMore && last !== undefined ? { sortDate: last.sort_date, id: last.id } : null,
  };
}

// ---------------------------------------------------------------------------------------------
// The exception report read

export interface ReviewSetExceptionRow {
  readonly exception_id: string;
  readonly review_document_id: ReviewDocumentId;
  readonly discovery_load_id: DiscoveryLoadId;
  readonly stage: ReviewDocumentExceptionStage;
  readonly code: ReviewDocumentExceptionCode;
  readonly detail: string | null;
  readonly created_at: string;
  readonly record_custodian_id: RecordCustodianId;
  readonly source_name: string | null;
  readonly processing_state: ReviewDocumentProcessingState;
}

// One page of the whole review set's exceptions — the live read behind the exception surface, as
// distinct from the per-load report artifact written once at completion.
//
// KEYSET ON THE PAIR, never on the document alone. Several reasons on one document is normal — a
// container that was both encrypted and oversize — so a page boundary can fall inside one document,
// and resuming from the document would skip every reason after the boundary. A dropped reason reads
// as a document that had no trouble, which is the one thing a record about absence must never say.
export function selectReviewSetExceptionPageStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  afterDocumentId: string | null,
  afterExceptionId: string | null,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT exception.id AS exception_id, ` +
        `exception.review_document_id AS review_document_id, ` +
        `exception.discovery_load_id AS discovery_load_id, exception.stage AS stage, ` +
        `exception.code AS code, exception.detail AS detail, ` +
        `exception.created_at AS created_at, ` +
        `document.record_custodian_id AS record_custodian_id, ` +
        `document.source_name AS source_name, document.processing_state AS processing_state ` +
        `FROM ${REVIEW_DOCUMENT_EXCEPTION_TABLE} AS exception ` +
        `JOIN ${REVIEW_DOCUMENT_TABLE} AS document ON document.id = exception.review_document_id ` +
        `WHERE exception.review_set_id = ? ` +
        `AND (exception.review_document_id > ? ` +
        `OR (exception.review_document_id = ? AND exception.id > ?)) ` +
        `AND ${access.fragmentFor("exception.review_set_id")} ` +
        `ORDER BY exception.review_document_id ASC, exception.id ASC LIMIT ?`,
    )
    .bind(
      reviewSetId,
      afterDocumentId ?? "",
      afterDocumentId ?? "",
      afterExceptionId ?? "",
      ...access.bindings,
      limit,
    );
}

export async function readReviewSetExceptionPage(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
  afterDocumentId: string | null,
  afterExceptionId: string | null,
  limit: number,
): Promise<ReviewSetExceptionRow[]> {
  const { results } = await selectReviewSetExceptionPageStatement(
    database,
    reviewSetId,
    access,
    afterDocumentId,
    afterExceptionId,
    limit,
  ).all<ReviewSetExceptionRow>();
  return results;
}

export interface ReviewSetExceptionCodeCount {
  readonly code: ReviewDocumentExceptionCode;
  readonly document_count: number;
}

// The counts-by-code the exception surface leads with: one indexed group-by against
// (review_set_id, code). DISTINCT on the document, because a document with two reasons is one document
// with a problem and not two.
export function selectVisibleExceptionCountsStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): SqlStatement {
  return database
    .prepare(
      `SELECT code, COUNT(DISTINCT review_document_id) AS document_count ` +
        `FROM ${REVIEW_DOCUMENT_EXCEPTION_TABLE} WHERE review_set_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_EXCEPTION_TABLE}.review_set_id`)} ` +
        `GROUP BY code ORDER BY code ASC`,
    )
    .bind(reviewSetId, ...access.bindings);
}

export async function readVisibleExceptionCounts(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  access: ReviewSetAccessPredicate,
): Promise<ReviewSetExceptionCodeCount[]> {
  const { results } = await selectVisibleExceptionCountsStatement(
    database,
    reviewSetId,
    access,
  ).all<ReviewSetExceptionCodeCount>();
  return results;
}

// ---------------------------------------------------------------------------------------------
// The occurrence read

export interface ReviewDocumentOccurrenceListRow {
  readonly id: string;
  readonly primary_review_document_id: ReviewDocumentId;
  readonly duplicate_review_document_id: ReviewDocumentId;
  readonly record_custodian_id: RecordCustodianId;
  readonly discovery_load_id: DiscoveryLoadId;
  readonly created_at: string;
}

// "WHICH CUSTODIANS HELD THIS DOCUMENT" — the question asked under oath, and the reason deduplication
// keeps the duplicate row instead of deleting it. One indexed read against
// (review_set_id, primary_review_document_id), bounded, with the access predicate composed so a
// member off the list learns nothing about a corpus they cannot see.
export function selectVisibleOccurrencesStatement(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  primaryReviewDocumentId: ReviewDocumentId,
  access: ReviewSetAccessPredicate,
  limit: number,
  cursor?: SortCursor,
): SqlStatement {
  const bindings: unknown[] = [reviewSetId, primaryReviewDocumentId, ...access.bindings];
  const cursorClause = keysetClause(bindings, cursor, "duplicate_review_document_id", "id", true);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT id, primary_review_document_id, duplicate_review_document_id, record_custodian_id, ` +
        `discovery_load_id, created_at FROM ${REVIEW_DOCUMENT_OCCURRENCE_TABLE} ` +
        `WHERE review_set_id = ? AND primary_review_document_id = ? ` +
        `AND ${access.fragmentFor(`${REVIEW_DOCUMENT_OCCURRENCE_TABLE}.review_set_id`)} ` +
        cursorClause +
        // The occurrence row's own id joins the sort key. The duplicate identifier alone was already
        // unique per primary, so this changes no order that exists today; it makes the order TOTAL by
        // construction, which is what a keyset needs and what a future second row for one duplicate
        // would otherwise quietly break.
        `ORDER BY duplicate_review_document_id ASC, id ASC LIMIT ?`,
    )
    .bind(...bindings);
}

/**
 * Which custodians held this document, a page at a time.
 *
 * Paged rather than capped because the answer's size is the corpus's to choose, not the caller's: a
 * boilerplate signature block or a company-wide announcement is held by every record custodian in
 * the matter, and that is precisely the document whose occurrence list is asked about under oath.
 */
export async function readVisibleOccurrences(
  database: SqlDatabase,
  reviewSetId: ReviewSetId,
  primaryReviewDocumentId: ReviewDocumentId,
  access: ReviewSetAccessPredicate,
  pageSize: number,
  cursor?: string,
): Promise<Page<ReviewDocumentOccurrenceListRow>> {
  const { results } = await selectVisibleOccurrencesStatement(
    database,
    reviewSetId,
    primaryReviewDocumentId,
    access,
    // One more than the page, as the has-more probe.
    pageSize + 1,
    decodeCursor(cursor),
  ).all<ReviewDocumentOccurrenceListRow>();
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows,
    nextCursor:
      hasMore && last !== undefined
        ? encodeCursor(last.duplicate_review_document_id, last.id)
        : null,
  };
}

// ---------------------------------------------------------------------------------------------
// The registry the visibility fitness pass enumerates.
//
// Every builder above is here, and the fitness test scans this file's source to prove the list has not
// fallen behind it — so a read added tomorrow is held to the wall without anybody remembering.

export interface AccessScopedReviewRead {
  readonly key: string;
  readonly pages: boolean;
  readonly build: (database: SqlDatabase, access: ReviewSetAccessPredicate) => SqlStatement;
}

const SAMPLE_MATTER = "matter_visibilitySample000000" as MatterId;
const SAMPLE_REVIEW_SET = "reviewSet_visibilitySample00000000" as ReviewSetId;
const SAMPLE_LOAD = "discoveryLoad_visibilitySample000000" as DiscoveryLoadId;
const SAMPLE_DOCUMENT = "reviewDocument_visibilitySample000000" as ReviewDocumentId;

export const ACCESS_SCOPED_REVIEW_READS: readonly AccessScopedReviewRead[] = [
  {
    key: "selectVisibleReviewSetsForMatter",
    pages: true,
    build: (database, access) =>
      selectVisibleReviewSetsForMatterStatement(database, SAMPLE_MATTER, access, 50),
  },
  {
    key: "selectVisibleReviewSets",
    pages: true,
    build: (database, access) => selectVisibleReviewSetsStatement(database, access, 50),
  },
  {
    key: "selectVisibleReviewSet",
    pages: true,
    build: (database, access) =>
      selectVisibleReviewSetStatement(database, SAMPLE_REVIEW_SET, access),
  },
  {
    key: "selectVisibleDiscoveryLoad",
    pages: true,
    build: (database, access) => selectVisibleDiscoveryLoadStatement(database, SAMPLE_LOAD, access),
  },
  {
    key: "selectVisibleDiscoveryLoads",
    pages: true,
    build: (database, access) =>
      selectVisibleDiscoveryLoadsStatement(database, SAMPLE_REVIEW_SET, access, 50),
  },
  {
    key: "selectReviewDocumentPage",
    pages: true,
    build: (database, access) =>
      selectReviewDocumentPageStatement(
        database,
        SAMPLE_REVIEW_SET,
        access,
        { recordCustodianId: "recordCustodian_visibilitySample00000" as RecordCustodianId },
        { sortDate: "2026-01-01T00:00:00.000Z", id: SAMPLE_DOCUMENT },
        50,
      ),
  },
  {
    key: "selectUndatedReviewDocumentPage",
    pages: true,
    build: (database, access) =>
      selectUndatedReviewDocumentPageStatement(
        database,
        SAMPLE_REVIEW_SET,
        access,
        { exceptionCode: "encrypted" },
        { sortDate: null, id: SAMPLE_DOCUMENT },
        50,
      ),
  },
  {
    key: "selectReviewSetExceptionPage",
    pages: true,
    build: (database, access) =>
      selectReviewSetExceptionPageStatement(database, SAMPLE_REVIEW_SET, access, null, null, 50),
  },
  {
    key: "selectVisibleExceptionCounts",
    // An aggregate over the whole review set: it has no LIMIT, and giving one to a group-by over a
    // closed fifteen-code vocabulary would be a cap that can only ever hide a code.
    pages: false,
    build: (database, access) =>
      selectVisibleExceptionCountsStatement(database, SAMPLE_REVIEW_SET, access),
  },
  {
    key: "selectVisibleOccurrences",
    pages: true,
    build: (database, access) =>
      selectVisibleOccurrencesStatement(database, SAMPLE_REVIEW_SET, SAMPLE_DOCUMENT, access, 50),
  },
];
