import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointFirmId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";
import { presignerForEnv } from "../files/presigner-wiring.ts";
import { requireBucket } from "../files/require-bucket.ts";

// The async bulk-download poll endpoint: the client that received a 202 from POST /downloads/zip polls
// here for the job's state. A building/failed job carries no URL; a ready job mints a fresh short-TTL
// signed GET for its R2 artifact each poll (the URL is never stored). The coordinator DO is addressed
// by firmId:manifestHash, so one firm can never read another firm's job — the firm id comes from the
// session, not the path. Same chokepoint + files:organize capability as the download route.

const POLL_URL_TTL_SECONDS = 300;

const bundleStatusMeta: RouteMeta = {
  operationId: "downloads.bundleStatus",
  surface: "app",
  authenticated: true,
  permission: "files:organize",
  // files:* capabilities govern matter-rooted file objects, so the resource is "matter" (the same
  // binding the download route declares) — even though the job itself is addressed per firm.
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const BundleStatusResponse = z
  .object({ status: z.string(), url: z.string().optional() })
  .openapi("BundleStatus");

const bundleStatusRoute = defineOpenAPIRoute(bundleStatusMeta, {
  method: "get",
  path: "/api/v1/downloads/bundles/{manifestHash}",
  description:
    "Reports the state of an async bulk-download build (building, ready, or failed). A ready job " +
    "carries a freshly minted, short-lived signed URL to the built ZIP artifact.",
  request: { params: z.object({ manifestHash: z.string().min(1) }) },
  responses: {
    200: {
      description: "The job's current state, with a signed URL when ready",
      content: { "application/json": { schema: BundleStatusResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks files:organize",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "The firm is unreachable or the member is deactivated",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

type BundleStatusApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;

export function registerBundleStatusRoute(app: BundleStatusApp, chokepoint: Chokepoint): void {
  app.openapi(
    { ...bundleStatusRoute, middleware: chokepointMiddleware(chokepoint, bundleStatusRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const firmId = requireChokepointFirmId(c);
      const bucket = requireBucket(firm.bucketName);
      const { manifestHash } = c.req.valid("param");

      const coordinator = c.env.BUNDLE_COORDINATOR.get(
        c.env.BUNDLE_COORDINATOR.idFromName(`${firmId}:${manifestHash}`),
      );
      const state = await coordinator.status();
      if (state.status === "ready" && state.r2Key !== null) {
        // Guard against a reaped artifact: the `bundles/` R2 lifecycle rule expires the object after
        // its TTL, but the DO state is durable and would keep reporting `ready` with a stale key —
        // handing out a signed URL that 404s. HEAD the object first; if it is gone, report `expired`
        // so the client re-requests a build (the download route rebuilds a missing artifact).
        const artifact = await c.env.R2.head(state.r2Key);
        if (artifact !== null) {
          const url = await presignerForEnv(c.env).presignGet(
            bucket,
            state.r2Key,
            POLL_URL_TTL_SECONDS,
          );
          return c.json({ status: "ready", url }, 200);
        }
        return c.json({ status: "expired" }, 200);
      }
      return c.json({ status: state.status }, 200);
    },
  );
}
