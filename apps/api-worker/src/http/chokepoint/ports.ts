// The real chokepoint ports: the bridge from the chokepoint's injected
// interfaces (chokepoint.ts) to the implementations (session-context.ts, firm-database-proxy.ts).
// The chokepoint is built over fakes; this module supplies the production resolvers and the
// FirmContext the handlers read. One home for the wiring so app.ts stays a thin composition root.
import type { Context } from "hono";
import type { Permission } from "@magna-carta/access-control/registry";
import type { IdempotencyContext } from "@magna-carta/data-access/hono-idempotency-middleware";
import { selectMemberStatusStatement } from "@magna-carta/data-access/member-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../../bindings.ts";
import type { RouteMeta } from "../contracts/route-meta.ts";
import type { createAuth } from "../../auth.ts";
import {
  firmDatabaseFor,
  firmDatabaseMigrationStateFor,
  type FirmDatabaseMigrationState,
  type ProxyBatchDatabase,
} from "../../firm-database/firm-database-proxy.ts";
import { resolveSession, type SessionContext } from "../session-context.ts";
import { loadEffectivePermissions } from "../../effective-permissions.ts";
import type { ChokepointPorts, ResolvedSession } from "./chokepoint.ts";
import { resolveSupportSession } from "../resolve-support-session.ts";
import { resolveSupportPermissions } from "../../support/tier-permissions.ts";

// What resolveFirmContext returns and the chokepoint threads to loadPermissions and the handler:
// the session firm's per-firm database handle, an on-demand reader for its name, and its bucket.
// Opaque to the chokepoint; consumed by handlers via c.get(
// "chokepointFirmContext"). The firm came from the SESSION, never the URL.
export interface FirmContext {
  readonly firmDatabase: ProxyBatchDatabase;
  /**
   * What the firm's lineage did, and what stopped it — asked on demand, and answerable when nothing
   * else about this database is. Every statement `firmDatabase` carries is refused while a migration
   * is stuck, so this is the one question a diagnostic can still put.
   */
  readonly migrationState: () => Promise<FirmDatabaseMigrationState>;
  /**
   * The firm's readable name, resolved ON DEMAND rather than carried.
   *
   * A FIRM CAN BE RENAMED, so this is the one fact here that is never served from the row cache
   * below: a cached name would be a stale name, and the two places that ask for it are the session
   * bootstrap (the name in the app shell) and a file-integrity receipt — a document a firm relies
   * on, where last week's name would be wrong in a way nobody could see. Lazy rather than eagerly
   * read because two routes out of a hundred want it, and making every request pay a control-plane
   * read for a string almost none of them use is what put it in the cache in the first place.
   *
   * Empty string when the firm row has vanished mid-request (the same answer the assembly consumer
   * gives for the same absence) — a caller holding a firm context has already passed the gate.
   */
  readonly readFirmName: () => Promise<string>;
  // The firm's R2 bucket name, for the upload/download presigner (null until provisioning created it;
  // an active firm always has it). The bucket came from the SESSION firm row, never client input.
  readonly bucketName: string | null;
}

// The typed context variables the chokepoint stashes (chokepoint.ts step 3a) and the handlers
// read. Declared once here so app.ts types the OpenAPIHono Variables and handlers get typed
// c.get(...) — formalizing the string-keyed stash into a typed contract.
export interface ChokepointVariables {
  chokepointFirmId: FirmId;
  chokepointUserId: SessionContext["userId"];
  chokepointFirmContext: FirmContext;
}

// The full app context Variables: the chokepoint-stashed tenancy plus the idempotency context the
// chokepoint's idempotency gate sets (read by the required-idempotency handlers). One home so the
// OpenAPIHono instance and every route's c.get(...) type against the same shape — and so the route
// modules type their `app` parameter without importing app.ts at value level.
//
// correlationId + logger are stashed by the telemetry middleware (installed first, ahead of the
// chokepoint): every downstream guard/handler emits events through the request-scoped `logger`
// against the request's `correlationId`, and problemJson reads correlationId to stamp every reply.
// Both optional: a code path running before the middleware (none today) would see neither.
//
// permissions is stashed by the chokepoint's own RBAC step (chokepoint.ts step 3b) alongside the
// tenancy variables above, but ONLY when the route names a non-null permission (the common case) —
// hence optional, unlike the ChokepointVariables that are unconditionally present on the
// session-present path. A handler reads it via requireChokepointPermissions/assertAlsoHasPermission
// (context-accessors.ts) to require a SECOND capability beyond the route's declared primary one.
export type AppVariables = ChokepointVariables & {
  idempotency?: IdempotencyContext;
  correlationId?: string;
  logger?: Logger;
  permissions?: ReadonlySet<Permission>;
  // Set by platformOperatorGuard on allow: the platform-operator route-specific guard's own
  // authorized-principal handle, parallel to chokepointUserId but for the "public" surface routes
  // that skip the per-firm chokepoint entirely (see platform-operator-guard.ts).
  platformOperatorUserId?: import("@magna-carta/identifiers/types").UserId;
};

