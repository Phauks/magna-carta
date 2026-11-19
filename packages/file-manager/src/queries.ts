import type { ExportCopyFacts, ExportCopyState } from "./export-copy.ts";
import {
  assemblePage,
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  type Page,
  type SortCursor,
} from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { AUDIT_LOG_TABLE } from "@magna-carta/data-access/audit-statements";
import {
  INDEX_SPLIT_MEMBER_TABLE,
  INDEX_SPLIT_TABLE,
} from "@magna-carta/data-access/index-split-statements";
import { MEMBER_TABLE } from "@magna-carta/data-access/member-statements";
import type {
  DocumentCheckoutId,
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  UploadSessionId,
  UserId,
} from "@magna-carta/identifiers/types";
import { DOCUMENT_TYPE_TABLE } from "./document-type-statements.ts";
import {
  FILE_TABLE,
  FILE_VERSION_TABLE,
  UPLOAD_SESSION_TABLE,
  selectCurrentCleanVersionsBySha256Statement,
  FILE_VERSION_PARTICIPANT_TABLE,
  type VersionSaveKind,
} from "./file-statements.ts";
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
  // Opt-in: also surface files whose latest version is still pending (ingest in flight) or was
  // quarantined (rejected as malware) — a first upload with no clean version yet. Default false keeps
  // the historical behaviour (only files with a clean current version appear). currentVersionId stays
  // clean-only in either mode, so a pending/quarantined row can never render a download link.
  readonly includePendingAndQuarantined?: boolean;
}

// The file summary a table row is painted from — the file's metadata joined to its display version, so
// one list call needs no per-row fan-out to the version history. The display version is the clean
// current version when one exists (currentVersionId, set only on a clean commit), otherwise — only in
// the opt-in include mode — the latest pending or quarantined version. `status` reports which of those
// the row is; version-derived fields (versionNumber/sizeBytes/sniffedContentType/scanVerdict) come from
// that display version. currentVersionId is ALWAYS the clean pointer (null for a pending/quarantined
// first upload), so a non-clean row structurally cannot offer a download.
export interface FileListItem {
  readonly id: FileId;
  readonly matterId: MatterId;
  readonly folderId: FolderId | null;
  readonly name: string;
  readonly documentTypeId: DocumentTypeId | null;
  readonly currentVersionId: FileVersionId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versionNumber: number;
  readonly sizeBytes: number | null;
  readonly sniffedContentType: string | null;
  readonly scanVerdict: "unscanned" | "clean" | "flagged" | null;
  readonly status: "clean" | "pending" | "quarantined";
  // The human-readable reason a version was quarantined (the scan detail), present only when status is
  // "quarantined"; null otherwise.
  readonly quarantineReason: string | null;
  // The last-modified instant the uploading device reported for the display version's source file, or
  // null where none was recorded. A fact about where the bytes came from, beside the record's own dates.
  readonly sourceModifiedAt: string | null;
  // Who uploaded the display version, and what the firm calls them. The id is the version's own
  // record (it outlives the member row, so a departed member's uploads stay attributed); the name is
  // read off the member row at query time and is null for an upload nobody was recorded for, or
  // whose member row is gone. "Created By" on the file table is this: an upload is an act of creation.
  readonly uploadedBy: UserId | null;
  readonly uploadedByName: string | null;
}

interface FileSummaryRowRaw {
  id: FileId;
  matter_id: MatterId;
  folder_id: FolderId | null;
  name: string;
  document_type_id: DocumentTypeId | null;
  current_version_id: FileVersionId | null;
  created_at: string;
  updated_at: string;
  version_number: number;
  size_bytes: number | null;
  sniffed_content_type: string | null;
  scan_verdict: "unscanned" | "clean" | "flagged" | null;
  version_status: "clean" | "pending" | "quarantined" | "abandoned";
  scan_detail: string | null;
  source_modified_at: string | null;
  uploaded_by: UserId | null;
  uploaded_by_name: string | null;
}

function toFileListItem(row: FileSummaryRowRaw): FileListItem {
  const status: "clean" | "pending" | "quarantined" =
    row.version_status === "quarantined"
      ? "quarantined"
      : row.version_status === "pending"
        ? "pending"
        : "clean";
  return {
    id: row.id,
    matterId: row.matter_id,
    folderId: row.folder_id,
    name: row.name,
    documentTypeId: row.document_type_id,
    currentVersionId: row.current_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    versionNumber: row.version_number,
    sizeBytes: row.size_bytes,
    sniffedContentType: row.sniffed_content_type,
    scanVerdict: row.scan_verdict,
    status,
    quarantineReason: status === "quarantined" ? row.scan_detail : null,
    sourceModifiedAt: row.source_modified_at,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
  };
}

// The summary columns both the list and the single-file read project — the file row plus its display
// version's version_number/size/sniffed-type/verdict/status/detail.
const FILE_SUMMARY_COLUMNS =
  "f.id, f.matter_id, f.folder_id, f.name, f.document_type_id, f.current_version_id, " +
  "f.created_at, f.updated_at, dv.version_number, dv.size_bytes, dv.sniffed_content_type, " +
  "dv.scan_verdict, dv.status AS version_status, dv.scan_detail, dv.source_modified_at, " +
  "dv.uploaded_by, m.display_name AS uploaded_by_name";

// The uploader's name rides every summary read off the member row. LEFT, because the upload fact
// outlives the member: a departed member's files keep their attribution id and lose only the name.
const UPLOADER_JOIN = `LEFT JOIN ${MEMBER_TABLE} m ON m.user_id = dv.uploaded_by `;

