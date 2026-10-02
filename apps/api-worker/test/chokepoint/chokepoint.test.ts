// The chokepoint middleware — the single ordered enforcement point for
// tenancy/authn/RBAC/idempotency/rate-limit. These tests prove each gate's reply AND the fixed
// order: a request failing an earlier gate must never touch a later port. The ports are injected
// fakes that RECORD their invocation order, so "order is the contract" is asserted, not assumed.
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "@hono/zod-openapi";
import { assertPermission } from "@magna-carta/access-control/registry";
import type { Permission } from "@magna-carta/access-control/registry";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import {
  createChokepoint,
  type ChokepointPorts,
  type ResolvedSession,
} from "../../src/chokepoint/chokepoint";
import { defineOpenAPIRoute, type RouteMeta } from "../../src/contracts/route-meta";
import { BUCKETS, createInMemoryRateLimiter } from "../../src/chokepoint/rate-limiter";

// Branded-identifier fixtures: the chokepoint never validates these (the session resolver did), it
// only scopes keys with them, so opaque branded values are enough.
const FIRM_ALPHA = "firm_alpha0000000000000" as FirmId;
const FIRM_BRAVO = "firm_bravo0000000000000" as FirmId;
const USER_ONE = "user_one00000000000000" as UserId;
const USER_TWO = "user_two00000000000000" as UserId;

const MANAGE_MEMBERS = assertPermission("firm:manageMembers");

// A trace of which gates ran, in order — the order-is-the-contract assertion reads this.
interface Trace {
  readonly steps: string[];
}

// The injected firm context the resolveFirmContext port returns — opaque to the chokepoint, it
// only threads it to loadPermissions and the handler. A marker object suffices here.
interface FakeFirmContext {
  readonly firmId: FirmId;
}

// Builds a chokepoint over fully-controllable fakes. Each port records into `trace` before
// returning its scripted verdict, so a test can both force a gate's outcome and prove the order.
function buildChokepoint(
  script: {
    session?: { userId: UserId; firmId: FirmId } | null;
    firmContext?: FakeFirmContext | null;
    permissions?: ReadonlySet<Permission>;
    rateLimitAllowed?: boolean;
  } = {},
): {
  chokepoint: ReturnType<typeof createChokepoint>;
  trace: Trace;
  rateLimitKeys: string[];
} {
  const trace: Trace = { steps: [] };
  const rateLimitKeys: string[] = [];
  const session =
    script.session === undefined ? { userId: USER_ONE, firmId: FIRM_ALPHA } : script.session;
  const firmContext =
    script.firmContext === undefined ? { firmId: FIRM_ALPHA } : script.firmContext;
  const permissions = script.permissions ?? new Set<Permission>([MANAGE_MEMBERS]);
  const rateLimitAllowed = script.rateLimitAllowed ?? true;

  const ports: ChokepointPorts<FakeFirmContext> = {
    resolveSession: async () => {
      trace.steps.push("resolveSession");
      return session;
    },
    resolveFirmContext: async () => {
      trace.steps.push("resolveFirmContext");
      return firmContext;
    },
    loadPermissions: async () => {
      trace.steps.push("loadPermissions");
      return permissions;
    },
    // No idempotency gate in these order/gate fakes — the real idempotency wiring is exercised
    // through the Miniflare integration suites (members/firms), not these unit fakes.
    idempotency: { middlewareFor: () => null },
    rateLimiter: {
      check: (bucket, key) => {
        trace.steps.push("rateLimiter");
        rateLimitKeys.push(key);
        return rateLimitAllowed
          ? { allowed: true, limit: 100, remaining: 99 }
          : { allowed: false, retryAfterSeconds: 42, limit: 100, remaining: 0 };
      },
    },
  };
  return { chokepoint: createChokepoint(ports), trace, rateLimitKeys };
}

