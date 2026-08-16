import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DiscoveryLoadId,
  RecordCustodianId,
  ReviewDocumentId,
} from "@magna-carta/identifiers/types";
import { REVIEW_DOCUMENT_EXCEPTION_TABLE } from "./processing-statements.ts";
import { REVIEW_DOCUMENT_TABLE } from "./review-document-statements.ts";
import type {
  ReviewDocumentExceptionCode,
  ReviewDocumentExceptionStage,
  ReviewDocumentFamilyRole,
  ReviewDocumentProcessingState,
  ReviewDocumentSourceKind,
} from "./types.ts";

// THE TWO WALKS THE RECORD ARTIFACTS ARE BUILT FROM. Both are keyset-paged by identifier and both
// are ordered, and neither is negotiable on either count.
//
// KEYSET, NEVER OFFSET: a load at the ceiling is a quarter of a million rows, and an offset walk is
// quadratic in the corpus it is describing.
//
// ORDERED, BECAUSE THE ARTIFACT MUST BE REPRODUCIBLE. The manifest and the exception report are
// documents a firm hands to another party; the same load reported twice has to produce the same
// bytes, and an unordered read is a document whose row order is whatever the planner felt like. The
// order is the identifier, which is stable for the life of the row.

export interface ManifestDocumentRow {
  readonly id: ReviewDocumentId;
  readonly record_custodian_id: RecordCustodianId;
  readonly source_kind: ReviewDocumentSourceKind;
  readonly source_name: string | null;
  readonly source_path: string | null;
  readonly size_bytes: number | null;
  readonly content_md5: string | null;
  readonly content_sha1: string | null;
  readonly content_sha256: string | null;
  readonly family_id: ReviewDocumentId;
  readonly family_role: ReviewDocumentFamilyRole;
  readonly family_sequence: number;
  readonly page_count: number | null;
  readonly format_identified: string | null;
  readonly extraction_route: string | null;
  readonly pages_recognized: number | null;
  readonly text_fingerprint: string | null;
  readonly dedup_group_id: string | null;
  readonly is_dedup_primary: number;
  readonly processing_state: ReviewDocumentProcessingState;
  readonly sort_date: string | null;
  readonly sort_date_source: string | null;
}

const MANIFEST_DOCUMENT_COLUMNS =
  "id, record_custodian_id, source_kind, source_name, source_path, size_bytes, content_md5, " +
  "content_sha1, content_sha256, family_id, family_role, family_sequence, page_count, " +
  "format_identified, extraction_route, pages_recognized, text_fingerprint, dedup_group_id, " +
  "is_dedup_primary, processing_state, sort_date, sort_date_source";

// One page of the load's documents, in identifier order. Served by the
// (discovery_load_id, processing_state, id) index the dispatch walk already added — the state column
// sits between the two this read uses, so the index is a prefix scan rather than a table walk.
export function selectManifestDocumentPageStatement(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  afterId: string | null,
  limit: number,
): SqlStatement {
  return (
    database
      .prepare(
        `SELECT ${MANIFEST_DOCUMENT_COLUMNS} FROM ${REVIEW_DOCUMENT_TABLE} ` +
          `WHERE discovery_load_id = ?1 AND id > ?2 ORDER BY id ASC LIMIT ?3`,
      )
      // The empty string sorts below every identifier, so "from the beginning" and "resume here" are
      // the same statement rather than two.
      .bind(loadId, afterId ?? "", limit)
  );
}

export async function readManifestDocumentPage(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  afterId: string | null,
  limit: number,
): Promise<ManifestDocumentRow[]> {
  const { results } = await selectManifestDocumentPageStatement(
    database,
    loadId,
    afterId,
    limit,
  ).all<ManifestDocumentRow>();
  return results;
}

export interface LoadExceptionRow {
  readonly review_document_id: ReviewDocumentId;
  readonly exception_id: string;
  readonly stage: ReviewDocumentExceptionStage;
  readonly code: ReviewDocumentExceptionCode;
  readonly detail: string | null;
  readonly created_at: string;
  readonly record_custodian_id: RecordCustodianId;
  readonly source_name: string | null;
  readonly source_path: string | null;
  readonly format_identified: string | null;
  readonly family_id: ReviewDocumentId;
  readonly family_role: ReviewDocumentFamilyRole;
  readonly processing_state: ReviewDocumentProcessingState;
  readonly is_dedup_primary: number;
}

