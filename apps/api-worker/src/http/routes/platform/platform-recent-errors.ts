// GET /api/v1/platform/recent-errors — the deployment's failures over the last day, one row per kind,
// for the System Status page's Recent Errors tab. A platform operator's read: the rows name Workers,
// routes and Error IDs across every firm on the deployment, which is the operator's view and no
// firm's. The read is src/system-status/recorded-errors.ts: the control plane's own error record,
// with background failures joined on from Workers Logs where a log-read token is set.
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { Problem } from "../../contracts/problem.ts";
import { platformOperatorGuard } from "../shared/platform-operator-guard.ts";
import { readRecordedErrors } from "../../../system-status/recorded-errors.ts";

const RecentErrorGroup = z
  .object({
    // server: a problem the API answered; browser: a crash the app reported; background: a sweep,
    // consumer or Cron failure read from Workers Logs.
    source: z.enum(["server", "browser", "background"]),
    latestErrorId: z.string().nullable(),
    service: z.string().nullable(),
    // The operation (method and route template), the app route a crash happened under, or the
    // background pass's name.
    where: z.string().nullable(),
    status: z.number().int().nullable(),
    title: z.string().nullable(),
    errorName: z.string().nullable(),
    messageHead: z.string().nullable(),
    count: z.number().int(),
    firstSeen: z.string(),
    lastSeen: z.string(),
  })
  .openapi("RecentErrorGroup");

const RecentErrorsResponse = z
  .object({
    // Whether the error record could be read.
    state: z.enum(["read", "unreachable"]),
    // Whether the background failures could be read from Workers Logs, which needs a token.
    backgroundState: z.enum(["read", "not-configured", "refused", "unreachable"]),
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
    "The deployment's failures over the last 24 hours, folded into one row per source, Worker, " +
    "place, status and error name with its count, first and last sighting and newest Error ID. " +
    "Requests and browser crashes come from the control plane's error record; background failures " +
    "come from Workers Logs, and backgroundState says why they are missing when the log read " +
    "could not be made: not-configured (no account id or log-read token), refused or unreachable.",
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
      const report = await readRecordedErrors(c.env);
      if (report.state !== "read") {
        return c.json(
          {
            state: report.state,
            backgroundState: report.backgroundState,
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
          backgroundState: report.backgroundState,
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
