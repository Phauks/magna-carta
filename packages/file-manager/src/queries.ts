import {
  appendCursorPredicate,
  assemblePage,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { FILE_TABLE, FILE_VERSION_TABLE } from "./file-statements.ts";
import { FOLDER_TABLE } from "./folder-statements.ts";

// Read mediation (golden rule 3): every consumer read serves only clean, non-deleted content. A file
// is visible once it has a clean current version (current_version_id, set only on commit); a version
// read filters status = 'clean'. The pending/quarantined gate is enforced HERE, not by a key scheme.
// The cursor-paginated list draws its keyset toolkit from @magna-carta/data-access/cursor-pagination.
export type { Page };

export interface ListFilesFilters {
  readonly matterId: MatterId;
  readonly folderId?: FolderId;
  readonly includeDeleted?: boolean; // the recovery view; default false
}

export function listFilesStatement(
  database: SqlDatabase,
  filters: ListFilesFilters,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  // current_version_id IS NOT NULL is the visibility gate — it is set only when a version commits
  // clean, so pending/quarantined-only files never appear.
  const conditions = ["matter_id = ?", "current_version_id IS NOT NULL"];
  const bindings: unknown[] = [filters.matterId];
  if (filters.folderId !== undefined) {
    conditions.push("folder_id = ?");
    bindings.push(filters.folderId);
  }
  if (filters.includeDeleted !== true) {
    conditions.push("deleted_at IS NULL");
  }
  appendCursorPredicate(conditions, bindings, cursor);
  bindings.push(limit);
  return database
    .prepare(
      `SELECT id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at FROM ${FILE_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

interface FileRowRaw {
  id: FileId;
  matter_id: MatterId;
  folder_id: FolderId | null;
  name: string;
  document_type_id: DocumentTypeId | null;
  current_version_id: FileVersionId | null;
  deleted_at: string | null;
  created_at: string;
}

export interface FileListItem {
  readonly id: FileId;
  readonly matterId: MatterId;
  readonly folderId: FolderId | null;
  readonly name: string;
  readonly documentTypeId: DocumentTypeId | null;
  readonly currentVersionId: FileVersionId | null;
  readonly deletedAt: string | null;
  readonly createdAt: string;
}

function toFileListItem(row: FileRowRaw): FileListItem {
  return {
    id: row.id,
    matterId: row.matter_id,
    folderId: row.folder_id,
    name: row.name,
    documentTypeId: row.document_type_id,
    currentVersionId: row.current_version_id,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
  };
}

export interface ListFilesParams extends ListFilesFilters {
  readonly cursor?: string;
  readonly pageSize?: number;
}

export async function listFiles(
  database: SqlDatabase,
  params: ListFilesParams,
): Promise<Page<FileListItem>> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
  const { results } = await listFilesStatement(
    database,
    params,
    decodeCursor(params.cursor),
    pageSize + 1,
  ).all<FileRowRaw>();
  return assemblePage(results, pageSize, toFileListItem);
}

// The clean current version of a non-deleted file — for the signed-download path (r2_key) and the
// ZIP selection. Returns nothing for a deleted file or one without a committed version.
export function selectCurrentCleanVersionStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id, v.r2_key, v.size_bytes, v.version_number, v.scan_verdict, v.scan_detail FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
    )
    .bind(fileId);
}

export interface CleanVersion {
  readonly id: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly versionNumber: number;
  // The committed version's scan verdict + detail. A re-scan can flag an ALREADY-committed (still
  // visible) version `flagged` without hiding it (informed access) — so the download path must read
  // the verdict here and gate a flagged version, rather than assume status='clean' means safe.
  readonly scanVerdict: "unscanned" | "clean" | "flagged" | null;
  readonly scanDetail: string | null;
}

export async function getCurrentCleanVersion(
  database: SqlDatabase,
  fileId: FileId,
): Promise<CleanVersion | undefined> {
  const { results } = await selectCurrentCleanVersionStatement(database, fileId).all<{
    id: FileVersionId;
    r2_key: string;
    size_bytes: number | null;
    version_number: number;
    scan_verdict: "unscanned" | "clean" | "flagged" | null;
    scan_detail: string | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    versionNumber: row.version_number,
    scanVerdict: row.scan_verdict,
    scanDetail: row.scan_detail,
  };
}

// The preview gate's single read: the same clean, non-deleted current version as the download path,
// widened with the verdict + storage facts decidePreview keys off. A new sibling (not an edit to
// getCurrentCleanVersion) so the status-gated read it mirrors stays untouched. status = 'clean' and
// deleted_at IS NULL are preserved — a pending/quarantined/deleted version is never previewable.
export function selectCurrentCleanVersionForPreviewStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id, v.r2_key, v.size_bytes, v.version_number, v.inline_playable, v.storage_class, v.storage_encoding, v.sniffed_content_type, v.artifact_role, v.scan_verdict FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
    )
    .bind(fileId);
}

export interface CleanVersionForPreview {
  readonly id: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly versionNumber: number;
  readonly inlinePlayable: "playable" | "download-only" | "indeterminate" | null;
  readonly storageClass: string;
  readonly storageEncoding: string;
  readonly sniffedContentType: string | null;
  readonly artifactRole: string;
  // A re-scan can flag an already-committed (still-clean-status) version; the preview gate reads
  // it here so a flagged version is always download-only regardless of inline_playable.
  readonly scanVerdict: "unscanned" | "clean" | "flagged" | null;
}

export async function getCurrentCleanVersionForPreview(
  database: SqlDatabase,
  fileId: FileId,
): Promise<CleanVersionForPreview | undefined> {
  const { results } = await selectCurrentCleanVersionForPreviewStatement(database, fileId).all<{
    id: FileVersionId;
    r2_key: string;
    size_bytes: number | null;
    version_number: number;
    inline_playable: "playable" | "download-only" | "indeterminate" | null;
    storage_class: string;
    storage_encoding: string;
    sniffed_content_type: string | null;
    artifact_role: string;
    scan_verdict: "unscanned" | "clean" | "flagged" | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    versionNumber: row.version_number,
    inlinePlayable: row.inline_playable,
    storageClass: row.storage_class,
    storageEncoding: row.storage_encoding,
    sniffedContentType: row.sniffed_content_type,
    artifactRole: row.artifact_role,
    scanVerdict: row.scan_verdict,
  };
}

// A file's committed version history (clean only) — newest first.
export function listCleanVersionsStatement(database: SqlDatabase, fileId: FileId): SqlStatement {
  return database
    .prepare(
      `SELECT id, version_number, r2_key, size_bytes, sniffed_content_type, content_sha256, committed_at, inline_playable FROM ${FILE_VERSION_TABLE} WHERE file_id = ?1 AND status = 'clean' ORDER BY version_number DESC`,
    )
    .bind(fileId);
}

export interface CleanVersionListItem {
  readonly id: FileVersionId;
  readonly versionNumber: number;
  readonly sizeBytes: number | null;
  readonly sniffedContentType: string | null;
  readonly contentSha256: string | null;
  readonly committedAt: string | null;
  readonly inlinePlayable: "playable" | "download-only" | "indeterminate" | null;
}

export async function listCleanVersions(
  database: SqlDatabase,
  fileId: FileId,
): Promise<readonly CleanVersionListItem[]> {
  const { results } = await listCleanVersionsStatement(database, fileId).all<{
    id: FileVersionId;
    version_number: number;
    size_bytes: number | null;
    sniffed_content_type: string | null;
    content_sha256: string | null;
    committed_at: string | null;
    inline_playable: "playable" | "download-only" | "indeterminate" | null;
  }>();
  return results.map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    sizeBytes: row.size_bytes,
    sniffedContentType: row.sniffed_content_type,
    contentSha256: row.content_sha256,
    committedAt: row.committed_at,
    inlinePlayable: row.inline_playable,
  }));
}

// Every clean committed version's R2 key, size, and storage class in this firm — the authoritative
// set the storage reconciliation filters its R2 LIST against. Only clean versions are metered, and
// the single bound R2 binding is shared across dev-pool firms, so reconciliation must consider only
// objects whose key belongs to this firm's clean set: a pending/quarantined/abandoned object (never
// metered) or another firm's object (not in this set) is ignored, never driven into the meter.
export function listCleanVersionR2KeysStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT r2_key, size_bytes, storage_class FROM ${FILE_VERSION_TABLE} WHERE status = 'clean'`,
  );
}

export interface CleanVersionR2Object {
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly storageClass: string;
}

export async function listCleanVersionR2Keys(
  database: SqlDatabase,
): Promise<readonly CleanVersionR2Object[]> {
  const { results } = await listCleanVersionR2KeysStatement(database).all<{
    r2_key: string;
    size_bytes: number | null;
    storage_class: string;
  }>();
  return results.map((row) => ({
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    storageClass: row.storage_class,
  }));
}

// The current clean version of each non-deleted file in a matter whose recorded scan engine version
// is STALE relative to the firm's current engine — the work set for an on-demand "scan this matter
// now" pass. Staleness is filtered in SQL (NULL engine = never scanned = stale; a differing engine =
// stale) so a matter already current under the engine returns nothing and enqueues nothing; this
// mirrors the access-triggered staleness gate, just batched over a matter. LIMIT is the caller's cap +
// 1 so the caller can detect (and honestly report) that more remain beyond the cap.
export function listStaleMatterVersionsForRescanStatement(
  database: SqlDatabase,
  matterId: MatterId,
  currentEngineVersion: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.r2_key, v.size_bytes FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.matter_id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean' AND (v.scan_engine_version IS NULL OR v.scan_engine_version != ?2) LIMIT ?3`,
    )
    .bind(matterId, currentEngineVersion, limit);
}

