import { askableTerm, likePattern, LIKE_ESCAPE_CLAUSE } from "@magna-carta/data-access/like-search";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DocumentTemplateId,
  DocumentTemplateVersionId,
  LocationId,
  MatterTypeId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { TemplateKind } from "./types.ts";

// The template catalogue's reads and writes. Table names are tracked against @magna-carta/database's
// per-firm schema by the schema-name-sync fitness test; both tables exist only in the per-firm database,
// so the caller supplies that handle and no query here can reach across firms.

export const DOCUMENT_TEMPLATE_TABLE = "document_template";
export const DOCUMENT_TEMPLATE_VERSION_TABLE = "document_template_version";

export type TemplateStatus = "active" | "archived";
export type TemplateVersionStatus = "pending" | "clean" | "quarantined" | "abandoned";

export interface InsertDocumentTemplateRow {
  readonly id: DocumentTemplateId;
  readonly name: string;
  readonly description: string | null;
  readonly matterTypeId: MatterTypeId | null;
  readonly locationId: LocationId | null;
  readonly createdBy: UserId | null;
  readonly createdAt: string;
}

export function insertDocumentTemplateStatement(
  database: SqlDatabase,
  row: InsertDocumentTemplateRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DOCUMENT_TEMPLATE_TABLE} (id, name, description, matter_type_id, location_id, status, current_version_id, created_by, archived_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'active', NULL, ?6, NULL, ?7, ?7)`,
    )
    .bind(
      row.id,
      row.name,
      row.description,
      row.matterTypeId,
      row.locationId,
      row.createdBy,
      row.createdAt,
    );
}

export interface InsertDocumentTemplateVersionRow {
  readonly id: DocumentTemplateVersionId;
  readonly templateId: DocumentTemplateId;
  readonly versionNumber: number;
  // Which engine fills this version in. Bound explicitly rather than defaulted, so a caller that
  // registers a fillable PDF cannot store it as a word-processing package by forgetting to say.
  readonly kind: TemplateKind;
  readonly r2Key: string;
  readonly sizeBytes: number;
  readonly contentSha256: string;
  readonly fieldManifestJson: string;
  readonly normalizationWarningsJson: string;
  readonly normalizerVersion: number;
  readonly macroPartsRemoved: number;
  readonly createdBy: UserId | null;
  readonly createdAt: string;
}

// A version is minted `pending`. It reaches `clean` only through the ingest gate over its stored bytes —
// the same gate every uploaded byte in the platform crosses — and a version that is not `clean` is never
// assembled from.
export function insertDocumentTemplateVersionStatement(
  database: SqlDatabase,
  row: InsertDocumentTemplateVersionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${DOCUMENT_TEMPLATE_VERSION_TABLE} (id, template_id, version_number, kind, r2_key, size_bytes, content_sha256, storage_encoding, storage_class, status, field_manifest_json, normalization_warnings_json, normalizer_version, macro_parts_removed, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'full', 'standard', 'pending', ?8, ?9, ?10, ?11, ?12, ?13)`,
    )
    .bind(
      row.id,
      row.templateId,
      row.versionNumber,
      row.kind,
      row.r2Key,
      row.sizeBytes,
      row.contentSha256,
      row.fieldManifestJson,
      row.normalizationWarningsJson,
      row.normalizerVersion,
      row.macroPartsRemoved,
      row.createdBy,
      row.createdAt,
    );
}

export const DOCUMENT_TEMPLATE_FIELD_BINDING_TABLE = "document_template_field_binding";

