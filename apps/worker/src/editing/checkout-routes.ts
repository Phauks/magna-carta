import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertAuditLogStatement } from "@magna-carta/data-access/audit-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertDocumentCheckoutStatement } from "@magna-carta/file-manager/checkout-statements";
import { getCurrentCleanVersion } from "@magna-carta/file-manager/queries";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FileId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { identifierPathParam } from "../contracts/common.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";
import { requireBucket } from "../files/require-bucket.ts";

// How long a checkout's download URL is valid. Short — the client fetches the working copy promptly;
// the offline edit then lives on the client until check-in.
const CHECKOUT_DOWNLOAD_TTL_SECONDS = 300;

const CheckoutResponse = z
  .object({
    // The opaque handle for this checkout — presented on check-in to reconcile against its base.
    checkoutId: z.string(),
    // A short-TTL presigned GET the client downloads the working copy directly from R2 (the bytes
    // never flow through the Worker).
    presignedGetUrl: z.string(),
  })
  .openapi("CheckoutResponse");

// Takes an offline working copy of a document: records a document_checkout against the current
// committed version (the base the eventual check-in reconciles against) and returns a presigned GET of
// that version's bytes. The optimistic model never blocks — multiple offline copies may be out at once;
// each check-in reconciles independently against its own base. Audited.
export const checkoutMeta: RouteMeta = {
  operationId: "documents.checkout",
  surface: "app",
  authenticated: true,
  permission: "documents:checkout",
  resource: "matter",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

export const checkoutRoute = defineOpenAPIRoute(checkoutMeta, {
  method: "post",
  path: "/api/v1/documents/{fileId}/checkout",
  request: { params: z.object({ fileId: identifierPathParam("file", "fileId") }) },
  description:
    "Take an offline working copy of a document: records a checkout against the current version and returns a short-lived presigned download URL for that version's bytes.",
  responses: {
    200: {
      description: "The checkout handle and the presigned download URL",
      content: { "application/json": { schema: CheckoutResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks documents:checkout",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The file does not exist in this firm, or has no committed version to check out",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerDocumentCheckoutRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...checkoutRoute, middleware: chokepointMiddleware(chokepoint, checkoutRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const memberId = requireChokepointUserId(c);
      const bucket = requireBucket(firm.bucketName);
      const fileId = c.req.param("fileId") as FileId;

      const version = await getCurrentCleanVersion(firm.firmDatabase, fileId);
      if (version === undefined) {
        return problemJson(c, {
          type: "not-found",
          status: 404,
          title: "Not found",
          detail: "No such document with a committed version to check out.",
        });
      }

      const checkoutId = newIdentifier("documentCheckout");
      const now = new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            insertDocumentCheckoutStatement(firm.firmDatabase, {
              id: checkoutId,
              fileId,
              holderMemberId: memberId,
              lockType: "offline_working_copy",
              baseVersionId: version.id,
              acquiredAt: now,
            }),
            insertAuditLogStatement(firm.firmDatabase, {
              id: newIdentifier("auditLog"),
              event: "document.checkout_opened",
              actorUserId: memberId,
              subjectId: fileId,
              metadata: null,
              now,
            }),
          ],
          outboxMessages: [],
        },
        { now: () => now },
      );

      const presignedGetUrl = await presignerForEnv(c.env).presignGet(
        bucket,
        version.r2Key,
        CHECKOUT_DOWNLOAD_TTL_SECONDS,
      );
      return c.json({ checkoutId, presignedGetUrl }, 200);
    },
  );
}