// One page of the load's exceptions, each carrying enough of its document that the report needs no
// second read per row. Ordered by document and then by the exception's own identifier, because
// several reasons on one document is normal — a container that was both encrypted and oversize — and
// each of them is a different sentence.
//
// The join is to `review_document` rather than the other way round because the driving filter is the
// load, which this table now carries directly: the (discovery_load_id, review_document_id) index
// serves the walk, and the document is probed by primary key.
// The walk is keyed on the PAIR, not on the document, and that is a correctness rule rather than a
// refinement: several reasons on one document is normal, so a page boundary can fall in the middle of
// one. Resuming from the document alone would skip the reasons after the boundary, and a dropped
// reason reads as a document that had no trouble — the one thing a report about absence must never
// say.
export function selectLoadExceptionPageStatement(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  afterDocumentId: string | null,
  afterExceptionId: string | null,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT exception.review_document_id AS review_document_id, ` +
        `exception.id AS exception_id, exception.stage AS stage, exception.code AS code, ` +
        `exception.detail AS detail, exception.created_at AS created_at, ` +
        `document.record_custodian_id AS record_custodian_id, ` +
        `document.source_name AS source_name, document.source_path AS source_path, ` +
        `document.format_identified AS format_identified, document.family_id AS family_id, ` +
        `document.family_role AS family_role, document.processing_state AS processing_state, ` +
        `document.is_dedup_primary AS is_dedup_primary ` +
        `FROM ${REVIEW_DOCUMENT_EXCEPTION_TABLE} AS exception ` +
        `JOIN ${REVIEW_DOCUMENT_TABLE} AS document ON document.id = exception.review_document_id ` +
        `WHERE exception.discovery_load_id = ?1 ` +
        `AND (exception.review_document_id > ?2 ` +
        `OR (exception.review_document_id = ?2 AND exception.id > ?3)) ` +
        `ORDER BY exception.review_document_id ASC, exception.id ASC LIMIT ?4`,
    )
    .bind(loadId, afterDocumentId ?? "", afterExceptionId ?? "", limit);
}

export async function readLoadExceptionPage(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
  afterDocumentId: string | null,
  afterExceptionId: string | null,
  limit: number,
): Promise<LoadExceptionRow[]> {
  const { results } = await selectLoadExceptionPageStatement(
    database,
    loadId,
    afterDocumentId,
    afterExceptionId,
    limit,
  ).all<LoadExceptionRow>();
  return results;
}

// Which engines read this load's documents, as the corpus recorded them on the rows. One aggregate
// over a closed four-name vocabulary, so the answer is a handful of rows however large the load is —
// and it is drawn from the documents rather than from what happened to be bound at deploy time,
// because what read a document is a fact about the document.
export function selectLoadExtractionRoutesStatement(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
): SqlStatement {
  return database
    .prepare(
      `SELECT DISTINCT extraction_route FROM ${REVIEW_DOCUMENT_TABLE} ` +
        `WHERE discovery_load_id = ?1 AND extraction_route IS NOT NULL ` +
        `ORDER BY extraction_route ASC`,
    )
    .bind(loadId);
}

export async function readLoadExtractionRoutes(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
): Promise<string[]> {
  const { results } = await selectLoadExtractionRoutesStatement(database, loadId).all<{
    extraction_route: string;
  }>();
  const engines = new Set<string>();
  for (const row of results) {
    for (const engine of row.extraction_route.split(",")) if (engine !== "") engines.add(engine);
  }
  return [...engines].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export interface LoadExceptionCodeCount {
  readonly code: ReviewDocumentExceptionCode;
  readonly document_count: number;
}

// The report's spine: how many DOCUMENTS carry each code in this load. Distinct on the document,
// because a document with two reasons is one document with a problem rather than two — a report that
// counted rows would overstate the corpus's trouble to opposing counsel, which is a different kind
// of wrong from understating it and no better.
export function selectLoadExceptionCountsByCodeStatement(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
): SqlStatement {
  return database
    .prepare(
      `SELECT code, COUNT(DISTINCT review_document_id) AS document_count ` +
        `FROM ${REVIEW_DOCUMENT_EXCEPTION_TABLE} WHERE discovery_load_id = ?1 ` +
        `GROUP BY code ORDER BY code ASC`,
    )
    .bind(loadId);
}

export async function readLoadExceptionCountsByCode(
  database: SqlDatabase,
  loadId: DiscoveryLoadId,
): Promise<LoadExceptionCodeCount[]> {
  const { results } = await selectLoadExceptionCountsByCodeStatement(
    database,
    loadId,
  ).all<LoadExceptionCodeCount>();
  return results;
}
