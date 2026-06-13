// The real chokepoint ports (slice 0·5b Task 8): the bridge from the chokepoint's injected
// interfaces (chokepoint.ts) to the 0·4 implementations (session-context.ts, firm-binding-
// resolver.ts). Task 7 built the chokepoint over fakes; this module supplies the production
// resolvers and the FirmContext the handlers read. One home for the wiring so app.ts stays a
// thin composition root.
import type { Context } from "hono";
import type { Permission } from "@magna-carta/access-control/registry";
import type { IdempotencyContext } from "@magna-carta/data-access/hono-idempotency-middleware";
import { selectMemberStatusStatement } from "@magna-carta/data-access/member-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../app.ts";
import type { createAuth } from "../auth.ts";
import { resolveFirmDatabase } from "../firm-binding-resolver.ts";
import {
  loadEffectivePermissions,
  resolveSession,
  type SessionContext,
} from "../session-context.ts";
import type { ChokepointPorts, ResolvedSession } from "./chokepoint.ts";

// What resolveFirmContext returns and the chokepoint threads to loadPermissions and the handler:
// the session firm's per-firm D1 handle plus its display name (so a handler reading the firm need
// not re-query the control plane). Opaque to the chokepoint; consumed by handlers via c.get(
// "chokepointFirmContext"). The firm came from the SESSION (ADR-0052), never the URL.
export interface FirmContext {
  readonly firmDatabase: D1Database;
  readonly firmName: string;
}

// The typed context variables the chokepoint stashes (chokepoint.ts step 3a) and the handlers
// read. Declared once here so app.ts types the OpenAPIHono Variables and handlers get typed
// c.get(...) — formalizing the Task 7 string-keyed stash into a typed contract.
export interface ChokepointVariables {
  chokepointFirmId: FirmId;
  chokepointUserId: SessionContext["userId"];
  chokepointFirmContext: FirmContext;
}

// The full app context Variables: the chokepoint-stashed tenancy plus the idempotency context the
// chokepoint's idempotency gate sets (read by the required-idempotency handlers). One home so the
// OpenAPIHono instance and every route's c.get(...) type against the same shape — and so the route
// modules type their `app` parameter without importing app.ts at value level.
export type AppVariables = ChokepointVariables & { idempotency?: IdempotencyContext };

// resolveSession port: the cookie → { userId, firmId } resolver, bound to the per-env Better Auth
// instance app.ts owns. SessionContext IS the ResolvedSession shape (both { userId, firmId }).
function makeResolveSession(
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
): (c: Context) => Promise<ResolvedSession | null> {
  return (c) => resolveSession(authForEnv((c as Context<{ Bindings: Bindings }>).env), c);
}

// resolveFirmContext port (the ADR-0052 structural-absence gate). Returns null — mapped to the
// chokepoint's 404, no existence oracle — for EVERY structural absence:
//   • the firm row is missing from this control plane,
//   • the firm's database_identifier binds to no D1 in this deployment (cross-firm / unreachable),
//   • the session member is DEACTIVATED in the firm (a deliberate absent state, ADR-0052).
// A NEVER-MIRRORED user (no member row yet — the owner-activation sweep-lag window) is NOT absent:
// it returns the context so the read self-heals to a 200 with empty permissions; only an explicit
// non-active status is the absence. (me.get carries permission: null, so the chokepoint resolves
// the firm here and skips the permission gate; the handler loads the empty permission set itself.)
function makeResolveFirmContext(): (
  c: Context,
  session: ResolvedSession,
) => Promise<FirmContext | null> {
  return async (c, session) => {
    const env = (c as Context<{ Bindings: Bindings }>).env;
    const firmRow = await env.DB_CONTROL.prepare(
      "SELECT name, database_identifier FROM firm WHERE id = ?1",
    )
      .bind(session.firmId)
      .first<{ name: string; database_identifier: string }>();
    if (firmRow === null) return null;

    const firmDatabase = resolveFirmDatabase(env, firmRow.database_identifier);
    if (firmDatabase === null) return null;

    // Member-active check (ADR-0052): a row whose status is anything other than 'active' is a
    // DEACTIVATED member → absent → 404. Zero rows is the never-mirrored sweep-lag window → present.
    const memberStatusResult = await selectMemberStatusStatement(firmDatabase, session.userId).all<{
      status: string;
    }>();
    const memberStatus = memberStatusResult.results[0]?.status;
    if (memberStatus !== undefined && memberStatus !== "active") return null;

    return { firmDatabase, firmName: firmRow.name };
  };
}

// loadPermissions port: the session member's effective permissions in THEIR firm (the firm DB came
// from the session-derived FirmContext — never client input), folded through the access-control
// resolver. The member-active filter already lives in the permission statements (a deactivated
// member's roles confer nothing), but the chokepoint never reaches here for a deactivated member —
// resolveFirmContext already 404'd them.
function makeLoadPermissions(): (
  firmContext: FirmContext,
  userId: ResolvedSession["userId"],
) => Promise<ReadonlySet<Permission>> {
  return (firmContext, userId) => loadEffectivePermissions(firmContext.firmDatabase, userId);
}

// Assembles the production ports MINUS the idempotency port (app.ts adds createChokepointIdempotency
// — it lives in its own module to avoid a value-import cycle through this one). The rate limiter is
// injected because app.ts owns its lifetime: one per worker isolate, never one per request.
export function createChokepointPorts(
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
  rateLimiter: ChokepointPorts<FirmContext>["rateLimiter"],
): Omit<ChokepointPorts<FirmContext>, "idempotency"> {
  return {
    resolveSession: makeResolveSession(authForEnv),
    resolveFirmContext: makeResolveFirmContext(),
    loadPermissions: makeLoadPermissions(),
    rateLimiter,
  };
}
