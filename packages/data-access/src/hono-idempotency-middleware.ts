import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { fingerprintRequest } from "./canonical.ts";
import { decideIdempotency, type IdempotencyRecordRow } from "./idempotency-decision.ts";
import { selectIdempotencyRecordStatement, type SqlDatabase } from "./idempotency-statements.ts";

// What the middleware hands the route handler (via context.get("idempotency")) when the request must
// execute: the handler passes these straight to runIdempotentEffect, which owns the atomic commit.
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
}) {
  return createMiddleware<{ Variables: { idempotency?: IdempotencyContext } }>(
    async (context, next) => {
      const key = context.req.header("Idempotency-Key");
      if (key === undefined || key === "") {
        if (options.requirement === "required") {
          return context.json({ error: "this operation requires an Idempotency-Key header" }, 400);
        }
        await next(); // optional route, no header: no record, no SQL
        return;
      }

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
          return context.json(conflict.body, conflict.status);
        }
        case "execute":
          context.set("idempotency", { key, fingerprint });
          await next();
      }
    },
  );
}
