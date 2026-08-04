// The telemetry event model. Redaction is STRUCTURAL: an event is built only through a typed
// allowlist builder whose schema enumerates exactly the loggable fields. A field that was never
// declared has no slot to be logged in — rejected at the type level and stripped at runtime. This
// is the primary redact-by-default defense; the scrubber (scrub.ts) is only a backstop.

// Field values are flat primitives — no nested objects. With no structure to recurse into, the
// allowlist is airtight and the Analytics Engine / Logpush consumers stay simple. A builder that
// needs structure is a design smell: add explicit fields instead.
export type FieldValue = string | number | boolean | null;

export interface TelemetryEvent {
  readonly name: string;
  readonly at: string; // ISO-8601 UTC instant
  readonly correlationId: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

// The context every event is stamped with: the per-request correlation id and the build instant
// (injected, never read from a wall clock here — keeps the builder pure and testable).
export interface EventContext {
  readonly correlationId: string;
  readonly now: string;
}

// The placeholder a value that is not a flat primitive is replaced with. Declared fields are TYPED
// FieldValue, but a call site that reaches a builder through `any` — a parsed request body, a caught
// error's payload, a row straight off a query — can still hand over an object or an array. Stripping
// undeclared KEYS never touched those: the value sat in a declared slot, so it survived to the log
// line, where JSON.stringify serialised the whole nested structure verbatim. The scrubber cannot
// help either, since it only walks string values. So the value class is enforced here, at the same
// boundary as the key allowlist: anything that is not a string, number, boolean, or null is
// replaced outright rather than serialised, because there is no way to know what a smuggled object
// contains. The Workers logger (workers-logger.ts) counts each occurrence, so the offending call
// site shows up as a metric instead of failing silently. A bigint or a symbol would additionally
// have thrown inside JSON.stringify, taking the emit down with it.
export const UNLOGGABLE_VALUE = "[unloggable]";

function asFieldValue(value: unknown): FieldValue {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") return value as FieldValue;
  return UNLOGGABLE_VALUE;
}

// defineEvent: the allowlist IS the builder. The declared keys are the ONLY loggable fields —
// unknown keys are rejected at the type level (the exact `fields` parameter type) and stripped at
// runtime (defense against an `as any` / cast call site). The same cast defense applies to the
// VALUES: each one is forced back to a flat primitive on the way in, so a declared slot cannot be
// used to smuggle a structure past the allowlist. The `const` type parameter pins the key tuple to
// its literals so `Keys[number]` is the exact union of declared field names.
export function defineEvent<const Keys extends readonly string[]>(name: string, allowedKeys: Keys) {
  const allowed = new Set<string>(allowedKeys);
  const build = (
    context: EventContext,
    fields: { [K in Keys[number]]: FieldValue },
  ): TelemetryEvent => {
    const kept: Record<string, FieldValue> = {};
    for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
      if (allowed.has(key)) kept[key] = asFieldValue(value);
    }
    return { name, at: context.now, correlationId: context.correlationId, fields: kept };
  };
  // The builder carries its own event name, so the catalog (EVENT_NAMES) derives from the builders
  // rather than a hand-copied parallel list that can drift (the uniqueness fitness test then checks
  // the real builders, not literals).
  return Object.assign(build, { eventName: name });
}
