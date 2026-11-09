// Negative-compile assertions for problemJson's status domain: exercised by the typechecker
// (pnpm check), not by Vitest — the pattern from problem-type-keys.ts. problemJson is the
// platform-wide error-reply path, so a non-error status must be a compile error, not a runtime bug.
import type { Context } from "hono";
import { problemJson } from "../../src/http/contracts/problem";

declare const c: Context;

export function rejectsSuccessStatus(): Response {
  return problemJson(c, {
    type: "not-found",
    // @ts-expect-error - 200 is not an error status; problemJson accepts 4xx/5xx only
    status: 200,
    title: "Not an error",
  });
}

// POSITIVE controls: client-error and server-error statuses compile.
export function acceptsClientErrorStatus(): Response {
  return problemJson(c, { type: "not-found", status: 404, title: "Matter not found" });
}

export function acceptsServerErrorStatus(): Response {
  return problemJson(c, { type: "rate-limited", status: 503, title: "Service unavailable" });
}
