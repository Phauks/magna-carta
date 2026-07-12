import { DEFAULT_PAGE_SIZE, type Page } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  DocumentCheckoutId,
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  MatterId,
  UploadSessionId,
} from "@magna-carta/identifiers/types";
import { FILE_TABLE, FILE_VERSION_TABLE, UPLOAD_SESSION_TABLE } from "./file-statements.ts";
import { FOLDER_TABLE } from "./folder-statements.ts";

// Read mediation (golden rule 3): every consumer read serves only clean, non-deleted content. A file
// is visible once it has a clean current version (current_version_id, set only on commit); a version
// read filters status = 'clean'. The pending/quarantined gate is enforced HERE, not by a key scheme.
// The cursor-paginated list draws its keyset toolkit from @magna-carta/data-access/cursor-pagination.
export type { Page };

/**
 * The columns a file list can be ordered by. Sorting is a SERVER concern, not a view one: the list is
 * keyset-paginated, so ordering the rows a client happens to hold would answer a different question
 * than the one asked — "the largest file" would mean the largest of the loaded page, not of the matter.
 */
export type FileSortKey = "name" | "createdAt" | "updatedAt" | "sizeBytes";
export type FileSortDirection = "asc" | "desc";

// Newest-first: the question asked of a file list far more often than any other is "what came in
// last". A caller that does not care still gets a deterministic order rather than whatever the
// database found convenient.
const DEFAULT_SORT: FileSortKey = "createdAt";
const DEFAULT_DIRECTION: FileSortDirection = "desc";

export interface ListFilesFilters {
  readonly matterId: MatterId;
  readonly folderId?: FolderId;
  readonly sort?: FileSortKey;
  readonly direction?: FileSortDirection;
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
  };
}

/*
 * One sortable column: the SQL expression the list is BOTH ordered and paged by, and how to read that
 * same value back off a row to mint the next cursor. The two must agree exactly — the keyset predicate
 * asks the database for "the rows after this value", so a cursor minted from a value the ORDER BY never
 * produced would silently skip or repeat rows.
 */
interface SortColumn {
  /** Qualified — the JOIN to file_version makes a bare column name ambiguous. */
  readonly expression: string;
  readonly cursorValue: (row: FileSummaryRowRaw) => string | number;
}

const SORT_COLUMNS: Record<FileSortKey, SortColumn> = {
  // NOCASE, so a name sort reads the way a person alphabetizes. SQLite's default BINARY collation
  // orders by code point, which puts every capital ahead of every lowercase letter — "Zoning" would
  // sort before "answer".
  name: { expression: "f.name COLLATE NOCASE", cursorValue: (row) => row.name },
  createdAt: { expression: "f.created_at", cursorValue: (row) => row.created_at },
  updatedAt: { expression: "f.updated_at", cursorValue: (row) => row.updated_at },
  // A pending or quarantined row never committed bytes, so its size is NULL. NULL does not compare
  // against a number, which would puncture the strict total order the keyset depends on (it is what
  // makes "the row after this one" well-defined), so an absent size is folded to -1 — below every real
  // size — in the ordering AND in the cursor, which is why both come from this one place.
  sizeBytes: {
    expression: "COALESCE(dv.size_bytes, -1)",
    cursorValue: (row) => row.size_bytes ?? -1,
  },
};

/*
 * The file list's cursor: the value of the column being sorted by, plus the id that breaks its ties.
 * It keeps the same opaque `{c, i}` envelope as the platform's shared cursor
 * (@magna-carta/data-access/cursor-pagination) — one cursor shape across every list — but `c` may
 * carry a number (a size) as well as a string, which the shared decoder rejects. That is why this
 * list has its own codec rather than reusing that one.
 */
interface FileCursor {
  readonly value: string | number;
  readonly id: string;
}

function encodeFileCursor(value: string | number, id: string): string {
  return btoa(JSON.stringify({ c: value, i: id }));
}

