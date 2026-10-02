// The chokepoint's idempotency port: the ONE place required-idempotency is
// applied. It replaces the per-route idempotency middleware members.ts and firms.ts
// previously mounted — the chokepoint now owns the key requirement AND the pre-decision, derived
// once from the route's resolved meta and the chokepoint-stashed firm context. Exactly one
// application per required route, never chokepoint + route-mounted.
//
// The stored-key derivation is the SURFACE's tenant scope (the control-plane idempotency table is
// shared across firms and the platform, so the scope rides in the stored key — members.ts/firms.ts
// territory): an app-surface session route scopes by the SESSION firm (`${firmId}:${clientKey}`,
// firm from the chokepoint context, never client input), and the public platform-admin route scopes
// by `platform:${clientKey}`. The two namespaces cannot collide — every firm scope starts with the
// `firm_` handle prefix, never the literal `platform`.
import type { Context, MiddlewareHandler } from "hono";
import { fingerprintRequest } from "@magna-carta/data-access/canonical";
import { idempotencyMiddleware } from "@magna-carta/data-access/hono-idempotency-middleware";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { Bindings } from "../app.ts";
import { problemResponseForIdempotencyConflict } from "../idempotency-conflict-problems.ts";
import type { RouteMeta } from "../contracts/route-meta.ts";
import { requireIdempotencyKey } from "../require-idempotency-key.ts";
import type { ChokepointIdempotency } from "./chokepoint.ts";

// The composed gate for one required-idempotency request: first the Idempotency-Key requirement
// (missing → the RFC 9457 400, before any SQL), then the data-access pre-decision keyed by the
// surface-scoped stored key, answering replay / 409 / 422 through the worker's problem mapping.
// Returned as a single Hono middleware so the chokepoint wraps the rate-limit + handler tail with
// it (calling its next only on the EXECUTE path).
function composedIdempotencyGate(
  database: Bindings["DB_CONTROL"],
  deriveStoredKey: (clientKey: string) => string,
): MiddlewareHandler {
  const preDecision = idempotencyMiddleware({
    requirement: "required",
    database,
    deriveStoredKey,
    // The pre-decision 409/422 — the COMMON conflict path — answers the route's declared
    // application/problem+json contract through the same mapping the handler's race path uses.
    conflictResponse: problemResponseForIdempotencyConflict,
  }) as unknown as MiddlewareHandler;

  return async (c, next) => {
    // Both sub-middlewares RETURN a Response to short-circuit (the Hono signal): requireIdempotencyKey
    // returns the 400 when the header is absent; the pre-decision returns the 409/422/replay. Hono's
    // Next type is () => Promise<void>, so a short-circuit Response cannot be threaded as a `next`
    // return — instead it is published onto c.res (the same channel Hono's own dispatcher uses) so it
    // propagates up to the chokepoint, which returns it. On the execute path requireIdempotencyKey's
    // next runs the pre-decision, whose execute path runs `next` (the chokepoint's rate-limit +
    // handler tail). publishing onto c.res is idempotent with the handler/tail also setting c.res.
    const requirementReply = await requireIdempotencyKey(c, async () => {
      const preDecisionReply = await preDecision(c, next);
      if (preDecisionReply instanceof Response) c.res = preDecisionReply;
    });
    if (requirementReply instanceof Response) c.res = requirementReply;
  };
}

// The path's own identity, as the default pre-decision computes it: the query string is part of a
// mutating request's identity, so it is kept, sorted so parameter order never changes it.
function canonicalRequestPath(requestUrl: string): string {
  const url = new URL(requestUrl);
  url.searchParams.sort();
  return url.pathname + url.search;
}

