import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/*
 * The folder half of the matter's file surface. Files already have a client in
 * $lib/documents/document-api.ts; folders had none, because until now nothing in the app drew a
 * folder tree.
 *
 * Same rules as its sibling: same-origin calls against the relative `/api/v1` paths, response
 * shapes hand-written against apps/api-worker/openapi/openapi.json, and every call resolves rather
 * than throws so a caller can tell a server that answered from a server that did not.
 */

/**
 * One node of a matter's folder tree, in adjacency-list form. The server sends a flat list and the
 * client assembles the shape — which is the right split: a tree is a rendering decision, and a flat
 * list is what a cursor-paginated read can honestly return.
 */
export interface FolderSummary {
  id: string;
  parentFolderId: string | null;
  name: string;
}

export function listMatterFolders(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<{ data: FolderSummary[] }>> {
  const query = new URLSearchParams({ matterId });
  return requestJson(fetchImpl, `/api/v1/folders?${query.toString()}`);
}

export function createFolder(
  fetchImpl: typeof fetch,
  input: { matterId: string; parentFolderId: string | null; name: string },
  idempotencyKey: string,
): Promise<ApiOutcome<{ folderId: string }>> {
  return requestJson(fetchImpl, "/api/v1/folders", {
    method: "POST",
    body: input,
    idempotencyKey,
  });
}

/** Rename, or move under a different parent. Both are a PATCH; either field may be sent alone. */
export function patchFolder(
  fetchImpl: typeof fetch,
  folderId: string,
  changes: { name?: string; parentFolderId?: string | null },
): Promise<ApiOutcome<{ folderId: string }>> {
  return requestJson(fetchImpl, `/api/v1/folders/${encodeURIComponent(folderId)}`, {
    method: "PATCH",
    body: changes,
  });
}

export function deleteFolder(
  fetchImpl: typeof fetch,
  folderId: string,
): Promise<ApiOutcome<{ folderId: string }>> {
  return requestJson(fetchImpl, `/api/v1/folders/${encodeURIComponent(folderId)}`, {
    method: "DELETE",
  });
}

/*
 * The file-side writes this screen makes. They live beside the folder calls rather than in
 * $lib/documents/document-api.ts because that module is the DOCUMENT LOOP's client — reading a
 * matter's documents, uploading bytes, opening an editor. Renaming, moving and deleting are the
 * file MANAGER's verbs, and putting them here keeps each module's reason to change to one thing.
 */

/** Rename, move, or set the document type. Any field may be sent alone. */
export function patchFile(
  fetchImpl: typeof fetch,
  fileId: string,
  changes: { name?: string; folderId?: string | null; documentTypeId?: string | null },
): Promise<ApiOutcome<{ fileId: string }>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}`, {
    method: "PATCH",
    body: changes,
  });
}

/**
 * A soft delete. The bytes are not destroyed and the row is not erased — the file leaves the list
 * and stays recoverable, which is why this screen can offer it without a warning that overstates
 * what is happening.
 */
export function deleteFile(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<{ fileId: string }>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
  });
}

/**
 * Where a file's bytes are fetched from. The route resolves the current clean version and redirects
 * to a short-lived presigned URL, so the browser is pointed at it rather than the bytes being pulled
 * through this app.
 */
export function downloadUrl(fileId: string): string {
  return `/api/v1/files/${encodeURIComponent(fileId)}/download`;
}
