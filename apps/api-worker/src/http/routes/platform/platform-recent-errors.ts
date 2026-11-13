// GET /api/v1/platform/recent-errors — the deployment's failures over the last day, one row per kind,
// for the System Status page's Recent Errors tab. A platform operator's read: the rows name Workers,
// routes and Error IDs across every firm on the deployment, which is the operator's view and no
// firm's. The read itself and its four outcomes are src/system-status/recent-errors.ts.
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { Problem } from "../../contracts/problem.ts";
import { platformOperatorGuard } from "../shared/platform-operator-guard.ts";
import { readRecentErrors } from "../../../system-status/recent-errors.ts";

const RecentErrorGroup = z
  .object({
    latestErrorId: z.string().nullable(),
    service: z.string().nullable(),
    eventName: z.string(),
    where: z.string().nullable(),
    errorName: z.string().nullable(),
    messageHead: z.string().nullable(),
    count: z.number().int(),
    firstSeen: z.string(),
    lastSeen: z.string(),
  })
  .openapi("RecentErrorGroup");

const RecentErrorsResponse = z
  .object({
    state: z.enum(["read", "not-configured", "refused", "unreachable"]),
    windowStart: z.string().nullable(),
    windowEnd: z.string().nullable(),
    total: z.number().int().nullable(),
    truncated: z.boolean(),
    groups: z.array(RecentErrorGroup),
  })
  .openapi("RecentErrorsResponse");

// surface: "public" is the platform-operator exception (platform-status.ts states the posture):
// the guard resolves the session and the operator row itself, and the chokepoint keeps the rate
// limit. A read, so no idempotency and no audit row.
export const platformRecentErrorsMeta: RouteMeta = {
  operationId: "platform.recentErrors",
  surface: "public",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const platformRecentErrorsRoute = defineOpenAPIRoute(platformRecentErrorsMeta, {
  method: "get",
  path: "/api/v1/platform/recent-errors",
  description:
    "The deployment's recent failures, read back from Workers Logs: every error.captured and " +
    "operation.failed event across the account's Workers over the last 24 hours, folded into one " +
    "row per Worker, place and error name with its count, first and last sighting and newest Error " +
    "ID. state says why there are no rows when the read could not be made: not-configured (no " +
    "account id or log-read token), refused (the token was not accepted) or unreachable.",
  responses: {
    200: {
      description: "The recent failures, or why they could not be read",
      content: { "application/json": { schema: RecentErrorsResponse } },
    },
    401: {
      description: "Not signed in",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Not a platform operator, or 2FA not enabled",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerPlatformRecentErrorsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...platformRecentErrorsRoute,
      middleware: chokepointMiddleware(chokepoint, platformRecentErrorsRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const report = await readRecentErrors(c.env);
      if (report.state !== "read") {
        return c.json(
          {
            state: report.state,
            windowStart: null,
            windowEnd: null,
            total: null,
            truncated: false,
            groups: [],
          },
          200,
        );
      }
      return c.json(
        {
          state: report.state,
          windowStart: report.windowStart,
          windowEnd: report.windowEnd,
          total: report.total,
          truncated: report.truncated,
          groups: [...report.groups],
        },
        200,
      );
    },
  );
}