export function listFilesStatement(
  database: SqlDatabase,
  filters: ListFilesFilters,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  const conditions = ["f.matter_id = ?"];
  const bindings: unknown[] = [filters.matterId];
  if (filters.folderId !== undefined) {
    conditions.push("f.folder_id = ?");
    bindings.push(filters.folderId);
  }
  if (filters.includeDeleted !== true) {
    conditions.push("f.deleted_at IS NULL");
  }
  // The display version resolved by the JOIN. Default: the clean current version only — current_version_id
  // is set solely by a clean commit, so pending/quarantined-only files are excluded by the JOIN itself and
  // by the visibility predicate below. Include mode: fall back to the latest pending/quarantined version
  // (an in-flight or rejected first upload), keeping the file visible in the table without inventing a
  // clean pointer. The INNER JOIN drops any file whose display version resolves to null (e.g. a first
  // upload that was aborted, leaving only an abandoned version).
  const includePendingAndQuarantined = filters.includePendingAndQuarantined === true;
  const displayVersion = includePendingAndQuarantined
    ? `COALESCE(f.current_version_id, (SELECT lv.id FROM ${FILE_VERSION_TABLE} lv WHERE lv.file_id = f.id AND lv.status IN ('pending', 'quarantined') ORDER BY lv.version_number DESC LIMIT 1))`
    : "f.current_version_id";
  if (!includePendingAndQuarantined) {
    conditions.push("f.current_version_id IS NOT NULL");
  }
  // The keyset predicate, qualified to the file table: the JOIN to file_version makes bare created_at/id
  // ambiguous, so this cannot reuse the shared appendCursorPredicate (which emits unqualified columns).
  if (cursor !== undefined) {
    conditions.push("(f.created_at < ? OR (f.created_at = ? AND f.id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(limit);
  // fitness:allow-no-status — this read deliberately spans version statuses. The gate is not a WHERE
  // status= on the joined row but the display-version resolution: the JOIN targets either the clean
  // current version (current_version_id, clean-only by construction) or, in include mode, a version
  // gated to pending/quarantined in the COALESCE subquery. currentVersionId is projected from the file
  // row (clean pointer), never from the joined version, so no consumer can reach non-clean bytes.
  return database
    .prepare(
      `SELECT ${FILE_SUMMARY_COLUMNS} FROM ${FILE_TABLE} f ` +
        `JOIN ${FILE_VERSION_TABLE} dv ON dv.id = ${displayVersion} ` +
        UPLOADER_JOIN +
        `WHERE ${conditions.join(" AND ")} ORDER BY f.created_at DESC, f.id DESC LIMIT ?`,
    )
    .bind(...bindings);
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
  ).all<FileSummaryRowRaw>();
  return assemblePage(results, pageSize, toFileListItem);
}

// One file's enriched summary — the same shape a list row carries, for the detail read. Gated to a
// clean current version (status = 'clean') and a non-deleted file, so a pending-only, quarantined, or
// soft-deleted file returns undefined (the route 404s). status is therefore always "clean" here.
export function selectFileSummaryStatement(database: SqlDatabase, fileId: FileId): SqlStatement {
  return database
    .prepare(
      `SELECT ${FILE_SUMMARY_COLUMNS} FROM ${FILE_TABLE} f ` +
        `JOIN ${FILE_VERSION_TABLE} dv ON dv.id = f.current_version_id ` +
        UPLOADER_JOIN +
        `WHERE f.id = ?1 AND f.deleted_at IS NULL AND dv.status = 'clean'`,
    )
    .bind(fileId);
}

export async function getFileSummary(
  database: SqlDatabase,
  fileId: FileId,
): Promise<FileListItem | undefined> {
  const { results } = await selectFileSummaryStatement(database, fileId).all<FileSummaryRowRaw>();
  const row = results[0];
  if (row === undefined) return undefined;
  return toFileListItem(row);
}

// The upload session's own lifecycle status plus its version's ingest status (and the quarantine reason
// when the bytes were rejected) — the read behind the upload-status poll. The session status reports how
// far the direct-to-R2 ceremony got (open → completed/aborted/expired); the version status reports what
// ingest decided about the bytes (pending → clean/quarantined, or abandoned on a no-op/abort). Returns
// undefined for an unknown session in this firm (the route 404s — a session in another firm is simply
// absent from this firm's database).
export interface UploadSessionStatus {
  readonly sessionStatus: "open" | "completed" | "aborted" | "expired";
  readonly versionStatus: "pending" | "clean" | "quarantined" | "abandoned";
  readonly quarantineReason: string | null;
}

// fitness:allow-no-status — reporting the version's status IS the purpose of this read, so it spans
// every status by design. It serves no bytes: it projects the status string, never an r2_key.
export function selectUploadSessionStatusStatement(
  database: SqlDatabase,
  sessionId: UploadSessionId,
): SqlStatement {
  return database
    .prepare(
      `SELECT s.status AS session_status, v.status AS version_status, v.scan_detail ` +
        `FROM ${UPLOAD_SESSION_TABLE} s JOIN ${FILE_VERSION_TABLE} v ON v.id = s.file_version_id WHERE s.id = ?1`,
    )
    .bind(sessionId);
}

export async function getUploadSessionStatus(
  database: SqlDatabase,
  sessionId: UploadSessionId,
): Promise<UploadSessionStatus | undefined> {
  const { results } = await selectUploadSessionStatusStatement(database, sessionId).all<{
    session_status: "open" | "completed" | "aborted" | "expired";
    version_status: "pending" | "clean" | "quarantined" | "abandoned";
    scan_detail: string | null;
  }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    sessionStatus: row.session_status,
    versionStatus: row.version_status,
    quarantineReason: row.version_status === "quarantined" ? row.scan_detail : null,
  };
}

// A file in the firm whose current version holds exactly these bytes.
export interface ContentMatch {
  readonly versionId: FileVersionId;
  readonly fileId: FileId;
  readonly matterId: MatterId;
  readonly folderId: FolderId | null;
  readonly name: string;
  readonly sizeBytes: number | null;
}

// Every live file in the firm whose current version's bytes hash to this digest AND are this many
// bytes long — the size is a second key, so a digest collision (or a caller's mistaken digest) cannot
// pass an unrelated file off as the same one. What the upload dialog reads before sending bytes.
export async function findCurrentVersionsByContent(
  database: SqlDatabase,
  contentSha256: string,
  sizeBytes: number,
): Promise<ContentMatch[]> {
  const { results } = await selectCurrentCleanVersionsBySha256Statement(
    database,
    contentSha256,
  ).all<{
    version_id: FileVersionId;
    file_id: FileId;
    matter_id: MatterId;
    folder_id: FolderId | null;
    name: string;
    size_bytes: number | null;
  }>();
  return results
    .filter((row) => row.size_bytes === sizeBytes)
    .map((row) => ({
      versionId: row.version_id,
      fileId: row.file_id,
      matterId: row.matter_id,
      folderId: row.folder_id,
      name: row.name,
      sizeBytes: row.size_bytes,
    }));
}

// The clean current version of a non-deleted file — for the signed-download path (r2_key) and the
// ZIP selection. Returns nothing for a deleted file or one without a committed version.
export function selectCurrentCleanVersionStatement(
  database: SqlDatabase,
  fileId: FileId,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id, v.r2_key, v.size_bytes, v.version_number, v.scan_verdict, v.scan_detail, f.name, v.export_copy_state, v.export_r2_key, v.export_size_bytes FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id WHERE f.id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
    )
    .bind(fileId);
}

export interface CleanVersion extends ExportCopyFacts {
  readonly id: FileVersionId;
  readonly r2Key: string;
  readonly sizeBytes: number | null;
  readonly versionNumber: number;
  // The committed version's scan verdict + detail. A re-scan can flag an ALREADY-committed (still
  // visible) version `flagged` without hiding it (informed access) — so the download path must read
  // the verdict here and gate a flagged version, rather than assume status='clean' means safe.
  readonly scanVerdict: "unscanned" | "clean" | "flagged" | null;
  readonly scanDetail: string | null;
  // The file's own name. Carried by the join this read already makes rather than fetched again: the
  // download register records what a member took, and "what they took" is a name, not a key.
  readonly name: string;
}

export interface FileWithCurrentCleanVersion {
  readonly name: string;
  readonly matterId: MatterId;
  readonly deletedAt: string | null;
  // The current clean version, or null when the file has none (no committed version yet, or current
  // points at a non-clean version). Distinct from `undefined` (the whole file row absent).
  readonly currentVersion: CleanVersion | null;
}

