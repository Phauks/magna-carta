import { z } from "@hono/zod-openapi";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

// The routes the page behind a completion email calls, declared. Each rides the chokepoint's signer
// lane for the signed-copy link: the link in the `x-signing-link` header is verified, checked against
// the signer's row, and admitted only once the request is completed and sealed. The request and the
// signer are facts of the link, never of the path. The handlers are in ./signed-copy.ts.

function problem(description: string) {
  return { description, content: { "application/problem+json": { schema: Problem } } };
}

const common = {
  404: problem("Not a link this deployment made, or the copy is no longer held"),
  410: problem("The link expired or was replaced, or the copy is not sealed yet"),
  429: problem("Rate limit exceeded"),
};

function copyMeta(action: string): RouteMeta {
  return {
    operationId: `signer.${action}`,
    surface: "app",
    authenticated: false,
    permission: null,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
    signerLane: "signed-copy",
  };
}

/** What the page shows before the signer downloads anything. Names no other signer. */
export const SignedCopyView = z
  .object({
    title: z.string(),
    firmName: z.string(),
    senderName: z.string(),
    sealedAt: z.string().meta({ format: "date-time" }),
    documentFileName: z.string(),
    certificateFileName: z.string(),
  })
  .meta({ id: "SignedCopyView" });

const pdf = (description: string) => ({
  description,
  content: { "application/pdf": { schema: z.string().meta({ format: "binary" }) } },
});

export const signedCopyRoute = defineOpenAPIRoute(copyMeta("readSignedCopy"), {
  method: "get",
  path: "/api/v1/signer/signed-copy",
  description:
    "What the link to a signed copy opens: the document's title, who sent it, and when it was " +
    "sealed. Writes nothing.",
  responses: {
    200: {
      description: "The signed copy's details",
      content: { "application/json": { schema: SignedCopyView } },
    },
    ...common,
  },
});

export const signedCopyDocumentRoute = defineOpenAPIRoute(copyMeta("readSignedCopyDocument"), {
  method: "get",
  path: "/api/v1/signer/signed-copy/document",
  description: "The sealed, signed copy of the document, as a PDF.",
  responses: { 200: pdf("The signed copy"), ...common },
});

export const signedCopyCertificateRoute = defineOpenAPIRoute(
  copyMeta("readSignedCopyCertificate"),
  {
    method: "get",
    path: "/api/v1/signer/signed-copy/certificate",
    description: "The Certificate of Completion filed beside the signed copy, as a PDF.",
    responses: { 200: pdf("The certificate"), ...common },
  },
);
