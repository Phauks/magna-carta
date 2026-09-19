// The chokepoint context accessors: the fail-closed reads an authenticated
// handler uses instead of a raw c.get("chokepoint…"). The chokepoint stashes the tenancy variables
// (chokepointUserId / chokepointFirmId / chokepointFirmContext) ONLY on the non-public,
// session-present path (chokepoint.ts step 3a). On the CURRENT route set every authenticated handler
// runs only after that path populated them — an authenticated: true route 401s without a session and
// 404s without firm context, so a handler never sees them undefined.
//
// But the context-variable TYPES (ports.ts ChokepointVariables) declare them non-optional, so a
// FUTURE app-surface route mistakenly authored authenticated: false would let the session-null path
// fall through to a handler that trusts `undefined` tenancy (e.g. binding undefined as a firm_id).
// These accessors convert that latent undefined-trust into a loud throw — mirroring the fail-closed
// guard the idempotency port already applies (idempotency-port.ts) when an app-surface
// required-idempotency route reaches it without a resolved firm. A throw → Hono's default 500
// (fail-closed: the handler's tenant-scoped work never runs), the regression contract documented in
// chokepoint.ts.
import { assertPermission } from "@magna-carta/access-control/registry";
import type { Permission } from "@magna-carta/access-control/registry";
import type { IdempotencyContext } from "@magna-carta/data-access/hono-idempotency-middleware";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Context } from "hono";
import type { Bindings } from "../bindings.ts";
import { problemJson, type ProblemResponse } from "../contracts/problem.ts";
import type { AppVariables, FirmContext } from "./ports.ts";
import type { SessionContext } from "../session-context.ts";

// The minimal context shape these accessors need: the typed variable getter. Declared structurally
// (not Hono's Context<E, P, I> — whose path/input generics differ per route, so a route handler's
// fully-parameterized context would not match a fixed Context type) so any chokepoint-typed handler
// context satisfies it. Kept a leaf (no app.ts import) so the route modules and the chokepoint can
// both depend on it without a cycle.
interface AppContext {
  get<Key extends keyof AppVariables>(key: Key): AppVariables[Key];
}

// The fail-closed message shared by every accessor: a chokepoint-stashed tenancy variable is absent,
// which on the current routes is impossible (the session/firm gates precede any authenticated
// handler) and so signals a broken invariant — a route reaching a tenant-scoped handler without the
// chokepoint having populated context. Fail loud (→ 500) rather than let a handler trust undefined.
function chokepointContextError(variable: string): Error {
  return new Error(
    `chokepoint context variable ${JSON.stringify(variable)} is undefined in an authenticated ` +
      `handler — the chokepoint stashes tenancy only on the session-present path, so an absent ` +
      `value means the session/firm gates did not run before this handler (a route mistakenly ` +
      `authored authenticated: false would do this). Failing closed.`,
  );
}

// The session user id the chokepoint resolved, or a throw if absent (the populated-context
// invariant broken). Use in place of a raw c.get("chokepointUserId").
export function requireChokepointUserId(c: AppContext): SessionContext["userId"] {
  const userId = c.get("chokepointUserId") as SessionContext["userId"] | undefined;
  if (userId === undefined) throw chokepointContextError("chokepointUserId");
  return userId;
}

// The session firm id the chokepoint resolved, or a throw if absent. Use in place of a raw
// c.get("chokepointFirmId").
export function requireChokepointFirmId(c: AppContext): FirmId {
  const firmId = c.get("chokepointFirmId") as FirmId | undefined;
  if (firmId === undefined) throw chokepointContextError("chokepointFirmId");
  return firmId;
}

// The session firm's context (per-firm D1 handle + name) the chokepoint resolved, or a throw if
// absent. Use in place of a raw c.get("chokepointFirmContext").
export function requireChokepointFirmContext(c: AppContext): FirmContext {
  const firmContext = c.get("chokepointFirmContext") as FirmContext | undefined;
  if (firmContext === undefined) throw chokepointContextError("chokepointFirmContext");
  return firmContext;
}

// Non-throwing variants for cross-cutting middleware that runs on BOTH public and authenticated
// routes (the usage-analytics reached emitter): on a public/unauthenticated route the chokepoint
// never populated tenancy, and the caller treats absence as "nothing to do" rather than a broken
// invariant. Return undefined instead of throwing.
export function optionalChokepointUserId(c: AppContext): SessionContext["userId"] | undefined {
  return c.get("chokepointUserId") as SessionContext["userId"] | undefined;
}
export function optionalChokepointFirmId(c: AppContext): FirmId | undefined {
  return c.get("chokepointFirmId") as FirmId | undefined;
}
export function optionalChokepointFirmContext(c: AppContext): FirmContext | undefined {
  return c.get("chokepointFirmContext") as FirmContext | undefined;
}

// The permission set the chokepoint resolved for the route's primary gate (RBAC step 3b), or a throw
// if absent. Only populated when the route names a non-null permission (routeMeta.permission), which
// every route reaching for this accessor does (it exists to require a SECOND capability beyond that
// declared one). Use in place of a raw c.get("permissions").
export function requireChokepointPermissions(c: AppContext): ReadonlySet<Permission> {
  const permissions = c.get("permissions") as ReadonlySet<Permission> | undefined;
  if (permissions === undefined) throw chokepointContextError("permissions");
  return permissions;
}

// A DUAL permission gate: asserts the principal ALSO holds `permission`, beyond the route's declared
// primary one (RouteMeta.permission — enforced by the chokepoint before the handler runs). For a
// route whose primary gate is a broad capability (e.g. files:upload, the matter-write gate) but whose
// handler performs an action that additionally requires a narrower tool capability (e.g.
// tools:fileRepair), call this FIRST in the handler. Returns the identical 403 problem shape the
// chokepoint's own primary-gate denial returns (chokepoint.ts step 3b) — a caller cannot distinguish
// which gate refused them — or null when the capability is present.
export function assertAlsoHasPermission(
  c: Context<{ Bindings: Bindings; Variables: AppVariables }>,
  permission: string,
): ProblemResponse<403> | null {
  const required = assertPermission(permission);
  if (!requireChokepointPermissions(c).has(required)) {
    return problemJson(c, {
      type: "permission-denied",
      status: 403,
      title: "Permission denied",
      detail: "Your role does not grant this action in this firm.",
      requestAccess: true,
    });
  }
  return null;
}

// The idempotency context the chokepoint's idempotency gate stashed on a required-idempotency route,
// or a throw if absent. A handler mounted on a required-idempotency route always runs after the gate
// populated it; an absent value means the gate did not run (the route is misconfigured), so fail loud
// (→ 500) rather than silently lose idempotency. Use in place of a raw c.get("idempotency").
export function requireChokepointIdempotency(c: AppContext): IdempotencyContext {
  const idempotency = c.get("idempotency") as IdempotencyContext | undefined;
  if (idempotency === undefined) {
    throw new Error(
      "idempotency context missing — the chokepoint idempotency gate did not run on a required-idempotency route",
    );
  }
  return idempotency;
}
