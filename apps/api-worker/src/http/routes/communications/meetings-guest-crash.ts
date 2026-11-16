// POST /api/v1/guest/client-errors: a meeting guest's page keeping a crash against the Error ID its
// crash screen shows, the way a member's page does at /api/v1/client-errors.
//
// A guest has no session, so the member's route refuses them and their `client_` handle used to
// resolve to nothing. This rides the chokepoint's guest lane on the LINK the page was opened from
// (the invitation lane), because the link is the one credential the page holds for the whole visit:
// a crash before Join has no grant yet. The firm comes from the verified link; no user is recorded,
// because a guest is not one.
//
// The route the record files the crash under is fixed, never the page's address: a guest's address
// IS their link, token and all, and the record must not hold a credential.
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { requireChokepointGuestGrant } from "../../chokepoint/context-accessors.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import {
  keepClientError,
  RecordClientErrorRequest,
  RecordClientErrorResponse,
} from "../shared/client-error-record.ts";

/** What a guest's crash is filed under: the page's route template, which names no link. */
export const GUEST_PAGE_ROUTE = "/join/[token]";

// The guest lane's shape (meetings-guest.ts says why each field is what it is). audited: true for
// the reason the member's route gives: the error record row is the durable record. Keyed by the
// invitation, on the bucket a member's crash uses, so one guest's render loop stops at its own
// ceiling.
export const recordGuestCrashMeta: RouteMeta = {
  operationId: "guest.recordCrash",
  surface: "app",
  authenticated: false,
  permission: null,
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "client-error",
  guestLane: "invitation",
};

const guestCredentialHeader = z.object({
  "x-meeting-guest": z
    .string()
    .optional()
    .openapi({
      param: { name: "x-meeting-guest", in: "header" },
      description: "The link the guest's page was opened from.",
    }),
});

export const recordGuestCrashRoute = defineOpenAPIRoute(recordGuestCrashMeta, {
  method: "post",
  path: "/api/v1/guest/client-errors",
  description:
    "Keeps a crash on a meeting guest's page against the client_ Error ID its crash screen shows, " +
    "so the ID can be looked up in System Status. The same facts a member's crash carries; the " +
    "route is filed as the guest page's template, never the address, which holds the link. A " +
    "second send of one ID is a no-op.",
  request: {
    headers: guestCredentialHeader,
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
    404: {
      description: "No such resource: the answer to a missing or unverifiable link",
      content: { "application/problem+json": { schema: Problem } },
    },
    409: {
      description: "The meeting has ended or the link is used up",
      content: { "application/problem+json": { schema: Problem } },
    },
    410: {
      description: "The link has expired, was withdrawn, or was replaced by a newer one",
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

export function registerMeetingGuestCrashRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...recordGuestCrashRoute,
      middleware: chokepointMiddleware(chokepoint, recordGuestCrashRoute),
    },
    async (c) => {
      const grant = requireChokepointGuestGrant(c);
      const request = c.req.valid("json");
      await keepClientError(c.env, request, {
        firmId: grant.firmId,
        userId: null,
        correlationId: c.get("correlationId") ?? null,
        route: GUEST_PAGE_ROUTE,
      });
      return c.json({ errorId: request.errorId, recorded: true }, 201);
    },
  );
}