export interface StaleMatterVersion {
  readonly r2Key: string;
  readonly sizeBytes: number | null;
}

export async function listStaleMatterVersionsForRescan(
  database: SqlDatabase,
  matterId: MatterId,
  currentEngineVersion: string,
  limit: number,
): Promise<readonly StaleMatterVersion[]> {
  const { results } = await listStaleMatterVersionsForRescanStatement(
    database,
    matterId,
    currentEngineVersion,
    limit,
  ).all<{ r2_key: string; size_bytes: number | null }>();
  return results.map((row) => ({ r2Key: row.r2_key, sizeBytes: row.size_bytes }));
}

// Committed versions (status = 'clean') whose scan has not yet been evaluated (scan_verdict =
// 'unscanned'). Used by the weekly re-scan sweep to re-enqueue these versions once a real scan
// engine is available. The status = 'clean' predicate is the legitimate status gate: only committed
// versions are eligible — pending/quarantined/abandoned versions are not re-scanned.
export function listUnscannedCommittedVersionsStatement(
  database: SqlDatabase,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, r2_key FROM ${FILE_VERSION_TABLE} WHERE status = 'clean' AND scan_verdict = 'unscanned' LIMIT ?`,
    )
    .bind(limit);
}

export interface UnscannedCommittedVersion {
  readonly id: FileVersionId;
  readonly r2Key: string;
}

export async function listUnscannedCommittedVersions(
  database: SqlDatabase,
  limit: number,
): Promise<readonly UnscannedCommittedVersion[]> {
  const { results } = await listUnscannedCommittedVersionsStatement(database, limit).all<{
    id: FileVersionId;
    r2_key: string;
  }>();
  return results.map((row) => ({ id: row.id, r2Key: row.r2_key }));
}

// Loads an already-committed (status = 'clean') version by its R2 key — the non-pending counterpart to
// selectPendingVersionByR2KeyStatement. The access-triggered re-scan dispatch uses it to branch: a key
// with no pending row but a committed row is a re-scan candidate. Returns the columns the staleness
// check + dedup-cache lookup need (the content hash and the engine version it was last scanned under).
// undefined for a pending, quarantined, abandoned, or unknown key.
export function selectCommittedVersionByR2KeyStatement(
  database: SqlDatabase,
  r2Key: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, file_id, content_sha256, scan_engine_version, scan_verdict FROM ${FILE_VERSION_TABLE} WHERE r2_key = ?1 AND status = 'clean'`,
    )
    .bind(r2Key);
}

