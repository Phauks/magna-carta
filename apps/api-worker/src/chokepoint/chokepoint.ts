// The chokepoint middleware: the single ordered enforcement point every
// /api/v1 route traverses. Cross-cutting concerns are properties of the route's metadata
// (contracts/route-meta.ts), not per-handler discipline — the chokepoint reads that metadata and
// enforces, in ONE fixed order, what the route declared. The order IS the security contract:
//
//   1. resolve session → firm        (cookie → Better Auth → { userId, firmId }; firm from the
//                                      session, never the URL)
//   2. authn                          (meta.authenticated && no session → 401)
//   3. RBAC, two failure modes:
//        a. structural absence → 404  (firm row missing / firm DB unbound / member deactivated —
//                                      no existence oracle, indistinguishable from "no such firm")
//        b. within-firm denial → 403  (visible-but-denied trusted insider; carries
//                                      requestAccess: true — the request→grant seam)
//   4. idempotency                    (meta.idempotency === "required" → apply the idempotency
//                                      middleware — see the seam below)
//   5. rate-limit                     (over the bucket → 429 + Retry-After), keyed TENANT-SCOPED
//   6. handler
//
// A request failing an earlier gate NEVER touches a later port (fail-closed, short-circuit at the
// first failure). The chokepoint is a factory over injected ports so it is testable with fakes
// (chokepoint.test.ts records port invocation order and asserts it); the ports are wired to the
// implementations (session-context.ts, the firmId-addressed FirmDatabase DO, the idempotency middleware).
import type { Context, MiddlewareHandler } from "hono";
import { assertPermission, isPermission } from "@magna-carta/access-control/registry";
import type { Permission } from "@magna-carta/access-control/registry";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { problemJson } from "../contracts/problem.ts";
import { routeMetaOf, type ResolvedRouteMeta, type RouteMeta } from "../contracts/route-meta.ts";
import type { RateLimiter } from "./rate-limiter.ts";

// What resolveSession yields: the authenticated principal and the firm it is scoped to (from the
// session cookie — never the URL). Mirrors session-context.ts's SessionContext; redeclared here so
// the chokepoint depends on the port shape, not the module that supplies the real resolver.
export interface ResolvedSession {
  readonly userId: UserId;
  // NULL for a person who belongs to no firm yet — the account-before-a-firm state the joining
  // surface creates. Step 3a below turns that into the reserved 404 unless the route declared
  // firmlessSession, so a firmless session is closed by default on every route that never
  // considered it.
  readonly firmId: FirmId | null;
  // Present when the principal is a support session (a staff identity under a firm grant). The
  // chokepoint threads it to loadPermissions to choose the tier-scoped permission set.
  readonly support?: {
    readonly grantId: import("@magna-carta/identifiers/types").SupportGrantId;
    readonly principalId: import("@magna-carta/identifiers/types").PlatformStaffId;
    readonly tier: import("@magna-carta/data-access/support-access-statements").SupportGrantTier;
  };
}

