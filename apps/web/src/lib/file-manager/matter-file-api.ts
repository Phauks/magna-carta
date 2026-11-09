import { requestJson, type ApiOutcome } from "$lib/api/request.ts";
// The scan-policy vocabulary has one home; the history read states the same firm settings the File
// Safety settings page writes, so both surfaces name one set of values.
import type { FlaggedTreatment, ScanTier } from "./scan-policy-api.ts";

/*
 * The file manager's own read of a matter's files.
 *
 * It is not $lib/documents/document-api.ts, and the split is the one that module already draws:
 * that client is the DOCUMENT LOOP's — create a document, open an editor, save a version. This one
 * is the file MANAGER's, and it needs facts the loop's client does not carry: the scan verdict the
 * Safety column grades, the document type the classification column shows and the type menu sets,
 * and the folder a file sits in for every act that moves one.
 *
 * Same rules as its sibling folder-api.ts: same-origin calls against relative `/api/v1` paths,
 * response shapes hand-written against apps/api-worker/openapi/openapi.json, every call resolving
 * rather than throwing so a caller can tell a server that answered from one that did not.
 */

/** How a file's latest version came out of the ingest gate. */
export type MatterFileStatus = "clean" | "pending" | "quarantined";

/** What the scanner said about the display version, or null where no scan has run. */
export type ScanVerdict = "unscanned" | "clean" | "flagged";

export interface MatterFile {
  id: string;
  matterId: string;
  folderId: string | null;
  name: string;
  /** The firm's classification label, or null where none has been set. Never a stand-in word. */
  documentTypeId: string | null;
  /** The clean current version, or null. A pending or rejected row structurally cannot download. */
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  versionNumber: number;
  sizeBytes: number | null;
  sniffedContentType: string | null;
  scanVerdict: ScanVerdict | null;
  status: MatterFileStatus;
  quarantineReason: string | null;
  /**
   * The last-modified instant the uploading device reported for the file this row's version came
   * from, or null where none was recorded. A fact about the source, kept beside the record's dates.
   */
  sourceModifiedAt: string | null;
  /**
   * Who uploaded the display version, and what the firm calls them. The id outlives the member row;
   * the name is null for an upload nobody was recorded for or whose member has left. "Created By"
   * on the table is the name.
   */
  uploadedBy: string | null;
  uploadedByName: string | null;
}

export interface MatterFileVersion {
  id: string;
  versionNumber: number;
  sizeBytes: number | null;
  sniffedContentType: string | null;
  contentSha256: string | null;
  committedAt: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  /**
   * What kind of save cut this version from the browser editor's working copy: the member's own
   * Save, the editor's autosave, the save as the last view left, or the idle reap. Null for a
   * version that arrived by upload, check-in or restore. History folds the autosaves.
   */
  saveKind: "explicit" | "autosave" | "exit" | "reap" | null;
  /** Everyone in the editing session when the version was cut, the author included. */
  participants: readonly { userId: string; name: string | null }[];
  /** The version's standing verdict, the engine that reached it, and the engine's own detail. */
  scanVerdict: "unscanned" | "clean" | "flagged" | null;
  scanEngineVersion: string | null;
  scanDetail: string | null;
  /**
   * Who changed what in this version, one entry per author, read from the document's own change
   * marks at the cut. `authorName` is the member's name today where the author resolved to one
   * who is still here, else the name the document holds. Empty where the version recorded nothing
   * new: an upload, a spreadsheet, or a version whose marks have not been read yet.
   */
  changes: readonly VersionAuthorChanges[];
}

/** One author's tally of changes in a version. */
export interface VersionAuthorChanges {
  authorUserId: string | null;
  authorName: string;
  insertions: number;
  deletions: number;
  formatting: number;
}

/**
 * Every file on the matter, in every state. Pending and rejected rows are asked for deliberately: a
 * file the scanner is still reading, and one it refused, must both read as themselves where the
 * person put them. A file that silently never appears is the worse failure by a distance.
 */
