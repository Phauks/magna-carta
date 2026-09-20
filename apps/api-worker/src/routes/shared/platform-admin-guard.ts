import type { MiddlewareHandler } from "hono";
import { authDenied } from "@magna-carta/telemetry/events";
import { newErrorId } from "@magna-carta/telemetry/ids";
import type { Bindings } from "../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { constantTimeStringEquals } from "../../constant-time.ts";
import { problemJson } from "../../contracts/problem.ts";

// Shared between the platform module (the public firms surface and the alpha release-channel
// door) and the support module (the support-session mint) — the one platform-operator credential
// check, so the two surfaces cannot drift apart in what a wrong key looks like from outside.
// The guard reads the telemetry-stashed logger + correlationId (set by the middleware ahead of it)
// from context, so its env is the full AppVariables, not a one-off shape.
type GuardEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};

// The platform-admin guard: a Worker-secret header check, the single-operator reality for now — a
// real platform-admin principal model is a later seam. Fail closed: an unset/empty
// PLATFORM_ADMIN_KEY rejects every request, and a missing key, a wrong key, and an unconfigured
// deployment all answer the SAME 401 problem (no probe surface).
// This stays a ROUTE-SPECIFIC middleware (NOT the chokepoint's RBAC): firms.provision is the
// documented public-surface exception, so the chokepoint skips its session/firm/RBAC gates and this
// secret guard does the auth. chokepoint/register.ts composes it BEFORE the chokepoint enforcement
// middleware, so it runs first — a missing/wrong secret 401s before the chokepoint's idempotency and
// rate-limit gates ever run, and nothing about the route is discoverable without the secret.
export const platformAdminGuard: MiddlewareHandler<GuardEnv> = async (c, next) => {
  const configuredKey = c.env.PLATFORM_ADMIN_KEY;
  const presentedKey = c.req.header("X-Platform-Admin-Key");
  // The CLIENT sees one opaque 401 for all three causes (no enumeration oracle — see the route
  // comment); this branch decides only what the OPERATOR sees. The order preserves the original
  // short-circuit, so the constant-time compare still runs only when a non-empty key was presented.
  let denialCause: "unconfigured" | "missing-header" | "mismatch" | undefined;
  if (configuredKey === undefined || configuredKey === "") {
    denialCause = "unconfigured";
  } else if (presentedKey === undefined || presentedKey === "") {
    denialCause = "missing-header";
  } else if (!(await constantTimeStringEquals(presentedKey, configuredKey))) {
    denialCause = "mismatch";
  }
  if (denialCause !== undefined) {
    const errorId = newErrorId();
    // The standard telemetry pipeline (slice 0·6) — the structural replacement for slice 0·4's
    // interim console.error seam. The auth.denied event records the cause label + route + the SAME
    // Error ID the client receives (so an operator can tell a deployment misconfiguration
    // 'unconfigured' apart from a denied caller). The allowlist IS the redaction: the event has no
    // slot for the presented or configured key, so neither can ever be logged. The request-scoped
    // logger and correlation id were stashed by the telemetry middleware ahead of this guard.
    c.get("logger")?.log(
      authDenied(
        { correlationId: c.get("correlationId") ?? "", now: new Date().toISOString() },
        { cause: denialCause, route: c.req.routePath, errorId },
      ),
    );
    return problemJson(c, {
      type: "unauthenticated",
      title: "Authentication required",
      status: 401,
      detail: "Sign in to call this endpoint.",
      errorId,
    });
  }
  await next();
};