// The binding index rows for one version: one per DISTINCT merge key its manifest names, written in the
// SAME BATCH as the version itself.
//
// A template version is immutable, so a row derived from it and committed with it can never disagree
// with it — there is no update path here and no staleness mode, which is precisely what makes an index
// acceptable where the alternative was `instr()` over every stored manifest. A rolled-back registration
// leaves no bindings behind, for the same reason it leaves no version behind.
//
// One statement per key rather than one multi-row insert: the batch chokepoint takes statements, the
// count is bounded by the manifest the registration already refused to exceed, and a single statement
// whose SQL shape depends on the key count would defeat the prepared-statement cache for every distinct
// template size a firm registers.
export function insertTemplateFieldBindingStatements(
  database: SqlDatabase,
  templateVersionId: DocumentTemplateVersionId,
  mergeKeys: readonly string[],
): SqlStatement[] {
  const distinct = [...new Set(mergeKeys)].sort();
  return distinct.map((mergeKey) =>
    database
      .prepare(
        `INSERT INTO ${DOCUMENT_TEMPLATE_FIELD_BINDING_TABLE} (template_version_id, merge_key) VALUES (?1, ?2)`,
      )
      .bind(templateVersionId, mergeKey),
  );
}

// Every registered version that binds one merge key. The read behind "where is this field used", and
// behind the guard that refuses to destroy a firm's own field a template names — an index seek on
// `merge_key`, never a scan over stored manifests.
export function selectTemplateVersionsBindingKeyStatement(
  database: SqlDatabase,
  mergeKey: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT template_version_id FROM ${DOCUMENT_TEMPLATE_FIELD_BINDING_TABLE} WHERE merge_key = ?1 ORDER BY template_version_id`,
    )
    .bind(mergeKey);
}

// Move the catalogue row's pointer to a version that has cleared the gate. Guarded on the version being
// clean IN THE STATEMENT rather than only in the caller: a version whose scan verdict changed between
// the caller's read and this commit must not become the version every assembly of this template uses.
export function setCurrentTemplateVersionStatement(
  database: SqlDatabase,
  templateId: DocumentTemplateId,
  versionId: DocumentTemplateVersionId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_TEMPLATE_TABLE} SET current_version_id = ?2, updated_at = ?3 WHERE id = ?1 AND EXISTS (SELECT 1 FROM ${DOCUMENT_TEMPLATE_VERSION_TABLE} WHERE id = ?2 AND template_id = ?1 AND status = 'clean')`,
    )
    .bind(templateId, versionId, updatedAt);
}

export function markTemplateVersionCleanStatement(
  database: SqlDatabase,
  versionId: DocumentTemplateVersionId,
  scanVerdict: string,
  scanEngineVersion: string | null,
  scanDetail: string | null,
  committedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_TEMPLATE_VERSION_TABLE} SET status = 'clean', scan_verdict = ?2, scan_engine_version = ?3, scan_detail = ?4, committed_at = ?5 WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(versionId, scanVerdict, scanEngineVersion, scanDetail, committedAt);
}

// A version whose bytes the scan engine flagged never becomes assemblable. The row stays — a refused
// registration is itself something a firm has to be able to explain — but the status ladder stops it at
// `quarantined`, which is the same gate a flagged file version stops at.
export function markTemplateVersionQuarantinedStatement(
  database: SqlDatabase,
  versionId: DocumentTemplateVersionId,
  scanDetail: string | null,
  scanEngineVersion: string | null,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_TEMPLATE_VERSION_TABLE} SET status = 'quarantined', scan_verdict = 'flagged', scan_detail = ?2, scan_engine_version = ?3 WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(versionId, scanDetail, scanEngineVersion);
}