// A mounted app: the chokepoint's per-route middleware in front of a handler that records it ran.
function mountedApp(
  chokepoint: ReturnType<typeof createChokepoint>,
  meta: RouteMeta,
  trace: Trace,
  options: { method?: "get" | "post"; path?: string } = {},
): Hono {
  const app = new Hono();
  const path = options.path ?? "/api/v1/members";
  const handler = (c: Context) => {
    trace.steps.push("handler");
    return c.json({ ok: true }, 200);
  };
  const middleware = chokepoint.forRoute(meta);
  if ((options.method ?? "post") === "get") {
    app.get(path, middleware, handler);
  } else {
    app.post(path, middleware, handler);
  }
  return app;
}

// Canonical authenticated mutating route meta (members.invite shape).
const authedMeta: RouteMeta = {
  operationId: "members.invite",
  surface: "app",
  authenticated: true,
  permission: "firm:manageMembers",
  resource: "firm",
  audited: true,
  idempotency: "optional",
  rateLimit: "default",
};

describe("createChokepoint — fixed gate order", () => {
  it("runs every gate in order for an allowed authenticated request, then the handler", async () => {
    const { chokepoint, trace } = buildChokepoint();
    const app = mountedApp(chokepoint, authedMeta, trace);
    const response = await app.request("/api/v1/members", { method: "POST" });
    expect(response.status).toBe(200);
    expect(trace.steps).toEqual([
      "resolveSession",
      "resolveFirmContext",
      "loadPermissions",
      "rateLimiter",
      "handler",
    ]);
  });
});

describe("createChokepoint — authn gate (401)", () => {
  it("replies 401 unauthenticated problem when authenticated meta but no session", async () => {
    const { chokepoint, trace } = buildChokepoint({ session: null });
    const app = mountedApp(chokepoint, authedMeta, trace);
    const response = await app.request("/api/v1/members", { method: "POST" });
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.type).toBe("https://api.magnacarta.esq/problems/unauthenticated");
  });

  it("short-circuits at authn — never touches firm/permissions/limiter/handler (fail-closed order)", async () => {
    const { chokepoint, trace } = buildChokepoint({ session: null });
    const app = mountedApp(chokepoint, authedMeta, trace);
    await app.request("/api/v1/members", { method: "POST" });
    expect(trace.steps).toEqual(["resolveSession"]);
  });
});

describe("createChokepoint — RBAC structural absence (404)", () => {
  it("replies 404 not-found when the firm context is absent (cross-firm / structural)", async () => {
    const { chokepoint, trace } = buildChokepoint({ firmContext: null });
    const app = mountedApp(chokepoint, authedMeta, trace);
    const response = await app.request("/api/v1/members", { method: "POST" });
    expect(response.status).toBe(404);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.type).toBe("https://api.magnacarta.esq/problems/not-found");
    // No existence oracle and no requestAccess on a 404 — structural absence is silent.
    expect("requestAccess" in body).toBe(false);
  });

  it("short-circuits at the firm gate — never loads permissions, never limits, never handles", async () => {
    const { chokepoint, trace } = buildChokepoint({ firmContext: null });
    const app = mountedApp(chokepoint, authedMeta, trace);
    await app.request("/api/v1/members", { method: "POST" });
    expect(trace.steps).toEqual(["resolveSession", "resolveFirmContext"]);
  });
});

describe("createChokepoint — RBAC within-firm denial (403 + requestAccess)", () => {
  it("replies 403 permission-denied with requestAccess:true when visible-but-denied", async () => {
    const { chokepoint, trace } = buildChokepoint({ permissions: new Set<Permission>() });
    const app = mountedApp(chokepoint, authedMeta, trace);
    const response = await app.request("/api/v1/members", { method: "POST" });
    expect(response.status).toBe(403);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.type).toBe("https://api.magnacarta.esq/problems/permission-denied");
    expect(body.requestAccess).toBe(true);
  });

  it("short-circuits at RBAC — never limits, never handles", async () => {
    const { chokepoint, trace } = buildChokepoint({ permissions: new Set<Permission>() });
    const app = mountedApp(chokepoint, authedMeta, trace);
    await app.request("/api/v1/members", { method: "POST" });
    expect(trace.steps).toEqual(["resolveSession", "resolveFirmContext", "loadPermissions"]);
  });
});

