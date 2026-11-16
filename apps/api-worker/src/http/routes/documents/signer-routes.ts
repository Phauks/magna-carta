import { z } from "@hono/zod-openapi";
import {
  SignerAccessCodeCheck,
  SignerAccessCodeSent,
  SignerAdoption,
  SignerDecline,
  SignerFinish,
  SignerOutcome,
  SignerRequestView,
} from "../../../signing/signer-contract.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The routes an outside signer's page calls, declared. Each rides the chokepoint's signer lane: the
// link in the `x-signing-link` header is verified before anything is read, and the request and the
// signer are facts of the link, never of the path, so there is no identifier for a signer to change.
// The handlers are in ./signers.ts.

function problem(description: string) {
  return { description, content: { "application/problem+json": { schema: Problem } } };
}

const common = {
  404: problem("Not a signing link this deployment made"),
  409: problem("A step before this one is not done, or it is not this signer's turn"),
  410: problem("The link was replaced, or the request is no longer out for signing"),
  422: problem("What was sent cannot be used"),
  429: problem("Rate limit exceeded"),
};

const viewResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: SignerRequestView } },
});

function signerMeta(
  action: string,
  options: { readonly write?: boolean; readonly rateLimit?: RouteMeta["rateLimit"] } = {},
): RouteMeta {
  return {
    operationId: `signer.${action}`,
    surface: "app",
    authenticated: false,
    permission: null,
    resource: "firm",
    // Every act a signer takes is written to the request's own activity, observed by the server; that
    // record is what the Certificate of Completion prints.
    audited: options.write ?? false,
    idempotency: "optional",
    rateLimit: options.rateLimit ?? "default",
    signerLane: "link",
  };
}

const json = <T extends z.ZodType>(schema: T) => ({
  body: { content: { "application/json": { schema } }, required: true },
});

export const readRoute = defineOpenAPIRoute(signerMeta("readRequest"), {
  method: "get",
  path: "/api/v1/signer/request",
  description:
    "The signer's own part of the request their link names: who sent it, the document's title and " +
    "message, the agreement to sign electronically, their own fields, and where they stand. Writes nothing.",
  responses: { 200: viewResponse("The signer's view"), ...common },
});

export const documentRoute = defineOpenAPIRoute(signerMeta("readDocument"), {
  method: "get",
  path: "/api/v1/signer/document",
  description: "The exact PDF version that was sent for signature, for the signer to read.",
  responses: {
    200: {
      description: "The document",
      content: { "application/pdf": { schema: z.string().meta({ format: "binary" }) } },
    },
    ...common,
  },
});

export const openRoute = defineOpenAPIRoute(signerMeta("open", { write: true }), {
  method: "post",
  path: "/api/v1/signer/opening",
  description:
    "Records that the signer opened the request, the first time only. A separate act from reading, " +
    "so a mail scanner that follows the link records nothing.",
  responses: {
    200: viewResponse("The signer's view"),
    ...common,
    409: problem("It is not this signer's turn yet"),
  },
});

export const sendCodeRoute = defineOpenAPIRoute(
  signerMeta("sendAccessCode", { write: true, rateLimit: "expensive" }),
  {
    method: "post",
    path: "/api/v1/signer/access-code",
    description:
      "Emails a fresh six-digit code to the signer's own address, for a signer who proves who they " +
      "are with one. A new code replaces the last; it works for ten minutes and five tries.",
    responses: {
      202: {
        description: "The code was sent",
        content: { "application/json": { schema: SignerAccessCodeSent } },
      },
      ...common,
      409: problem("No code is needed, or it is not this signer's turn"),
      503: problem("The code could not be sent"),
    },
  },
);

export const checkCodeRoute = defineOpenAPIRoute(signerMeta("checkAccessCode", { write: true }), {
  method: "post",
  path: "/api/v1/signer/access-code/check",
  description:
    "Checks a code the signer entered; the right one records that they proved who they are.",
  request: json(SignerAccessCodeCheck),
  responses: {
    200: viewResponse("The signer's view"),
    ...common,
    409: problem("No code was sent, it expired, or its tries are spent"),
    422: problem("The code is wrong"),
  },
});

export const consentRoute = defineOpenAPIRoute(signerMeta("consent", { write: true }), {
  method: "post",
  path: "/api/v1/signer/consent",
  description:
    "Records that the signer agreed to sign electronically, under the disclosure version they were shown.",
  responses: {
    200: viewResponse("The signer's view"),
    ...common,
    409: problem("A step before this one is not done"),
  },
});

export const adoptRoute = defineOpenAPIRoute(signerMeta("adopt", { write: true }), {
  method: "post",
  path: "/api/v1/signer/adoption",
  description:
    "Keeps the signature (and initials) the signer adopted, as PNG images in the firm's own storage.",
  request: json(SignerAdoption),
  responses: {
    200: viewResponse("The signer's view"),
    ...common,
    409: problem("A step before this one is not done"),
    422: problem("An image is not a PNG, or is too large"),
  },
});

export const finishRoute = defineOpenAPIRoute(signerMeta("finish", { write: true }), {
  method: "post",
  path: "/api/v1/signer/finish",
  description:
    "Signs: every one of the signer's fields is checked, their answers recorded, and the request " +
    "moves on to the next signer or to complete.",
  request: json(SignerFinish),
  responses: {
    200: {
      description: "Signed",
      content: { "application/json": { schema: SignerOutcome } },
    },
    ...common,
    409: problem("A step before this one is not done"),
    422: problem("A required field is empty"),
  },
});

export const declineRoute = defineOpenAPIRoute(signerMeta("decline", { write: true }), {
  method: "post",
  path: "/api/v1/signer/declining",
  description:
    "Declines to sign, which ends the request for everyone; the reason is kept on its record.",
  request: json(SignerDecline),
  responses: {
    200: {
      description: "Declined",
      content: { "application/json": { schema: SignerOutcome } },
    },
    ...common,
    409: problem("It is not this signer's turn, or they already signed"),
  },
});
