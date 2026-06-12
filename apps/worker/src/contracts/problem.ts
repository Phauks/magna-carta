// RFC 9457 Problem Details (design spec, error model): the one error shape platform-wide,
// extended with the observability errorId (ADR-0017/ADR-0038) and field-level errors[] for 422s.
// Ported from the Phase 0 spike (test/support/api-contract-spike-app.ts keeps its own copy — it
// guards the library, this module is the product).
import { z } from "@hono/zod-openapi";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";
import { problemType, type ProblemTypeKey } from "./problem-types";

// One field-level validation failure: path is the dot-joined location in the request body/query.
export const ProblemFieldError = z
  .object({ path: z.string(), code: z.string(), detail: z.string() })
  .openapi("ProblemFieldError");

export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    errorId: z.string(),
    instance: z.string().optional(),
    errors: z.array(ProblemFieldError).optional(),
  })
  .openapi("Problem");

export type ProblemBody = z.infer<typeof Problem>;

export interface ProblemOptions {
  type: ProblemTypeKey;
  status: ContentfulStatusCode;
  title: string;
  detail?: string;
  errors?: z.infer<typeof ProblemFieldError>[];
}

// Reply with an RFC 9457 problem document: expands the registry key to its type URI, mints a fresh
// err_ correlation id (shown to the user, maps to the redacted log — ADR-0017/ADR-0038), and stamps
// instance with the request path.
export function problemJson(c: Context, options: ProblemOptions): Response {
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
      path: issue.path.join("."),
      code: issue.code,
      detail: issue.message,
    })),
  });
}