describe("createChokepoint — rate-limit gate (429 + Retry-After)", () => {
  it("replies 429 rate-limited problem with a Retry-After header", async () => {
    const { chokepoint, trace } = buildChokepoint({ rateLimitAllowed: false });
    const app = mountedApp(chokepoint, authedMeta, trace);
    const response = await app.request("/api/v1/members", { method: "POST" });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.type).toBe("https://api.magnacarta.esq/problems/rate-limited");
  });

  it("short-circuits at the limiter — the handler never runs", async () => {
    const { chokepoint, trace } = buildChokepoint({ rateLimitAllowed: false });
    const app = mountedApp(chokepoint, authedMeta, trace);
    await app.request("/api/v1/members", { method: "POST" });
    expect(trace.steps).toEqual([
      "resolveSession",
      "resolveFirmContext",
      "loadPermissions",
      "rateLimiter",
    ]);
  });
});

describe("createChokepoint — tenant-scoped rate-limit key (forward obligation)", () => {
  it("scopes the authenticated rate-limit key by firmId, so one firm cannot consume another's bucket", async () => {
    const alpha = buildChokepoint({ session: { userId: USER_ONE, firmId: FIRM_ALPHA } });
    const bravo = buildChokepoint({ session: { userId: USER_ONE, firmId: FIRM_BRAVO } });
    await mountedApp(alpha.chokepoint, authedMeta, alpha.trace).request("/api/v1/members", {
      method: "POST",
    });
    await mountedApp(bravo.chokepoint, authedMeta, bravo.trace).request("/api/v1/members", {
      method: "POST",
    });
    expect(alpha.rateLimitKeys[0]).toContain(FIRM_ALPHA);
    expect(bravo.rateLimitKeys[0]).toContain(FIRM_BRAVO);
    expect(alpha.rateLimitKeys[0]).not.toBe(bravo.rateLimitKeys[0]);
  });

  it("does NOT key on a caller-supplied header (a client cannot evade or pick a bucket)", async () => {
    const { chokepoint, rateLimitKeys, trace } = buildChokepoint();
    const app = mountedApp(chokepoint, authedMeta, trace);
    await app.request("/api/v1/members", {
      method: "POST",
      headers: { "x-firm-id": "firm_attacker0000000000", "x-rate-key": "evil" },
    });
    expect(rateLimitKeys[0]).not.toContain("attacker");
    expect(rateLimitKeys[0]).not.toContain("evil");
    expect(rateLimitKeys[0]).toContain(FIRM_ALPHA);
  });
});

describe("createChokepoint — public surface", () => {
  // A public route (firms.provision shape): authenticated:true + permission named, but surface
  // "public" — its own guard middleware (platform-admin secret) does the auth, NOT the chokepoint's
  // session/firm/RBAC gates.
  const publicMeta: RouteMeta = {
    operationId: "firms.provision",
    surface: "public",
    authenticated: true,
    permission: "firm:provision",
    resource: "firm",
    audited: true,
    idempotency: "required",
    rateLimit: "auth",
  };

  it("skips session/firm/RBAC on a public route — the route's own guard runs instead", async () => {
    const { chokepoint, trace } = buildChokepoint();
    const app = mountedApp(chokepoint, publicMeta, trace, { path: "/api/v1/firms" });
    const response = await app.request("/api/v1/firms", { method: "POST" });
    expect(response.status).toBe(200); // reached the handler
    // No session/firm/RBAC gate ran for a public surface; only the rate-limit gate and the handler.
    expect(trace.steps).toEqual(["rateLimiter", "handler"]);
  });

  it("rate-limits a public route on an IP/session-derived key, never firmId (no firm context exists)", async () => {
    const { chokepoint, rateLimitKeys, trace } = buildChokepoint();
    const app = mountedApp(chokepoint, publicMeta, trace, { path: "/api/v1/firms" });
    await app.request("/api/v1/firms", {
      method: "POST",
      headers: { "cf-connecting-ip": "203.0.113.7" },
    });
    expect(rateLimitKeys[0]).toContain("203.0.113.7");
    expect(rateLimitKeys[0]).not.toContain(FIRM_ALPHA);
  });
});