export function listMatterFiles(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<{ data: MatterFile[]; nextCursor: string | null }>> {
  const query = new URLSearchParams({ matterId, includePendingAndQuarantined: "true" });
  return requestJson(fetchImpl, `/api/v1/files?${query.toString()}`);
}

/**
 * One file, as the file manager reads it. The route answers 404 for a file that is pending only,
 * rejected, or deleted — the editor is the caller, and a document in any of those states has no
 * version it could open.
 */
export function readMatterFile(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<MatterFile>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}`);
}

export function listFileVersions(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<{ data: MatterFileVersion[] }>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}/versions`);
}

/** One soft-deleted file, as the Deleted Files view reads it: the record plus the deletion facts. */
export interface DeletedFileSummary {
  id: string;
  name: string;
  /** The folder it was in, as stored. The folder row itself may be gone. */
  folderId: string | null;
  documentTypeId: string | null;
  deletedAt: string;
  deletedBy: string | null;
  deletedByName: string | null;
  currentVersionId: string | null;
  sizeBytes: number | null;
  sniffedContentType: string | null;
}

/** Why one member could not be taken out of an archive. Each is a fact about that member. */
export type ExtractionRefusalReason =
  | "archive-missing"
  | "directory"
  | "not-a-file"
  | "encrypted"
  | "unsupported-compression"
  | "malformed"
  | "too-large"
  | "expansion-ratio"
  | "corrupt"
  | "policy-size"
  | "policy-type"
  | "not-in-archive";

export interface ArchiveExtraction {
  /** The members that became files on the matter. */
  readonly extracted: readonly {
    readonly path: string;
    readonly fileId: string;
    readonly versionId: string;
    readonly name: string;
  }[];
  /** The members that did not, each with the reason it did not. */
  readonly refused: readonly { readonly path: string; readonly reason: ExtractionRefusalReason }[];
}

/**
 * Take named members out of an archive and file them on the matter.
 *
 * PARTIAL SUCCESS IS THE ORDINARY CASE, which is why the answer carries two lists rather than a
 * status: one encrypted member among ten does not stop the other nine, and a caller that collapsed
 * this into success-or-failure would have to lie about one of them. Every member that comes out
 * goes through the same scan gate an upload does, so an extraction is not a way around the checks.
 */
export function extractArchiveMembers(
  fetchImpl: typeof fetch,
  fileId: string,
  paths: readonly string[],
  folderId: string | null,
  idempotencyKey: string,
): Promise<ApiOutcome<ArchiveExtraction>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}/archive-extractions`, {
    method: "POST",
    body: { paths: [...paths], folderId },
    idempotencyKey,
  });
}

/** The matter's soft-deleted files, newest deletion first. */
export function listDeletedFiles(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<{ data: DeletedFileSummary[]; nextCursor: string | null }>> {
  const query = new URLSearchParams();
  if (cursor !== undefined) query.set("cursor", cursor);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/files/deleted${suffix}`,
  );
}

/**
 * Bring a deleted file back. With no destination the file returns to its stored folder, falling
 * back to the matter root when that folder no longer exists; an explicit folder (null = the root)
 * overrides. The answer reports where it actually landed.
 */
