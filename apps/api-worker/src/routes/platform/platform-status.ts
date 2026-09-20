// The platform-status event-lifecycle write routes: a platform operator declares a service event
// (an active disruption), posts rolling updates as investigation progresses, and resolves it. All
// three write the SAME operator-owned status:authored KV document (authored-store.ts); the public
// read/merge surface that serves the status page consumes it alongside the cron-derived document.
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { COMPONENT_STATUS, EVENT_IMPACT, EVENT_LIFECYCLE } from "@magna-carta/status";
import type { Bindings } from "../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { Problem, problemJson } from "../../contracts/problem.ts";
import { platformOperatorGuard } from "./platform-operator-guard.ts";
import { mutateAuthored } from "../../status/authored-store.ts";

const DeclareBody = z
  .object({
    title: z.string().min(1),
    impact: z.enum(EVENT_IMPACT),
    affectedComponentIds: z.array(z.string()),
    body: z.string().min(1),
  })
  .openapi("DeclareServiceEvent");

const UpdateBody = z
  .object({ eventId: z.string(), lifecycle: z.enum(EVENT_LIFECYCLE), body: z.string().min(1) })
  .openapi("PostServiceEventUpdate");

const EventResult = z.object({ eventId: z.string() }).openapi("ServiceEventResult");

// A component-status override is the v1 shape for a maintenance window too: an operator sets an
// override with status "maintenance" for the affected component — there is no separate schedule
// model. Note is required (not optional) so an override always carries operator-visible context.
const SetOverrideBody = z
  .object({
    componentId: z.string().min(1),
    status: z.enum(COMPONENT_STATUS),
    note: z.string().min(1),
  })
  .openapi("SetComponentOverride");

const ClearOverrideBody = z
  .object({ componentId: z.string().min(1) })
  .openapi("ClearComponentOverride");

const OverrideResult = z.object({ componentId: z.string() }).openapi("ComponentOverrideResult");

// surface: "public" is the platform-operator exception (the same posture as
// platform-release-channel.ts): platformOperatorGuard does the auth (Better Auth session +
// platform_operator/2FA check), so the chokepoint skips session/firm/RBAC gates and still owns the
// rate-limit and idempotency gates. permission: "firm:provision" is the nominal capability (public
// routes skip the RBAC gate; the guard is the real auth here, but the mutating-method registration
// guard in defineOpenAPIRoute requires a non-null permission).
const commonMeta = {
  surface: "public",
  authenticated: true,
  permission: "firm:provision",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "auth",
} satisfies Omit<RouteMeta, "operationId">;

export const declareEventMeta: RouteMeta = {
  ...commonMeta,
  operationId: "platformStatus.declareEvent",
};
export const postUpdateMeta: RouteMeta = {
  ...commonMeta,
  operationId: "platformStatus.postUpdate",
};
export const resolveEventMeta: RouteMeta = {
  ...commonMeta,
  operationId: "platformStatus.resolveEvent",
};
export const setComponentOverrideMeta: RouteMeta = {
  ...commonMeta,
  operationId: "platformStatus.setComponentOverride",
};
export const clearComponentOverrideMeta: RouteMeta = {
  ...commonMeta,
  operationId: "platformStatus.clearComponentOverride",
};

