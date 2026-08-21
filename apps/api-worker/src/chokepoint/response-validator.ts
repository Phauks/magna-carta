// Dev-only response validator: parses
// outgoing JSON against the route's declared response schema and throws on divergence, so a
// handler that drifts from its contract fails loudly in `wrangler dev` and in tests — before a
// generated client ever sees the lie. Enabled only when c.env.ENVIRONMENT === "development",
// read at request time (Workers bindings are per-request); any other value (production has it
// unset) is a strict pass-through that never touches the body — no double-parse cost on the
// hot path (golden rule 10).
//
// Wiring shape (the routeMetaOf keying constraint, contracts/route-meta.ts): route identity does
// NOT survive into the library's registry or Hono's matchedRoutes, so the route's response config
// must be resolved at REGISTRATION time. createResponseValidator therefore takes the route
// definition (the defineOpenAPIRoute return) and closes the middleware over it; registration
// composes it through @hono/zod-openapi's own per-route middleware slot:
//
//   app.openapi({ ...route, middleware: [createResponseValidator(route)] }, handler)
//
// (Spreading at registration is safe: meta is resolved from the original route object before the
// spread, and the library itself rest-destructures the config anyway.)
//
// Undeclared-status policy: a 2xx status the route does
// not declare throws — success shapes are exactly what the generated clients type against. The
// 4xx/5xx problem replies (defaultHook, problemJson, the chokepoint) are NOT yet declared
// per-route; they pass unvalidated until the shared problem responses are registered. Statuses
// declared without JSON content (204, binary media types) and non-zod schemas (raw OpenAPI
// objects, $ref'd shared responses) are skipped — there is nothing to runtime-validate.
// Exact status keys only: OpenAPI range keys ("2XX") and "default" are not consulted — a route
// declaring them reads as undeclared here; revisit with the shared problem responses.
// JSON bodies are assumed finite and modest — clone().json() buffers the tee'd branch; streamed
// responses belong under non-JSON media types (which are skipped).
import type { RouteConfig } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { ZodError } from "zod";

// A contract divergence the handler produced: the operationId and status locate the route, the
// zod issues (empty for non-schema divergences such as an undeclared status) say what diverged.
// Surfaces in the `wrangler dev` console through Hono's default error handler.
export class ResponseContractDivergenceError extends Error {
  override readonly name = "ResponseContractDivergenceError";

  constructor(
    readonly operationId: string,
    readonly status: number,
    readonly issues: ZodError["issues"],
    message: string,
  ) {
    super(message);
  }
}

interface DeclaredResponseContent {
  schema?: unknown;
}

interface DeclaredResponse {
  content?: Record<string, DeclaredResponseContent>;
}

interface ZodLikeSchema {
  safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: ZodError };
}

function isZodSchema(schema: unknown): schema is ZodLikeSchema {
  return typeof (schema as { safeParse?: unknown } | null | undefined)?.safeParse === "function";
}

function isJsonMediaType(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

// The response's media type, normalized: parameters stripped, lowercased ("" when absent).
function mediaTypeOf(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function operationIdOf(route: RouteConfig): string {
  const operationId = (route as { operationId?: unknown }).operationId;
  return typeof operationId === "string" && operationId.length > 0
    ? operationId
    : `${route.method.toUpperCase()} ${route.path}`;
}

async function assertResponseMatchesContract(
  route: RouteConfig,
  response: Response,
): Promise<void> {
  const status = response.status;
  const operationId = operationIdOf(route);
  const divergencePrefix = `Response contract divergence on ${operationId} (status ${status}):`;

  const declaredResponses = route.responses as Record<string, DeclaredResponse | undefined>;
  const declared = declaredResponses[String(status)];
  if (declared === undefined) {
    if (status >= 200 && status < 300) {
      throw new ResponseContractDivergenceError(
        operationId,
        status,
        [],
        `${divergencePrefix} the handler replied with undeclared status ${status} — ` +
          `declare it in the route's responses or fix the handler.`,
      );
    }
    // Undeclared 4xx/5xx: the problem replies are not declared per-route until the shared problem
    // responses are registered — pass until then (documented scope, module header).
    return;
  }

  const content = declared.content;
  if (content === undefined) return; // declared without content (e.g. 204) — nothing to validate

  const declaredJsonMediaTypes = Object.keys(content).filter(isJsonMediaType);
  if (declaredJsonMediaTypes.length === 0) return; // declared non-JSON (binary/text) — out of scope

  const responseMediaType = mediaTypeOf(response);
  if (!isJsonMediaType(responseMediaType)) {
    throw new ResponseContractDivergenceError(
      operationId,
      status,
      [],
      `${divergencePrefix} the route declares JSON content for this status but the handler ` +
        `replied with content-type ${responseMediaType === "" ? "(none)" : responseMediaType}.`,
    );
  }

  // Prefer the declared entry matching the reply's media type (application/problem+json vs
  // application/json); fall back to the first declared JSON entry — the body shape is the
  // contract being enforced here, exact media-subtype matching is not.
  const matchedMediaType = declaredJsonMediaTypes.includes(responseMediaType)
    ? responseMediaType
    : (declaredJsonMediaTypes[0] as string);
  const schema = content[matchedMediaType]?.schema;
  if (!isZodSchema(schema)) return; // raw OpenAPI schema object — no runtime parse available

  // Clone before reading: validation must never consume the body the client receives.
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    throw new ResponseContractDivergenceError(
      operationId,
      status,
      [],
      `${divergencePrefix} the route declares JSON content for this status but the body is ` +
        `not parseable JSON.`,
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ResponseContractDivergenceError(
      operationId,
      status,
      result.error.issues,
      `${divergencePrefix} the body does not match the declared schema.\n` +
        z.prettifyError(result.error),
    );
  }
}

// The factory: takes the route definition at registration time, returns the per-route middleware.
// After the handler runs, development validates c.res against the route's declared responses;
// every other environment returns immediately — zero body reads (the test proves it with a
// body-access-spied Response).
export function createResponseValidator(
  route: RouteConfig,
): MiddlewareHandler<{ Bindings: { ENVIRONMENT?: string } }> {
  return async (c, next) => {
    await next();
    // Optional chaining matters: Hono's two-argument app.request(path, init) passes env as
    // undefined — an absent env is a pass-through, never a crash in the gate that decides
    // whether to run.
    if (c.env?.ENVIRONMENT !== "development") return;
    await assertResponseMatchesContract(route, c.res);
  };
}
