import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync fitness test.
export const FILE_TABLE = "file";
export const FILE_VERSION_TABLE = "file_version";
export const UPLOAD_SESSION_TABLE = "upload_session";

// The top-level R2 key segment for matter files (also the storage_meter prefix). Keys are opaque:
// files/{fileId}/{versionId} — never derived from a folder path, so a rename moves no bytes.
export const FILES_PREFIX = "files";

export function fileVersionKey(fileId: FileId, versionId: FileVersionId): string {
  return `${FILES_PREFIX}/${fileId}/${versionId}`;
}

export interface InsertFileRow {
  readonly id: FileId;
  readonly matterId: MatterId;
  readonly folderId: FolderId | null;
  readonly name: string;
  readonly documentTypeId: DocumentTypeId | null;
  readonly createdAt: string;
}

export function insertFileStatement(database: SqlDatabase, row: InsertFileRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FILE_TABLE} (id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?6)`,
    )
    .bind(row.id, row.matterId, row.folderId, row.name, row.documentTypeId, row.createdAt);
}

export interface InsertFileVersionRow {
  readonly id: FileVersionId;
  readonly fileId: FileId;
  readonly versionNumber: number;
  readonly r2Key: string;
  readonly declaredContentType: string | null;
  readonly uploadedBy: UserId | null;
  readonly createdAt: string;
}

// A pending version: bytes are not yet ingested, so size/sniffed-type/hash/scan are null and status
// is 'pending' — invisible to every consumer read until the ingest gate commits it.
export function insertFileVersionStatement(
  database: SqlDatabase,
  row: InsertFileVersionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${FILE_VERSION_TABLE} (id, file_id, version_number, r2_key, size_bytes, declared_content_type, sniffed_content_type, content_sha256, scan_verdict, scan_engine_version, status, uploaded_by, created_at, committed_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, NULL, NULL, NULL, NULL, 'pending', ?6, ?7, NULL)`,
    )
    .bind(
      row.id,
      row.fileId,
      row.versionNumber,
      row.r2Key,
      row.declaredContentType,
      row.uploadedBy,
      row.createdAt,
    );
}

export interface InsertUploadSessionRow {
  readonly id: UploadSessionId;
  readonly fileVersionId: FileVersionId;
  readonly mode: "put" | "multipart";
  readonly declaredSize: number | null;
  readonly declaredContentType: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
}

export function insertUploadSessionStatement(
  database: SqlDatabase,
  row: InsertUploadSessionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${UPLOAD_SESSION_TABLE} (id, file_version_id, mode, r2_upload_id, declared_size, declared_content_type, status, created_at, expires_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5, 'open', ?6, ?7)`,
    )
    .bind(
      row.id,
      row.fileVersionId,
      row.mode,
      row.declaredSize,
      row.declaredContentType,
      row.createdAt,
      row.expiresAt,
    );
}

// next version_number = max over ALL versions + 1. Status is deliberately NOT filtered: an abandoned
// or quarantined version still consumes its (file_id, version_number) UNIQUE slot, so reusing the
// number would collide. The one file_version read that legitimately spans every status.
// fitness:allow-no-status
export function selectMaxVersionNumberStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT COALESCE(MAX(version_number), 0) AS n FROM ${FILE_VERSION_TABLE} WHERE file_id = ?1`,
    )
    .bind(fileId);
}

// The ingest gate acts only on a pending version (status = 'pending' is the guard); a replayed event
// finds it already clean/quarantined and matches nothing.
export function selectPendingVersionStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, file_id, version_number, r2_key FROM ${FILE_VERSION_TABLE} WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(versionId);
}

