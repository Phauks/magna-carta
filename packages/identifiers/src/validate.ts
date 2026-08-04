import { TOKEN_BODY_PATTERN_SOURCE } from "./nanoid.ts";
import { ENTITY_PREFIXES, type EntityType } from "./registry.ts";
import type { BrandFor } from "./types.ts";

// The token body fragment comes from the generator seam (nanoid.ts), which owns it alongside the
// alphabet and length it mints with and pins the two together by test — so a validator can never
// accept a shape the generator cannot produce, or reject one it can, and the same fragment is what
// the telemetry scrubber exempts. One precompiled pattern per entity type, built once at module load.
// The cast is exhaustive: the entries come from ENTITY_PREFIXES, whose keys ARE EntityType, so every
// entity type has a pattern and the keyed access below is never undefined.
const HANDLE_PATTERNS = Object.fromEntries(
  Object.entries(ENTITY_PREFIXES).map(([type, prefix]) => [
    type,
    new RegExp(`^${prefix}_${TOKEN_BODY_PATTERN_SOURCE}$`),
  ]),
) as Record<EntityType, RegExp>;

// The well-formed-handle pattern for an entity type (anchored, no flags) — for consumers that need
// the shape itself, e.g. a zod `.regex()` in an API schema, so the alphabet/length are sourced from
// this package instead of hardcoded at the call site.
export function identifierPattern(type: EntityType): RegExp {
  return HANDLE_PATTERNS[type];
}

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
