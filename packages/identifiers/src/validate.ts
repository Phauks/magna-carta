import { TOKEN_SIZE } from "./nanoid.ts";
import { ENTITY_PREFIXES, type EntityType } from "./registry.ts";
import type { BrandFor } from "./types.ts";

// The token character class is the URL-safe set (A-Za-z0-9_-) the generator's alphabet draws from.
// A test (registry/seam conformance) asserts every character of the seam's TOKEN_ALPHABET falls in this
// class, so the two cannot drift. One precompiled pattern per entity type — built once at module load.
const HANDLE_PATTERNS = Object.fromEntries(
  Object.entries(ENTITY_PREFIXES).map(([type, prefix]) => [
    type,
    new RegExp(`^${prefix}_[A-Za-z0-9_-]{${TOKEN_SIZE}}$`),
  ]),
) as Record<EntityType, RegExp>;

// Type guard: is `value` a well-formed handle for entity `type`? Narrows an untrusted value to the brand.
export function isIdentifier<T extends EntityType>(value: unknown, type: T): value is BrandFor<T> {
  return typeof value === "string" && HANDLE_PATTERNS[type].test(value);
}

// Throwing narrower for the common "reject bad input" path (e.g. a URL param). The caller's error
// middleware maps the throw to a 400; here we only fail loud with a clear message.
export function assertIdentifier<T extends EntityType>(value: unknown, type: T): BrandFor<T> {
  if (!isIdentifier(value, type)) {
    const shown = typeof value === "string" ? JSON.stringify(value) : typeof value;
    throw new TypeError(`not a valid ${type} identifier: ${shown}`);
  }
  return value;
}