export function restoreFile(
  fetchImpl: typeof fetch,
  fileId: string,
  destination: { folderId?: string | null },
  idempotencyKey: string,
): Promise<ApiOutcome<{ fileId: string; folderId: string | null }>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}/restore`, {
    method: "POST",
    body: destination.folderId === undefined ? {} : { folderId: destination.folderId },
    idempotencyKey,
  });
}

/** One audited act on the matter's files, resolved for reading: names now, not names then. */
export interface FileHistoryEntry {
  at: string;
  /** The audit event, e.g. "file.renamed" or "folder.created" — the label is derived client-side. */
  event: string;
  /** Whether the act was done to a file or a folder: the trail carries both. */
  subjectKind: "file" | "folder";
  subjectId: string;
  subjectName: string;
  versionNumber: number | null;
  actorUserId: string | null;
  actorName: string | null;
  /**
   * What the act changed, resolved server-side per event: the old and new name for a rename, the
   * old and new folder path for a move, the source folder for a delete, the landing folder for a
   * restore. Null on rows recorded before the writes carried this — an honest blank, never a guess.
   */
  fromText: string | null;
  toText: string | null;
  /** The redacted audit metadata, verbatim; shape varies by event. */
  detail: unknown;
}

/** The matter's file changelog, newest first. */
export function listFileHistory(
  fetchImpl: typeof fetch,
  matterId: string,
  cursor?: string,
): Promise<ApiOutcome<{ data: FileHistoryEntry[]; nextCursor: string | null }>> {
  const query = new URLSearchParams();
  if (cursor !== undefined) query.set("cursor", cursor);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestJson(
    fetchImpl,
    `/api/v1/matters/${encodeURIComponent(matterId)}/file-history${suffix}`,
  );
}

/** One member of an archive's central directory. Read, never extracted. */
export interface ArchiveEntry {
  path: string;
  isDirectory: boolean;
  compressedSizeBytes: number | null;
  uncompressedSizeBytes: number | null;
  modifiedAt: string | null;
}

/**
 * A zip's central directory, read from the stored bytes with ranged requests and no extraction.
 * A deleted zip reads the same as a live one — browsing restores nothing. `truncated` means the
 * archive holds more entries than the cap and the listing stopped honestly.
 */
export function listArchiveEntries(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<{ entries: ArchiveEntry[]; truncated: boolean }>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}/archive-entries`);
}

/** One of the firm's document types. The vocabulary is the firm's own and it is editable. */
export interface DocumentTypeSummary {
  id: string;
  name: string;
  code: string | null;
  deactivatedAt: string | null;
}

export function listDocumentTypes(
  fetchImpl: typeof fetch,
): Promise<ApiOutcome<{ data: DocumentTypeSummary[] }>> {
  return requestJson(fetchImpl, "/api/v1/document-types");
}

export function createDocumentType(
  fetchImpl: typeof fetch,
  name: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ id: string }>> {
  return requestJson(fetchImpl, "/api/v1/document-types", {
    method: "POST",
    body: { name },
    idempotencyKey,
  });
}

/**
 * Re-run the malware check across the matter. The engine's own endpoint is matter-scoped: it
 * re-scans every file whose scan is stale against the firm's current engine and skips the rest, so
 * a matter already current enqueues nothing. A per-file re-run is not a route that exists, which is
 * why the per-file menu item says so rather than calling this and implying it did one file.
 */
