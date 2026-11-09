import { z } from "zod";
import type { EntityType } from "./registry.ts";
import type { Identifier } from "./types.ts";
import { identifierPattern } from "./validate.ts";

// A request-body field carrying an identifier-typed handle: the well-formed-handle pattern check for
// the entity type (the pattern is this package's, never restated), typed as the entity's branded
// identifier so a handler can pass the parsed value straight to a domain service that demands the
// brand. The brand is compile-time only — the runtime schema is a plain pattern-checked string, which
// emits into a contract as exactly that. Lives here rather than in the worker's contract helpers
// because a domain package's contract module (packages/<domain>/src/contract.ts) declares body shapes
// too, and a package cannot import the worker.
export function identifierField<T extends EntityType>(type: T): z.ZodType<Identifier<T>, string> {
  return z.string().regex(identifierPattern(type)) as unknown as z.ZodType<Identifier<T>, string>;
}
