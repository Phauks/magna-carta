// RFC 9457 Problem Details: the one error shape platform-wide, extended with the observability
// errorId and field-level errors[] for 422s.
import { z } from "@hono/zod-openapi";
import { identifierPattern } from "@magna-carta/identifiers/validate";
import { newErrorId } from "@magna-carta/telemetry/ids";
import type { Context, TypedResponse } from "hono";
import type { ClientErrorStatusCode, ServerErrorStatusCode } from "hono/utils/http-status";
import type { JSONParsed } from "hono/utils/types";
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
// so status is pinned to the 4xx/5xx range and errorId to the error_ handle shape the
// @magna-carta/identifiers generator actually emits.
export const Problem = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string().optional(),
    errorId: z.string().regex(identifierPattern("error")),
    // The per-request correlation id (correlation_) the telemetry middleware mints and rides on every event.
    // Stamped on every problem reply so a user-visible failure joins its redacted server trace.
    // Optional in the schema because a problem built outside a request context (none today) would
    // have none.
    correlationId: z.string().optional(),
    instance: z.string().optional(),
    errors: z.array(ProblemFieldError).optional(),
    // Within-firm denial seam: a typed optional extension (NOT an open passthrough), set
    // only on the chokepoint's 403 to signal the trusted-insider may request a grant. The
    // request→grant flow is out of scope this slice — this field is the wire seam for it. Kept a
    // strict boolean so a non-boolean is rejected, never coerced.
    requestAccess: z.boolean().optional(),
    // Forward seam: set on the malware-flagged 409 when the firm has step-up re-auth enabled for
    // flagged downloads. The actual challenge (recent-auth check) is wired in a later auth slice;
    // the flag is present now so clients can show a re-auth prompt as soon as it lands.
    stepUpRequired: z.boolean().optional(),
    // The attempt budget, set on a throttled reply and on a refused credential-shaped attempt. A
    // bare "too many requests" leaves a surface that wants to warn before the wall with nothing to
    // say, so the two numbers behind the wording ride the problem itself: how many attempts are
    // left, and how long the refusal stands. Both are whole non-negative integers; both are absent
    // rather than zero when the reply is not about a budget at all.
    attemptsRemaining: z.number().int().min(0).optional(),
    retryAfterSeconds: z.number().int().min(0).optional(),
  })
  .openapi("Problem");

export type ProblemBody = z.infer<typeof Problem>;

export interface ProblemOptions {
  type: ProblemTypeKey;
  status: ProblemStatusCode;
  title: string;
  detail?: string;
  errors?: z.infer<typeof ProblemFieldError>[];
  // Emitted into the body only when set (the chokepoint sets it true on its 403). A
  // typed optional, not an open extension bag — the only extension this slice admits.
  requestAccess?: boolean;
  // See stepUpRequired on Problem above. Emitted into the body only when set (true) — the
  // download handler sets it when the firm has step-up re-auth enabled for flagged downloads.
  stepUpRequired?: boolean;
  // See attemptsRemaining / retryAfterSeconds on Problem above. Emitted only when set, so a
  // problem that is not about a budget carries neither.
  attemptsRemaining?: number;
  retryAfterSeconds?: number;
  // An already-minted error_ handle to stamp into the body instead of minting a fresh one. The
  // caller wants the SAME Error ID it has already correlated elsewhere — e.g. the platform-admin
  // guard logs a denial cause against the id it then returns to the client (reworked onto the
  // telemetry pipeline in slice 0·6). Defaults to a fresh mint when omitted.
  errorId?: string;
}

// The precisely-typed reply problemJson returns: a Response that ALSO carries the status literal in
// its TypedResponse phantom, so a `return problemJson(c, { status: 409, … })` typechecks against an
// `app.openapi` route declaring `409: Problem` (@hono/zod-openapi keys the handler's accepted
// responses on the status literal). `c.json(body, status)` already produces exactly
// `Response & TypedResponse<JSONParsed<ProblemBody>, S, "json">`; mirroring that here — generic over
// the status literal S — preserves the narrowing a bare `: Response` annotation would erase. The
// `application/problem+json` content-type rides in the runtime headers; zod-openapi matches the
// declared response on status, and accepts the `"json"` format against a
// `application/problem+json` declaration.
export type ProblemResponse<S extends ProblemStatusCode> = Response &
  TypedResponse<JSONParsed<ProblemBody>, S, "json">;

// Reply with an RFC 9457 problem document: expands the registry key to its type URI, mints a fresh
// error_ correlation id (shown to the user, maps to the redacted log), and stamps
// instance with the request path. Generic over the status literal so the returned response stays
// status-typed for `app.openapi` handlers (see ProblemResponse).
export function problemJson<S extends ProblemStatusCode>(
  c: Context,
  options: ProblemOptions & { status: S },
): ProblemResponse<S> {
  // Defense-in-depth (matches the definition-time-guard philosophy): the platform-wide error path
  // must never emit a 2xx/3xx "problem." status is typed to the 4xx/5xx range, so a caller reaching
  // a non-error status has cast around the type; fail loudly rather than emit a contradictory reply.
  if (!Number.isInteger(options.status) || options.status < 400 || options.status > 599) {
    throw new RangeError(
      `problemJson called with status ${String(options.status)} — a problem reply must be in the ` +
        `4xx/5xx range (400–599); the error path never emits a 2xx/3xx problem.`,
    );
  }
  // The telemetry middleware (installed first) stashes the per-request correlation id; stamp it so
  // the problem joins its redacted server trace. Read defensively (unknown context type) — absent
  // only outside a request, which no caller is today.
  const correlationId = c.get("correlationId") as string | undefined;
  const body: ProblemBody = {
    type: problemType(options.type),
    title: options.title,
    status: options.status,
    ...(options.detail !== undefined && { detail: options.detail }),
    errorId: options.errorId ?? newErrorId(),
    ...(correlationId !== undefined && { correlationId }),
    instance: c.req.path,
    ...(options.errors !== undefined && { errors: options.errors }),
    ...(options.requestAccess !== undefined && { requestAccess: options.requestAccess }),
    ...(options.stepUpRequired !== undefined && { stepUpRequired: options.stepUpRequired }),
    ...(options.attemptsRemaining !== undefined && {
      attemptsRemaining: options.attemptsRemaining,
    }),
    ...(options.retryAfterSeconds !== undefined && {
      retryAfterSeconds: options.retryAfterSeconds,
    }),
  };
  return c.json(body, options.status, {
    "content-type": "application/problem+json",
  }) as ProblemResponse<S>;
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
