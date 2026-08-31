import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

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
}

export interface MatterFileVersion {
  id: string;
  versionNumber: number;
  sizeBytes: number | null;
  sniffedContentType: string | null;
  contentSha256: string | null;
  committedAt: string | null;
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
  /** The audit event, e.g. "file.renamed" — the label is derived client-side. */
  event: string;
  fileId: string;
  fileName: string;
  versionNumber: number | null;
  actorUserId: string | null;
  actorName: string | null;
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
): Promise<ApiOutcome<IntegrityVerification>> {
  return requestJson(fetchImpl, "/api/v1/file-integrity/verify", {
    method: "POST",
    body: { fileId },
  });
}
