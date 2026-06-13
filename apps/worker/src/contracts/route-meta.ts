// RouteMeta + defineOpenAPIRoute (design spec, route-metadata model; ADR-0067): every route
// carries machine-readable metadata so each cross-cutting concern is a property of the traversed
// path — enforced at the one chokepoint middleware and provable in CI over the emitted document,
// never per-handler discipline. A field belongs here only if the chokepoint, a fitness function,
// or codegen consumes it; the reserved seams (cache, planTier, metered) stay unpopulated until
// their owning feature is built.
//
// Note: @hono/zod-openapi exports its own (unrelated) defineOpenAPIRoute helper for route+handler
// bundles; this module's defineOpenAPIRoute is the platform wrapper around createRoute and is the
// only one route modules import.
import { createRoute, z } from "@hono/zod-openapi";
import type { RouteConfig } from "@hono/zod-openapi";
import type { KnownPermission, Permission } from "@magna-carta/access-control/registry";

export type RateLimitBucket = "default" | "auth" | "expensive";

export interface RouteMeta {
  operationId: string; // 'subsystem.action' — ^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$
  surface: "app" | "public" | "portal";
  authenticated: boolean;
  // Capability required (ADR-0068 registry); null only when authenticated: false. KnownPermission
  // admits compile-checked literals (the registry's documented authoring type — a branded
  // Permission cannot be written literally); Permission admits runtime-validated values.
  permission: KnownPermission | Permission | null;
  resource: "matter" | "firm" | "location" | "directoryEntity" | "portalShare";
  audited: boolean; // writes an immutable audit entry (ADR-0017/0038)
  idempotency: "required" | "optional"; // ADR-0063 — required on money/trust/payment/outbound-comms
  rateLimit: RateLimitBucket;
  tags?: string[]; // default: [operationId namespace] — applied when absent OR empty
  deprecated?: boolean;
}

// The meta as attached to a defined route: optional fields resolved to their defaults, so the
// chokepoint and the conformance suite never re-derive them.
export interface ResolvedRouteMeta extends RouteMeta {
  tags: string[];
  deprecated: boolean;
}

const OPERATION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

// Meta rides on the returned route object via a WeakMap, not a magic property, so the route
// config stays exactly what @hono/zod-openapi expects and the association cannot leak into the
// emitted document or serialization.
const routeMetaByRoute = new WeakMap<object, ResolvedRouteMeta>();

// The chokepoint accessor: the resolved meta for a route returned by defineOpenAPIRoute.
//
// Keying constraint: the argument must be the EXACT object defineOpenAPIRoute returned — the
// WeakMap key does not survive past registration. app.openapi({ middleware, hide, ...route },
// handler) rest-destructures the route config (verified in @hono/zod-openapi 1.4.0), so the
// library's openAPIRegistry stores a shallow COPY (routeMetaOf on a registry definition returns
// undefined), and Hono's request-time c.req.matchedRoutes never references the createRoute
// object at all. Consequence: meta must be resolved at REGISTRATION time — app.ts iterating the
// route bundles, or per-route middleware closing over the meta — never looked up from the
// matched route at request time.
export function routeMetaOf(route: object): ResolvedRouteMeta | undefined {
  return routeMetaByRoute.get(route);
}

// createRoute's config has description optional; the platform requires it (Spectral's
// operation-description rule, and the generated SDK docs read it) — so the wrapper's parameter
// type demands it at compile time (negative-compile assertion: test/contracts/route-meta-types.ts).
type DescribedRouteConfig<P extends string> = Omit<RouteConfig, "path"> & {
  path: P;
  description: string;
};

// Documentation-only flip for idempotency-required routes (ADR-0063): the shared
// idempotencyKeyHeader fragment is optional at the schema layer (presence enforcement belongs to
// the chokepoint middleware, which replies with the registered idempotency-key-missing problem),
// but the emitted document must advertise required: true so the generated client types the header
// required and Prism models it. zod-to-openapi spreads `.openapi({ param })` metadata over the
// optionality-derived `required`, and `.openapi()` clones the field schema — the shared fragment
// is never mutated. The wrap goes through `.extend()`, which preserves the object-level schema
// state (catchall, strict/strip mode, object-level refinements); the wrapped field's own runtime
// parse is unchanged. (Whether `.extend()` carries forward object-level `.openapi` metadata is
// untested and moot here: the shared idempotencyKeyHeader fragment carries no object-level
// `.openapi`, only per-field param metadata.)
function withRequiredIdempotencyKeyHeaderDocumentation<
  P extends string,
  R extends DescribedRouteConfig<P>,
