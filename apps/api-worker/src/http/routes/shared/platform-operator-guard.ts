import type { MiddlewareHandler } from "hono";
import { decidePlatformOperatorAccess } from "@magna-carta/access-control/platform-operator";
import {
  selectActivePlatformOperatorStatement,
  type PlatformOperatorAccessRow,
} from "@magna-carta/data-access/platform-operator-statements";
import { authDenied } from "@magna-carta/telemetry/events";
import { newErrorId } from "@magna-carta/telemetry/ids";
import type { Bindings } from "../../../bindings.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { resolveSession } from "../../session-context.ts";
import { authForEnv } from "../../../auth-instance.ts";
import { problemJson } from "../../contracts/problem.ts";

type GuardEnv = { Bindings: Bindings; Variables: AppVariables };

// A platform-level guard for global-operator actions. Runs as route-specific middleware on a
// surface: "public" route (so the per-firm chokepoint does not try to resolve a firm), resolving
// the Better Auth session itself and authorizing the platform_operator principal.
export const platformOperatorGuard: MiddlewareHandler<GuardEnv> = async (c, next) => {
  const session = await resolveSession(authForEnv(c.env), c);
  const correlationId = c.get("correlationId") ?? "";
  if (session === null) {
    const errorId = newErrorId();
    // Better Auth resolves the session from a cookie, not a header — "no-session" names what
    // actually failed (distinct from platformAdminGuard's header-secret "missing-header").
    c.get("logger")?.log(
      authDenied(
        { correlationId, now: new Date().toISOString() },
        { cause: "no-session", route: c.req.routePath, errorId },
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
  const nowIso = new Date().toISOString();
  const row = (
    await selectActivePlatformOperatorStatement(
      c.env.DB_CONTROL,
      session.userId,
      nowIso,
    ).all<PlatformOperatorAccessRow>()
  ).results[0];
  const decision = decidePlatformOperatorAccess(row);
  if (!decision.allow) {
    const errorId = newErrorId();
    // decision.reason ("not-operator" / "mfa-required") distinguishes the two 403 causes in
    // telemetry — they were previously collapsed under one "mismatch" label.
    c.get("logger")?.log(
      authDenied(
        { correlationId, now: nowIso },
        { cause: decision.reason, route: c.req.routePath, errorId },
      ),
    );
    const detail =
      decision.reason === "mfa-required"
        ? "Enable two-factor authentication to perform platform-operator actions."
        : "This account is not a platform operator.";
    return problemJson(c, {
      type: "permission-denied",
      title: "Forbidden",
      status: 403,
      detail,
      errorId,
    });
  }
  c.set("platformOperatorUserId", session.userId);
  await next();
};