// The ports the chokepoint is built over. FirmContext is generic and opaque to the chokepoint: the
// resolveFirmContext port returns whatever the handler needs (the per-firm D1 handle, in the real
// wiring), and the chokepoint only threads it to loadPermissions — it never inspects it.
export interface ChokepointPorts<FirmContext> {
  // Step 1: cookie → { userId, firmId } or null (no valid session). The chokepoint maps null to the
  // 401 only when the route declares authenticated: true.
  resolveSession: (c: Context) => Promise<ResolvedSession | null>;
  // Step 3a: the session's firm → the firm's context, or null for STRUCTURAL ABSENCE (firm row
  // missing, firm DB unbound, member deactivated). null → 404, no existence oracle.
  // Encapsulates the control-plane lookup + the firmId-addressed FirmDatabase DO + member-active check. The
  // WHOLE session is passed (not just firmId) so the port can run the member-active check against
  // the session's userId — a deactivated member is absent, folded in HERE so the same
  // 404 covers a missing firm and a deactivated member with no per-handler discipline.
  // meta is passed so the port can tell a route that tolerates an unreachable firm database from
  // one that must fail closed on it; it never widens what the port may return.
  resolveFirmContext: (
    c: Context,
    session: ResolvedSession,
    meta: RouteMeta,
  ) => Promise<FirmContext | null>;
  // Step 3b: the principal's effective permissions in THEIR firm. A missing required permission is
  // a within-firm denial → 403 + requestAccess (the trusted insider may request a grant).
  loadPermissions: (
    firmContext: FirmContext,
    session: ResolvedSession,
  ) => Promise<ReadonlySet<Permission>>;
  // Step 4: idempotency. For a route whose meta.idempotency === "required" the
  // chokepoint owns the WHOLE idempotency gate — the Idempotency-Key requirement (missing → 400)
  // AND the pre-decision (replay / 409 in-progress / 422 fingerprint-mismatch) — at the ONE point,
  // never double-applied by a route's own middleware. The port returns the composed idempotency
  // middleware for THIS request (it reads the tenant-scoped stored key from the chokepoint-stashed
  // firm context, or the platform scope for the public surface), or null for an optional-idempotency
  // route (no gate). Position is fixed here: after RBAC, before rate-limit.
  idempotency: ChokepointIdempotency;
  // Step 5: the rate-limit verdict (the chokepoint owns the 429 reply and the tenant-scoped key).
  rateLimiter: RateLimiter;
}

// The idempotency port (step 4). Given the request context and the route's resolved meta, returns
// the composed Idempotency-Key-requirement + pre-decision middleware to wrap the handler with —
// or null when the route does not require idempotency (meta.idempotency !== "required"). The
// returned middleware is a standard Hono (c, next): it either short-circuits with a 400/409/422/
// replay reply, or calls next() after stashing the IdempotencyContext for the handler.
export interface ChokepointIdempotency {
  middlewareFor(c: Context, meta: RouteMeta): MiddlewareHandler | null;
}