// File metadata + its current clean version in ONE round-trip, for the latency-sensitive hot paths
// (WOPI CheckFileInfo on every callback, the edit/view launch). A LEFT JOIN gated on status='clean'
// keeps the file row available so callers still distinguish absent (undefined) vs deleted (deletedAt
// set) vs no-clean-version (currentVersion null) — without a second read of the file row.
export async function getFileWithCurrentCleanVersion(
  database: SqlDatabase,
  fileId: FileId,
): Promise<FileWithCurrentCleanVersion | undefined> {
  const { results } = await database
    .prepare(
      `SELECT f.name, f.matter_id, f.deleted_at, v.id AS version_id, v.r2_key, v.size_bytes, v.version_number, v.scan_verdict, v.scan_detail, v.export_copy_state, v.export_r2_key, v.export_size_bytes FROM ${FILE_TABLE} f LEFT JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id AND v.status = 'clean' WHERE f.id = ?1`,
    )
    .bind(fileId)
    .all<{
      name: string;
      matter_id: MatterId;
      deleted_at: string | null;
      version_id: FileVersionId | null;
      r2_key: string | null;
      size_bytes: number | null;
      version_number: number | null;
      scan_verdict: "unscanned" | "clean" | "flagged" | null;
      scan_detail: string | null;
      export_copy_state: ExportCopyState | null;
      export_r2_key: string | null;
      export_size_bytes: number | null;
    }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    name: row.name,
    matterId: row.matter_id,
    deletedAt: row.deleted_at,
    currentVersion:
      row.version_id === null
        ? null
        : {
            id: row.version_id,
            r2Key: row.r2_key as string,
            sizeBytes: row.size_bytes,
            versionNumber: row.version_number as number,
            scanVerdict: row.scan_verdict,
            scanDetail: row.scan_detail,
            // This read already has the file's name at the top level; the nested version carries it
            // too so every CleanVersion answers the same questions whichever read produced it.
            name: row.name,
            exportCopyState: row.export_copy_state,
            exportR2Key: row.export_r2_key,
            exportSizeBytes: row.export_size_bytes,
          },
  };
}

// The file row plus ONE NAMED version of that file — the read for a caller that already holds a
// version handle and must be served exactly that version, not whatever the file's current pointer has
// advanced to since. The version is resolved only when it is clean AND belongs to this file, so a
// handle naming another file's version, a withdrawn version, or a still-pending one resolves to null.
// The file row still comes back either way, so the caller distinguishes absent (undefined) from
// deleted (deletedAt set) from no-longer-servable (version null) without a second read.
export interface FileWithNamedVersion {
  readonly name: string;
  readonly matterId: MatterId;
  readonly deletedAt: string | null;
  readonly version: CleanVersion | null;
}

export async function getFileWithNamedVersion(
  database: SqlDatabase,
  fileId: FileId,
  versionId: FileVersionId,
): Promise<FileWithNamedVersion | undefined> {
  const { results } = await database
    .prepare(
      `SELECT f.name, f.matter_id, f.deleted_at, v.id AS version_id, v.r2_key, v.size_bytes, v.version_number, v.scan_verdict, v.scan_detail, v.export_copy_state, v.export_r2_key, v.export_size_bytes FROM ${FILE_TABLE} f LEFT JOIN ${FILE_VERSION_TABLE} v ON v.id = ?2 AND v.file_id = f.id AND v.status = 'clean' WHERE f.id = ?1`,
    )
    .bind(fileId, versionId)
    .all<{
      name: string;
      matter_id: MatterId;
      deleted_at: string | null;
      version_id: FileVersionId | null;
      r2_key: string | null;
      size_bytes: number | null;
      version_number: number | null;
      scan_verdict: "unscanned" | "clean" | "flagged" | null;
      scan_detail: string | null;
      export_copy_state: ExportCopyState | null;
      export_r2_key: string | null;
      export_size_bytes: number | null;
    }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    name: row.name,
    matterId: row.matter_id,
    deletedAt: row.deleted_at,
    version:
      row.version_id === null
        ? null
        : {
            id: row.version_id,
            r2Key: row.r2_key as string,
            sizeBytes: row.size_bytes,
            versionNumber: row.version_number as number,
            scanVerdict: row.scan_verdict,
            scanDetail: row.scan_detail,
            // This read already has the file's name at the top level; the nested version carries it
            // too so every CleanVersion answers the same questions whichever read produced it.
            name: row.name,
            exportCopyState: row.export_copy_state,
            exportR2Key: row.export_r2_key,
            exportSizeBytes: row.export_size_bytes,
          },
  };
}

// The archive-browse read: the file row plus its current clean version's key and sniffed type,
// DELIBERATELY without a deleted_at predicate — a soft-deleted zip browses exactly like a live one,
// because browsing reads already-committed bytes and restores nothing. A sibling of
// getFileWithCurrentCleanVersion rather than an extension of it, because each reader projects its
// own columns; the LEFT JOIN stays gated on status = 'clean', so a pending or quarantined version is
// never the one browsed.
export interface FileWithArchiveVersion {
  readonly name: string;
  readonly matterId: MatterId;
  readonly deletedAt: string | null;
  // The current clean version, or null when the file has none yet (pending-only / quarantined-only).
  readonly currentVersion: {
    readonly id: FileVersionId;
    readonly r2Key: string;
    readonly sniffedContentType: string | null;
  } | null;
}

export async function getFileWithArchiveVersion(
  database: SqlDatabase,
  fileId: FileId,
): Promise<FileWithArchiveVersion | undefined> {
  const { results } = await database
    .prepare(
      `SELECT f.name, f.matter_id, f.deleted_at, v.id AS version_id, v.r2_key, v.sniffed_content_type FROM ${FILE_TABLE} f LEFT JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id AND v.status = 'clean' WHERE f.id = ?1`,
    )
    .bind(fileId)
    .all<{
      name: string;
      matter_id: MatterId;
      deleted_at: string | null;
      version_id: FileVersionId | null;
      r2_key: string | null;
      sniffed_content_type: string | null;
    }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    name: row.name,
    matterId: row.matter_id,
    deletedAt: row.deleted_at,
    currentVersion:
      row.version_id === null
        ? null
        : {
            id: row.version_id,
            r2Key: row.r2_key as string,
            sniffedContentType: row.sniffed_content_type,
          },
  };
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
    name: string;
    export_copy_state: ExportCopyState | null;
    export_r2_key: string | null;
    export_size_bytes: number | null;
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
    name: row.name,
    exportCopyState: row.export_copy_state,
    exportR2Key: row.export_r2_key,
    exportSizeBytes: row.export_size_bytes,
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

// Every still-Standard clean version of a file whose time in Trash is over: deleted before the
// cutoff (the firm's trash window back from now). The current version is included, because a deleted
// file's current version is as cold as its history. The tiering sweep moves these to Infrequent
// Access when the firm's deleted-file policy says "archive"; a restored file has no deleted_at and
// drops out of the scan at once.
export function listExpiredTrashVersionsStatement(
  database: SqlDatabase,
  deletedBeforeIso: string,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      `SELECT v.id, v.r2_key, v.size_bytes, v.artifact_role ` +
        `FROM ${FILE_VERSION_TABLE} v JOIN ${FILE_TABLE} f ON f.id = v.file_id ` +
        `WHERE v.status = 'clean' AND v.storage_class = 'standard' ` +
        `AND f.deleted_at IS NOT NULL AND f.deleted_at < ?1 ` +
        `LIMIT ?2`,
    )
    .bind(deletedBeforeIso, limit);
}