describe("createChokepoint — non-authenticated read route", () => {
  const publicReadMeta: RouteMeta = {
    operationId: "health.read",
    surface: "public",
    authenticated: false,
    permission: null,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };

  it("skips authn/RBAC for an unauthenticated public route but still rate-limits", async () => {
    const { chokepoint, trace } = buildChokepoint();
    const app = mountedApp(chokepoint, publicReadMeta, trace, {
      method: "get",
      path: "/api/v1/status",
    });
    const response = await app.request("/api/v1/status");
    expect(response.status).toBe(200);
    expect(trace.steps).toEqual(["rateLimiter", "handler"]);
  });
});

describe("createChokepoint — registration-time meta assertion", () => {
  it("forRoute throws when handed undefined meta (a registered /api/v1 route must carry meta)", () => {
    const { chokepoint } = buildChokepoint();
    expect(() => chokepoint.forRoute(undefined as unknown as RouteMeta)).toThrow(/meta/i);
  });

  it("assertRouteHasMeta throws at startup for a defined route whose meta is missing", () => {
    const { chokepoint } = buildChokepoint();
    // A raw createRoute-less object stands in for a route with no routeMetaOf association.
    expect(() => chokepoint.assertRouteHasMeta({}, "/api/v1/orphan")).toThrow(/meta/i);
  });

  it("assertRouteHasMeta returns the resolved meta for a defineOpenAPIRoute-built route", () => {
    const { chokepoint } = buildChokepoint();
    const route = defineOpenAPIRoute(authedMeta, {
      method: "post",
      path: "/api/v1/members",
      description: "Invite a member.",
      responses: {
        200: { description: "ok", content: { "application/json": { schema: z.object({}) } } },
      },
    });
    const meta = chokepoint.assertRouteHasMeta(route, "/api/v1/members");
    expect(meta.operationId).toBe("members.invite");
  });
});