export function rescanMatter(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<{ enqueued: number; capped: boolean }>> {
  return requestJson(fetchImpl, `/api/v1/scan/matter/${encodeURIComponent(matterId)}`, {
    method: "POST",
    body: {},
  });
}

/**
 * Bundle a selection into a ZIP. The host resolves folders and files to their current clean
 * versions at request time and streams the archive, so a whole folder downloads as one act rather
 * than as one browser tab per file. An empty selection bundles the whole matter, which is what
 * Download Full Matter asks for.
 */
export function bundleDownloadRequest(
  matterId: string,
  fileIds: readonly string[],
  folderIds: readonly string[],
): { path: string; body: Record<string, unknown> } {
  return {
    path: "/api/v1/downloads/zip",
    body: { matterId, fileIds: [...fileIds], folderIds: [...folderIds] },
  };
}

/** Where a file's bytes are fetched from: the route redirects to a short-lived presigned URL. */
export function fileDownloadUrl(fileId: string): string {
  return `/api/v1/files/${encodeURIComponent(fileId)}/download`;
}

/** The five digests, in the order the Hashes tab lists them. */
export interface DigestSet {
  md5: string;
  sha1: string;
  sha256: string;
  sha384: string;
  sha512: string;
}

export const HASH_ALGORITHMS = ["sha256", "sha512", "sha384", "sha1", "md5"] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

/** How the recomputed digest stood against the one recorded at intake. */
export type IntegrityComparison = "match" | "mismatch" | "no-baseline";

export interface IntegrityVerification {
  algorithms: DigestSet;
  sizeBytes: number;
  /** What intake recorded, or null where an older ingest path recorded nothing. */
  baselineSha256: string | null;
  comparison: IntegrityComparison;
  computedAt: string;
}

/**
 * Recompute a file's digests FROM ITS BYTES AT REST and compare the result against what intake
 * recorded. That is the whole point of the tab: a digest read back out of the same row that wrote
 * it proves nothing — a stored hash matching itself is a tautology. This reads the bytes again.
 *
 * The check is recorded: a difference between what intake recorded and what the bytes digest to now
 * is a chain-of-custody event on a matter record, which is why the route audits it.
 */
export function verifyFileIntegrity(
  fetchImpl: typeof fetch,
  fileId: string,
  /** The committed version to verify; the current version when omitted. */
  versionId?: string,
): Promise<ApiOutcome<IntegrityVerification>> {
  return requestJson(fetchImpl, "/api/v1/file-integrity/verify", {
    method: "POST",
    body: versionId === undefined ? { fileId } : { fileId, versionId },
  });
}

/** The events a file's scan history is made of, as the server names them. */
export type FileScanEventKind =
  | "file.version_committed"
  | "file.version_rescanned"
  | "file.quarantined"
  | "file.rescan_requested";

/** One line of a file's safety history: a scan, or a request for one, against one version. */
export interface FileScanEvent {
  id: string;
  at: string;
  event: FileScanEventKind;
  versionId: string;
  versionNumber: number;
  /** Who asked, for a request; null for a scan the platform ran on its own. */
  actorUserId: string | null;
  actorName: string | null;
  /** What the scan found, as recorded when it happened; null where the event carried no such fact. */
  scanVerdict: "unscanned" | "clean" | "flagged" | null;
  /**
   * The engine the check ran under; on a request, the engine recorded for the firm at the moment
   * somebody asked. Null where the row carried neither.
   */
  scanEngineVersion: string | null;
  scanDetail: string | null;
  /**
   * Whether a request reached the scan queue; null on every other kind of line, which does not
   * record it. False is the line that would otherwise read as a check on its way and never was.
   */
  queued: boolean | null;
}

/**
 * What the firm's checks run under, as the firm holds it TODAY. Nothing records the settings in
 * force when an earlier check ran, so these never describe one line of the history.
 */
export interface FileScanSettings {
  tier: ScanTier;
  suspiciousScoreFloor: number;
  flaggedTreatment: FlaggedTreatment;
  stepUpReauthOnFlagged: boolean;
}

export interface FileScanHistory {
  /** The engine the firm scans with today, or null while none is recorded. */
  currentEngineVersion: string | null;
  scanSettings: FileScanSettings;
  data: FileScanEvent[];
}

/** A file's safety history, newest first. */
export function listFileScans(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<FileScanHistory>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}/scans`);
}

export interface FileRescanResult {
  /** The audit id of the request; the re-scan event that answers it carries the same id. */
  requestId: string;
  versionId: string;
  /** False when nothing could be queued (no engine recorded, or no scan queue bound). */
  enqueued: boolean;
}

/**
 * Ask for a fresh scan of one committed version (the current one when none is named). The scan
 * runs in the background; the history shows the request at once and the verdict when it lands.
 */
export function requestFileRescan(
  fetchImpl: typeof fetch,
  fileId: string,
  versionId?: string,
): Promise<ApiOutcome<FileRescanResult>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}/rescan`, {
    method: "POST",
    body: versionId === undefined ? {} : { versionId },
  });
}
