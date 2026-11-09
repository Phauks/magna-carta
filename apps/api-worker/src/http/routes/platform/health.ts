import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

const Health = z
  .object({ status: z.literal("ok"), version: z.string(), time: z.string() })
  .openapi("Health");

// Health is public, unauthenticated platform plumbing (a liveness probe), NOT a /api/v1 business
// route — but it still carries route metadata and rides the chokepoint (rate-limit only; the
// chokepoint skips session/firm/RBAC for an unauthenticated public surface) so EVERY registered
// route is enforced through the one seam, none reachable that skips it. permission: null because
// authenticated is false (the route-meta guard requires null permission on a public route).
export const healthMeta: RouteMeta = {
  operationId: "health.read",
  surface: "public",
  authenticated: false,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const healthRoute = defineOpenAPIRoute(healthMeta, {
  method: "get",
  path: "/api/health",
  description: "Service health — the walking-skeleton control-plane round trip.",
  responses: {
    200: {
      description: "Service health",
      content: { "application/json": { schema: Health } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerHealthRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...healthRoute, middleware: chokepointMiddleware(chokepoint, healthRoute) },
    async (c) => {
      // Prove the control-plane D1 binding works end-to-end (the walking-skeleton's round trip).
      await c.env.DB_CONTROL.prepare("SELECT 1").first();
      // Skeleton timestamp; Temporal.Instant adoption is a later slice.
      return c.json(
        { status: "ok" as const, version: "0.0.0", time: new Date().toISOString() },
        200,
      );
    },
  );
}