describe("createChokepoint — fail-closed on a throwing port (no onError → default 500)", () => {
  // The single most valuable security regression guard: a throwing port (resolveSession,
  // resolveFirmContext, loadPermissions, rateLimiter) must propagate as a rejected middleware so
  // Hono's no-onError default yields a 5xx — fail-closed. The contract under test is: the handler
  // NEVER runs and the error propagates (a 5xx). If a future app.onError converted the throw into a
  // 2xx/next(), this test fails — warning the author they have made the chokepoint fail-OPEN.
  const throwingMeta = authedMeta;

  // Build ports where exactly one port throws; the others record into trace and return benign
  // verdicts so the throwing port is the only thing that can stop the chain reaching the handler.
  function buildThrowingChokepoint(throwAt: "resolveSession" | "loadPermissions"): {
    chokepoint: ReturnType<typeof createChokepoint>;
    trace: Trace;
  } {
    const trace: Trace = { steps: [] };
    const session: ResolvedSession = { userId: USER_ONE, firmId: FIRM_ALPHA };
    const ports: ChokepointPorts<FakeFirmContext> = {
      resolveSession: async () => {
        trace.steps.push("resolveSession");
        if (throwAt === "resolveSession") throw new Error("resolveSession port exploded");
        return session;
      },
      resolveFirmContext: async () => {
        trace.steps.push("resolveFirmContext");
        return { firmId: FIRM_ALPHA };
      },
      loadPermissions: async () => {
        trace.steps.push("loadPermissions");
        if (throwAt === "loadPermissions") throw new Error("loadPermissions port exploded");
        return new Set<Permission>([MANAGE_MEMBERS]);
      },
      idempotency: { middlewareFor: () => null },
      rateLimiter: {
        check: (_bucket, key) => {
          trace.steps.push("rateLimiter");
          void key;
          return { allowed: true, limit: 100, remaining: 99 };
        },
      },
    };
    return { chokepoint: createChokepoint(ports), trace };
  }

  it("a throwing session port: the handler never runs and the request yields a 5xx", async () => {
    const { chokepoint, trace } = buildThrowingChokepoint("resolveSession");
    const app = mountedApp(chokepoint, throwingMeta, trace);
    const response = await app.request("/api/v1/members", { method: "POST" });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(trace.steps).not.toContain("handler");
    // The session port is the first gate; it threw, so nothing past it ran either.
    expect(trace.steps).toEqual(["resolveSession"]);
  });

  it("a throwing post-session port (loadPermissions): the handler never runs and yields a 5xx", async () => {
    const { chokepoint, trace } = buildThrowingChokepoint("loadPermissions");
    const app = mountedApp(chokepoint, throwingMeta, trace);
    const response = await app.request("/api/v1/members", { method: "POST" });
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(trace.steps).not.toContain("handler");
    // It threw at the permission load, so the limiter and handler are never reached.
    expect(trace.steps).toEqual(["resolveSession", "resolveFirmContext", "loadPermissions"]);
  });

  it("the throw propagates out of the middleware (not swallowed into a 2xx/next)", async () => {
    // Assert the propagation directly: invoking the middleware with a no-op next must REJECT, so a
    // future onError cannot silently convert the throw into a success without breaking this.
    const { chokepoint, trace } = buildThrowingChokepoint("resolveSession");
    const middleware = chokepoint.forRoute(throwingMeta);
    let handlerRan = false;
    const next = async () => {
      handlerRan = true;
    };
    const fakeContext = {
      req: { header: () => undefined, path: "/api/v1/members" },
      get: () => undefined,
      set: () => undefined,
    } as unknown as Context;
    await expect(middleware(fakeContext, next)).rejects.toThrow(/resolveSession port exploded/);
    expect(handlerRan).toBe(false);
    expect(trace.steps).not.toContain("handler");
  });
});