// Soft-archive, never a delete: a template that produced a filed document has to remain explicable, so
// the row stays and only its status moves.
export function archiveDocumentTemplateStatement(
  database: SqlDatabase,
  templateId: DocumentTemplateId,
  archivedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${DOCUMENT_TEMPLATE_TABLE} SET status = 'archived', archived_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'active'`,
    )
    .bind(templateId, archivedAt);
}

// One home for the catalogue projection and its row mapping, so every read of this table returns the
// same shape and a new column cannot be added to one query and forgotten in another.
const SELECT_TEMPLATE_COLUMNS = `SELECT id, name, description, matter_type_id, location_id, status, current_version_id, created_at, updated_at FROM ${DOCUMENT_TEMPLATE_TABLE}`;

export interface DocumentTemplateRow {
  readonly id: DocumentTemplateId;
  readonly name: string;
  readonly description: string | null;
  readonly matterTypeId: MatterTypeId | null;
  readonly locationId: LocationId | null;
  readonly status: TemplateStatus;
  readonly currentVersionId: DocumentTemplateVersionId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface DocumentTemplateColumns {
  id: string;
  name: string;
  description: string | null;
  matter_type_id: string | null;
  location_id: string | null;
  status: string;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

function toDocumentTemplateRow(row: DocumentTemplateColumns): DocumentTemplateRow {
  return {
    id: row.id as DocumentTemplateId,
    name: row.name,
    description: row.description,
    matterTypeId: row.matter_type_id as MatterTypeId | null,
    locationId: row.location_id as LocationId | null,
    status: row.status as TemplateStatus,
    currentVersionId: row.current_version_id as DocumentTemplateVersionId | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function readDocumentTemplate(
  database: SqlDatabase,
  templateId: DocumentTemplateId,
): Promise<DocumentTemplateRow | undefined> {
  const { results } = await database
    .prepare(`${SELECT_TEMPLATE_COLUMNS} WHERE id = ?1`)
    .bind(templateId)
    .all<DocumentTemplateColumns>();
  const row = results[0];
  return row === undefined ? undefined : toDocumentTemplateRow(row);
}

export interface ListTemplatesParams {
  readonly status?: TemplateStatus;
  readonly matterTypeId?: MatterTypeId;
  /** A reader's text, matched anywhere in the name or the description. Blank means unfiltered. */
  readonly search?: string;
  readonly limit: number;
  // Keyset cursor: the (name, id) pair of the last row of the previous page. Names are not unique, so
  // the id is the tiebreaker that keeps the page boundary stable when two templates share a name.
  readonly afterName?: string;
  readonly afterId?: string;
}

// The catalogue list's statement. Filters on status and sorts by name, which is exactly what the
// (status, name) index covers, so this is an index walk rather than a scan even at the top of the
// expected range (a few hundred templates per firm). Split out from the read below so the load-profile
// harness's EXPLAIN probe runs the REAL query rather than a copy of it that could drift.
export function listDocumentTemplatesStatement(
  database: SqlDatabase,
  params: ListTemplatesParams,
): SqlStatement {
  const status = params.status ?? "active";
  const conditions = ["status = ?1"];
  const bindings: unknown[] = [status];
  if (params.matterTypeId !== undefined) {
    bindings.push(params.matterTypeId);
    conditions.push(`(matter_type_id IS NULL OR matter_type_id = ?${bindings.length})`);
  }
  // A contains-match over the two things a person calls a template by. It is a scan within the
  // status the index walk narrowed to, which is a bounded cost at a few hundred templates per firm;
  // the pattern is escaped so a reader's own `%` or `_` is text, never a wildcard.
  const term = askableTerm(params.search);
  if (term !== undefined) {
    bindings.push(likePattern(term));
    conditions.push(
      `(name LIKE ?${bindings.length} ${LIKE_ESCAPE_CLAUSE} OR description LIKE ?${bindings.length} ${LIKE_ESCAPE_CLAUSE})`,
    );
  }
  if (params.afterName !== undefined && params.afterId !== undefined) {
    bindings.push(params.afterName, params.afterId);
    conditions.push(`(name, id) > (?${bindings.length - 1}, ?${bindings.length})`);
  }
  bindings.push(params.limit);
  return database
    .prepare(
      `${SELECT_TEMPLATE_COLUMNS} WHERE ${conditions.join(" AND ")} ORDER BY name ASC, id ASC LIMIT ?${bindings.length}`,
    )
    .bind(...bindings);
}

export async function listDocumentTemplates(
  database: SqlDatabase,
  params: ListTemplatesParams,
): Promise<DocumentTemplateRow[]> {
  const { results } = await listDocumentTemplatesStatement(
    database,
    params,
  ).all<DocumentTemplateColumns>();
  return results.map(toDocumentTemplateRow);
}

export interface DocumentTemplateVersionRow {
  readonly id: DocumentTemplateVersionId;
  readonly templateId: DocumentTemplateId;
  readonly versionNumber: number;
  readonly kind: TemplateKind;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly contentSha256: string | null;
  readonly storageEncoding: string;
  readonly status: TemplateVersionStatus;
  readonly fieldManifestJson: string;
  readonly normalizationWarningsJson: string;
  readonly normalizerVersion: number;
  readonly macroPartsRemoved: number;
  readonly createdAt: string;
}

interface DocumentTemplateVersionColumns {
  id: string;
  template_id: string;
  version_number: number;
  kind: string;
  r2_key: string;
  size_bytes: number | null;
  content_sha256: string | null;
  storage_encoding: string;
  status: string;
  field_manifest_json: string;
  normalization_warnings_json: string;
  normalizer_version: number;
  macro_parts_removed: number;
  created_at: string;
}

const SELECT_VERSION_COLUMNS = `SELECT id, template_id, version_number, kind, r2_key, size_bytes, content_sha256, storage_encoding, status, field_manifest_json, normalization_warnings_json, normalizer_version, macro_parts_removed, created_at FROM ${DOCUMENT_TEMPLATE_VERSION_TABLE}`;

function toDocumentTemplateVersionRow(
  row: DocumentTemplateVersionColumns,
): DocumentTemplateVersionRow {
  return {
    id: row.id as DocumentTemplateVersionId,
    templateId: row.template_id as DocumentTemplateId,
    versionNumber: row.version_number,
    kind: row.kind as TemplateKind,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    contentSha256: row.content_sha256,
    storageEncoding: row.storage_encoding,
    status: row.status as TemplateVersionStatus,
    fieldManifestJson: row.field_manifest_json,
    normalizationWarningsJson: row.normalization_warnings_json,
    normalizerVersion: row.normalizer_version,
    macroPartsRemoved: row.macro_parts_removed,
    createdAt: row.created_at,
  };
}

export async function readDocumentTemplateVersion(
  database: SqlDatabase,
  versionId: DocumentTemplateVersionId,
): Promise<DocumentTemplateVersionRow | undefined> {
  const { results } = await database
    .prepare(`${SELECT_VERSION_COLUMNS} WHERE id = ?1`)
    .bind(versionId)
    .all<DocumentTemplateVersionColumns>();
  const row = results[0];
  return row === undefined ? undefined : toDocumentTemplateVersionRow(row);
}

// Everything one assembly needs to know about its template, in ONE read: the version's stored bytes'
// location and gate status, the field manifest that lets the assembly plan its merge reads before
// touching any XML, and the catalogue row's name (which the produced document is named from). Split
// across two reads it would be two round trips at the head of every job for facts that always travel
// together.
export interface TemplateVersionForAssembly {
  readonly versionId: DocumentTemplateVersionId;
  readonly templateId: DocumentTemplateId;
  readonly templateName: string;
  readonly templateStatus: TemplateStatus;
  readonly versionNumber: number;
  // Which engine fills this version in. Read at the head of every job and at submit, so neither the
  // route nor the consumer has to assume a word-processing package.
  readonly kind: TemplateKind;
  readonly r2Key: string;
  readonly contentSha256: string | null;
  readonly status: TemplateVersionStatus;
  readonly fieldManifestJson: string;
  readonly normalizerVersion: number;
}

// Split out from the read below for the same reason as the catalogue list's: the load-profile harness
// probes the REAL query rather than a copy that could drift out of step with it.
export function readTemplateVersionForAssemblyStatement(
  database: SqlDatabase,
  versionId: DocumentTemplateVersionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id AS id, v.template_id AS template_id, t.name AS template_name, t.status AS template_status, v.version_number AS version_number, v.kind AS kind, v.r2_key AS r2_key, v.content_sha256 AS content_sha256, v.status AS status, v.field_manifest_json AS field_manifest_json, v.normalizer_version AS normalizer_version FROM ${DOCUMENT_TEMPLATE_VERSION_TABLE} v JOIN ${DOCUMENT_TEMPLATE_TABLE} t ON t.id = v.template_id WHERE v.id = ?1`,
    )
    .bind(versionId);
}

