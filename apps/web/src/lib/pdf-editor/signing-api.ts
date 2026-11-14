/*
 * Sending a document for signature, as the PDF Editor calls it: the member routes for a signing
 * request (apps/api-worker/src/http/routes/documents/signing-requests.ts). The shapes are the
 * contract's own; the transport envelope is $lib/api/request.ts.
 */
import type {
  SaveSigningDraftRequest,
  SigningRequestDetail,
  SigningRequestList,
} from "@magna-carta/api-client";
import { requestJson, type ApiOutcome } from "$lib/api/request.ts";

export type {
  SaveSigningDraftRequest,
  SigningRequestDetail,
  SigningRequestSummary,
} from "@magna-carta/api-client";

export function listSigningRequests(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<SigningRequestList>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}/signing-requests`);
}

export function readSigningRequest(
  fetchImpl: typeof fetch,
  requestId: string,
): Promise<ApiOutcome<SigningRequestDetail>> {
  return requestJson(fetchImpl, `/api/v1/signing-requests/${encodeURIComponent(requestId)}`);
}

export function createSigningRequest(
  fetchImpl: typeof fetch,
  fileId: string,
): Promise<ApiOutcome<SigningRequestDetail>> {
  return requestJson(fetchImpl, `/api/v1/files/${encodeURIComponent(fileId)}/signing-requests`, {
    method: "POST",
  });
}

export function saveSigningDraft(
  fetchImpl: typeof fetch,
  requestId: string,
  draft: SaveSigningDraftRequest,
): Promise<ApiOutcome<SigningRequestDetail>> {
  return requestJson(fetchImpl, `/api/v1/signing-requests/${encodeURIComponent(requestId)}/draft`, {
    method: "PUT",
    body: draft,
  });
}

export function sendSigningRequest(
  fetchImpl: typeof fetch,
  requestId: string,
): Promise<ApiOutcome<SigningRequestDetail>> {
  return requestJson(
    fetchImpl,
    `/api/v1/signing-requests/${encodeURIComponent(requestId)}/sending`,
    {
      method: "POST",
    },
  );
}

export function remindSigners(
  fetchImpl: typeof fetch,
  requestId: string,
): Promise<ApiOutcome<SigningRequestDetail>> {
  return requestJson(
    fetchImpl,
    `/api/v1/signing-requests/${encodeURIComponent(requestId)}/reminders`,
    {
      method: "POST",
    },
  );
}

export function cancelSigningRequest(
  fetchImpl: typeof fetch,
  requestId: string,
  reason: string,
): Promise<ApiOutcome<SigningRequestDetail>> {
  return requestJson(
    fetchImpl,
    `/api/v1/signing-requests/${encodeURIComponent(requestId)}/voiding`,
    {
      method: "POST",
      body: { reason },
    },
  );
}
