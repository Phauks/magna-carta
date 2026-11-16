import { z } from "@hono/zod-openapi";
import {
  SignerAdoption,
  SignerDecline,
  SignerFinish,
  SignerOutcome,
  SignerRequestView,
} from "../../../signing/signer-contract.ts";
import { identifierPathParam } from "../../contracts/common.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// A firm member's own part of a signing request, declared: the same steps an outside signer takes
// (open, agree, adopt, finish or decline) for a signer the sender named as a colleague signed in to
// the firm. The member is who the session says, never a path value: the signer is found on the
// request by the session's user, and a request that does not name them is not found. There is no
// link and no access code; the session is the proof of who signs. The handlers are in ./signers.ts,
// shared with the outside signer's lane.

function problem(description: string) {
  return { description, content: { "application/problem+json": { schema: Problem } } };
}

const fileParam = z.object({ id: identifierPathParam("file", "id") });
const requestParam = z.object({ requestId: identifierPathParam("signingRequest", "requestId") });

const common = {
  401: problem("No valid session"),
  403: problem("The member lacks the permission this route names"),
  404: problem("No such request naming this member as a signer"),
  409: problem("A step before this one is not done, or it is not this member's turn"),
  410: problem("The request is no longer out for signing, or this member already signed"),
  422: problem("What was sent cannot be used"),
  429: problem("Rate limit exceeded"),
};

const viewResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: SignerRequestView } },
});

function memberMeta(action: string, write: boolean): RouteMeta {
  return {
    operationId: `signing.${action}`,
    surface: "app",
    authenticated: true,
    permission: "esign:sign",
    resource: "firm",
    // Every act is also written to the request's own activity, which the Certificate of Completion prints.
    audited: write,
    idempotency: "optional",
    rateLimit: "default",
  };
}

const json = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

export const MyRequestsOnFile = z
  .object({
    /** Requests on the file that name this member as a signer and still wait on them, newest first. */
    requestIds: z.array(z.string()),
  })
  .meta({ id: "MySigningRequestsOnFile" });

export const myRequestsRoute = defineOpenAPIRoute(memberMeta("listMyRequests", false), {
  method: "get",
  path: "/api/v1/files/{id}/my-signing-requests",
  description:
    "The requests on a file that name the signed-in member as a signer and are still out with " +
    "their part unfinished, newest first. Empty when nothing waits on them.",
  request: { params: fileParam },
  responses: {
    200: {
      description: "The requests",
      content: { "application/json": { schema: MyRequestsOnFile } },
    },
    401: common[401],
    403: common[403],
    429: common[429],
  },
});

export const myReadRoute = defineOpenAPIRoute(memberMeta("readMyPart", false), {
  method: "get",
  path: "/api/v1/signing-requests/{requestId}/my-part",
  description:
    "The signed-in member's own part of a request: who sent it, the document's title and message, " +
    "the agreement to sign electronically, their own fields, and where they stand. Writes nothing.",
  request: { params: requestParam },
  responses: { 200: viewResponse("The member's view"), ...common },
});

export const myDocumentRoute = defineOpenAPIRoute(memberMeta("readMyDocument", false), {
  method: "get",
  path: "/api/v1/signing-requests/{requestId}/my-part/document",
  description: "The exact PDF version that was sent for signature, for the member to read.",
  request: { params: requestParam },
  responses: {
    200: {
      description: "The document",
      content: { "application/pdf": { schema: z.string().meta({ format: "binary" }) } },
    },
    ...common,
  },
});

export const myOpenRoute = defineOpenAPIRoute(memberMeta("openMyPart", true), {
  method: "post",
  path: "/api/v1/signing-requests/{requestId}/my-part/opening",
  description: "Records that the member opened the request, the first time only.",
  request: { params: requestParam },
  responses: { 200: viewResponse("The member's view"), ...common },
});

export const myConsentRoute = defineOpenAPIRoute(memberMeta("consentMyPart", true), {
  method: "post",
  path: "/api/v1/signing-requests/{requestId}/my-part/consent",
  description:
    "Records that the member agreed to sign electronically, under the disclosure version they were shown.",
  request: { params: requestParam },
  responses: { 200: viewResponse("The member's view"), ...common },
});

export const myAdoptRoute = defineOpenAPIRoute(memberMeta("adoptMySignature", true), {
  method: "post",
  path: "/api/v1/signing-requests/{requestId}/my-part/adoption",
  description:
    "Keeps the signature (and initials) the member adopted, as PNG images in the firm's own storage.",
  request: { params: requestParam, ...json(SignerAdoption) },
  responses: { 200: viewResponse("The member's view"), ...common },
});

export const myFinishRoute = defineOpenAPIRoute(memberMeta("finishMyPart", true), {
  method: "post",
  path: "/api/v1/signing-requests/{requestId}/my-part/finish",
  description:
    "Signs: every one of the member's fields is checked, their answers recorded, and the request " +
    "moves on to the next signer or to complete.",
  request: { params: requestParam, ...json(SignerFinish) },
  responses: {
    200: { description: "Signed", content: { "application/json": { schema: SignerOutcome } } },
    ...common,
  },
});

export const myDeclineRoute = defineOpenAPIRoute(memberMeta("declineMyPart", true), {
  method: "post",
  path: "/api/v1/signing-requests/{requestId}/my-part/declining",
  description:
    "Declines to sign, which ends the request for everyone; the reason is kept on its record.",
  request: { params: requestParam, ...json(SignerDecline) },
  responses: {
    200: { description: "Declined", content: { "application/json": { schema: SignerOutcome } } },
    ...common,
  },
});