// The chokepoint, after construction: a per-route middleware factory plus the registration-time
// meta assertion. forRoute closes over the route's resolved meta; the app wires it in front of the
// handler at registration — meta is resolved at REGISTRATION time, never from the matched
// route at request time (routeMetaOf's keying constraint).
export interface Chokepoint {
  // The per-route middleware. Pass the route's RouteMeta (the chokepoint resolves its defaults to
  // the same shape ResolvedRouteMeta carries — only the gate-relevant fields are read).
  forRoute(meta: RouteMeta): MiddlewareHandler;
  // Startup assertion: a registered /api/v1 route whose routeMetaOf returns
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
    // A route that tolerates an unreachable firm database is admitted WITHOUT the member-active
    // check, because that check is the read that cannot run. Naming a capability alongside it would
    // be a contradiction: capabilities are loaded from the very database that is unreachable, so the
    // route would either fail anyway or claim an authority nothing verified. Refused at startup for
    // the same reason an unregistered permission is — a misconfiguration should be loud here rather
    // than a surprise during the outage it was written for.
    if (meta.firmDatabaseOutage === "tolerate" && meta.permission !== null) {
      throw new Error(
        `Route ${JSON.stringify(path)} declares firmDatabaseOutage: "tolerate" and also names ` +
          `permission ${JSON.stringify(meta.permission)}. A route admitted without the ` +
          `member-active check may not require a capability, because permissions are read from the ` +
          `same firm database the declaration concedes is unreachable. Drop the permission, or ` +
          `drop the toleration.`,
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

      // Steps 4-6 — idempotency, rate-limit, handler — as one closure, because there are now TWO
      // ways to arrive at them: the ordinary path at the bottom of this middleware, and the
      // firmless-admission path in step 3a·0, which has no firm context to resolve and so skips
      // steps 3a and 3b entirely. Both go through here, so no route can reach a handler without
      // crossing the idempotency and rate-limit gates, in this order.
      const runIdempotencyAndHandler = async (): Promise<Response | void> => {
        // Step 4: idempotency. For a required-idempotency route the chokepoint owns the
        // whole gate — the key requirement and the pre-decision — at the ONE point. The port
        // returns the composed middleware (reading the tenant-scoped stored key from the firm
        // context stashed above, or the platform scope for the public surface); the gate runs
        // HERE, after RBAC and before rate-limit, wrapping the rate-limit + handler tail in
        // idempotencyTail. For an optional-idempotency route the port returns null and the tail
        // runs directly. There is no route-mounted idempotency middleware any more — exactly one
        // application, never two.
        const idempotencyMiddleware = ports.idempotency.middlewareFor(c, meta);

        // The tail after the idempotency gate: rate-limit, then the handler. Hoisted into a
        // closure so it can run either directly (optional idempotency) or as the idempotency
        // middleware's next() (required idempotency) — the rate-limit gate is enforced on the
        // EXECUTE path either way, and a replay/conflict short-circuit in the idempotency
        // middleware never reaches it (the stored response is already an accounted-for request;
        // re-charging the limiter on a replay would be a second debit for one logical request).
        const idempotencyTail = async (): Promise<void> => {
          // Step 5: rate-limit. The key is TENANT-SCOPED and server-derived — never
          // caller-supplied: a firm-scoped key for authenticated traffic so one firm cannot
          // consume or evade another's bucket, and an IP-scoped key where there is no firm — the
          // public surface, and a signed-in person who has no firm yet, whose requests cost the
          // platform what an anonymous one does. A client cannot pick or rotate its bucket.
          const firmId = c.get("chokepointFirmId") as FirmId | undefined;
          const rateLimitKey = firmId !== undefined ? `firm:${firmId}` : clientRateLimitKey(c);
          const verdict = await ports.rateLimiter.check(meta.rateLimit, rateLimitKey);
          if (!verdict.allowed) {
            // The budget rides the BODY as well as the header. Retry-After alone tells a caller
            // when to come back and nothing about how much room it had, so a surface that wants to
            // warn before the wall — the sign-in ladder is the one that made this necessary — had
            // to invent the number or say nothing. Both fields come off the verdict, never a
            // constant here, so the limiter stays the one authority on its own arithmetic.
            const response = problemJson(c, {
              type: "rate-limited",
              status: 429,
              title: "Too many requests",
              detail: "Rate limit exceeded; retry after the interval in the Retry-After header.",
              attemptsRemaining: verdict.remaining,
              ...(verdict.retryAfterSeconds !== undefined && {
                retryAfterSeconds: verdict.retryAfterSeconds,
              }),
            });
            if (verdict.retryAfterSeconds !== undefined) {
              response.headers.set("retry-after", String(verdict.retryAfterSeconds));
            }
            // Inside this tail closure (an idempotency-middleware next() OR the direct path) the
            // verdict is published via c.res, not returned — short-circuiting the handler without
            // calling the downstream next().
            c.res = response;
            return;
          }

          // Step 6: the handler.
          //
          // FAIL-CLOSED CONTRACT (do not break): a port above (resolveSession/resolveFirmContext/
          // loadPermissions/rateLimiter) throwing rejects this middleware. With NO app.onError,
          // Hono's default converts that rejection into a 500 — the handler is never reached,
          // which is the fail-closed behavior the chokepoint depends on. If you add an
          // app.onError, it MUST re-raise (or reply 5xx) for an enforcement-port throw; it must
          // NEVER convert the throw into a 2xx or call next(), which would make the chokepoint
          // fail-OPEN. The regression guard is chokepoint.test.ts "fail-closed on a throwing port".
          await next();
        };

        // Run the idempotency gate wrapping the tail (required-idempotency route), or the tail
        // directly (optional). When the idempotency middleware short-circuits (400/409/422/replay)
        // it RETURNS a Response (the Hono short-circuit signal) and does NOT call its next
        // (idempotencyTail) — so the rate-limit gate and the handler never run for a
        // replay/conflict. That return must be propagated so Hono finalizes the context with it
        // (returning it from this outer middleware is how a manually-invoked sub-middleware's
        // short-circuit reply lands as the response; without it Hono throws "Context is not
        // finalized").
        if (idempotencyMiddleware !== null) {
          return await idempotencyMiddleware(c, idempotencyTail);
        }
        return await idempotencyTail();
      };

      // Steps 1–3 — session, authn, RBAC — apply ONLY to non-public surfaces. A public route
      // (e.g. POST /v1/firms, platform-admin-secret-guarded) carries no cookie/CSRF assumption;
      // its OWN guard middleware does the auth (composed before this chokepoint middleware), and the
      // chokepoint must not run the session/firm/RBAC gates that don't apply (and must not break
      // that guard). The chokepoint still enforces the idempotency and rate-limit gates for every
      // surface (a public route's idempotency is platform-scoped — see the idempotency port).
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
          // Step 3a·0 — FIRMLESS ADMISSION, ahead of the firm context because there is no firm to
          // resolve. Three outcomes, and the default is the closed one:
          //
          //   no firm + "reject"     → the reserved 404, the same absence a cross-firm request
          //                            gets. This is every route that never thought about it.
          //   no firm + allow/only   → admitted with NO firm context and NO capability check;
          //                            the handler reads the user id and nothing else.
          //   HAS a firm + "only"    → the reserved 404. A route for people who have no firm is
          //                            not a route a member of a firm may reach, which is what
          //                            lets it carry permission: null (contracts/route-meta.ts).
          //
          // Absence rather than a 403 throughout: which of the two a caller got would itself
          // answer whether they hold a firm, and that is the account fact the joining surface is
          // arranged not to publish.
          const firmless = session.firmId === null;
          const admission = meta.firmlessSession ?? "reject";
          if ((firmless && admission === "reject") || (!firmless && admission === "only")) {
            return problemJson(c, {
              type: "not-found",
              status: 404,
              title: "Not found",
              detail: "No such resource in this firm.",
            });
          }
          if (firmless) {
            // No firm context, no permissions, no firm-scoped rate-limit key — the request is
            // keyed by IP like an anonymous one, because that is what it costs the platform.
            c.set("chokepointUserId", session.userId);
            return await runIdempotencyAndHandler();
          }

          // Step 3a: resolve the firm context. null = structural absence (cross-firm / firm row
          // missing / DB unbound / member deactivated) → 404, no existence oracle.
          const firmContext = await ports.resolveFirmContext(c, session, meta);
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
          // requestAccess: true (the request→grant seam). permission: null means "any
          // authenticated user" (a non-mutating read; the definition-time guard in route-meta.ts
          // forbids null on authenticated mutations), so it skips the capability check.
          if (meta.permission !== null) {
            const permissions = await ports.loadPermissions(firmContext, session);
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
            // Stash the resolved permission set too — a handler whose route names ONE capability
            // (the primary gate above) but must ALSO require a second, unrelated capability (a dual
            // gate) reads it via requireChokepointPermissions/assertAlsoHasPermission
            // (context-accessors.ts) instead of re-deriving it with a second loadPermissions call.
            c.set("permissions", permissions);
          }

          // Stash the resolved tenancy for the handler and the rate-limit key (the context
          // variables the handler reads are formalized elsewhere; here it scopes the limiter key).
          c.set("chokepointFirmId", session.firmId);
          c.set("chokepointUserId", session.userId);
          c.set("chokepointFirmContext", firmContext);
        }
      }

      return await runIdempotencyAndHandler();
    };
  }

  return { forRoute, assertRouteHasMeta };
}
