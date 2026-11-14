// GET /api/v1/platform/errors/{errorId} — what one Error ID was, for System Status's lookup box.
//
// A platform operator's read, for the same reason as Recent Errors: a record names a firm, a member
// and a route, across every firm on the deployment. The record itself is the control plane's
// `error_record` (src/http/error-record.ts and ./client-errors.ts write it); what each column may hold
// is stated on the table.
//
// An ID with no record is still answered: a server-minted ID says when and where it was minted, and
// that is enough to tell "before recording began, or past the thirty days" from "never minted here".
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import {
  selectErrorRecordStatement,
  type ErrorRecordRow,
} from "@magna-carta/data-access/error-record-statements";
import { describeErrorId } from "@magna-carta/telemetry/ids";
import type { Bindings } from "../../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { Problem } from "../../contracts/problem.ts";
import { platformOperatorGuard } from "../shared/platform-operator-guard.ts";

export const ErrorRecord = z
  .object({
    errorId: z.string(),
    recordedAt: z.string(),
    source: z.enum(["server", "browser"]),
    service: z.string().nullable(),
    operation: z.string().nullable(),
    status: z.number().int().nullable(),
    problemType: z.string().nullable(),
    title: z.string().nullable(),
    errorName: z.string().nullable(),
    messageHead: z.string().nullable(),
    location: z.string().nullable(),
    build: z.string().nullable(),
    firmId: z.string().nullable(),
    userId: z.string().nullable(),
    correlationId: z.string().nullable(),
  })
  .openapi("ErrorRecord");

const ErrorLookupResponse = z
  .object({
    record: ErrorRecord.nullable(),
    // What a server-minted ID says about itself, recorded or not; null for a client_ ID.
    mintedAt: z.string().nullable(),
    mintedBy: z.string().nullable(),
  })
  .openapi("ErrorLookupResponse");

export function errorRecordFromRow(row: ErrorRecordRow): z.infer<typeof ErrorRecord> {
  return {
    errorId: row.id,
    recordedAt: row.recorded_at,
    source: row.source === "browser" ? "browser" : "server",
    service: row.service,
    operation: row.operation,
    status: row.status,
    problemType: row.problem_type,
    title: row.title,
    errorName: row.error_name,
    messageHead: row.message_head,
    location: row.location,
    build: row.build,
    firmId: row.firm_id,
    userId: row.user_id,
    correlationId: row.correlation_id,
  };
}

export const platformErrorLookupMeta: RouteMeta = {
  operationId: "platform.errorLookup",
  surface: "public",
  authenticated: true,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const platformErrorLookupRoute = defineOpenAPIRoute(platformErrorLookupMeta, {
  method: "get",
  path: "/api/v1/platform/errors/{errorId}",
  description:
    "What one Error ID was: the recorded failure (the operation, the answer, the error kind, the " +
    "scrubbed message head, the firm and member ids), kept for thirty days. An ID with no record " +
    "still answers what a server-minted ID says about itself — when and by which Worker.",
  request: {
    params: z.object({
      errorId: z
        .string()
        .max(64)
        .regex(/^(error|client)_[A-Za-z0-9]+$/),
    }),
  },
  responses: {
    200: {
      description: "The record, or what the ID says about itself",
      content: { "application/json": { schema: ErrorLookupResponse } },
    },
    401: {
      description: "Not signed in",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Not a platform operator, or 2FA not enabled",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "Not the shape of an Error ID",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerPlatformErrorLookupRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...platformErrorLookupRoute,
      middleware: chokepointMiddleware(chokepoint, platformErrorLookupRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { errorId } = c.req.valid("param");
      const { results } = await selectErrorRecordStatement(
        c.env.DB_CONTROL,
        errorId,
      ).all<ErrorRecordRow>();
      const row = results[0];
      const facts = describeErrorId(errorId);
      return c.json(
        {
          record: row === undefined ? null : errorRecordFromRow(row),
          mintedAt: facts === null ? null : facts.mintedAt.toISOString(),
          mintedBy: facts === null ? null : facts.service,
        },
        200,
      );
    },
  );
}
