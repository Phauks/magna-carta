// Slice 0·5b Task 7: the chokepoint middleware (ADR-0067) — the single ordered enforcement point
// for tenancy/authn/RBAC/idempotency/rate-limit. These tests prove each gate's reply AND the
// fixed order: a request failing an earlier gate must never touch a later port. The ports are
// injected fakes that RECORD their invocation order, so "order is the contract" is asserted, not
// assumed. Real wiring of these ports to the 0·4 implementations is Task 8.
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "@hono/zod-openapi";
import { assertPermission } from "@magna-carta/access-control/registry";
import type { Permission } from "@magna-carta/access-control/registry";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { createChokepoint, type ChokepointPorts } from "../../src/chokepoint/chokepoint";
import { defineOpenAPIRoute, type RouteMeta } from "../../src/contracts/route-meta";
import { createInMemoryRateLimiter } from "../../src/chokepoint/rate-limiter";

// Branded-identifier fixtures: the chokepoint never validates these (the session resolver did), it
// only scopes keys with them, so opaque branded values are enough.
const FIRM_ALPHA = "firm_alpha0000000000000" as FirmId;
const FIRM_BRAVO = "firm_bravo0000000000000" as FirmId;
const USER_ONE = "user_one00000000000000" as UserId;

const MANAGE_MEMBERS = assertPermission("firm:manageMembers");

// A trace of which gates ran, in order — the order-is-the-contract assertion reads this.
interface Trace {
  readonly steps: string[];
}

// The injected firm context the resolveFirmContext port returns — opaque to the chokepoint, it
// only threads it to loadPermissions and (Task 8) the handler. A marker object suffices here.
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
    rateLimiter: {
      check: (bucket, key) => {
        trace.steps.push("rateLimiter");
        rateLimitKeys.push(key);
        return rateLimitAllowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 42 };
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
  const middleware = chokepoint.forRoute(meta) as MiddlewareHandler;
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

describe("createChokepoint — fixed gate order (ADR-0067)", () => {
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

describe("createChokepoint — RBAC structural absence (404, ADR-0052)", () => {
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

describe("createChokepoint — RBAC within-firm denial (403 + requestAccess, ADR-0068)", () => {
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

describe("createChokepoint — real in-memory limiter integration", () => {
  it("denies after the bucket limit is exhausted by the same firm key", async () => {
    const trace: Trace = { steps: [] };
    const rateLimiter = createInMemoryRateLimiter({ now: () => 0 });
    const ports: ChokepointPorts<FakeFirmContext> = {
      resolveSession: async () => ({ userId: USER_ONE, firmId: FIRM_ALPHA }),
      resolveFirmContext: async () => ({ firmId: FIRM_ALPHA }),
      loadPermissions: async () => new Set<Permission>([MANAGE_MEMBERS]),
      rateLimiter,
    };
    const chokepoint = createChokepoint(ports);
    // meta.rateLimit "auth" → limit 10. The eleventh request from the same firm is denied.
    const meta: RouteMeta = { ...authedMeta, rateLimit: "auth" };
    const app = mountedApp(chokepoint, meta, trace);
    let lastStatus = 0;
    for (let request = 0; request < 11; request++) {
      lastStatus = (await app.request("/api/v1/members", { method: "POST" })).status;
    }
    expect(lastStatus).toBe(429);
  });
});
