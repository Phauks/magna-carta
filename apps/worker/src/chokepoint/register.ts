// The per-route middleware composition: every /api route is registered with
// this exact chain, so the wiring lives in ONE home and no route module re-derives the order. It
// also runs the registration-time fail-closed assertion (assertRouteHasMeta) — a route mounted
// without metadata, or naming an unregistered permission, throws HERE at startup, never reaching a
// per-request 500.
//
// Order (the middleware array runs left-to-right, each wrapping the next):
//   1. the dev-only response validator — outermost so it awaits the whole chain and validates the
//      FINAL response (including the chokepoint's own problem replies) against the declared schema;
//   2. route-specific guards (the platform-admin secret on the public firms surface) — so a public
//      route is auth'd by its own guard before the chokepoint's idempotency/rate-limit gates, and
//      nothing about the route is discoverable without the secret;
//   3. the chokepoint enforcement middleware — which owns the session → firm → RBAC → idempotency →
//      rate-limit order internally.
import type { MiddlewareHandler } from "hono";
import type { RouteConfig } from "@hono/zod-openapi";
import type { Chokepoint } from "./chokepoint.ts";
import { createResponseValidator } from "./response-validator.ts";

export function chokepointMiddleware(
  chokepoint: Chokepoint,
  route: RouteConfig,
  routeSpecificMiddleware: MiddlewareHandler[] = [],
): MiddlewareHandler[] {
  // Fail-closed at registration: assert the route carries its metadata (and a registered
  // permission) before composing — a misconfigured route never reaches request time. The meta the
  // chokepoint enforces is the route's own resolved meta, derived here so a caller cannot hand in a
  // meta that disagrees with the route it is wiring.
  const meta = chokepoint.assertRouteHasMeta(route as object, route.path);
  return [
    createResponseValidator(route) as MiddlewareHandler,
    ...routeSpecificMiddleware,
    chokepoint.forRoute(meta),
  ];
}
