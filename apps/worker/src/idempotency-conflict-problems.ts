import type { Context } from "hono";
import type { IdempotentEffectResult } from "@magna-carta/data-access/run-idempotent-effect";
import { problemJson, type ProblemResponse } from "./contracts/problem.ts";

// THE kind → problem mapping for the two idempotency conflicts, shared by every
// required-idempotency route (members.invite, firms.provision) so the bodies stay identical by
// construction — and shared by BOTH paths that can answer them: the data-access middleware's
// pre-decision (its conflictResponse hook — the COMMON path) and the handler's
// runIdempotentEffect race outcomes (the rare path). The parameter is kind-only so both callers'
// shapes (the hook's {kind, status} conflict and the effect's result) satisfy it; one home,
// no drift. problemJson returns a status-typed ProblemResponse (the union of the two arms' status
// literals), preserving the narrowing zod-openapi handlers check.
export function problemResponseForIdempotencyConflict(
  c: Context,
  conflict: { readonly kind: "in-progress" | "fingerprint-mismatch" },
): ProblemResponse<409> | ProblemResponse<422> {
  if (conflict.kind === "in-progress") {
    return problemJson(c, {
      type: "idempotency-key-conflict",
      title: "Request in progress",
      status: 409,
      detail: "A request with this Idempotency-Key is still in progress.",
    });
  }
  return problemJson(c, {
    type: "idempotency-fingerprint-mismatch",
    title: "Idempotency-Key reused",
    status: 422,
    detail: "This Idempotency-Key was already used with a different request payload.",
  });
}

// The null-body guard the 201-storing routes share: a null stored body is impossible by
// construction — their effects always store a response body, and a replay returns what was
// stored. Answering a fabricated body would mask the corruption, so fail loud instead.
export function storedResponseBody(
  result: Extract<IdempotentEffectResult, { kind: "executed" | "replayed" }>,
): string {
  if (result.responseBody === null) {
    throw new Error("idempotent effect returned no stored response body on a 201-storing route");
  }
  return result.responseBody;
}
