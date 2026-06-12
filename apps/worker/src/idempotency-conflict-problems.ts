import type { Context } from "hono";
import type { IdempotentEffectResult } from "@magna-carta/data-access/run-idempotent-effect";
import { PROBLEM_CONTENT_TYPE, PROBLEM_TYPES, problemBody } from "./problem.ts";

// The kind → problem mapping for runIdempotentEffect's two conflict outcomes, shared by every
// required-idempotency route (members.invite, firms.provision) so the bodies stay identical by
// construction. These kinds only reach a handler on a race the middleware pre-check missed —
// the middleware's own kind → status mapping is mirrored here, problem-shaped for this surface.
// Like problem.ts's helpers, the return type is INFERRED (the two c.json typed responses): an
// explicit `Response` annotation would erase the status typing zod-openapi handlers check.
export function problemResponseForIdempotencyConflict(
  c: Context,
  result: Extract<IdempotentEffectResult, { kind: "in-progress" | "fingerprint-mismatch" }>,
) {
  if (result.kind === "in-progress") {
    return c.json(
      problemBody({
        type: PROBLEM_TYPES.conflict,
        title: "Request in progress",
        status: 409,
        detail: "A request with this Idempotency-Key is still in progress.",
        instance: c.req.path,
      }),
      409,
      PROBLEM_CONTENT_TYPE,
    );
  }
  return c.json(
    problemBody({
      type: PROBLEM_TYPES.validation,
      title: "Idempotency-Key reused",
      status: 422,
      detail: "This Idempotency-Key was already used with a different request payload.",
      instance: c.req.path,
    }),
    422,
    PROBLEM_CONTENT_TYPE,
  );
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