export interface CommittedVersionForRescan {
  readonly id: FileVersionId;
  readonly fileId: FileId;
  readonly contentSha256: string | null;
  readonly scanEngineVersion: string | null;
  readonly scanVerdict: string | null;
}

export async function loadCommittedVersionByR2Key(
  database: SqlDatabase,
  r2Key: string,
): Promise<CommittedVersionForRescan | undefined> {
  const { results } = await selectCommittedVersionByR2KeyStatement(database, r2Key).all<{
    id: FileVersionId;
    file_id: FileId;
    content_sha256: string | null;
    scan_engine_version: string | null;
    scan_verdict: string | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    fileId: row.file_id,
    contentSha256: row.content_sha256,
    scanEngineVersion: row.scan_engine_version,
    scanVerdict: row.scan_verdict,
  };
}

// A dedicated statement for the integrity baseline: the current clean version's R2 key, byte size,
// and the SHA-256 recorded at ingest. Kept as a sibling of selectCurrentCleanVersionStatement rather
// than an extension of it — each reader projects its own columns (the preview function established
// this pattern), and isolating the projection means neither caller is coupled to the other's columns.
export function selectCurrentCleanVersionForIntegrityStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id, v.r2_key, v.size_bytes, v.content_sha256 FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
    )
    .bind(fileId);
}

