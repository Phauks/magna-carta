import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

// RFC 9457 Problem Details (docs/conventions/api.md), extended with the observability errorId
// (ADR-0017/0038). DELIBERATE SEAM: slice 0·5 builds the platform problem module — the type-URI
// registry, the contracts/common schema home, and the app-level defaultHook for 422 validation
// problems. This file stays exactly as big as the slice 0·4 handlers need and is replaced
// wholesale by that module.
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    errorId: z.string(),
    instance: z.string().optional(),
  })
  .openapi("Problem");

export type ProblemBody = z.infer<typeof Problem>;

// Problem type URIs are a registry (api.md); these are the slice 0·4 entries.
export const PROBLEM_TYPES = {
  unauthenticated: "https://api.magnacarta.esq/problems/unauthenticated",
  forbidden: "https://api.magnacarta.esq/problems/forbidden",
  notFound: "https://api.magnacarta.esq/problems/not-found",
  conflict: "https://api.magnacarta.esq/problems/conflict",
  // invalid-request is the malformed-request 400 (e.g. a missing required header); validation is
  // the semantically-rejected 422 (api.md: Zod failures land here once the 0·5 defaultHook exists).
  invalidRequest: "https://api.magnacarta.esq/problems/invalid-request",
  validation: "https://api.magnacarta.esq/problems/validation",
} as const;

// The headers argument for c.json on every problem response.
export const PROBLEM_CONTENT_TYPE = { "content-type": "application/problem+json" } as const;

const ERROR_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

// The short user-facing correlation id (docs/conventions/error-logging.md). The full Error ID
// pipeline (capture + redacted-trace correlation) is slice 0·6 telemetry; minting the id now
// means every problem response already carries the stable string that pipeline correlates by.
// Modulo bias is acceptable: this is a correlation token, not a secret.
export function newErrorId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let token = "";
  for (const byte of bytes) token += ERROR_ID_ALPHABET[byte % ERROR_ID_ALPHABET.length];
  return `err_${token}`;
}

export function problemBody(input: {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
}): ProblemBody {
  return { errorId: newErrorId(), ...input };
}

// Shared response helpers for the problem shapes more than one handler answers with — the
// bodies stay identical across routes by construction.

export function unauthenticatedProblemResponse(c: Context) {
  return c.json(
    problemBody({
      type: PROBLEM_TYPES.unauthenticated,
      title: "Authentication required",
      status: 401,
      detail: "Sign in to call this endpoint.",
      instance: c.req.path,
    }),
    401,
    PROBLEM_CONTENT_TYPE,
  );
}

export function forbiddenProblemResponse(c: Context) {
  return c.json(
    problemBody({
      type: PROBLEM_TYPES.forbidden,
      title: "Permission denied",
      status: 403,
      instance: c.req.path,
    }),
    403,
    PROBLEM_CONTENT_TYPE,
  );
}

// ADR-0052: a firm (or firm-scoped resource) this deployment cannot reach is ABSENT — 404,
// never a 500 and never an existence oracle.
export function notFoundProblemResponse(c: Context) {
  return c.json(
    problemBody({
      type: PROBLEM_TYPES.notFound,
      title: "Not found",
      status: 404,
      instance: c.req.path,
    }),
    404,
    PROBLEM_CONTENT_TYPE,
  );
}
