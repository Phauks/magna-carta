// The chokepoint middleware (design spec, ADR-0067): the single ordered enforcement point every
// /api/v1 route traverses. Cross-cutting concerns are properties of the route's metadata
// (contracts/route-meta.ts), not per-handler discipline — the chokepoint reads that metadata and
// enforces, in ONE fixed order, what the route declared. The order IS the security contract:
//
//   1. resolve session → firm        (cookie → Better Auth → { userId, firmId }; firm from the
//                                      session, never the URL — ADR-0052)
//   2. authn                          (meta.authenticated && no session → 401)
//   3. RBAC, two failure modes (ADR-0052 / ADR-0068):
//        a. structural absence → 404  (firm row missing / firm DB unbound / member deactivated —
//                                      no existence oracle, indistinguishable from "no such firm")
//        b. within-firm denial → 403  (visible-but-denied trusted insider; carries
//                                      requestAccess: true — the request→grant seam)
//   4. idempotency                    (meta.idempotency === "required" → apply the idempotency
//                                      middleware; Task 8 wires the real one — see the seam below)
//   5. rate-limit                     (over the bucket → 429 + Retry-After), keyed TENANT-SCOPED
//   6. handler
//
// A request failing an earlier gate NEVER touches a later port (fail-closed, short-circuit at the
// first failure). The chokepoint is a factory over injected ports so it is testable with fakes
// (chokepoint.test.ts records port invocation order and asserts it); Task 8 wires the ports to the
// 0·4 implementations (session-context.ts, firm-binding-resolver.ts, the idempotency middleware).
import type { Context, MiddlewareHandler } from "hono";
import { assertPermission, isPermission } from "@magna-carta/access-control/registry";
import type { Permission } from "@magna-carta/access-control/registry";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { problemJson } from "../contracts/problem.ts";
import { routeMetaOf, type ResolvedRouteMeta, type RouteMeta } from "../contracts/route-meta.ts";
import type { RateLimiter } from "./rate-limiter.ts";

// What resolveSession yields: the authenticated principal and the firm it is scoped to (from the
// session cookie — never the URL). Mirrors session-context.ts's SessionContext; redeclared here so
// the chokepoint depends on the port shape, not the 0·4 module (Task 8 supplies the real resolver).
export interface ResolvedSession {
  readonly userId: UserId;
  readonly firmId: FirmId;
}

// The ports the chokepoint is built over. FirmContext is generic and opaque to the chokepoint: the
// resolveFirmContext port returns whatever the handler needs (the per-firm D1 handle, in Task 8's
// real wiring), and the chokepoint only threads it to loadPermissions — it never inspects it.
export interface ChokepointPorts<FirmContext> {
  // Step 1: cookie → { userId, firmId } or null (no valid session). The chokepoint maps null to the
  // 401 only when the route declares authenticated: true.
  resolveSession: (c: Context) => Promise<ResolvedSession | null>;
  // Step 3a: session.firmId → the firm's context, or null for STRUCTURAL ABSENCE (firm row
  // missing, firm DB unbound, member deactivated — ADR-0052). null → 404, no existence oracle.
  // Encapsulates the control-plane lookup + resolveFirmDatabase + member-active check (Task 8).
  resolveFirmContext: (c: Context, firmId: FirmId) => Promise<FirmContext | null>;
  // Step 3b: the principal's effective permissions in THEIR firm. A missing required permission is
  // a within-firm denial → 403 + requestAccess (the trusted insider may request a grant).
  loadPermissions: (firmContext: FirmContext, userId: UserId) => Promise<ReadonlySet<Permission>>;
  // Step 5: the rate-limit verdict (the chokepoint owns the 429 reply and the tenant-scoped key).
  rateLimiter: RateLimiter;
}

