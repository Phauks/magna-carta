import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { fingerprintRequest } from "./canonical.ts";
import { decideIdempotency, type IdempotencyRecordRow } from "./idempotency-decision.ts";
import { selectIdempotencyRecordStatement, type SqlDatabase } from "./idempotency-statements.ts";

// What the middleware hands the route handler (via context.get("idempotency")) when the request must
// execute: the handler passes these straight to runIdempotentEffect, which owns the atomic commit.
// `key` is the STORED key — after deriveStoredKey, when configured — so the handler's commit always
// targets the exact row this middleware's pre-decision read.
export interface IdempotencyContext {
  readonly key: string;
  readonly fingerprint: string;
}

// One home for the kind -> HTTP mapping, shared by the middleware's pre-decision and by handlers
// mapping runIdempotentEffect's conflict kinds — the two must never drift apart.
export const IDEMPOTENCY_CONFLICT_RESPONSES = {
  "in-progress": {
    status: 409,
    body: { error: "a request with this Idempotency-Key is still in progress" },
  },
  "fingerprint-mismatch": {
    status: 422,
    body: { error: "Idempotency-Key reused with a different request payload" },
  },
} as const;

// The fingerprint must distinguish DIFFERENT requests sharing one key (ADR-0063 -> 422). The query
// string is part of the request identity on a mutating endpoint, so it is included — canonically
// sorted, so parameter order never changes the fingerprint. context.req.path EXCLUDES the query,
// which is why this builds from the full URL.
function canonicalRequestPath(requestUrl: string): string {
  const url = new URL(requestUrl);
  url.searchParams.sort();
  return url.pathname + url.search;
}

// The HTTP boundary of ADR-0063. Each mutating route declares its requirement (spec route metadata):
// required + missing header -> 400; optional + missing header -> pass through untouched. With a
// header: fingerprint the request and pre-decide — replay (stored response + Idempotency-Replayed
// header), 409 (in progress), or 422 (key reused for a different payload) WITHOUT invoking the
// handler; otherwise expose {key, fingerprint} and continue. The pre-check is advisory speed —
// runIdempotentEffect re-checks atomically at commit, so a race here is safe.
export function idempotencyMiddleware(options: {
  requirement: "required" | "optional";
  database: SqlDatabase;
  // The stored-key derivation seam (ADR-0063). By default the record is keyed by the raw client
  // header — sufficient where the table itself is tenant-isolated (the per-firm databases are,
  // physically). A SHARED table needs the tenant in the key: the control-plane convention is
  // `${firmId}:${clientKey}`, with the firm taken from AUTHENTICATED context (never client input),
  // so one tenant's key can never replay or poison another tenant's record. That presumes ordering:
  // the route's auth middleware must run BEFORE this one so the derivation can read the resolved
  // session — every realistic consumer is a per-request closure that already holds its own request
  // context, which is why the hook receives only the client key. The derived key is
  // server-internal — clients only ever see their own header, and the replay semantics
  // (Idempotency-Replayed: true) are unchanged. It is exposed as IdempotencyContext.key so the
  // handler's runIdempotentEffect commits the same row this pre-decision read.
  deriveStoredKey?: (clientKey: string) => string;
  // The conflict-response seam (same shape as deriveStoredKey): the mounting surface owns the
  // wire contract for the 409/422 pre-decision answers — the worker's routes declare RFC 9457
  // application/problem+json for these statuses, and THIS pre-decision is the common path for
  // both conflicts (the handler-race path through runIdempotentEffect is the rare one), so the
  // hook lets one problem mapping serve both. Absent, the generic JSON bodies below answer.
  conflictResponse?: (
    context: Context,
    conflict: {
      readonly kind: "in-progress" | "fingerprint-mismatch";
      readonly status: 409 | 422;
    },
  ) => Response;
}) {
  return createMiddleware<{ Variables: { idempotency?: IdempotencyContext } }>(
    async (context, next) => {
      const clientKey = context.req.header("Idempotency-Key");
      if (clientKey === undefined || clientKey === "") {
        if (options.requirement === "required") {
          return context.json({ error: "this operation requires an Idempotency-Key header" }, 400);
        }
        await next(); // optional route, no header: no record, no SQL
        return;
      }
      const key =
        options.deriveStoredKey === undefined ? clientKey : options.deriveStoredKey(clientKey);

      // Read via HonoRequest so hono caches the body for the handler's own req.json() call.
      // Downstream handlers must also read through HonoRequest methods, never context.req.raw —
      // the raw stream is consumed here. Non-JSON / empty bodies fingerprint as undefined.
      const body: unknown = await context.req.json().catch(() => undefined);
      const fingerprint = await fingerprintRequest({
        method: context.req.method,
        path: canonicalRequestPath(context.req.url),
        body,
      });

      const { results } = await selectIdempotencyRecordStatement(
        options.database,
        key,
      ).all<IdempotencyRecordRow>();
      const decision = decideIdempotency(results[0], fingerprint);

      switch (decision.kind) {
        case "replay": {
          context.header("Idempotency-Replayed", "true");
          return context.body(
            decision.responseBody ?? "",
            decision.responseCode as ContentfulStatusCode,
            { "content-type": "application/json" },
          );
        }
        case "in-progress":
        case "fingerprint-mismatch": {
          const conflict = IDEMPOTENCY_CONFLICT_RESPONSES[decision.kind];
          if (options.conflictResponse !== undefined) {
            return options.conflictResponse(context, {
              kind: decision.kind,
              status: conflict.status,
            });
          }
          return context.json(conflict.body, conflict.status);
        }
        case "execute":
          context.set("idempotency", { key, fingerprint });
          await next();
      }
    },
  );
}
