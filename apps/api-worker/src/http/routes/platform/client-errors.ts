// POST /api/v1/client-errors — the app keeping a crash in the browser against the Error ID it showed.
//
// A crash in the browser never reaches the API on its own, so the `client_…` handle a crash screen
// shows used to resolve to nothing: there was no record anywhere to look it up in. The app now sends
// the crash's code-shaped facts here the moment the crash screen draws, and the control plane's error
// record keeps them beside the server's own failures.
//
// What a crash may carry, and the insert that keeps it, are ../shared/client-error-record.ts, which
// the meeting guest's route uses too.
//
// It is not an incident. Nothing a member wrote travels, nobody is notified, and the member still
// chooses whether to report it; this only makes the handle on their screen resolvable.
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  keepClientError,
  RecordClientErrorRequest,
  RecordClientErrorResponse,
} from "../shared/client-error-record.ts";

export { CLIENT_ERROR_ID_PATTERN, keptClientMessage } from "../shared/client-error-record.ts";

// audited: true — the error record row IS the durable record, the same reasoning the incident
// route gives. firm:reportIncident is held by every default role: anybody who can crash the app
// can make the crash resolvable. Keyed per member by its own bucket, so a render loop on one
// person's screen spends nobody else's budget.
export const recordClientErrorMeta: RouteMeta = {
  operationId: "clientErrors.record",
  surface: "app",
  authenticated: true,
  permission: "firm:reportIncident",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "client-error",
};

export const recordClientErrorRoute = defineOpenAPIRoute(recordClientErrorMeta, {
  method: "post",
  path: "/api/v1/client-errors",
  description:
    "Keeps a crash in the browser against the client_ Error ID its crash screen shows, so the ID " +
    "can be looked up in System Status. Carries the route template, the error kind, the first " +
    "stack frame and the build; a message only for the engine's own kinds (TypeError, " +
    "ReferenceError, RangeError), scrubbed. A second send of one ID is a no-op.",
  request: {
    body: {
      content: { "application/json": { schema: RecordClientErrorRequest } },
      required: true,
    },
  },
  responses: {
    201: {
      description: "The crash is recorded (or already was)",
      content: { "application/json": { schema: RecordClientErrorResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks firm:reportIncident",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description:
        "The session's firm is not reachable, or the session member is deactivated — absent, never an existence oracle",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "The body failed validation",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerClientErrorsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...recordClientErrorRoute,
      middleware: chokepointMiddleware(chokepoint, recordClientErrorRoute),
    },
    async (c) => {
      const userId = requireChokepointUserId(c);
      const firmId = requireChokepointFirmId(c);
      const request = c.req.valid("json");
      await keepClientError(c.env, request, {
        firmId,
        userId,
        correlationId: c.get("correlationId") ?? null,
        route: request.route,
      });
      return c.json({ errorId: request.errorId, recorded: true }, 201);
    },
  );
}