// The chokepoint, after construction: a per-route middleware factory plus the registration-time
// meta assertion. forRoute closes over the route's resolved meta; the app wires it in front of the
// handler at registration (Task 8) — meta is resolved at REGISTRATION time, never from the matched
// route at request time (routeMetaOf's keying constraint).
export interface Chokepoint {
  // The per-route middleware. Pass the route's RouteMeta (the chokepoint resolves its defaults to
  // the same shape ResolvedRouteMeta carries — only the gate-relevant fields are read).
  forRoute(meta: RouteMeta): MiddlewareHandler;
  // Startup assertion (step 5 of the task): a registered /api/v1 route whose routeMetaOf returns
  // undefined throws HERE, at registration, not per-request. Returns the resolved meta so the
  // caller can hand it straight to forRoute.
  assertRouteHasMeta(route: object, path: string): ResolvedRouteMeta;
}

// The client IP for the unauthenticated/auth-bucket key: Cloudflare's cf-connecting-ip is the
// trusted edge-set client address (a client cannot spoof it past the edge). Falls back to a fixed
// sentinel so a missing header degrades to ONE shared bucket (fail-closed: stricter, never an
// open per-request bucket a client could rotate). Never a caller-pickable header.
function clientRateLimitKey(c: Context): string {
  const ip = c.req.header("cf-connecting-ip");
  // The `unknown` sentinel is only ever hit off-edge (tests, local dev): in production Cloudflare's
  // edge ALWAYS sets cf-connecting-ip, so collapsing every caller into one shared `ip:unknown`
  // bucket on absence is the safe fail-closed degradation, never a path real traffic takes.
  return `ip:${ip !== undefined && ip !== "" ? ip : "unknown"}`;
}

