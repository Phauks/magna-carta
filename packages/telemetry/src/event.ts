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

// defineEvent: the allowlist IS the builder. The declared keys are the ONLY loggable fields —
// unknown keys are rejected at the type level (the exact `fields` parameter type) and stripped at
// runtime (defense against an `as any` / cast call site). The `const` type parameter pins the key
// tuple to its literals so `Keys[number]` is the exact union of declared field names.
export function defineEvent<const Keys extends readonly string[]>(name: string, allowedKeys: Keys) {
  const allowed = new Set<string>(allowedKeys);
  const build = (
    context: EventContext,
    fields: { [K in Keys[number]]: FieldValue },
  ): TelemetryEvent => {
    const kept: Record<string, FieldValue> = {};
    for (const [key, value] of Object.entries(fields as Record<string, FieldValue>)) {
      if (allowed.has(key)) kept[key] = value;
    }
    return { name, at: context.now, correlationId: context.correlationId, fields: kept };
  };
  // The builder carries its own event name, so the catalog (EVENT_NAMES) derives from the builders
  // rather than a hand-copied parallel list that can drift (the uniqueness fitness test then checks
  // the real builders, not literals).
  return Object.assign(build, { eventName: name });
}
