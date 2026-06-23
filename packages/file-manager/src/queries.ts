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
  DocumentCheckoutId,
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
      `SELECT v.id, v.r2_key, v.size_bytes, v.version_number FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
    )
    .bind(fileId);
}

export interface CleanVersion {
  readonly id: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly versionNumber: number;
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
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    versionNumber: row.version_number,
  };
}

export interface TierableVersion {
  readonly id: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number;
  readonly artifactRole: string;
}

// The tiering sweep's candidates: clean, still-Standard versions that are NOT their file's current
// version and committed before the cutoff (the conservative IA-minimum window). The current/live
// version is never returned — tiering only ever touches superseded history. Spans nothing risky: it
// reads only committed (`clean`) versions and excludes the current pointer. The cutoff is an ISO
// instant; ISO-8601 sorts lexicographically so the string compare is a chronological compare. Bounded
// by `limit` so one daily pass never tiers an unbounded backlog. fitness:allow-no-status
export function listTierableVersionsStatement(
  database: SqlDatabase,
  committedBeforeIso: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id, v.r2_key, v.size_bytes, v.artifact_role ` +
        `FROM ${FILE_VERSION_TABLE} v JOIN ${FILE_TABLE} f ON f.id = v.file_id ` +
        `WHERE v.status = 'clean' AND v.storage_class = 'standard' ` +
        `AND v.committed_at IS NOT NULL AND v.committed_at < ?1 ` +
        `AND (f.current_version_id IS NULL OR f.current_version_id <> v.id) ` +
        `LIMIT ?2`,
    )
    .bind(committedBeforeIso, limit);
}

export async function listTierableVersions(
  database: SqlDatabase,
  committedBeforeIso: string,
  limit: number,
): Promise<TierableVersion[]> {
  const { results } = await listTierableVersionsStatement(database, committedBeforeIso, limit).all<{
    id: FileVersionId;
    r2_key: string;
    size_bytes: number | null;
    artifact_role: string;
  }>();
  return results.map((row) => ({
    id: row.id,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes ?? 0,
    artifactRole: row.artifact_role,
  }));
}

export interface ConflictPendingVersion {
  readonly id: FileVersionId;
  readonly versionNumber: number;
  readonly divergedFromVersionId: FileVersionId | null;
  readonly checkoutId: DocumentCheckoutId | null;
}

// The conflicting copy awaiting human reconciliation for a file — the document's "needs reconciliation"
// flag IS a conflict_pending version (no separate column). Returns the most recent one if several
// offline copies diverged; undefined means nothing to reconcile (the route 404s). Spans the version
// status by design — a conflicting copy is committed `clean`; reconciliation_status is the gate here.
// fitness:allow-no-status
export function getConflictPendingVersionStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, version_number, diverged_from_version_id, checkout_id FROM ${FILE_VERSION_TABLE} WHERE file_id = ?1 AND reconciliation_status = 'conflict_pending' ORDER BY version_number DESC LIMIT 1`,
    )
    .bind(fileId);
}

// ALL conflict_pending copies for a file, newest first. The reconcile route resolves every one in a
// single pass — multiple offline copies can diverge concurrently, so resolving only the newest would
// orphan the rest as permanently-unreconcilable conflict_pending versions. Gated on
// reconciliation_status (a conflicting copy is committed `clean`), not status. fitness:allow-no-status
export async function getConflictPendingVersions(
  database: SqlDatabase,
  fileId: FileId,
): Promise<ConflictPendingVersion[]> {
  const { results } = await database
    .prepare(
      `SELECT id, version_number, diverged_from_version_id, checkout_id FROM ${FILE_VERSION_TABLE} WHERE file_id = ?1 AND reconciliation_status = 'conflict_pending' ORDER BY version_number DESC`,
    )
    .bind(fileId)
    .all<{
      id: FileVersionId;
      version_number: number;
      diverged_from_version_id: FileVersionId | null;
      checkout_id: DocumentCheckoutId | null;
    }>();
  return results.map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    divergedFromVersionId: row.diverged_from_version_id,
    checkoutId: row.checkout_id,
  }));
}

export async function getConflictPendingVersion(
  database: SqlDatabase,
  fileId: FileId,
): Promise<ConflictPendingVersion | undefined> {
  const { results } = await getConflictPendingVersionStatement(database, fileId).all<{
    id: FileVersionId;
    version_number: number;
    diverged_from_version_id: FileVersionId | null;
    checkout_id: DocumentCheckoutId | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    versionNumber: row.version_number,
    divergedFromVersionId: row.diverged_from_version_id,
    checkoutId: row.checkout_id,
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
      `SELECT v.id, v.r2_key, v.size_bytes, v.version_number, v.inline_playable, v.storage_class, v.storage_encoding, v.sniffed_content_type, v.artifact_role FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
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