// The current (clean) version's hash, for the no-op skip: re-uploading identical bytes must not cut a
// new version. Reads only the committed version (status = 'clean').
export function selectCurrentVersionHashStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.content_sha256 AS hash FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ?1 AND v.status = 'clean'`,
    )
    .bind(fileId);
}

export interface CommitVersionRow {
  readonly versionId: FileVersionId;
  readonly sizeBytes: number;
  readonly sniffedContentType: string | null;
  readonly contentSha256: string;
  readonly scanVerdict: "unscanned" | "clean";
  readonly scanEngineVersion: string | null;
  readonly committedAt: string;
}

// Guarded on status = 'pending': a version commits exactly once. A replayed ingest matches no row.
export function commitVersionStatement(database: SqlDatabase, row: CommitVersionRow): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET status = 'clean', size_bytes = ?2, sniffed_content_type = ?3, content_sha256 = ?4, scan_verdict = ?5, scan_engine_version = ?6, committed_at = ?7 WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(
      row.versionId,
      row.sizeBytes,
      row.sniffedContentType,
      row.contentSha256,
      row.scanVerdict,
      row.scanEngineVersion,
      row.committedAt,
    );
}

export function bumpFileCurrentVersionStatement(
  database: SqlDatabase,
  fileId: FileId,
  versionId: FileVersionId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET current_version_id = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(fileId, versionId, updatedAt);
}

export function quarantineVersionStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET status = 'quarantined' WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(versionId);
}

// The no-op skip: identical re-upload abandons the freshly-minted pending version.
export function abandonVersionStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${FILE_VERSION_TABLE} SET status = 'abandoned' WHERE id = ?1 AND status = 'pending'`,
    )
    .bind(versionId);
}

export function setUploadSessionStatusStatement(
  database: SqlDatabase,
  fileVersionId: FileVersionId,
  status: "completed" | "aborted" | "expired",
): SqlStatement {
  return database
    .prepare(`UPDATE ${UPLOAD_SESSION_TABLE} SET status = ?2 WHERE file_version_id = ?1`)
    .bind(fileVersionId, status);
}

// The session by its own id, joined to its version's r2 key — the read the upload routes use to drive
// part-signing, completion, and abort (the route holds the session id, not the version id). The join
// to file_version reads the key of the still-pending version being uploaded TO (presigning its key is
// the whole point), so it legitimately spans version statuses.
// fitness:allow-no-status
export function selectUploadSessionStatement(
  database: SqlDatabase,
  sessionId: UploadSessionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT s.id, s.file_version_id, s.mode, s.r2_upload_id, s.status, s.declared_content_type, v.r2_key ` +
        `FROM ${UPLOAD_SESSION_TABLE} s JOIN ${FILE_VERSION_TABLE} v ON v.id = s.file_version_id WHERE s.id = ?1`,
    )
    .bind(sessionId);
}

// Records R2's multipart upload id on the open session after createMultipartUpload — composed into
// the same initiate batch so the response and the stored id commit atomically.
export function setUploadSessionR2UploadIdStatement(
  database: SqlDatabase,
  sessionId: UploadSessionId,
  r2UploadId: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${UPLOAD_SESSION_TABLE} SET r2_upload_id = ?2 WHERE id = ?1`)
    .bind(sessionId, r2UploadId);
}

// Transitions a session by its id, guarded on status = 'open': a replayed complete/abort matches no
// row, so the transition happens exactly once.
export function setUploadSessionStatusByIdStatement(
  database: SqlDatabase,
  sessionId: UploadSessionId,
  status: "completed" | "aborted" | "expired",
): SqlStatement {
  return database
    .prepare(`UPDATE ${UPLOAD_SESSION_TABLE} SET status = ?2 WHERE id = ?1 AND status = 'open'`)
    .bind(sessionId, status);
}

export function selectFileStatement(database: SqlDatabase, id: FileId): SqlStatement {
  return database
    .prepare(
      `SELECT id, matter_id, folder_id, name, document_type_id, current_version_id, deleted_at FROM ${FILE_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

export function renameFileStatement(
  database: SqlDatabase,
  id: FileId,
  name: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET name = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, name, updatedAt);
}

export function moveFileStatement(
  database: SqlDatabase,
  id: FileId,
  folderId: FolderId | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET folder_id = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, folderId, updatedAt);
}

export function assignDocumentTypeStatement(
  database: SqlDatabase,
  id: FileId,
  documentTypeId: DocumentTypeId | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET document_type_id = ?2, updated_at = ?3 WHERE id = ?1`)
    .bind(id, documentTypeId, updatedAt);
}

export function softDeleteFileStatement(
  database: SqlDatabase,
  id: FileId,
  deletedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${FILE_TABLE} SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1`)
    .bind(id, deletedAt);
}

// Folder-emptiness check (a file in the folder, any status, blocks the delete).
export function selectFolderFileStatement(database: SqlDatabase, folderId: FolderId): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${FILE_TABLE} WHERE folder_id = ?1 LIMIT 1`)
    .bind(folderId);
}
