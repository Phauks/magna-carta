import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
} from "@magna-carta/identifiers/types";
import { FILE_TABLE, FILE_VERSION_TABLE } from "./file-statements.ts";

// Read mediation (golden rule 3): every consumer read serves only clean, non-deleted content. A file
// is visible once it has a clean current version (current_version_id, set only on commit); a version
// read filters status = 'clean'. The pending/quarantined gate is enforced HERE, not by a key scheme.
const DEFAULT_PAGE_SIZE = 50;

export interface Page<Row> {
  readonly data: readonly Row[];
  readonly nextCursor: string | null;
}

interface SortCursor {
  readonly createdAt: string;
  readonly id: string;
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify({ c: createdAt, i: id }));
}

function decodeCursor(cursor: string | undefined): SortCursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(atob(cursor)) as { c?: unknown; i?: unknown };
    if (typeof parsed.c === "string" && typeof parsed.i === "string") {
      return { createdAt: parsed.c, id: parsed.i };
    }
  } catch {
    // A malformed cursor is treated as the first page.
  }
  return undefined;
}

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
  if (cursor !== undefined) {
    conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
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
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows.map(toFileListItem),
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
  };
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

// A file's committed version history (clean only) — newest first.
export function listCleanVersionsStatement(database: SqlDatabase, fileId: FileId): SqlStatement {
  return database
    .prepare(
      `SELECT id, version_number, r2_key, size_bytes, sniffed_content_type, content_sha256, committed_at FROM ${FILE_VERSION_TABLE} WHERE file_id = ?1 AND status = 'clean' ORDER BY version_number DESC`,
    )
    .bind(fileId);
}