export function createChokepoint<FirmContext>(ports: ChokepointPorts<FirmContext>): Chokepoint {
  function assertRouteHasMeta(route: object, path: string): ResolvedRouteMeta {
    const meta = routeMetaOf(route);
    if (meta === undefined) {
      throw new Error(
        `Route ${JSON.stringify(path)} is registered without route metadata — every /api/v1 ` +
          `route must be defined via defineOpenAPIRoute so the chokepoint can enforce its ` +
          `tenancy/authn/RBAC/idempotency/rate-limit contract. (routeMetaOf returned undefined; ` +
          `meta must be resolved at registration time, never from the matched route.)`,
      );
    }
    // Validate the named capability against the access-control registry HERE, at registration
    // (startup) time — matching the fail-at-startup philosophy of defineOpenAPIRoute's other
    // route-meta guards. A non-null permission that is not a registered key is a misconfigured
    // route; catching it now turns what would otherwise be a per-request 500 (the per-request
    // assertPermission below) into a loud startup failure. permission: null is legal ("any
    // authenticated user" — a non-mutating read), so only a non-null unregistered value throws. A
    // branded Permission already passed isPermission at its creation, so this is a no-op for it.
    if (meta.permission !== null && !isPermission(meta.permission)) {
      throw new Error(
        `Route ${JSON.stringify(path)} names permission ${JSON.stringify(meta.permission)}, which ` +
          `is not in the access-control registry (PERMISSIONS). A route may only require a ` +
          `registered capability; register it in @magna-carta/access-control or correct the ` +
          `route's meta.permission. (Validated at registration time, never per request.)`,
      );
    }
    return meta;
  }

  function forRoute(meta: RouteMeta): MiddlewareHandler {
    if (meta === undefined || meta === null) {
      throw new Error(
        "chokepoint.forRoute received no route metadata — a registered /api/v1 route must carry " +
          "its RouteMeta (defineOpenAPIRoute attaches it; resolve at registration time).",
      );
    }

    return async (c, next) => {
      const isPublicSurface = meta.surface === "public";

      // Steps 1–3 — session, authn, RBAC — apply ONLY to non-public surfaces. A public route
      // (e.g. POST /v1/firms, platform-admin-secret-guarded) carries no cookie/CSRF assumption;
      // its OWN guard middleware does the auth, and the chokepoint must not run the session/firm/
      // RBAC gates that don't apply (and must not break that guard). The chokepoint still enforces
      // the rate-limit gate for every surface. (Task 8 seam: a public route's idempotency is
      // applied by the route's own middleware chain today — see the idempotency note below.)
      if (!isPublicSurface) {
        // Step 1: resolve the session → firm.
        const session = await ports.resolveSession(c);

        // Step 2: authn. authenticated meta + no session → 401. (An unauthenticated non-public
        // route is unusual but valid — a read that needs no principal — and falls through.)
        if (meta.authenticated && session === null) {
          return problemJson(c, {
            type: "unauthenticated",
            status: 401,
            title: "Authentication required",
            detail: "This request requires a valid session.",
          });
        }

        if (session !== null) {
          // Step 3a: resolve the firm context. null = structural absence (cross-firm / firm row
          // missing / DB unbound / member deactivated) → 404, no existence oracle (ADR-0052).
          const firmContext = await ports.resolveFirmContext(c, session.firmId);
          if (firmContext === null) {
            return problemJson(c, {
              type: "not-found",
              status: 404,
              title: "Not found",
              detail: "No such resource in this firm.",
            });
          }

          // Step 3b: RBAC within the firm. A route naming a permission requires it; a missing
          // permission is a within-firm denial (trusted insider, visible-but-denied) → 403 with
          // requestAccess: true (ADR-0068 — the request→grant seam). permission: null means "any
          // authenticated user" (a non-mutating read; the definition-time guard in route-meta.ts
          // forbids null on authenticated mutations), so it skips the capability check.
          if (meta.permission !== null) {
            const permissions = await ports.loadPermissions(firmContext, session.userId);
            const required = assertPermission(meta.permission);
            if (!permissions.has(required)) {
              return problemJson(c, {
                type: "permission-denied",
                status: 403,
                title: "Permission denied",
                detail: "Your role does not grant this action in this firm.",
                requestAccess: true,
              });
            }
          }

          // Stash the resolved tenancy for the handler and the rate-limit key (Task 8 formalizes
          // the context variables the handler reads; here it scopes the limiter key).
          c.set("chokepointFirmId", session.firmId);
          c.set("chokepointUserId", session.userId);
          c.set("chokepointFirmContext", firmContext);
        }
      }

      // Step 4: idempotency. SEAM (Task 8): meta.idempotency === "required" must apply the
      // @magna-carta/data-access idempotency middleware. It is NOT wired here because that
      // middleware needs the firm/control-plane database handle and the tenant-scoped stored-key
      // derivation, which are Task 8's real-port concerns — and today the only required-idempotency
      // route (firms.provision) mounts its own idempotency middleware in its route chain, so
      // double-applying here would conflict. Task 8 moves that into the chokepoint behind an
      // injected idempotency port. The gate's POSITION (after RBAC, before rate-limit) is fixed
      // here; the wiring is the deferred part.

      // Step 5: rate-limit. The key is TENANT-SCOPED and server-derived — never caller-supplied
      // (forward obligation from the 0·5a limiter pass): a firm-scoped key for authenticated
      // traffic so one firm cannot consume or evade another's bucket, and an IP-scoped key for the
      // public/unauthenticated surface (no firm context exists). A client cannot pick or rotate
      // its bucket.
      const firmId = c.get("chokepointFirmId") as FirmId | undefined;
      const rateLimitKey = firmId !== undefined ? `firm:${firmId}` : clientRateLimitKey(c);
      const verdict = await ports.rateLimiter.check(meta.rateLimit, rateLimitKey);
      if (!verdict.allowed) {
        const response = problemJson(c, {
          type: "rate-limited",
          status: 429,
          title: "Too many requests",
          detail: "Rate limit exceeded; retry after the interval in the Retry-After header.",
        });
        if (verdict.retryAfterSeconds !== undefined) {
          response.headers.set("retry-after", String(verdict.retryAfterSeconds));
        }
        return response;
      }

      // Step 6: the handler.
      //
      // FAIL-CLOSED CONTRACT (do not break): a port above (resolveSession/resolveFirmContext/
      // loadPermissions/rateLimiter) throwing rejects this middleware. With NO app.onError, Hono's
      // default converts that rejection into a 500 — the handler is never reached, which is the
      // fail-closed behavior the chokepoint depends on. If you add an app.onError, it MUST re-raise
      // (or reply 5xx) for an enforcement-port throw; it must NEVER convert the throw into a 2xx or
      // call next(), which would make the chokepoint fail-OPEN. The regression guard is
      // chokepoint.test.ts "fail-closed on a throwing port".
      await next();
    };
  }

  return { forRoute, assertRouteHasMeta };
}
