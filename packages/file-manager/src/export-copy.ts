import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { FileId, FileVersionId, MatterId } from "@magna-carta/identifiers/types";
import {
  FILE_TABLE,
  FILE_VERSION_TABLE,
  fileVersionKey,
  type VersionSaveKind,
} from "./file-statements.ts";

// The copy of a version that leaves the platform.
//
// A word-processing document the browser editor opens records every insertion and deletion with
// its author, and the STORED version keeps those marks for as long as it lives: they are the
// document's own record of who changed what, and history reads them. A copy produced for outside
// the firm — a download, a bundle, and every path that follows — must not carry them, so each such
// copy is served from a version's EXPORT COPY: the same bytes with all changes accepted, produced
// once, off the request path, when the version is cut. The three `export_*` columns on
// `file_version` record that copy; this module is the one home for what they mean, the key the copy
// lives at, and which versions need one at all.

/** Where a version's export copy stands. Null on the row means the version needs no copy. */
export type ExportCopyState = "pending" | "ready" | "unavailable";

export interface ExportCopyFacts {
  readonly exportCopyState: ExportCopyState | null;
  readonly exportR2Key: string | null;
  readonly exportSizeBytes: number | null;
}

// Beside the version's own object, with a suffix rather than a nested segment: files/{fileId}/ is
// listed by prefix when a file's objects are purged, and the copy must fall inside that listing.
export function exportCopyKey(fileId: FileId, versionId: FileVersionId): string {
  return `${fileVersionKey(fileId, versionId)}.accepted`;
}

// The versions that need a copy: those the editor cut (an upload is served as it arrived — the
// platform recorded nothing in it) in the one format whose recorded changes the accept pass
// resolves. Decided by the file's name, which is what the editor decided the save format by.
export function needsExportCopy(fileName: string, saveKind: VersionSaveKind | null): boolean {
  return saveKind !== null && /\.docx$/i.test(fileName);
}

/** Marks a just-cut version as owing a copy. Rides the batch that cuts the version. */
export function markVersionExportCopyPendingStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      // fitness:allow-no-status — the version is being cut in this same batch and is addressed by id
      `UPDATE ${FILE_VERSION_TABLE} SET export_copy_state = 'pending', export_r2_key = NULL, export_size_bytes = NULL WHERE id = ?1`,
    )
    .bind(versionId);
}

export interface RecordExportCopyRow {
  readonly versionId: FileVersionId;
  readonly state: "ready" | "unavailable";
  readonly exportR2Key: string | null;
  readonly exportSizeBytes: number | null;
}

/** Records the produced copy (or that none can be). Addressed by id: the row is the one being answered. */
export function recordVersionExportCopyStatement(
  database: SqlDatabase,
  row: RecordExportCopyRow,
): SqlStatement {
  return database
    .prepare(
      // fitness:allow-no-status — the copy's row is addressed by id, whatever its status has become
      `UPDATE ${FILE_VERSION_TABLE} SET export_copy_state = ?2, export_r2_key = ?3, export_size_bytes = ?4 WHERE id = ?1`,
    )
    .bind(row.versionId, row.state, row.exportR2Key, row.exportSizeBytes);
}

export interface VersionForExportCopy extends ExportCopyFacts {
  readonly id: FileVersionId;
  readonly fileId: FileId;
  readonly matterId: MatterId;
  readonly name: string;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly versionNumber: number;
  readonly saveKind: VersionSaveKind | null;
}

// The facts the copy producer needs about one version, including a version that is no longer
// current: a copy is owed to any version the editor cut, since history can hand any of them out.
// Filtered to `clean` — a withdrawn or quarantined version is not served and gets no copy.
export function selectVersionForExportCopyStatement(
  database: SqlDatabase,
  versionId: FileVersionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id, v.file_id, f.matter_id, f.name, v.r2_key, v.size_bytes, v.version_number, v.save_kind, ` +
        `v.export_copy_state, v.export_r2_key, v.export_size_bytes ` +
        `FROM ${FILE_VERSION_TABLE} v JOIN ${FILE_TABLE} f ON f.id = v.file_id ` +
        `WHERE v.id = ?1 AND v.status = 'clean'`,
    )
    .bind(versionId);
}

export async function readVersionForExportCopy(
  database: SqlDatabase,
  versionId: FileVersionId,
): Promise<VersionForExportCopy | undefined> {
  const { results } = await selectVersionForExportCopyStatement(database, versionId).all<{
    id: FileVersionId;
    file_id: FileId;
    matter_id: MatterId;
    name: string;
    r2_key: string;
    size_bytes: number | null;
    version_number: number;
    save_kind: VersionSaveKind | null;
    export_copy_state: ExportCopyState | null;
    export_r2_key: string | null;
    export_size_bytes: number | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    fileId: row.file_id,
    matterId: row.matter_id,
    name: row.name,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    versionNumber: row.version_number,
    saveKind: row.save_kind,
    exportCopyState: row.export_copy_state,
    exportR2Key: row.export_r2_key,
    exportSizeBytes: row.export_size_bytes,
  };
}