describe("createChokepoint — registration-time permission validation (unregistered → throws at registration)", () => {
  // A route meta carrying a non-null permission string that is NOT in the access-control registry
  // must be rejected at REGISTRATION time (assertRouteHasMeta), matching the fail-at-startup
  // philosophy of the other route-meta guards — never deferred to a per-request 500.
  it("assertRouteHasMeta throws when the route's meta names an unregistered permission", () => {
    const { chokepoint } = buildChokepoint();
    const badMeta: RouteMeta = {
      ...authedMeta,
      permission: "firm:notARealPermission" as Permission,
    };
    const route = defineOpenAPIRoute(badMeta, {
      method: "post",
      path: "/api/v1/members",
      description: "Invite a member.",
      responses: {
        200: { description: "ok", content: { "application/json": { schema: z.object({}) } } },
      },
    });
    expect(() => chokepoint.assertRouteHasMeta(route, "/api/v1/members")).toThrow(/permission/i);
  });

  it("assertRouteHasMeta accepts permission: null (any authenticated user — legal)", () => {
    const { chokepoint } = buildChokepoint();
    const nullPermMeta: RouteMeta = {
      ...authedMeta,
      operationId: "members.read",
      permission: null,
    };
    const route = defineOpenAPIRoute(nullPermMeta, {
      method: "get",
      path: "/api/v1/members",
      description: "List members.",
      responses: {
        200: { description: "ok", content: { "application/json": { schema: z.object({}) } } },
      },
    });
    expect(() => chokepoint.assertRouteHasMeta(route, "/api/v1/members")).not.toThrow();
  });

  // Tolerating an unreachable firm database means being admitted WITHOUT the member-active check,
  // because that check is the read that cannot run. A capability named alongside it could not be
  // honoured either — permissions are read from the same unreachable database — so the combination
  // is refused at startup rather than discovered during the outage it was written for.
  it("assertRouteHasMeta throws when a route both tolerates a firm-database outage and names a permission", () => {
    const { chokepoint } = buildChokepoint();
    const contradictoryMeta: RouteMeta = {
      ...authedMeta,
      operationId: "meta.versions",
      permission: "firm:manageMembers",
      firmDatabaseOutage: "tolerate",
    };
    const route = defineOpenAPIRoute(contradictoryMeta, {
      method: "get",
      path: "/api/v1/meta/versions",
      description: "What is running.",
      responses: {
        200: { description: "ok", content: { "application/json": { schema: z.object({}) } } },
      },
    });
    expect(() => chokepoint.assertRouteHasMeta(route, "/api/v1/meta/versions")).toThrow(
      /tolerate/i,
    );
  });

  it("assertRouteHasMeta accepts tolerating a firm-database outage with permission: null", () => {
    const { chokepoint } = buildChokepoint();
    const diagnosticMeta: RouteMeta = {
      ...authedMeta,
      operationId: "meta.versions",
      permission: null,
      firmDatabaseOutage: "tolerate",
    };
    const route = defineOpenAPIRoute(diagnosticMeta, {
      method: "get",
      path: "/api/v1/meta/versions",
      description: "What is running.",
      responses: {
        200: { description: "ok", content: { "application/json": { schema: z.object({}) } } },
      },
    });
    expect(() => chokepoint.assertRouteHasMeta(route, "/api/v1/meta/versions")).not.toThrow();
  });

  it("assertRouteHasMeta accepts a registered permission", () => {
    const { chokepoint } = buildChokepoint();
    const route = defineOpenAPIRoute(authedMeta, {
      method: "post",
      path: "/api/v1/members",
      description: "Invite a member.",
      responses: {
        200: { description: "ok", content: { "application/json": { schema: z.object({}) } } },
      },
    });
    expect(() => chokepoint.assertRouteHasMeta(route, "/api/v1/members")).not.toThrow();
  });
});

describe("createChokepoint — portal surface runs the full chain (not public)", () => {
  // isPublicSurface is `surface === "public"` exactly, so surface: "portal" is NOT public: it must
  // run the full session/firm/RBAC chain (fail-closed), then the rate-limit gate and the handler.
  const portalMeta: RouteMeta = {
    operationId: "portal.viewShare",
    surface: "portal",
    authenticated: true,
    permission: "firm:manageMembers",
    resource: "portalShare",
    audited: true,
    idempotency: "optional",
    rateLimit: "default",
  };

  it("a portal route runs all gates in order — it is not treated as a public surface", async () => {
    const { chokepoint, trace } = buildChokepoint();
    const app = mountedApp(chokepoint, portalMeta, trace, { path: "/api/v1/portal/share" });
    const response = await app.request("/api/v1/portal/share", { method: "POST" });
    expect(response.status).toBe(200);
    expect(trace.steps).toEqual([
      "resolveSession",
      "resolveFirmContext",
      "loadPermissions",
      "rateLimiter",
      "handler",
    ]);
  });
});

describe("createChokepoint — cf-connecting-ip absent → 'unknown' sentinel key", () => {
  // On a public/unauthenticated route with no firm context, the rate-limit key is IP-derived. When
  // cf-connecting-ip is absent the documented `unknown` sentinel is used (one shared fail-closed
  // bucket), never an open per-request bucket a client could rotate.
  const publicReadMeta: RouteMeta = {
    operationId: "health.read",
    surface: "public",
    authenticated: false,
    permission: null,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  };

  it("keys on ip:unknown when cf-connecting-ip is absent", async () => {
    const { chokepoint, rateLimitKeys, trace } = buildChokepoint();
    const app = mountedApp(chokepoint, publicReadMeta, trace, {
      method: "get",
      path: "/api/v1/status",
    });
    await app.request("/api/v1/status");
    expect(rateLimitKeys[0]).toBe("ip:unknown");
  });
});