// resolveSession port: the cookie → { userId, firmId } resolver, bound to the per-env Better Auth
// instance app.ts owns. SessionContext IS the ResolvedSession shape (both { userId, firmId }).
function makeResolveSession(
  authForEnv: (env: Bindings) => ReturnType<typeof createAuth>,
): (c: Context) => Promise<ResolvedSession | null> {
  return async (c) => {
    const env = (c as Context<{ Bindings: Bindings }>).env;
    const support = await resolveSupportSession(env, c, Math.floor(Date.now() / 1000));
    if (support !== null) return support;
    return resolveSession(authForEnv(env), c);
  };
}

// How long a fully-provisioned firm row is believed without re-reading the control plane. The
// two facts it is allowed to answer for — that the firm EXISTS, and its bucket — neither of which
// a rename or an edit can move: bucket_name flips exactly once, from NULL, and a row that is gone
// is covered by the member gate on the firm's own database, which still runs on every request. So
// the staleness a minute admits is a hard-deleted firm's lingering session surviving that minute.
// Rows still provisioning (no bucket yet) are never cached, so a founder watches the bucket appear
// on the very request after it exists.
//
// THE FIRM'S NAME IS DELIBERATELY NOT HERE. A firm can be renamed, and a name is the one value on
// the row that changes in the ordinary life of a firm — so it is resolved on demand instead
// (FirmContext.readFirmName), and this cache holds nothing a rename could falsify.
const FIRM_ROW_CACHE_MILLISECONDS = 60_000;

interface CachedFirmRow {
  readonly bucketName: string;
  readonly expiresAtMilliseconds: number;
}