// The gate for a route declaring `idempotencyFingerprint: "path"`: the same key requirement, and a
// fingerprint over the method and the path ALONE — the body is never read here, so nothing derived
// from it reaches the stored record. There is deliberately no pre-decision: such a route stores a
// pointer rather than its reply, which the pre-decision would hand a retry verbatim. The handler's
// `runIdempotentEffect` makes the same replay / 409 / 422 decision from the same record before it
// runs anything, and answers a replay by reading the record afresh.
function pathFingerprintGate(deriveStoredKey: (clientKey: string) => string): MiddlewareHandler {
  return async (c, next) => {
    const requirementReply = await requireIdempotencyKey(c, async () => {
      const clientKey = c.req.header("Idempotency-Key") ?? "";
      const fingerprint = await fingerprintRequest({
        method: c.req.method,
        path: canonicalRequestPath(c.req.url),
        body: undefined,
      });
      c.set("idempotency", { key: deriveStoredKey(clientKey), fingerprint });
      await next();
    });
    if (requirementReply instanceof Response) c.res = requirementReply;
  };
}

// The real idempotency port. middlewareFor returns null for an optional-idempotency route (no
// gate), and the surface-scoped composed gate for a required one — app surface → firm scope (the
// chokepoint stashed the session firm id), public surface → platform scope.
export function createChokepointIdempotency(): ChokepointIdempotency {
  return {
    middlewareFor(c: Context, meta: RouteMeta): MiddlewareHandler | null {
      if (meta.idempotency !== "required") return null;
      const env = (c as Context<{ Bindings: Bindings }>).env;
      // The route's fingerprint mode decides which gate, wherever its record is kept.
      const gateFor = (
        database: Bindings["DB_CONTROL"],
        deriveStoredKey: (clientKey: string) => string,
      ): MiddlewareHandler =>
        meta.idempotencyFingerprint === "path"
          ? pathFingerprintGate(deriveStoredKey)
          : composedIdempotencyGate(database, deriveStoredKey);

      if (meta.surface === "public") {
        // The platform-admin surface: no session, no firm — the platform principal is the scope.
        return gateFor(env.DB_CONTROL, (clientKey) => `platform:${clientKey}`);
      }

      // An app/portal surface. The record MUST land in the same database the handler writes its
      // business to (so they ride one atomic batch — the slice 0·2 idempotent write path). The route
      // declares which via meta.idempotencyStore; the default is "firm".
      //
      // A required-idempotency mutating route is authenticated: true (the route-meta guard forbids
      // null permission on it), so the chokepoint always resolved the session firm and either stashed
      // the firm context/id or already 404'd at step 3a before this gate runs. An undefined value here
      // therefore means a broken chokepoint invariant — fail loud (fail-closed) rather than derive an
      // unscoped, cross-tenant-collidable key or target the wrong database.
      const store = meta.idempotencyStore ?? "firm";
      if (store === "control") {
        // The rare app-surface route whose business is itself control-plane (members.invite creates a
        // control-plane user): record in the SHARED control-plane table, the session firm in the key
        // (from authenticated context, never client input) so one firm cannot collide with another.
        const firmId = c.get("chokepointFirmId") as FirmId | undefined;
        if (firmId === undefined) {
          throw new Error(
            "chokepoint idempotency gate reached a control-store app route without a resolved " +
              "session firm — the session/firm gates must precede the idempotency gate",
          );
        }
        return gateFor(env.DB_CONTROL, (clientKey) => `${firmId}:${clientKey}`);
      }

      // store === "firm": the session firm's per-firm idempotency_key table. It is PHYSICALLY isolated
      // (a separate D1 per firm), so the raw client key suffices — no tenant prefix, and one firm's
      // record can never read or poison another's. The handler commits record + business + outbox in
      // one batch on this same database.
      const firmContext = c.get("chokepointFirmContext") as
        | { firmDatabase: D1Database }
        | undefined;
      if (firmContext === undefined) {
        throw new Error(
          "chokepoint idempotency gate reached a firm-store app route without a resolved firm " +
            "context — the session/firm gates must precede the idempotency gate",
        );
      }
      return gateFor(firmContext.firmDatabase, (clientKey) => clientKey);
    },
  };
}