function decodeFileCursor(cursor: string | undefined): FileCursor | undefined {
  if (cursor === undefined) return undefined;
  try {
    const parsed = JSON.parse(atob(cursor)) as { c?: unknown; i?: unknown };
    if (
      (typeof parsed.c === "string" || typeof parsed.c === "number") &&
      typeof parsed.i === "string"
    ) {
      return { value: parsed.c, id: parsed.i };
    }
  } catch {
    // A malformed or tampered cursor reveals nothing and is treated as the first page.
  }
  return undefined;
}

// The summary columns both the list and the single-file read project — the file row plus its display
// version's version_number/size/sniffed-type/verdict/status/detail.
const FILE_SUMMARY_COLUMNS =
  "f.id, f.matter_id, f.folder_id, f.name, f.document_type_id, f.current_version_id, " +
  "f.created_at, f.updated_at, dv.version_number, dv.size_bytes, dv.sniffed_content_type, " +
  "dv.scan_verdict, dv.status AS version_status, dv.scan_detail";

export function listFilesStatement(
  database: SqlDatabase,
  filters: ListFilesFilters,
  cursor: FileCursor | undefined,
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
  // The keyset predicate, over whichever column the caller sorted by (and qualified to its table: the
  // JOIN makes a bare column name ambiguous, so this cannot reuse the shared appendCursorPredicate,
  // which emits unqualified columns). The id tiebreak runs in the SAME direction as the sort — it is
  // what makes the order strict and total, so that "the row after this one" has exactly one answer
  // even when a dozen files share a name or a size.
  const sortColumn = SORT_COLUMNS[filters.sort ?? DEFAULT_SORT];
  const descending = (filters.direction ?? DEFAULT_DIRECTION) === "desc";
  const after = descending ? "<" : ">";
  const order = descending ? "DESC" : "ASC";
  if (cursor !== undefined) {
    conditions.push(
      `(${sortColumn.expression} ${after} ? OR ` +
        `(${sortColumn.expression} = ? AND f.id ${after} ?))`,
    );
    bindings.push(cursor.value, cursor.value, cursor.id);
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
        `WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${sortColumn.expression} ${order}, f.id ${order} LIMIT ?`,
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
  const sortColumn = SORT_COLUMNS[params.sort ?? DEFAULT_SORT];
  const { results } = await listFilesStatement(
    database,
    params,
    decodeFileCursor(params.cursor),
    pageSize + 1,
  ).all<FileSummaryRowRaw>();
  // Not the shared assemblePage: that mints the next cursor from created_at, which is only the sort
  // key when the caller did not choose another one.
  const hasMore = results.length > pageSize;
  const rows = hasMore ? results.slice(0, pageSize) : results;
  const last = rows.at(-1);
  return {
    data: rows.map(toFileListItem),
    nextCursor:
      hasMore && last !== undefined
        ? encodeFileCursor(sortColumn.cursorValue(last), last.id)
        : null,
  };
}

// One file's enriched summary — the same shape a list row carries, for the detail read. Gated to a
// clean current version (status = 'clean') and a non-deleted file, so a pending-only, quarantined, or
// soft-deleted file returns undefined (the route 404s). status is therefore always "clean" here.
export function selectFileSummaryStatement(database: SqlDatabase, fileId: FileId): SqlStatement {
  return database
    .prepare(
      `SELECT ${FILE_SUMMARY_COLUMNS} FROM ${FILE_TABLE} f ` +
        `JOIN ${FILE_VERSION_TABLE} dv ON dv.id = f.current_version_id ` +
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
      `SELECT f.name, f.matter_id, f.deleted_at, v.id AS version_id, v.r2_key, v.size_bytes, v.version_number, v.scan_verdict, v.scan_detail FROM ${FILE_TABLE} f LEFT JOIN ${FILE_VERSION_TABLE} v ON v.id = f.current_version_id AND v.status = 'clean' WHERE f.id = ?1`,
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
