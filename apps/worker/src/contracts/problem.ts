// RFC 9457 Problem Details (design spec, error model): the one error shape platform-wide,
// extended with the observability errorId (ADR-0017/ADR-0038) and field-level errors[] for 422s.
// Ported from the Phase 0 spike (test/support/api-contract-spike-app.ts keeps its own copy — it
// guards the library, this module is the product).
import { z } from "@hono/zod-openapi";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import type { Context } from "hono";
import type { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";
import { problemType, type ProblemTypeKey } from "./problem-types";

// This module replies with errors only, so only 4xx/5xx are representable — a 200 problem is a
// compile error (negative-compile assertions: test/contracts/problem-status.ts).
export type ProblemStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;

// One field-level validation failure: path is the dot-joined location in the request body/query
// (e.g. "client.address.postcode"). A top-level failure (empty Zod issue path — the whole body is
// wrong, e.g. a non-object) is normalized to "$", never the empty string.
export const ProblemFieldError = z
  .object({ path: z.string(), code: z.string(), detail: z.string() })
  .openapi("ProblemFieldError");

// Documents and validates error replies only (this schema feeds the dev-only response validator),
// so status is pinned to the 4xx/5xx range and errorId to the err_ handle shape the
// @magna-carta/identifiers generator actually emits.
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string().optional(),
    errorId: z.string().regex(identifierPattern("error")),
    instance: z.string().optional(),
    errors: z.array(ProblemFieldError).optional(),
  })
  .openapi("Problem");

export type ProblemBody = z.infer<typeof Problem>;

export interface ProblemOptions {
  type: ProblemTypeKey;
  status: ProblemStatusCode;
  title: string;
  detail?: string;
  errors?: z.infer<typeof ProblemFieldError>[];
}

// Reply with an RFC 9457 problem document: expands the registry key to its type URI, mints a fresh
// err_ correlation id (shown to the user, maps to the redacted log — ADR-0017/ADR-0038), and stamps
// instance with the request path.
export function problemJson(c: Context, options: ProblemOptions): Response {
  // Defense-in-depth (matches the definition-time-guard philosophy): the platform-wide error path
  // must never emit a 2xx/3xx "problem." status is typed to the 4xx/5xx range, so a caller reaching
  // a non-error status has cast around the type; fail loudly rather than emit a contradictory reply.
  if (!Number.isInteger(options.status) || options.status < 400 || options.status > 599) {
    throw new RangeError(
      `problemJson called with status ${String(options.status)} — a problem reply must be in the ` +
        `4xx/5xx range (400–599); the error path never emits a 2xx/3xx problem.`,
    );
  }
  const body: ProblemBody = {
    type: problemType(options.type),
    title: options.title,
    status: options.status,
    ...(options.detail !== undefined && { detail: options.detail }),
    errorId: newIdentifier("error"),
    instance: c.req.path,
    ...(options.errors !== undefined && { errors: options.errors }),
  };
  return c.json(body, options.status, { "content-type": "application/problem+json" });
}

// The app-level defaultHook for OpenAPIHono: maps every Zod request-validation failure to the
// 422 problem shape with field-level errors[]. Pass to `new OpenAPIHono({ defaultHook })`.
export function defaultHook(
  result: { success: true } | { success: false; error: ZodError },
  c: Context,
): Response | undefined {
  if (result.success) return undefined;
  return problemJson(c, {
    type: "validation",
    status: 422,
    title: "Validation failed",
    errors: result.error.issues.map((issue) => ({
      // An empty issue path means the whole body failed (e.g. a non-object): "$", not "".
      // Coerce each segment with String(): a symbol segment (from a future z.map/z.record with
      // symbol keys) would throw "Cannot convert a Symbol value to a string" in a bare join(),
      // collapsing the 422 into an unhandled 500.
      path: issue.path.length === 0 ? "$" : issue.path.map(String).join("."),
      code: issue.code,
      detail: issue.message,
    })),
  });
}