>(routeConfig: R, operationId: string): R {
  const headersSchema = routeConfig.request?.headers;
  if (headersSchema !== undefined && !(headersSchema instanceof z.ZodObject)) {
    throw new TypeError(
      `Route ${JSON.stringify(operationId)} declares idempotency: "required" but its ` +
        `request.headers is not a single z.object — array and intersection header shapes are ` +
        `unsupported by the idempotency-key documentation flip; declare one z.object that ` +
        `includes the shared idempotencyKeyHeader fragment from contracts/common.`,
    );
  }
  const idempotencyKeyField = headersSchema?.shape["idempotency-key"];
  if (headersSchema === undefined || idempotencyKeyField === undefined) {
    throw new TypeError(
      `Route ${JSON.stringify(operationId)} declares idempotency: "required" but its ` +
        `request.headers does not declare the "idempotency-key" header — include the shared ` +
        `idempotencyKeyHeader fragment from contracts/common.`,
    );
  }
  const documentedHeaders = headersSchema.extend({
    "idempotency-key": idempotencyKeyField.openapi({ param: { required: true } }),
  });
  return {
    ...routeConfig,
    request: { ...routeConfig.request, headers: documentedHeaders },
  };
}

// The platform route definer: validates the operationId shape at definition time (fails at
// startup, like the chokepoint's registration-time assertions), defaults tags from the
// operationId namespace (an absent OR empty tags list — no route may reach the document
// untagged), sets the OpenAPI-native operationId/tags/deprecated (generators key SDK method
// names off the native operationId — spike finding, docs/conventions/api.md), emits every meta
// field as an x-mc-* extension for the conformance fitness functions, and attaches the resolved
// meta for the chokepoint via routeMetaOf — keyed on the exact returned object; see the keying
// constraint on routeMetaOf (resolve meta at registration time, never from the matched route).
export function defineOpenAPIRoute<P extends string, R extends DescribedRouteConfig<P>>(
  meta: RouteMeta,
  routeConfig: R,
) {
  if (!OPERATION_ID_PATTERN.test(meta.operationId)) {
    throw new TypeError(
      `Malformed operationId ${JSON.stringify(meta.operationId)}: expected "subsystem.action" ` +
        `matching ${OPERATION_ID_PATTERN}.`,
    );
  }

  // Fail-closed access-control guards, asserted at definition time (startup), enforcing the spec's
  // access-control invariants the chokepoint (slice 0·5b) will TRUST without re-deriving. These are
  // RUNTIME asserts, not a type-level discriminated union on RouteMeta, BECAUSE the dangerous
  // invariant (#2 below) depends on the HTTP method — which lives in routeConfig.method, not on
  // RouteMeta — and on the mutating/non-mutating distinction. A discriminated union over RouteMeta
  // alone cannot see the method, so it cannot express the rule. Task 10's fitness function over the
  // emitted document remains the CI defense-in-depth backstop for the same invariants.
  //
  // #1 Public routes cannot name a capability: the chokepoint never reads a public route's
  // permission, so naming one is a confused contract that misleads the next reader.
  if (meta.authenticated === false && meta.permission !== null) {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} is public (authenticated: false) but names a ` +
        `permission ${JSON.stringify(meta.permission)} — the chokepoint ignores a public route's ` +
        `permission; set permission: null, or set authenticated: true if a capability is required.`,
    );
  }
  // #2 Authenticated mutating routes must name a non-null permission. The chokepoint reads
  // permission: null as "any authenticated user," so a mutating route authored with null permission
  // would let any logged-in user of any firm perform it — privilege escalation by omission. The
  // legitimate authenticated-null case is a NON-mutating read (e.g. GET /v1/me), so only mutating
  // methods trip this guard.
  const MUTATING_METHODS = new Set(["post", "put", "patch", "delete"]);
  if (
    MUTATING_METHODS.has(routeConfig.method.toLowerCase()) &&
    meta.authenticated === true &&
    meta.permission === null
  ) {
    throw new TypeError(
      `Route ${JSON.stringify(meta.operationId)} is an authenticated ${routeConfig.method.toUpperCase()} ` +
        `(mutating) route but names permission: null — the chokepoint would read that as ` +
        `"any authenticated user," letting any logged-in user perform it (privilege escalation by ` +
        `omission); name the capability this mutation requires from the access-control registry.`,
    );
  }

  const namespace = meta.operationId.slice(0, meta.operationId.indexOf("."));
  const resolvedMeta: ResolvedRouteMeta = {
    ...meta,
    tags: meta.tags?.length ? meta.tags : [namespace],
    deprecated: meta.deprecated ?? false,
  };
  const documentedConfig =
    meta.idempotency === "required"
      ? withRequiredIdempotencyKeyHeaderDocumentation(routeConfig, meta.operationId)
      : routeConfig;
  const route = createRoute({
    ...documentedConfig,
    operationId: resolvedMeta.operationId,
    tags: resolvedMeta.tags,
    ...(resolvedMeta.deprecated ? { deprecated: true } : {}),
    "x-mc-operationId": resolvedMeta.operationId,
    "x-mc-surface": resolvedMeta.surface,
    "x-mc-authenticated": resolvedMeta.authenticated,
    "x-mc-permission": resolvedMeta.permission,
    "x-mc-resource": resolvedMeta.resource,
    "x-mc-audited": resolvedMeta.audited,
    "x-mc-idempotency": resolvedMeta.idempotency,
    "x-mc-rateLimit": resolvedMeta.rateLimit,
    "x-mc-tags": resolvedMeta.tags,
    "x-mc-deprecated": resolvedMeta.deprecated,
  });
  routeMetaByRoute.set(route, resolvedMeta);
  return route;
}