export const declareEventRoute = defineOpenAPIRoute(declareEventMeta, {
  method: "post",
  path: "/api/v1/platform/status/events",
  description:
    "A platform operator declares a service event (a disruption) with an opening update.",
  request: { body: { content: { "application/json": { schema: DeclareBody } }, required: true } },
  responses: {
    201: {
      description: "The declared event id",
      content: { "application/json": { schema: EventResult } },
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
      description: "Invalid body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const postUpdateRoute = defineOpenAPIRoute(postUpdateMeta, {
  method: "post",
  path: "/api/v1/platform/status/events/updates",
  description: "A platform operator posts a rolling update to an existing service event.",
  request: { body: { content: { "application/json": { schema: UpdateBody } }, required: true } },
  responses: {
    200: {
      description: "The updated event id",
      content: { "application/json": { schema: EventResult } },
    },
    401: {
      description: "Not signed in",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Not a platform operator, or 2FA not enabled",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such event",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "Invalid body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const resolveEventRoute = defineOpenAPIRoute(resolveEventMeta, {
  method: "post",
  path: "/api/v1/platform/status/events/resolve",
  description:
    "A platform operator resolves a service event (marks it resolved with a final update).",
  request: { body: { content: { "application/json": { schema: UpdateBody } }, required: true } },
  responses: {
    200: {
      description: "The resolved event id",
      content: { "application/json": { schema: EventResult } },
    },
    401: {
      description: "Not signed in",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Not a platform operator, or 2FA not enabled",
      content: { "application/problem+json": { schema: Problem } },
    },
    404: {
      description: "No such event",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "Invalid body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const setComponentOverrideRoute = defineOpenAPIRoute(setComponentOverrideMeta, {
  method: "post",
  path: "/api/v1/platform/status/overrides",
  description:
    "A platform operator sets a component status override (including a maintenance window, via status maintenance), upserted by componentId.",
  request: {
    body: { content: { "application/json": { schema: SetOverrideBody } }, required: true },
  },
  responses: {
    200: {
      description: "The overridden component id",
      content: { "application/json": { schema: OverrideResult } },
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
      description: "Invalid body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export const clearComponentOverrideRoute = defineOpenAPIRoute(clearComponentOverrideMeta, {
  method: "post",
  path: "/api/v1/platform/status/overrides/clear",
  description: "A platform operator clears a component status override by componentId.",
  request: {
    body: { content: { "application/json": { schema: ClearOverrideBody } }, required: true },
  },
  responses: {
    200: {
      description: "The cleared component id",
      content: { "application/json": { schema: OverrideResult } },
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
      description: "Invalid body",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerPlatformStatusRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...declareEventRoute,
      middleware: chokepointMiddleware(chokepoint, declareEventRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { title, impact, affectedComponentIds, body } = c.req.valid("json");
      const author = c.get("platformOperatorUserId") ?? "";
      const now = new Date().toISOString();
      const eventId = newIdentifier("serviceEvent");
      await mutateAuthored(c.env.STATUS_KV, now, (current) => ({
        ...current,
        events: [
          ...current.events,
          {
            id: eventId,
            title,
            impact,
            lifecycle: "investigating",
            affectedComponentIds,
            authorUserId: author,
            startedAt: now,
            resolvedAt: null,
            updates: [{ at: now, lifecycle: "investigating", body, authorUserId: author }],
          },
        ],
      }));
      return c.json({ eventId }, 201);
    },
  );

  app.openapi(
    {
      ...postUpdateRoute,
      middleware: chokepointMiddleware(chokepoint, postUpdateRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { eventId, lifecycle, body } = c.req.valid("json");
      const author = c.get("platformOperatorUserId") ?? "";
      const now = new Date().toISOString();
      const { found } = await appendEventUpdate(
        c.env.STATUS_KV,
        now,
        eventId,
        lifecycle,
        body,
        author,
        false,
      );
      if (!found) return problemJson(c, { type: "not-found", title: "No such event", status: 404 });
      return c.json({ eventId }, 200);
    },
  );
  app.openapi(
    {
      ...resolveEventRoute,
      middleware: chokepointMiddleware(chokepoint, resolveEventRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { eventId, lifecycle, body } = c.req.valid("json");
      const author = c.get("platformOperatorUserId") ?? "";
      const now = new Date().toISOString();
      const { found } = await appendEventUpdate(
        c.env.STATUS_KV,
        now,
        eventId,
        lifecycle,
        body,
        author,
        true,
      );
      if (!found) return problemJson(c, { type: "not-found", title: "No such event", status: 404 });
      return c.json({ eventId }, 200);
    },
  );

  app.openapi(
    {
      ...setComponentOverrideRoute,
      middleware: chokepointMiddleware(chokepoint, setComponentOverrideRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { componentId, status, note } = c.req.valid("json");
      const author = c.get("platformOperatorUserId") ?? "";
      const now = new Date().toISOString();
      await mutateAuthored(c.env.STATUS_KV, now, (current) => ({
        ...current,
        overrides: [
          ...current.overrides.filter((override) => override.componentId !== componentId),
          { componentId, status, note, setAt: now, authorUserId: author },
        ],
      }));
      return c.json({ componentId }, 200);
    },
  );

  app.openapi(
    {
      ...clearComponentOverrideRoute,
      middleware: chokepointMiddleware(chokepoint, clearComponentOverrideRoute, [
        platformOperatorGuard as MiddlewareHandler,
      ]),
    },
    async (c) => {
      const { componentId } = c.req.valid("json");
      const now = new Date().toISOString();
      await mutateAuthored(c.env.STATUS_KV, now, (current) => ({
        ...current,
        overrides: current.overrides.filter((override) => override.componentId !== componentId),
      }));
      return c.json({ componentId }, 200);
    },
  );
}

// Shared by post-update and resolve: appends an update to the named event, forcing lifecycle to
// "resolved" (and stamping resolvedAt) when resolve is true, taking the caller's requested lifecycle
// otherwise. Extracted to a plain function (rather than a factory returning a Hono handler) because
// the two routes' typed Contexts differ — inlining c.req.valid("json") in each thin handler above
// keeps the zod-openapi type inference intact; this helper only ever sees plain values.
async function appendEventUpdate(
  kv: KVNamespace,
  now: string,
  eventId: string,
  lifecycle: (typeof EVENT_LIFECYCLE)[number],
  body: string,
  author: string,
  resolve: boolean,
): Promise<{ found: boolean }> {
  let found = false;
  await mutateAuthored(kv, now, (current) => ({
    ...current,
    events: current.events.map((event) => {
      if (event.id !== eventId) return event;
      found = true;
      const nextLifecycle = resolve ? "resolved" : lifecycle;
      return {
        ...event,
        lifecycle: nextLifecycle,
        resolvedAt: resolve ? now : event.resolvedAt,
        updates: [
          ...event.updates,
          { at: now, lifecycle: nextLifecycle, body, authorUserId: author },
        ],
      };
    }),
  }));
  return { found };
}
