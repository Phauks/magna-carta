import { createMiddleware } from "hono/factory";
import { fingerprintRequest } from "./canonical.ts";
import { decideIdempotency, type IdempotencyRecordRow } from "./idempotency-decision.ts";
import { selectIdempotencyRecordStatement, type SqlDatabase } from "./idempotency-statements.ts";

// What the middleware hands the route handler (via context.get("idempotency")) when the request must
// execute: the handler passes these straight to runIdempotentEffect, which owns the atomic commit.
export interface IdempotencyContext {
  readonly key: string;
  readonly fingerprint: string;
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

      const body: unknown = await context.req.raw
        .clone()
        .json()
        .catch(() => undefined); // non-JSON / empty bodies fingerprint as undefined
      const fingerprint = await fingerprintRequest({
        method: context.req.method,
        path: context.req.path,
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
          return context.body(decision.responseBody ?? "", decision.responseCode as never, {
            "content-type": "application/json",
          });
        }
        case "in-progress":
          return context.json(
            { error: "a request with this Idempotency-Key is still in progress" },
            409,
          );
        case "fingerprint-mismatch":
          return context.json(
            { error: "Idempotency-Key reused with a different request payload" },
            422,
          );
        case "execute":
          context.set("idempotency", { key, fingerprint });
          await next();
      }
    },
  );
}