export async function readTemplateVersionForAssembly(
  database: SqlDatabase,
  versionId: DocumentTemplateVersionId,
): Promise<TemplateVersionForAssembly | undefined> {
  const { results } = await readTemplateVersionForAssemblyStatement(database, versionId).all<{
    id: string;
    template_id: string;
    template_name: string;
    template_status: string;
    version_number: number;
    kind: string;
    r2_key: string;
    content_sha256: string | null;
    status: string;
    field_manifest_json: string;
    normalizer_version: number;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    versionId: row.id as DocumentTemplateVersionId,
    templateId: row.template_id as DocumentTemplateId,
    templateName: row.template_name,
    templateStatus: row.template_status as TemplateStatus,
    versionNumber: row.version_number,
    kind: row.kind as TemplateKind,
    r2Key: row.r2_key,
    contentSha256: row.content_sha256,
    status: row.status as TemplateVersionStatus,
    fieldManifestJson: row.field_manifest_json,
    normalizerVersion: row.normalizer_version,
  };
}

// Every R2 key any version row in this firm's catalogue names — the retention set a sweep collecting
// unnamed template objects out of a bucket has to complement. It mirrors listCleanVersionR2Keys in
// @magna-carta/file-manager, with one deliberate difference: NO status filter. That read feeds a
// STORAGE METER, which counts clean commits only; this one feeds a DELETE, and every status names
// bytes that are still the firm's. A pending version is a registration whose scan has not answered
// yet, a quarantined one is a refusal the firm has to be able to explain, and an abandoned one is a
// row somebody may still be reading. Only a key no row names at all is reclaimable.
//
// PAGED, and the paging is a safety property rather than an optimization. This whole set crosses one
// remote-procedure boundary in a single response, and the caller that reads it treats a FAILED read
// as "the retention set is incomplete, do nothing" — so a firm large enough to overflow one response
// would not merely slow the pass down, it would silently switch the pass off, every night, for the
// whole fleet. A keyset walk over `r2_key` bounds each response instead. The key is unique per
// version (the version identifier is in it), so ordering by it is total and no row can be skipped or
// repeated across pages.
export const TEMPLATE_VERSION_KEY_PAGE_SIZE = 1000;

