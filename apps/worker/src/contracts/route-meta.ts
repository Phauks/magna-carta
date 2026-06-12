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
  tags?: string[]; // default: [operationId namespace]
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
// is never mutated and runtime validation is unchanged.
function withRequiredIdempotencyKeyHeaderDocumentation<
  P extends string,
  R extends DescribedRouteConfig<P>,
>(routeConfig: R, operationId: string): R {
  const headersSchema = routeConfig.request?.headers;
  const headerShape = headersSchema instanceof z.ZodObject ? headersSchema.shape : undefined;
  const idempotencyKeyField = headerShape?.["idempotency-key"];
  if (idempotencyKeyField === undefined) {
    throw new TypeError(
      `Route ${JSON.stringify(operationId)} declares idempotency: "required" but its ` +
        `request.headers does not declare the "idempotency-key" header — include the shared ` +
        `idempotencyKeyHeader fragment from contracts/common.`,
    );
  }
  const documentedHeaders = z.object({
    ...headerShape,
    "idempotency-key": idempotencyKeyField.openapi({ param: { required: true } }),
  });
  return {
    ...routeConfig,
    request: { ...routeConfig.request, headers: documentedHeaders },
  };
}

// The platform route definer: validates the operationId shape at definition time (fails at
// startup, like the chokepoint's registration-time assertions), defaults tags from the
// operationId namespace, sets the OpenAPI-native operationId/tags/deprecated (generators key SDK
// method names off the native operationId — spike finding, docs/conventions/api.md), emits every
// meta field as an x-mc-* extension for the conformance fitness functions, and attaches the
// resolved meta for the chokepoint via routeMetaOf.
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
  const namespace = meta.operationId.slice(0, meta.operationId.indexOf("."));
  const resolvedMeta: ResolvedRouteMeta = {
    ...meta,
    tags: meta.tags ?? [namespace],
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