export async function listExpiredTrashVersions(
  database: SqlDatabase,
  deletedBeforeIso: string,
  limit: number,
): Promise<TierableVersion[]> {
  const { results } = await listExpiredTrashVersionsStatement(
    database,
    deletedBeforeIso,
    limit,
  ).all<{
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

// A file's committed version history (clean only) — newest first, one page at a time.
//
// PAGED because a version history only grows: a document under daily revision for five years is
// close to two thousand versions, and this read carried no bound at all. The sort key is
// version_number, which is already unique per file and already the order a person reads a history
// in, so it is a total order on its own; the identifier rides along in the cursor for the shape the
// encoding takes, not because it is needed to break a tie.
export function listCleanVersionsStatement(
  database: SqlDatabase,
  fileId: FileId,
  options: { readonly cursor?: SortCursor; readonly limit: number } = { limit: DEFAULT_PAGE_SIZE },
): SqlStatement {
  const conditions = ["v.file_id = ?", "v.status = 'clean'"];
  const bindings: unknown[] = [fileId];
  if (options.cursor !== undefined) {
    // Written out rather than composed with appendCursorPredicateOnColumn, because that helper binds
    // the sort value as the TEXT the cursor carries and version_number is an INTEGER. SQLite orders
    // across storage classes before it compares within one, so every integer is less than every
    // string: `version_number < '9'` would be true for every row in the table and the page would not
    // advance. The comparison has to be numeric, so the binding is a number.
    conditions.push("(v.version_number < ? OR (v.version_number = ? AND v.id < ?))");
    const sortValue = Number(options.cursor.createdAt);
    bindings.push(sortValue, sortValue, options.cursor.id);
  }
  bindings.push(options.limit);
  return database
    .prepare(
      `SELECT v.id, v.version_number, v.r2_key, v.size_bytes, v.sniffed_content_type, v.content_sha256, v.committed_at, v.inline_playable, v.uploaded_by, v.scan_verdict, v.scan_engine_version, v.scan_detail, v.save_kind, m.display_name AS uploaded_by_name, ` +
        // Everyone in the session when the version was cut, as "id<US>name" pairs joined by the record
        // separator: a name is firm-authored text and a comma inside one would split a person in two.
        // The name is read off the member row at query time, so a renamed member reads under their
        // current name and a departed one keeps the id and loses only the name. The subquery reads the
        // participant table, not file_version; the version's status is the outer WHERE's. fitness:allow-no-status
        `(SELECT group_concat(p.member_user_id || char(31) || COALESCE(pm.display_name, ''), char(30)) FROM ${FILE_VERSION_PARTICIPANT_TABLE} p LEFT JOIN ${MEMBER_TABLE} pm ON pm.user_id = p.member_user_id WHERE p.version_id = v.id) AS participants ` +
        `FROM ${FILE_VERSION_TABLE} v LEFT JOIN ${MEMBER_TABLE} m ON m.user_id = v.uploaded_by ` +
        `WHERE ${conditions.join(" AND ")} ORDER BY v.version_number DESC, v.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export interface CleanVersionListItem {
  readonly id: FileVersionId;
  readonly versionNumber: number;
  readonly sizeBytes: number | null;
  readonly sniffedContentType: string | null;
  readonly contentSha256: string | null;
  readonly committedAt: string | null;
  readonly inlinePlayable: "playable" | "download-only" | "indeterminate" | null;
  /** Who uploaded this version, and what the firm calls them — see FileListItem for the two halves. */
  readonly uploadedBy: UserId | null;
  readonly uploadedByName: string | null;
  /**
   * The version's standing safety verdict, the engine that reached it, and the engine's own detail —
   * the facts the Safety tab reads per version. A committed version always carries a verdict; null
   * is the engine-less launch state read back as "not scanned".
   */
  readonly scanVerdict: "unscanned" | "clean" | "flagged" | null;
  readonly scanEngineVersion: string | null;
  readonly scanDetail: string | null;
  /** What kind of save cut this version from the working copy; null for an upload or a restore. */
  readonly saveKind: VersionSaveKind | null;
  /** Everyone in the editing session when the version was cut, the author included. */
  readonly participants: readonly VersionParticipant[];
}

export interface VersionParticipant {
  readonly userId: UserId;
  /** The member's current display name, or null where the member row is gone. */
  readonly name: string | null;
}

/** "id<US>name<RS>id<US>name" back into participants; an empty name is a departed member. */
export function participantsOf(joined: string | null): VersionParticipant[] {
  if (joined === null || joined === "") return [];
  return joined.split("\u001E").map((pair) => {
    const [userId = "", name = ""] = pair.split("\u001F");
    return { userId: userId as UserId, name: name === "" ? null : name };
  });
}

export async function listCleanVersions(
  database: SqlDatabase,
  fileId: FileId,
  options: { readonly cursor?: string; readonly pageSize?: number } = {},
): Promise<Page<CleanVersionListItem>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const { results } = await listCleanVersionsStatement(database, fileId, {
    ...(decodeCursor(options.cursor) === undefined ? {} : { cursor: decodeCursor(options.cursor) }),
    // One more than the page, as the has-more probe.
    limit: pageSize + 1,
  }).all<{
    id: FileVersionId;
    version_number: number;
    size_bytes: number | null;
    sniffed_content_type: string | null;
    content_sha256: string | null;
    committed_at: string | null;
    inline_playable: "playable" | "download-only" | "indeterminate" | null;
    uploaded_by: UserId | null;
    uploaded_by_name: string | null;
    scan_verdict: "unscanned" | "clean" | "flagged" | null;
    scan_engine_version: string | null;
    scan_detail: string | null;
    save_kind: VersionSaveKind | null;
    participants: string | null;
  }>();
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    nextCursor:
      hasMore && last !== undefined ? encodeCursor(String(last.version_number), last.id) : null,
    data: rows.map((row) => ({
      id: row.id,
      versionNumber: row.version_number,
      sizeBytes: row.size_bytes,
      sniffedContentType: row.sniffed_content_type,
      contentSha256: row.content_sha256,
      committedAt: row.committed_at,
      inlinePlayable: row.inline_playable,
      uploadedBy: row.uploaded_by,
      uploadedByName: row.uploaded_by_name,
      saveKind: row.save_kind,
      participants: participantsOf(row.participants),
      scanVerdict: row.scan_verdict,
      scanEngineVersion: row.scan_engine_version,
      scanDetail: row.scan_detail,
    })),
  };
}

/** The audit events that record a safety scan of one version, in the order they are written. */
export const VERSION_SCAN_EVENTS = [
  "file.version_committed",
  "file.version_rescanned",
  "file.quarantined",
  "file.rescan_requested",
] as const;

export type VersionScanEvent = (typeof VERSION_SCAN_EVENTS)[number];

export interface VersionScanEventItem {
  readonly id: string;
  readonly at: string;
  readonly event: VersionScanEvent;
  readonly versionId: FileVersionId;
  readonly versionNumber: number;
  /** Who asked, for a request; null for a scan the platform ran on its own. */
  readonly actorUserId: UserId | null;
  readonly actorName: string | null;
  /** What the scan found, as the event recorded it; null where the event carried no such fact. */
  readonly scanVerdict: "unscanned" | "clean" | "flagged" | null;
  /**
   * The engine on the line: the composite the scan ran under, or — on a request — the engine that
   * was recorded for the firm at the moment somebody asked. Null where the row carried neither.
   */
  readonly scanEngineVersion: string | null;
  readonly scanDetail: string | null;
  /**
   * Whether a request actually reached the scan queue. Only a request row records it; null on every
   * other kind. A request that was recorded and never queued is the fact the history otherwise
   * withheld — the line said somebody asked and nothing said that nothing was going to happen.
   */
  readonly queued: boolean | null;
}

const VERSION_SCAN_EVENT_LIMIT = 200;

// One file's safety history, read off the per-firm audit_log: every commit, re-scan, quarantine and
// re-scan request against any of its versions, newest first. The verdict facts ride in the event's
// own metadata, written the moment the scan finished — the version row only ever holds the LATEST
// verdict, so a history that read the row would show the same engine on every line. The join to
// file_version spans every status on purpose: a quarantined version's history is exactly the one a
// reader most wants to see. It serves no bytes (version_number only). fitness:allow-no-status
export async function listVersionScanEvents(
  database: SqlDatabase,
  fileId: FileId,
): Promise<VersionScanEventItem[]> {
  const placeholders = VERSION_SCAN_EVENTS.map(() => "?").join(", ");
  const { results } = await database
    .prepare(
      `SELECT a.id, a.created_at, a.event, a.subject_id, a.actor_user_id, a.metadata, ` +
        `v.version_number, m.display_name AS actor_name ` +
        `FROM ${AUDIT_LOG_TABLE} a ` +
        `JOIN ${FILE_VERSION_TABLE} v ON v.id = a.subject_id AND v.file_id = ? ` +
        `LEFT JOIN ${MEMBER_TABLE} m ON m.user_id = a.actor_user_id ` +
        `WHERE a.event IN (${placeholders}) ` +
        `ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    )
    .bind(fileId, ...VERSION_SCAN_EVENTS, VERSION_SCAN_EVENT_LIMIT)
    .all<{
      id: string;
      created_at: string;
      event: VersionScanEvent;
      subject_id: FileVersionId;
      actor_user_id: UserId | null;
      metadata: string | null;
      version_number: number;
      actor_name: string | null;
    }>();
  return results.map((row) => {
    const facts = scanFactsFromMetadata(row.metadata);
    return Object.assign(
      {
        id: row.id,
        at: row.created_at,
        event: row.event,
        versionId: row.subject_id,
        versionNumber: row.version_number,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
      },
      facts,
    );
  });
}

// The scan facts an audit row carries, read defensively: metadata is JSON the writer chose, and an
// older row (or one written by a path that recorded only a flagged reason) may carry any subset.
function scanFactsFromMetadata(metadata: string | null): {
  readonly scanVerdict: "unscanned" | "clean" | "flagged" | null;
  readonly scanEngineVersion: string | null;
  readonly scanDetail: string | null;
  readonly queued: boolean | null;
} {
  const none = {
    scanVerdict: null,
    scanEngineVersion: null,
    scanDetail: null,
    queued: null,
  } as const;
  if (metadata === null) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return none;
  }
  if (typeof parsed !== "object" || parsed === null) return none;
  const record = parsed as Record<string, unknown>;
  const verdict = record["scanVerdict"];
  // A scan row records the engine it ran under; a request row records the engine that stood for the
  // firm when it was asked, under its own key. Both answer "what engine is on this line", and a row
  // never carries both, so one field reads either without ambiguity.
  const engine = record["scanEngineVersion"] ?? record["currentEngineVersion"];
  const detail = record["scanDetail"];
  const queued = record["enqueued"];
  return {
    scanVerdict:
      verdict === "unscanned" || verdict === "clean" || verdict === "flagged" ? verdict : null,
    scanEngineVersion: typeof engine === "string" ? engine : null,
    scanDetail: typeof detail === "string" ? detail : null,
    queued: typeof queued === "boolean" ? queued : null,
  };
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

// The same baseline for ONE NAMED clean version of the file, so a reader can verify an older version
// against what intake recorded for it. Scoped by both ids: a version id from another file (or another
// firm's) matches nothing.
export async function getVersionForIntegrity(
  database: SqlDatabase,
  fileId: FileId,
  versionId: FileVersionId,
): Promise<VersionIntegrity | undefined> {
  const { results } = await database
    .prepare(
      `SELECT v.id, v.r2_key, v.size_bytes, v.content_sha256 FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.file_id = f.id WHERE f.id = ?1 AND v.id = ?2 AND f.deleted_at IS NULL AND v.status = 'clean'`,
    )
    .bind(fileId, versionId)
    .all<{
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
      `SELECT f.id AS file_id, f.folder_id, f.name, v.id AS version_id, v.r2_key, v.size_bytes, ` +
        `v.export_copy_state, v.export_r2_key, v.export_size_bytes ` +
        `FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id ` +
        `WHERE f.matter_id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean'`,
    )
    .bind(matterId);
}

export interface MatterCleanFile extends ExportCopyFacts {
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
    export_copy_state: ExportCopyState | null;
    export_r2_key: string | null;
    export_size_bytes: number | null;
  }>();
  return results.map((row) => ({
    fileId: row.file_id,
    folderId: row.folder_id,
    name: row.name,
    versionId: row.version_id,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    exportCopyState: row.export_copy_state,
    exportR2Key: row.export_r2_key,
    exportSizeBytes: row.export_size_bytes,
  }));
}

// The facts the discovery-search write pipeline needs about a just-committed version, resolved from the
// version handle in one read: which file and matter it belongs to (the index is matter-scoped), which
// version number it is (the index is idempotent on file + version), where its bytes are, and what the
// sniff decided it is. Filtered to `clean` and to a live file, so a quarantined or deleted document can
// never be enqueued for indexing — the same read mediation every other consumer read applies.
export interface IndexableVersion {
  readonly versionId: FileVersionId;
  readonly fileId: FileId;
  readonly matterId: MatterId;
  readonly versionNumber: number;
  readonly r2Key: string;
  // The committed size, so the enqueue seam can decide whether extraction can hold this document at all
  // before a consumer tries to. Null for a row that predates the column being populated.
  readonly sizeBytes: number | null;
  readonly contentType: string | null;
}

export async function loadIndexableVersion(
  database: SqlDatabase,
  versionId: FileVersionId,
): Promise<IndexableVersion | undefined> {
  const { results } = await database
    .prepare(
      `SELECT v.id, v.file_id, f.matter_id, v.version_number, v.r2_key, v.size_bytes, v.sniffed_content_type, v.declared_content_type FROM ${FILE_VERSION_TABLE} v JOIN ${FILE_TABLE} f ON f.id = v.file_id WHERE v.id = ?1 AND v.status = 'clean' AND f.deleted_at IS NULL`,
    )
    .bind(versionId)
    .all<{
      id: FileVersionId;
      file_id: FileId;
      matter_id: MatterId;
      version_number: number;
      r2_key: string;
      size_bytes: number | null;
      sniffed_content_type: string | null;
      declared_content_type: string | null;
    }>();
  const row = results[0];
  if (row === undefined) return undefined;
  return {
    versionId: row.id,
    fileId: row.file_id,
    matterId: row.matter_id,
    versionNumber: row.version_number,
    r2Key: row.r2_key,
    sizeBytes: row.size_bytes,
    // The sniffed type is what the bytes actually are; the declared one is only what the uploader
    // claimed. Prefer the sniff and fall back, so the extract stage is told the truth when we know it.
    contentType: row.sniffed_content_type ?? row.declared_content_type,
  };
}

// Whether the file contents index holds a version, written over the aliases `v` (file_version) that
// every statement below reads it under. A version is held either as its own live split, or as a live
// member of a live merged split: compaction retires the small per-document splits it merges and
// leaves the membership as the only record that the version is searchable, so a predicate that looked
// at the first form alone would call every compacted document missing.
//
// ONE spelling, shared by the read that finds what to index and the read that counts what is indexed,
// so a firm is never shown "nothing waiting" while the repair pass still has work, or the reverse.
// Both probes go through an index on the document (`index_split_document_index`,
// `index_split_member_document_index`).
const VERSION_HELD_BY_SEARCH_INDEX =
  `(EXISTS (SELECT 1 FROM ${INDEX_SPLIT_TABLE} s ` +
  `WHERE s.document_id = v.file_id AND s.version = v.version_number AND s.superseded_at IS NULL) ` +
  `OR EXISTS (SELECT 1 FROM ${INDEX_SPLIT_MEMBER_TABLE} m ` +
  `JOIN ${INDEX_SPLIT_TABLE} s ON s.id = m.split_id ` +
  `WHERE m.document_id = v.file_id AND m.version = v.version_number ` +
  `AND m.superseded_at IS NULL AND s.superseded_at IS NULL))`;

// The versions the file contents index is FOR, over the aliases `v` (file_version) and `f` (file):
// the current version of a live file, committed and clean. A superseded version is not in the corpus
// by design, and a pending, quarantined or deleted one is never read by anything.
const VERSION_BELONGS_IN_SEARCH_INDEX =
  `v.status = 'clean' AND v.committed_at IS NOT NULL ` +
  `AND f.deleted_at IS NULL AND f.current_version_id = v.id`;

// The re-extraction sweep's candidates: files whose CURRENT version is committed and clean but which
// the search catalog does not hold. That set is exactly the documents missing from the
// searchable corpus, whatever put them there — a job that failed, a job whose extraction engine could
// not read the document at the time, an enqueue that never fired because the best-effort call after
// ingest commit lost its race, or a firm that turned indexing on after its documents were already
// loaded. None of those are distinguishable from the catalog and none of them need to be: the repair
// is the same in every case, and it is idempotent, because the split id is derived from the document
// and version so a re-run converges on the same split rather than a duplicate.
//
// The file's current version only. A superseded version is not in the corpus by design — the write
// pipeline keeps one live split per document — so sweeping every version would re-enqueue history
// forever and never converge.
//
// Bounded by `limit` so one pass never enqueues an unbounded backlog; the next pass takes the next
// batch.
//
// A KEYSET CURSOR, NOT AN OFFSET. Two of the terminal outcomes a candidate can reach — `deferred` (the
// extraction engine is not bound, the documented default) and `failed` (bytes nothing can read) — leave
// no split row behind, so those documents stay candidates forever. Ordered by `committed_at` alone and
// restarted from the top every pass, a firm whose oldest documents are all scans would re-read the same
// head on every run and never reach the rest of its catalogue. The cursor is what lets the caller
// advance past a candidate it has already dealt with, whatever the outcome was, so the walk is over the
// WHOLE catalogue rather than over its head repeatedly.
//
// (committed_at, id) as the key, because `committed_at` is not unique — two versions committed in the
// same millisecond would otherwise let the cursor skip one or loop on it. fitness:allow-no-status
export function listVersionsMissingFromSearchIndexStatement(
  database: SqlDatabase,
  limit: number,
  after?: SearchIndexCandidateCursor,
): SqlStatement {
  const cursorPredicate = after === undefined ? "" : `AND (v.committed_at, v.id) > (?2, ?3) `;
  const statement = database.prepare(
    `SELECT v.id, v.committed_at ` +
      `FROM ${FILE_VERSION_TABLE} v JOIN ${FILE_TABLE} f ON f.id = v.file_id ` +
      `WHERE ${VERSION_BELONGS_IN_SEARCH_INDEX} ` +
      `AND NOT ${VERSION_HELD_BY_SEARCH_INDEX} ` +
      cursorPredicate +
      `ORDER BY v.committed_at, v.id ` +
      `LIMIT ?1`,
  );
  return after === undefined
    ? statement.bind(limit)
    : statement.bind(limit, after.committedAt, after.versionId);
}

/** Where a sweep left off, so the next page resumes rather than restarting at the catalogue's head. */
export interface SearchIndexCandidateCursor {
  readonly committedAt: string;
  readonly versionId: FileVersionId;
}

export interface SearchIndexCandidate {
  readonly versionId: FileVersionId;
  readonly committedAt: string;
}

export async function listVersionsMissingFromSearchIndex(
  database: SqlDatabase,
  limit: number,
  after?: SearchIndexCandidateCursor,
): Promise<SearchIndexCandidate[]> {
  const { results } = await listVersionsMissingFromSearchIndexStatement(
    database,
    limit,
    after,
  ).all<{
    id: FileVersionId;
    committed_at: string;
  }>();
  return results.map((row) => ({ versionId: row.id, committedAt: row.committed_at }));
}

// How much of a firm's files the file contents index holds: how many files belong in it, how many of
// those it holds, and when it last took one in.
//
// `belonging - held` is what is NOT indexed, and that is all it says. It is not a queue: a file whose
// text nothing can read (a scan with no text layer while no recognition engine is bound, bytes no
// extractor understands) leaves no catalog row behind and stays in that number for good. A screen
// showing it says "not indexed", never "waiting".
export interface SearchIndexCoverage {
  readonly belonging: number;
  readonly held: number;
  // When the newest live split of a matter's files was published, or null where there is none.
  readonly lastIndexedAt: string | null;
}

// WHAT IT COSTS: one row per live file, each with at most two probes by document. That is the whole
// file table for a firm, so this is a read for a screen a person opened and never for a request path
// or a loop.
export async function readSearchIndexCoverage(database: SqlDatabase): Promise<SearchIndexCoverage> {
  const [counts, newest] = await Promise.all([
    database
      .prepare(
        `SELECT COUNT(*) AS belonging, ` +
          `COALESCE(SUM(CASE WHEN ${VERSION_HELD_BY_SEARCH_INDEX} THEN 1 ELSE 0 END), 0) AS held ` +
          `FROM ${FILE_TABLE} f JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id ` +
          `WHERE ${VERSION_BELONGS_IN_SEARCH_INDEX}`,
      )
      .all<{ belonging: number; held: number }>(),
    database
      .prepare(
        `SELECT MAX(created_at) AS newest FROM ${INDEX_SPLIT_TABLE} ` +
          `WHERE corpus_kind = 'matter' AND superseded_at IS NULL`,
      )
      .all<{ newest: string | null }>(),
  ]);
  return {
    belonging: counts.results[0]?.belonging ?? 0,
    held: counts.results[0]?.held ?? 0,
    lastIndexedAt: newest.results[0]?.newest ?? null,
  };
}

// For each of a set of files, the version the matter's file contents index holds: the version whose
// text a search result may quote. A file is answered for only when it is on this matter, is not
// deleted, and that version is still clean, so a file that was moved, removed or held by the scan
// since it was indexed is quoted from by nobody, whatever the index still says about it.
//
// The version comes from the catalog and not from the file's current version, because the two differ
// for as long as a new version is waiting to be indexed, and the page an index match names is a page
// of the version that was indexed. A version is live either as its own split or as a member of a
// merged one; the newer wins in the moment a re-index leaves both.
//
// One statement for the whole set. The set is a page of search results, bounded by the caller.
export async function listQuotableIndexedVersions(
  database: SqlDatabase,
  matterId: MatterId,
  fileIds: readonly FileId[],
): Promise<Map<FileId, number>> {
  if (fileIds.length === 0) return new Map();
  const placeholders = fileIds.map((_, index) => `?${index + 2}`).join(", ");
  const { results } = await database
    .prepare(
      `SELECT held.document_id AS file_id, MAX(held.version) AS version FROM (` +
        `SELECT s.document_id, s.version FROM ${INDEX_SPLIT_TABLE} s ` +
        `WHERE s.corpus_id = ?1 AND s.superseded_at IS NULL AND s.document_id IN (${placeholders}) ` +
        `UNION ALL ` +
        `SELECT m.document_id, m.version FROM ${INDEX_SPLIT_MEMBER_TABLE} m ` +
        `JOIN ${INDEX_SPLIT_TABLE} s ON s.id = m.split_id ` +
        `WHERE s.corpus_id = ?1 AND s.superseded_at IS NULL AND m.superseded_at IS NULL ` +
        `AND m.document_id IN (${placeholders})` +
        `) held ` +
        `JOIN ${FILE_TABLE} f ON f.id = held.document_id ` +
        `JOIN ${FILE_VERSION_TABLE} v ON v.file_id = f.id AND v.version_number = held.version ` +
        `WHERE f.matter_id = ?1 AND f.deleted_at IS NULL AND v.status = 'clean' ` +
        `GROUP BY held.document_id`,
    )
    .bind(matterId, ...fileIds)
    .all<{ file_id: FileId; version: number }>();
  return new Map(results.map((row) => [row.file_id, row.version]));
}

// The matter each of a set of files belongs to. The repair pass that stamps object metadata after the
// fact starts from R2 keys — which carry a file id and deliberately no matter — so it needs exactly
// this mapping, for a page of keys at a time rather than one query per object.
//
// SOFT-DELETED FILES ARE INCLUDED, and that is the point: a deleted file's objects are still in the
// bucket, still cost storage, and still belong to the matter they were filed under. Excluding them
// would leave precisely the objects nobody looks at as the ones nothing can scope.
//
// The ids are asked for in bounded groups because a bound-parameter list is not unbounded and a listing
// page can carry a thousand keys — a single IN over the whole page would work locally and fail against
// a real database on the size of firm that most needs the repair.
const MATTER_LOOKUP_GROUP_SIZE = 90;

export async function listMatterIdsByFileIds(
  database: SqlDatabase,
  fileIds: readonly FileId[],
): Promise<Map<FileId, MatterId>> {
  const found = new Map<FileId, MatterId>();
  for (let start = 0; start < fileIds.length; start += MATTER_LOOKUP_GROUP_SIZE) {
    const group = fileIds.slice(start, start + MATTER_LOOKUP_GROUP_SIZE);
    const placeholders = group.map(() => "?").join(", ");
    const { results } = await database
      .prepare(`SELECT id, matter_id FROM ${FILE_TABLE} WHERE id IN (${placeholders})`)
      .bind(...group)
      .all<{ id: FileId; matter_id: MatterId }>();
    for (const row of results) found.set(row.id, row.matter_id);
  }
  return found;
}

// The current names of a set of document types — the file-history read resolves the type ids its
// audit metadata recorded into display names, a page's distinct ids at a time (never one query per
// row). Grouped IN for the same bound-parameter reason listMatterIdsByFileIds gives; a deactivated
// type still resolves (its row survives), and an id whose row is gone is simply absent from the map.
export async function listDocumentTypeNamesByIds(
  database: SqlDatabase,
  documentTypeIds: readonly DocumentTypeId[],
): Promise<Map<DocumentTypeId, string>> {
  const found = new Map<DocumentTypeId, string>();
  for (let start = 0; start < documentTypeIds.length; start += MATTER_LOOKUP_GROUP_SIZE) {
    const group = documentTypeIds.slice(start, start + MATTER_LOOKUP_GROUP_SIZE);
    const placeholders = group.map(() => "?").join(", ");
    const { results } = await database
      .prepare(`SELECT id, name FROM ${DOCUMENT_TYPE_TABLE} WHERE id IN (${placeholders})`)
      .bind(...group)
      .all<{ id: DocumentTypeId; name: string }>();
    for (const row of results) found.set(row.id, row.name);
  }
  return found;
}

// A matter's soft-deleted files — the recovery ("Deleted Files") view, newest deletion first, one
// page at a time on a (deleted_at, id) keyset. The deleter is resolved from the audit trail rather
// than a column: the latest 'file.deleted' audit row for the file names the actor, and the member
// mirror supplies the display name — an actor whose member row is gone (or a system deletion with no
// actor) renders an honest null. folder_id is returned as stored even when the folder row itself was
// deleted, because the restore path is what decides whether that pointer still resolves. The display
// facts (size, sniffed type) come from the clean current version when one exists; a file deleted
// before any version committed carries nulls.
export interface DeletedFileListItem {
  readonly id: FileId;
  readonly name: string;
  readonly folderId: FolderId | null;
  readonly documentTypeId: DocumentTypeId | null;
  readonly deletedAt: string;
  readonly deletedBy: UserId | null;
  readonly deletedByName: string | null;
  readonly currentVersionId: FileVersionId | null;
  readonly sizeBytes: number | null;
  readonly sniffedContentType: string | null;
}

export function listDeletedFilesStatement(
  database: SqlDatabase,
  matterId: MatterId,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  const conditions = ["f.matter_id = ?", "f.deleted_at IS NOT NULL"];
  const bindings: unknown[] = [matterId];
  // The keyset orders by deleted_at (the fact this view sorts on), not created_at; the shared cursor
  // shape carries it in its sort-value slot.
  if (cursor !== undefined) {
    conditions.push("(f.deleted_at < ? OR (f.deleted_at = ? AND f.id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(limit);
  return database
    .prepare(
      `SELECT f.id, f.name, f.folder_id, f.document_type_id, f.deleted_at, f.current_version_id, ` +
        `dv.size_bytes, dv.sniffed_content_type, ` +
        `da.actor_user_id AS deleted_by, m.display_name AS deleted_by_name ` +
        `FROM ${FILE_TABLE} f ` +
        `LEFT JOIN ${FILE_VERSION_TABLE} dv ON dv.id = f.current_version_id AND dv.status = 'clean' ` +
        `LEFT JOIN ${AUDIT_LOG_TABLE} da ON da.id = (` +
        `SELECT a.id FROM ${AUDIT_LOG_TABLE} a WHERE a.subject_id = f.id AND a.event = 'file.deleted' ` +
        `ORDER BY a.created_at DESC, a.id DESC LIMIT 1) ` +
        `LEFT JOIN ${MEMBER_TABLE} m ON m.user_id = da.actor_user_id ` +
        `WHERE ${conditions.join(" AND ")} ORDER BY f.deleted_at DESC, f.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export async function listDeletedFiles(
  database: SqlDatabase,
  matterId: MatterId,
  options: { readonly cursor?: string; readonly pageSize?: number } = {},
): Promise<Page<DeletedFileListItem>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const { results } = await listDeletedFilesStatement(
    database,
    matterId,
    decodeCursor(options.cursor),
    // One more than the page, as the has-more probe.
    pageSize + 1,
  ).all<{
    id: FileId;
    name: string;
    folder_id: FolderId | null;
    document_type_id: DocumentTypeId | null;
    deleted_at: string;
    current_version_id: FileVersionId | null;
    size_bytes: number | null;
    sniffed_content_type: string | null;
    deleted_by: UserId | null;
    deleted_by_name: string | null;
  }>();
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.deleted_at, last.id) : null,
    data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      folderId: row.folder_id,
      documentTypeId: row.document_type_id,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      deletedByName: row.deleted_by_name,
      currentVersionId: row.current_version_id,
      sizeBytes: row.size_bytes,
      sniffedContentType: row.sniffed_content_type,
    })),
  };
}

// A matter's file activity trail, read straight off the per-firm audit_log, newest first on a
// (created_at, id) keyset.
//
// THREE SUBJECT SHAPES, ONE TRAIL. Rename/move/delete/restore/document-type/check-in events carry
// the FILE id; upload/version/download events carry the FILE VERSION id (the LEFT JOIN to
// file_version turns that back into its file); and 'folder.*' events carry the FOLDER id. The
// folder arm is a second SELECT rather than a wider join, because a folder is a different table and
// forcing one join to serve both would have to invent a null-file row for every folder event.
//
// Making a folder was audited from the day folders existed and never appeared here, because the
// read asked only for file events and its inner join to `file` could not have matched a folder id
// anyway. A history that silently omits a whole class of act is worse than one that says it cannot
// see it: somebody looking for who made a folder found nothing and concluded nothing had happened.
//
// A DELETED FOLDER's row is gone (a folder delete is a hard delete of an empty folder), so its name
// cannot be resolved at read time the way a file's is. That arm keeps the event and says the folder
// is no longer on the matter rather than dropping the row — what happened is the fact being read.
//
// The subject name is resolved at read time, never baked into the event. Metadata is passed through
// as the stored JSON string (already redacted at write time); actor names resolve through the
// member mirror like every other surface, null when the actor is the system or the member row is
// gone.
export interface FileHistoryItem {
  readonly at: string;
  readonly event: string;
  /** Whether this act was done to a file or to a folder. */
  readonly subjectKind: "file" | "folder";
  /** The file or folder the act was done to. */
  readonly subjectId: string;
  /** Its CURRENT name, or an honest sentence where the subject is no longer on the matter. */
  readonly subjectName: string;
  readonly versionNumber: number | null;
  readonly actorUserId: UserId | null;
  readonly actorName: string | null;
  // The audit row's redacted metadata JSON, verbatim (null when the event carried none).
  readonly metadataJson: string | null;
}

/** What a folder's name reads as once the folder itself is gone from the matter. */
const DELETED_FOLDER_NAME = "a folder no longer on the matter";

export function listFileHistoryStatement(
  database: SqlDatabase,
  matterId: MatterId,
  cursor: SortCursor | undefined,
  limit: number,
): SqlStatement {
  const conditions: string[] = [];
  // The matter scopes both arms of the union, so it is bound once per arm.
  const bindings: unknown[] = [matterId, matterId];
  if (cursor !== undefined) {
    conditions.push("(trail.created_at < ? OR (trail.created_at = ? AND trail.id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  bindings.push(limit);
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")} `;
  // The join to file_version resolves a version-subject event back to its file and version number —
  // it deliberately spans every status, because the history includes what happened to versions that
  // were quarantined or abandoned. It serves no bytes: it projects version_number only, never an
  // r2_key. fitness:allow-no-status
  return database
    .prepare(
      `SELECT trail.id, trail.created_at, trail.event, trail.actor_user_id, trail.metadata, ` +
        `trail.subject_kind, trail.subject_id, trail.subject_name, trail.version_number, ` +
        `m.display_name AS actor_name ` +
        `FROM (` +
        // The file arm: file-subject and version-subject events, both scoped through `file`.
        `SELECT a.id, a.created_at, a.event, a.actor_user_id, a.metadata, ` +
        `'file' AS subject_kind, f.id AS subject_id, f.name AS subject_name, ` +
        `v.version_number AS version_number ` +
        `FROM ${AUDIT_LOG_TABLE} a ` +
        `LEFT JOIN ${FILE_VERSION_TABLE} v ON v.id = a.subject_id ` +
        `JOIN ${FILE_TABLE} f ON f.id = COALESCE(v.file_id, a.subject_id) AND f.matter_id = ?1 ` +
        `WHERE (a.event LIKE 'file.%' OR a.event LIKE 'document.%') ` +
        `UNION ALL ` +
        // The folder arm. The join is LEFT so a folder that has since been deleted keeps its event;
        // the matter scope then rides the ON clause, and a deleted folder's own event is admitted
        // by its subject having no surviving row at all rather than by belonging to another matter.
        `SELECT a.id, a.created_at, a.event, a.actor_user_id, a.metadata, ` +
        `'folder' AS subject_kind, a.subject_id AS subject_id, ` +
        `COALESCE(d.name, '${DELETED_FOLDER_NAME}') AS subject_name, ` +
        `NULL AS version_number ` +
        `FROM ${AUDIT_LOG_TABLE} a ` +
        `LEFT JOIN ${FOLDER_TABLE} d ON d.id = a.subject_id AND d.matter_id = ?2 ` +
        `WHERE a.event LIKE 'folder.%' AND (d.id IS NOT NULL OR a.event = 'folder.deleted')` +
        `) trail ` +
        `LEFT JOIN ${MEMBER_TABLE} m ON m.user_id = trail.actor_user_id ` +
        `${where}ORDER BY trail.created_at DESC, trail.id DESC LIMIT ?`,
    )
    .bind(...bindings);
}

export async function listFileHistory(
  database: SqlDatabase,
  matterId: MatterId,
  options: { readonly cursor?: string; readonly pageSize?: number } = {},
): Promise<Page<FileHistoryItem>> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const { results } = await listFileHistoryStatement(
    database,
    matterId,
    decodeCursor(options.cursor),
    // One more than the page, as the has-more probe.
    pageSize + 1,
  ).all<{
    id: string;
    created_at: string;
    event: string;
    actor_user_id: UserId | null;
    metadata: string | null;
    version_number: number | null;
    subject_kind: "file" | "folder";
    subject_id: string;
    subject_name: string;
    actor_name: string | null;
  }>();
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
    data: rows.map((row) => ({
      at: row.created_at,
      event: row.event,
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      versionNumber: row.version_number,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      metadataJson: row.metadata,
    })),
  };
}