export interface VersionIntegrity {
  readonly id: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly contentSha256: string | null;
}

// The current clean version's R2 key plus the SHA-256 recorded at ingest — the integrity baseline.
// Returns undefined when the file has no clean current version (e.g. still pending or quarantined).
export async function getCurrentVersionForIntegrity(
  database: SqlDatabase,
  fileId: FileId,
): Promise<VersionIntegrity | undefined> {
  const { results } = await selectCurrentCleanVersionForIntegrityStatement(database, fileId).all<{
    id: FileVersionId;
    r2_key: string;
    size_bytes: number | null;
    content_sha256: string | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    contentSha256: row.content_sha256,
  };
}

// Every folder in a matter (id, parent, name) — the input to folder-tree path composition for the
// ZIP download. Folders carry no status gate (only file_version does), so this is an unguarded read.
export function listFoldersByMatterStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, parent_folder_id, name FROM ${FOLDER_TABLE} WHERE matter_id = ?1 ORDER BY created_at ASC, id ASC`,
    )
    .bind(matterId);
}

export interface FolderNode {
  readonly id: FolderId;
  readonly parentFolderId: FolderId | null;
  readonly name: string;
}

export async function listFoldersByMatter(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<readonly FolderNode[]> {
  const { results } = await listFoldersByMatterStatement(database, matterId).all<{
    id: FolderId;
    parent_folder_id: FolderId | null;
    name: string;
  }>();
  return results.map((row) => ({
    id: row.id,
    parentFolderId: row.parent_folder_id,
    name: row.name,
  }));
}

// Every clean, non-deleted file in a matter joined to its current clean version — the resolved,
// version-pinned set the ZIP download draws from. current_version_id IS NOT NULL + v.status = 'clean'
// is the visibility gate (set only on commit), so a pending/quarantined/deleted file never appears.
export function listCleanCurrentVersionsByMatterStatement(
  database: SqlDatabase,
  matterId: MatterId,
): SqlStatement {
  return database
    .prepare(
      `SELECT f.id AS file_id, f.folder_id, f.name, v.id AS version_id, v.r2_key, v.size_bytes ` +
        `FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id ` +
        `WHERE f.matter_id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
    )
    .bind(matterId);
}

export interface MatterCleanFile {
  readonly fileId: FileId;
  readonly folderId: FolderId | null;
  readonly name: string;
  readonly versionId: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
}

export async function listCleanCurrentVersionsByMatter(
  database: SqlDatabase,
  matterId: MatterId,
): Promise<readonly MatterCleanFile[]> {
  const { results } = await listCleanCurrentVersionsByMatterStatement(database, matterId).all<{
    file_id: FileId;
    folder_id: FolderId | null;
    name: string;
    version_id: FileVersionId;
    r2_key: string;
    size_bytes: number | null;
  }>();
  return results.map((row) => ({
    fileId: row.file_id,
    folderId: row.folder_id,
    name: row.name,
    versionId: row.version_id,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
  }));
}
