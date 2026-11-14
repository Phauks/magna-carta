/*
 * Sending a document for signature, as the PDF Editor calls it: the member routes for a signing
 * request (apps/api-worker/src/http/routes/documents/signing-requests.ts), through the generated
 * client. Each call answers the three-outcome ApiOutcome the tab renders from.
 */
import {
  signingCancelRequest,
  signingCreateRequest,
  signingListRequests,
  signingReadRequest,
  signingRemindSigners,
  signingSaveDraft,
  signingSendRequest,
  type SaveSigningDraftRequest,
  type SigningRequestDetail,
  type SigningRequestList,
} from "@magna-carta/api-client";
import { outcomeOf } from "$lib/api/api-client.ts";
import type { ApiOutcome } from "$lib/api/request.ts";

export type {
  SaveSigningDraftRequest,
  SigningRequestDetail,
  SigningRequestSummary,
} from "@magna-carta/api-client";

async function settled<T>(call: () => Promise<{ data: T }>): Promise<ApiOutcome<T>> {
  try {
    const { data } = await call();
    return { kind: "ok", value: data };
  } catch (error) {
    return outcomeOf(error);
  }
}

export function listSigningRequests(fileId: string): Promise<ApiOutcome<SigningRequestList>> {
  return settled(() => signingListRequests({ path: { id: fileId }, throwOnError: true }));
}

export function readSigningRequest(requestId: string): Promise<ApiOutcome<SigningRequestDetail>> {
  return settled(() => signingReadRequest({ path: { requestId }, throwOnError: true }));
}

export function createSigningRequest(fileId: string): Promise<ApiOutcome<SigningRequestDetail>> {
  return settled(() => signingCreateRequest({ path: { id: fileId }, throwOnError: true }));
}

export function saveSigningDraft(
  requestId: string,
  draft: SaveSigningDraftRequest,
): Promise<ApiOutcome<SigningRequestDetail>> {
  return settled(() => signingSaveDraft({ path: { requestId }, body: draft, throwOnError: true }));
}

export function sendSigningRequest(requestId: string): Promise<ApiOutcome<SigningRequestDetail>> {
  return settled(() => signingSendRequest({ path: { requestId }, throwOnError: true }));
}

export function remindSigners(requestId: string): Promise<ApiOutcome<SigningRequestDetail>> {
  return settled(() => signingRemindSigners({ path: { requestId }, throwOnError: true }));
}

export function cancelSigningRequest(
  requestId: string,
  reason: string,
): Promise<ApiOutcome<SigningRequestDetail>> {
  return settled(() =>
    signingCancelRequest({ path: { requestId }, body: { reason }, throwOnError: true }),
  );
}
