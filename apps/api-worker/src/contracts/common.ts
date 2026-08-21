// Shared contract fragments used across route modules: the idempotency-key header and
// identifier-typed path params.
import { z } from "@hono/zod-openapi";
import type { EntityType } from "@magna-carta/identifiers/registry";
import type { Identifier } from "@magna-carta/identifiers/types";
import { identifierPattern } from "@magna-carta/identifiers/validate";

// The Idempotency-Key request-header fragment, for `request.headers` on mutating routes.
// The key MUST stay lowercase: @hono/zod-openapi matches header schema keys case-sensitively
// against the incoming header map, which Hono lowercases — an uppercase key here would never
// match a real request (the documented library gotcha).
// The value is optional at the schema layer: presence on idempotency-required routes is
// enforced by the chokepoint idempotency middleware, which replies with the registered
// idempotency-key-missing problem — a required schema key would preempt that with a generic 422.
export const idempotencyKeyHeader = z.object({
  "idempotency-key": z.string().min(1).optional(),
});

// A path-param fragment for an identifier-typed segment: validates the well-formed-handle shape
// for the entity type (pattern sourced from @magna-carta/identifiers, never hardcoded) and types
// the parsed value as the entity's branded identifier. The brand is compile-time only — the
// runtime schema is a plain pattern-checked string, which emits cleanly.
// `name` must match the key the caller binds in the params object:
// `z.object({ matterId: identifierPathParam("matter", "matterId") })`. A mismatch between the
// schema-level `param.name` and the binding object key fails loud with a ConflictError at
// document-emission time (zod-to-openapi behavior, pinned in common.test.ts) — never a silently
// wrong document.
export function identifierPathParam<T extends EntityType>(
  type: T,
  name: string,
): z.ZodType<Identifier<T>, string> {
  return z
    .string()
    .regex(identifierPattern(type))
    .openapi({ param: { name, in: "path" } }) as unknown as z.ZodType<Identifier<T>, string>;
}

// A request-BODY field carrying an identifier-typed handle: the same well-formed-handle pattern check
// as identifierPathParam, branded to the entity's identifier so a handler can pass it straight to a
// domain service that demands the branded type — without the path-param `.openapi({ param })` (a body
// field is not a path parameter). Emits as a plain constrained string (the brand is compile-time only).
export function identifierField<T extends EntityType>(type: T): z.ZodType<Identifier<T>, string> {
  return z.string().regex(identifierPattern(type)) as unknown as z.ZodType<Identifier<T>, string>;
}
