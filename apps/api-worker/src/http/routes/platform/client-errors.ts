// POST /api/v1/client-errors — the app keeping a crash in the browser against the Error ID it showed.
//
// A crash in the browser never reaches the API on its own, so the `client_…` handle a crash screen
// shows used to resolve to nothing: there was no record anywhere to look it up in. The app now sends
// the crash's code-shaped facts here the moment the crash screen draws, and the control plane's error
// record keeps them beside the server's own failures.
//
// What arrives is a shape, never content: the handle, the SvelteKit route id (a template such as
// "/(app)/meetings/[meetingId]", not the concrete path), the error's kind, the first stack frame as
// file, line and column, and the build. A message is kept only for the kinds whose message the
// JavaScript engine writes itself, and it is scrubbed here as well as there; anything else is
// dropped, because a message our code or a library wrote can carry what the code had in hand.
//
// It is not an incident. Nothing a member wrote travels, nobody is notified, and the member still
// chooses whether to report it; this only makes the handle on their screen resolvable.
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { insertErrorRecordStatement } from "@magna-carta/data-access/error-record-statements";
import { scrubText } from "@magna-carta/telemetry/scrub";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmId,
  requireChokepointUserId,
} from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem, publicCause } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";

/** The shape apps/web/src/lib/diagnostics/client-error-id.ts mints: Crockford base32, eight long. */
export const CLIENT_ERROR_ID_PATTERN = /^client_[0-9A-HJKMNP-TV-Z]{8}$/;

const RecordClientErrorRequest = z
  .object({
    errorId: z.string().regex(CLIENT_ERROR_ID_PATTERN),
    // The SvelteKit route id the crash happened under, or the path where there is none.
    route: z.string().max(200),
    errorName: z.string().max(60),
    // Present only for an engine-written message; the server keeps it only for those kinds too.
    message: z.string().max(200).optional(),
    // The first stack frame, "file.svelte:212:18".
    location: z.string().max(160).optional(),
    build: z.string().max(60),
  })
  .openapi("RecordClientErrorRequest");

const RecordClientErrorResponse = z
  .object({ errorId: z.string(), recorded: z.boolean() })
  .openapi("RecordClientErrorResponse");

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

/** The message the record may keep: an engine kind's message, scrubbed, or nothing. */
export function keptClientMessage(errorName: string, message: string | undefined): string | null {
  if (message === undefined || message === "") return null;
  const scrubbed = scrubText(message).text;
  const cause = publicCause(errorName, scrubbed);
  // publicCause returns the bare kind when the kind is not one the engine writes.
  return cause === (errorName === "" ? "Error" : errorName) ? null : scrubbed;
}

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
      await insertErrorRecordStatement(c.env.DB_CONTROL, {
        errorId: request.errorId,
        recordedAt: new Date().toISOString(),
        source: "browser",
        service: "web",
        operation: request.route,
        status: null,
        problemType: null,
        title: null,
        errorName: request.errorName,
        messageHead: keptClientMessage(request.errorName, request.message),
        location: request.location ?? null,
        build: request.build,
        firmId,
        userId,
        correlationId: c.get("correlationId") ?? null,
      }).run();
      return c.json({ errorId: request.errorId, recorded: true }, 201);
    },
  );
}
