import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

/*
 * The File Manager's client for sharing with people outside the firm. One read per matter (every live
 * share, with the person's name) and three writes: share a selection, change one share, stop one.
 * Same rules as folder-api.ts: relative `/api/v1` paths, shapes written against
 * apps/api-worker/openapi/openapi.json, every call resolves rather than throws, and every write takes
 * its idempotency key as a required parameter.
 */

export type ShareRole = "viewer" | "commenter" | "editor";
export type ShareSignIn = "link" | "emailCode" | "twoStep";

export interface ShareSummary {
  id: string;
  matterId: string;
  scope: "matter" | "folder" | "file";
  folderId: string | null;
  fileId: string | null;
  fileVersionId: string | null;
  recipientEntityId: string;
  recipientName: string | null;
  role: ShareRole;
  allowDownload: boolean;
  signIn: ShareSignIn;
  endsOn: string | null;
  sharedByUserId: string;
  createdAt: string;
  updatedAt: string;
  dormant: "ended" | "needsNewSharer" | null;
}

export type ShareTargetInput =
  | { scope: "matter" }
  | { scope: "folder"; folderId: string }
  | { scope: "file"; fileId: string; fileVersionId?: string | null };

export interface ShareSettingsInput {
  allowDownload?: boolean;
  signIn?: ShareSignIn;
  endsOn?: string | null;
}

export function listMatterShares(
  fetchImpl: typeof fetch,
  matterId: string,
): Promise<ApiOutcome<{ data: ShareSummary[] }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/shares`);
}

export function shareItems(
  fetchImpl: typeof fetch,
  matterId: string,
  input: ShareSettingsInput & {
    items: ShareTargetInput[];
    people: { entityId: string; role: ShareRole }[];
  },
  idempotencyKey: string,
): Promise<ApiOutcome<{ shareIds: string[] }>> {
  return requestJson(fetchImpl, `/api/v1/matters/${encodeURIComponent(matterId)}/shares`, {
    method: "POST",
    body: input,
    idempotencyKey,
  });
}

export function changeShare(
  fetchImpl: typeof fetch,
  shareId: string,
  changes: ShareSettingsInput & { role?: ShareRole },
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/shares/${encodeURIComponent(shareId)}`, {
    method: "PATCH",
    body: changes,
    idempotencyKey,
  });
}

export function stopShare(
  fetchImpl: typeof fetch,
  shareId: string,
  idempotencyKey: string,
): Promise<ApiOutcome<{ ok: true }>> {
  return requestJson(fetchImpl, `/api/v1/shares/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
    idempotencyKey,
  });
}
