// Negative-compile assertions for defineOpenAPIRoute: exercised by the typechecker (pnpm check),
// not by Vitest — the pattern from problem-status.ts and identifier-path-param-types.ts. The
// wrapper promises that a route cannot be defined without a description (Spectral's
// operation-description rule made a compile error instead of a CI lint failure) and that the
// permission field only admits registry-checked keys.
import { z } from "@hono/zod-openapi";
import { defineOpenAPIRoute, type RouteMeta } from "../../src/contracts/route-meta";

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