// resolveFirmContext port (the structural-absence gate). Returns null — mapped to the
// chokepoint's 404, no existence oracle — for EVERY structural absence:
//   • the firm row is missing from this control plane,
//   • the session member is DEACTIVATED in the firm (a deliberate absent state).
// A NEVER-MIRRORED user (no member row yet — the owner-activation sweep-lag window) is NOT absent:
// it returns the context so the read self-heals to a 200 with empty permissions; only an explicit
// non-active status is the absence. (me.get carries permission: null, so the chokepoint resolves
// the firm here and skips the permission gate; the handler loads the empty permission set itself.)
//
// The control-plane row read is CACHED per isolate for a minute (see FIRM_ROW_CACHE_MILLISECONDS
// for why that is sound), because it was a serial ~100ms on the front of every request for facts
// that do not move. Only a complete, provisioned row is cached — absence is never cached (the
// structural gate stays live), and neither is a row mid-provisioning. The member-active check
// against the firm's own database still runs on every request; the row order is unchanged where it
// matters: the DO is still never addressed for a firm the control plane does not answer for.
function makeResolveFirmContext(): (
  c: Context,
  session: ResolvedSession,
  meta: RouteMeta,
) => Promise<FirmContext | null> {
  const firmRowCache = new Map<FirmId, CachedFirmRow>();
  return async (c, session, meta) => {
    // A session that carries no firm has no firm context, which is this port's own definition of
    // absence. The chokepoint already answers such a session before asking (its firmless-admission
    // step), so this is not a path production traffic takes — it is stated because the port is
    // callable on its own and must not be readable as "no firm means fall back to something".
    if (session.firmId === null) return null;
    const env = (c as Context<{ Bindings: Bindings }>).env;

    // THE NAME PEOPLE READ IS `display_name`, and `name` is only sometimes it. A firm created
    // through the operator door is named by a human typing one, so the two agree. A SELF-SERVE
    // firm is not: `firm.name` there is the registration's own handle, because firm names are not
    // unique in the world and a UNIQUE column over them would let a stranger probe for any firm
    // by trying to register its name — so the readable name lives in `display_name` and `name` is
    // machinery. Resolving `name` alone put that handle on screen for every self-serve firm.
    const nameOf = (row: { name: string; display_name: string | null }): string =>
      row.display_name ?? row.name;

    let bucketName: string | null;
    // The row this request read for itself, when it read one. A cache MISS has already paid for the
    // whole row, so the name it carries is this request's own fresh answer and readFirmName below
    // must not go back for it; a cache HIT has no row, and readFirmName reads one when asked.
    let firmRowThisRequest: { name: string; display_name: string | null } | null = null;

    const cached = firmRowCache.get(session.firmId);
    if (cached !== undefined && cached.expiresAtMilliseconds > Date.now()) {
      bucketName = cached.bucketName;
    } else {
      firmRowCache.delete(session.firmId);
      const firmRow = await env.DB_CONTROL.prepare(
        "SELECT name, display_name, bucket_name FROM firm WHERE id = ?1",
      )
        .bind(session.firmId)
        .first<{ name: string; display_name: string | null; bucket_name: string | null }>();
      if (firmRow === null) return null;
      firmRowThisRequest = firmRow;
      bucketName = firmRow.bucket_name;
      if (bucketName !== null) {
        // A blunt bound, not an eviction policy: an isolate serves nowhere near this many firms,
        // so the clear exists only so the map cannot grow without limit across a long isolate life.
        if (firmRowCache.size >= 1000) firmRowCache.clear();
        firmRowCache.set(session.firmId, {
          bucketName,
          expiresAtMilliseconds: Date.now() + FIRM_ROW_CACHE_MILLISECONDS,
        });
      }
    }

    const firmId = session.firmId;
    const readFirmName = async (): Promise<string> => {
      if (firmRowThisRequest !== null) return nameOf(firmRowThisRequest);
      const row = await env.DB_CONTROL.prepare("SELECT name, display_name FROM firm WHERE id = ?1")
        .bind(firmId)
        .first<{ name: string; display_name: string | null }>();
      return row === null ? "" : nameOf(row);
    };

    // Every firm is reachable by name through its per-firm FirmDatabase Durable Object; the stub
    // self-migrates the per-firm lineage on first access. The firm is addressed by its session
    // firmId — never client input.
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, session.firmId);

    // Member-active check: a row whose status is anything other than 'active' is a
    // DEACTIVATED member → absent → 404. Zero rows is the never-mirrored sweep-lag window → present.
    //
    // Failing to RUN the check is a third outcome, and neither of the two above. The per-firm
    // lineage is applied in the FirmDatabase durable object's constructor, so a migration that
    // cannot complete leaves the firm's whole database unreachable and this read throws rather than
    // answering. Fail-closed is the default and stays the default: the throw propagates, the route
    // answers 500, and no firm data is served on a membership nothing could verify.
    //
    // A route declaring firmDatabaseOutage: "tolerate" is admitted instead. Registration has
    // already refused that declaration alongside a named permission, so such a route claims no
    // capability, and any firm read it still attempts is its own to catch and report — which is
    // what a diagnostic does, the outage being its subject. Nothing is relaxed for anything else,
    // and nothing leaks by admitting it: the database that would hold the firm's data is the
    // database that is down.
    let memberStatus: string | undefined;
    try {
      const memberStatusResult = await selectMemberStatusStatement(
        firmDatabase,
        session.userId,
      ).all<{ status: string }>();
      memberStatus = memberStatusResult.results[0]?.status;
    } catch (error) {
      if (meta.firmDatabaseOutage !== "tolerate") throw error;
    }
    if (memberStatus !== undefined && memberStatus !== "active") return null;

    return {
      firmDatabase,
      migrationState: () => firmDatabaseMigrationStateFor(env.FIRM_DATABASE, firmId),
      readFirmName,
      bucketName,
    };
  };
}

// loadPermissions port: the session member's effective permissions in THEIR firm (the firm DB came
// from the session-derived FirmContext — never client input), folded through the access-control
// resolver. The member-active filter already lives in the permission statements (a deactivated
// member's roles confer nothing), but the chokepoint never reaches here for a deactivated member —
// resolveFirmContext already 404'd them.
function makeLoadPermissions(): (
  firmContext: FirmContext,
  session: ResolvedSession,
) => Promise<ReadonlySet<Permission>> {
  return async (firmContext, session) =>
    session.support === undefined
      ? loadEffectivePermissions(firmContext.firmDatabase, session.userId)
      : resolveSupportPermissions(session.support.tier, firmContext.firmDatabase, session.userId);
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
