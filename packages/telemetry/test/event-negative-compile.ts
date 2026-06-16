// Negative-compile assertions — the TYPE-level half of structural redaction. This file is never
// run; it is type-checked by `vp check` (tsconfig includes test/**/*.ts). Each @ts-expect-error
// pins a usage that MUST fail to compile — if any becomes legal, tsc flags the unused directive and
// the gate goes red. Together with event.test.ts's runtime-strip proofs, this closes both halves:
// you cannot declare a content field, and you cannot smuggle one past the type.
import { defineEvent, type FieldValue } from "../src/event.ts";

const context = { correlationId: "correlation_x", now: "2026-06-13T00:00:00.000Z" };
const build = defineEvent("test.negative", ["allowed"] as const);

// A nested object is not a FieldValue — events are flat primitives only.
// @ts-expect-error nested object is not assignable to FieldValue
build(context, { allowed: { nested: 1 } });

// An undeclared key cannot be passed — excess-property check rejects it at the call site.
// @ts-expect-error `secret` was never declared in the allowlist
build(context, { allowed: "ok", secret: "leaked" });

// A declared field is required — a partial call is a type error.
// @ts-expect-error missing the declared `allowed` field
build(context, {});

// undefined is not a FieldValue (null is the only nullish primitive allowed).
// @ts-expect-error undefined is not assignable to FieldValue
build(context, { allowed: undefined });

// A type-level sanity anchor so the import of FieldValue is load-bearing.
const _primitive: FieldValue = "ok";
void _primitive;
