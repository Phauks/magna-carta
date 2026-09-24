// Negative-compile assertions for defineOpenAPIRoute: exercised by the typechecker (pnpm check),
// not by Vitest — the pattern from problem-status.ts and identifier-path-param-types.ts. The
// wrapper promises that a route cannot be defined without a description (Spectral's
// operation-description rule made a compile error instead of a CI lint failure) and that the
// permission field only admits registry-checked keys.
import { OpenAPIHono, z } from "@hono/zod-openapi";
import { defineOpenAPIRoute, type RouteMeta } from "../../src/http/contracts/route-meta";

const meta: RouteMeta = {
  operationId: "matters.list",
  surface: "app",
  authenticated: true,
  permission: "firm:manageMembers",
  resource: "matter",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

const responses = {
  200: {
    description: "OK",
    content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
  },
};

// POSITIVE control: a described route compiles.
export const describedRoute = defineOpenAPIRoute(meta, {
  method: "get",
  path: "/api/v1/matters",
  description: "Lists matters.",
  responses,
});

// @ts-expect-error - description is required by the wrapper even though createRoute's own config
// leaves it optional; an undescribed operation must be a compile error, not a Spectral finding
export const undescribedRoute = defineOpenAPIRoute(meta, {
  method: "get",
  path: "/api/v1/matters",
  responses,
});

// A permission literal must be a key registered in the access-control registry (KnownPermission);
// an unregistered string must not typecheck.
export const unregisteredPermissionMeta: RouteMeta = {
  ...meta,
  // @ts-expect-error - "matters:doesNotExist" is not a registered permission key
  permission: "matters:doesNotExist",
};

// Handler response inference pins: defineOpenAPIRoute's return must carry createRoute's full
// response inference through to app.openapi(), so a handler that diverges from the declared
// contract is a compile error. If a future widening cast on defineOpenAPIRoute's return type
// erases that inference, these directives become "unused @ts-expect-error" failures — the
// degradation is loud, not silent. POSITIVE control first: a conforming handler compiles.
const inferencePinApp = new OpenAPIHono();
inferencePinApp.openapi(describedRoute, (c) => c.json({ ok: true }, 200));

// @ts-expect-error - the declared 200 body is { ok: boolean }; a string body shape must not compile
inferencePinApp.openapi(describedRoute, (c) => c.json({ ok: "yes" }, 200));

// @ts-expect-error - 404 is not a declared status code for this route; replying with it must not compile
inferencePinApp.openapi(describedRoute, (c) => c.json({ ok: true }, 404));