describe("createChokepoint — real in-memory limiter integration", () => {
  it("denies after the bucket limit is exhausted by the same firm key", async () => {
    const trace: Trace = { steps: [] };
    const rateLimiter = createInMemoryRateLimiter({ now: () => 0 });
    const ports: ChokepointPorts<FakeFirmContext> = {
      resolveSession: async () => ({ userId: USER_ONE, firmId: FIRM_ALPHA }),
      resolveFirmContext: async () => ({ firmId: FIRM_ALPHA }),
      loadPermissions: async () => new Set<Permission>([MANAGE_MEMBERS]),
      idempotency: { middlewareFor: () => null },
      rateLimiter,
    };
    const chokepoint = createChokepoint(ports);
    // The request one past meta.rateLimit's bucket ceiling is denied. The count comes from the
    // bucket rather than a literal: the auth bucket is pinned above the credential ladder and moves
    // whenever that does, and a literal would quietly stop reaching the gate the day it moved.
    const meta: RouteMeta = { ...authedMeta, rateLimit: "auth" };
    const app = mountedApp(chokepoint, meta, trace);
    let lastStatus = 0;
    for (let request = 0; request < BUCKETS.auth.limit + 1; request++) {
      lastStatus = (await app.request("/api/v1/members", { method: "POST" })).status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("createChokepoint — a member-scoped bucket", () => {
  const upvoteMeta: RouteMeta = { ...authedMeta, rateLimit: "meeting-question-upvote" };

  it("keys the bucket by the session's own user within its firm", async () => {
    const one = buildChokepoint({ session: { userId: USER_ONE, firmId: FIRM_ALPHA } });
    const two = buildChokepoint({ session: { userId: USER_TWO, firmId: FIRM_ALPHA } });
    await mountedApp(one.chokepoint, upvoteMeta, one.trace).request("/api/v1/members", {
      method: "POST",
    });
    await mountedApp(two.chokepoint, upvoteMeta, two.trace).request("/api/v1/members", {
      method: "POST",
    });
    expect(one.rateLimitKeys[0]).toBe(`member:${FIRM_ALPHA}:${USER_ONE}`);
    expect(two.rateLimitKeys[0]).toBe(`member:${FIRM_ALPHA}:${USER_TWO}`);
  });

  it("refuses one member's loop at its own ceiling and leaves the firm's budget and a colleague's alone", async () => {
    const rateLimiter = createInMemoryRateLimiter({ now: () => 0 });
    let session: ResolvedSession = { userId: USER_ONE, firmId: FIRM_ALPHA };
    const ports: ChokepointPorts<FakeFirmContext> = {
      resolveSession: async () => session,
      resolveFirmContext: async () => ({ firmId: FIRM_ALPHA }),
      loadPermissions: async () => new Set<Permission>([MANAGE_MEMBERS]),
      idempotency: { middlewareFor: () => null },
      rateLimiter,
    };
    const chokepoint = createChokepoint(ports);
    const trace: Trace = { steps: [] };
    const upvote = mountedApp(chokepoint, upvoteMeta, trace);
    const ordinary = mountedApp(chokepoint, authedMeta, trace);

    let lastStatus = 0;
    for (let request = 0; request < BUCKETS["meeting-question-upvote"].limit + 1; request++) {
      lastStatus = (await upvote.request("/api/v1/members", { method: "POST" })).status;
    }
    expect(lastStatus).toBe(429);
    // The same member's ordinary request spends the firm's bucket, which the loop never touched.
    expect((await ordinary.request("/api/v1/members", { method: "POST" })).status).toBe(200);
    // And a colleague's upvote meets a bucket of their own.
    session = { userId: USER_TWO, firmId: FIRM_ALPHA };
    expect((await upvote.request("/api/v1/members", { method: "POST" })).status).toBe(200);
  });
});
