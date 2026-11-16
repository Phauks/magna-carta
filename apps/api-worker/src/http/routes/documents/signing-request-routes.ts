import { z } from "@hono/zod-openapi";
import {
  CancelSigningRequest,
  SaveSigningDraftRequest,
  SigningRequestDetail,
  SigningRequestList,
} from "../../../signing/request-contract.ts";
import { identifierPathParam } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The member routes for a signing request, declared: paths, permissions and responses. The handlers
// are in ./signing-requests.ts.

const fileParam = z.object({ id: identifierPathParam("file", "id") });
const requestParam = z.object({ requestId: identifierPathParam("signingRequest", "requestId") });

function problem(description: string) {
  return { description, content: { "application/problem+json": { schema: Problem } } };
}

const common = {
  401: problem("No valid session"),
  403: problem("The member lacks the permission this route names"),
  404: problem("No such file or request in this firm"),
  429: problem("Rate limit exceeded"),
};

const detailResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: SigningRequestDetail } },
});

function meta(
  operationId: string,
  permission: "esign:send" | "esign:sign",
  audited: boolean,
): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission,
    resource: "firm",
    audited,
    idempotency: "optional",
    rateLimit: "default",
  };
}

export const createRoute = defineOpenAPIRoute(meta("signing.createRequest", "esign:send", true), {
  method: "post",
  path: "/api/v1/files/{id}/signing-requests",
  description:
    "Starts a draft request to sign the file's current clean PDF version. The draft names that " +
    "exact version; a later version of the file does not change what is signed.",
  request: { params: fileParam },
  responses: {
    201: detailResponse("The draft"),
    ...common,
    422: problem("The file's current version is not a clean PDF"),
  },
});

export const listRoute = defineOpenAPIRoute(meta("signing.listRequests", "esign:sign", false), {
  method: "get",
  path: "/api/v1/files/{id}/signing-requests",
  description: "The signing requests on a file, newest first.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The requests",
      content: { "application/json": { schema: SigningRequestList } },
    },
    ...common,
  },
});

export const readRoute = defineOpenAPIRoute(meta("signing.readRequest", "esign:sign", false), {
  method: "get",
  path: "/api/v1/signing-requests/{requestId}",
  description:
    "A request with its signers, their fields and its activity, oldest first. Never a link's " +
    "secret, an access code or a signature image.",
  request: { params: requestParam },
  responses: { 200: detailResponse("The request"), ...common },
});

export const saveRoute = defineOpenAPIRoute(meta("signing.saveDraft", "esign:send", true), {
  method: "put",
  path: "/api/v1/signing-requests/{requestId}/draft",
  description:
    "Replaces a draft's settings, signers and fields. Refused with 409 once the request is sent.",
  request: {
    params: requestParam,
    body: { content: { "application/json": { schema: SaveSigningDraftRequest } }, required: true },
  },
  responses: {
    200: detailResponse("The saved draft"),
    ...common,
    409: problem("The request has already been sent"),
    422: problem("An expiry out of range, or a field naming a signer not on the request"),
  },
});

export const sendRoute = defineOpenAPIRoute(meta("signing.sendRequest", "esign:send", true), {
  method: "post",
  path: "/api/v1/signing-requests/{requestId}/sending",
  description:
    "Sends a draft: records the SHA-256 of the version's bytes, so the seal can refuse anything " +
    "else, and asks the first signer, or every signer when the order is all at once. 422 names " +
    "what stops it being sent.",
  request: { params: requestParam },
  responses: {
    200: detailResponse("The request, sent"),
    ...common,
    409: problem("The request was already sent, or moved while this was decided"),
    422: problem("The draft cannot be sent yet; the detail says why"),
  },
});

export const remindRoute = defineOpenAPIRoute(meta("signing.remindSigners", "esign:send", true), {
  method: "post",
  path: "/api/v1/signing-requests/{requestId}/reminders",
  description: "Reminds every signer who has been asked and has not signed.",
  request: { params: requestParam },
  responses: {
    200: detailResponse("The request, with the reminder in its activity"),
    ...common,
    409: problem("The request is not out for signing"),
    422: problem("The request cannot be reminded; the detail says why"),
  },
});

export const cancelRoute = defineOpenAPIRoute(meta("signing.cancelRequest", "esign:send", true), {
  method: "post",
  path: "/api/v1/signing-requests/{requestId}/voiding",
  description:
    "Cancels a draft or a request still out for signing. Nothing is deleted; the request keeps " +
    "its signers, fields and activity, and its links stop working.",
  request: {
    params: requestParam,
    body: { content: { "application/json": { schema: CancelSigningRequest } }, required: true },
  },
  responses: {
    200: detailResponse("The request, cancelled"),
    ...common,
    409: problem("The request is already complete, declined or cancelled"),
    422: problem("The request cannot be cancelled; the detail says why"),
  },
});