export function listTemplateVersionR2KeysStatement(
  database: SqlDatabase,
  afterKey: string | null,
  limit: number,
): SqlStatement {
  return afterKey === null
    ? database
        .prepare(`SELECT r2_key FROM ${DOCUMENT_TEMPLATE_VERSION_TABLE} ORDER BY r2_key LIMIT ?1`)
        .bind(limit)
    : database
        .prepare(
          `SELECT r2_key FROM ${DOCUMENT_TEMPLATE_VERSION_TABLE} WHERE r2_key > ?1 ORDER BY r2_key LIMIT ?2`,
        )
        .bind(afterKey, limit);
}

export async function listTemplateVersionR2Keys(
  database: SqlDatabase,
  pageSize: number = TEMPLATE_VERSION_KEY_PAGE_SIZE,
): Promise<readonly string[]> {
  const keys: string[] = [];
  let afterKey: string | null = null;
  for (;;) {
    const page: { results: { r2_key: string }[] } = await listTemplateVersionR2KeysStatement(
      database,
      afterKey,
      pageSize,
    ).all<{ r2_key: string }>();
    const results = page.results;
    for (const row of results) keys.push(row.r2_key);
    if (results.length < pageSize) return keys;
    afterKey = results[results.length - 1]?.r2_key ?? null;
    // A full page whose last key is unreadable would otherwise restart the walk from the beginning
    // and never terminate. There is no such row — r2_key is NOT NULL — so this is the assertion that
    // it stays that way rather than a case to handle.
    if (afterKey === null) return keys;
  }
}

export async function readNextTemplateVersionNumber(
  database: SqlDatabase,
  templateId: DocumentTemplateId,
): Promise<number> {
  const { results } = await database
    .prepare(
      `SELECT MAX(version_number) AS n FROM ${DOCUMENT_TEMPLATE_VERSION_TABLE} WHERE template_id = ?1`,
    )
    .bind(templateId)
    .all<{ n: number | null }>();
  return (results[0]?.n ?? 0) + 1;
}
