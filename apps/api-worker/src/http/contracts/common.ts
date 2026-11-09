// Shared contract fragments used across route modules: the idempotency-key header and
// identifier-typed path params. The body-field twin, identifierField, lives in
// @magna-carta/identifiers/field so a domain package's contract module can declare it too.
import { z } from "@hono/zod-openapi";
import type { EntityType } from "@magna-carta/identifiers/registry";
import type { Identifier } from "@magna-carta/identifiers/types";
import { identifierField } from "@magna-carta/identifiers/field";

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
  return (identifierField(type) as unknown as z.ZodString).openapi({
    param: { name, in: "path" },
  }) as unknown as z.ZodType<Identifier<T>, string>;
}
