// The scrubbing backstop (spec §1, decided #3). A boundary pass over every STRING field that
// replaces denylisted shapes with [scrubbed] and reports which fields tripped. This is a TRIPWIRE,
// not the guarantee: the allowlist event builders (event.ts) are the defense — a non-zero trip
// count means a builder declared a field that carried content it should not have, which a test
// fails on. The Workers logger counts trips into the `telemetry.scrubbed` metric.
import type { FieldValue, TelemetryEvent } from "./event.ts";

// Each pattern is global so every match in a field is replaced (a field may carry more than one).
// String.replace resets a global regex's lastIndex, so reusing these module-level literals is safe.
const PATTERNS: readonly RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // email addresses
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN shapes
  /\b\d{9,}\b/g, // long digit runs — account/card numbers
];

// A whole-value minted identifier handle (`<prefix>_<21 url-safe chars>`, ADR-0062). These are
// opaque ids the pipeline CORRELATES on (errorId/correlationId/incidentId), never user content — so
// a value that IS one is exempt from scrubbing entirely. Without this, a token whose random body
// happens to contain a dash-flanked 9+ digit run (or an SSN-shaped substring) would be corrupted to
// [scrubbed], destroying the very Error ID the 500 is keyed by and firing a spurious trip. The
// `-`/`_` in the url-safe alphabet create the word boundaries the digit-run/SSN patterns key on, so
// "handles mix letters" was not actually a safe guarantee; this exemption is.
const OPAQUE_HANDLE = /^[a-z]+_[A-Za-z0-9_-]{21}$/;

const REPLACEMENT = "[scrubbed]";

export interface ScrubResult {
  readonly event: TelemetryEvent;
  readonly trips: ReadonlyArray<{ readonly field: string }>;
}

// Returns a FRESH event (never mutates the input) with string fields scrubbed, plus one trip per
// field that changed. Non-string values pass through untouched.
export function scrubStrings(event: TelemetryEvent): ScrubResult {
  const trips: Array<{ field: string }> = [];
  const fields: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(event.fields)) {
    if (typeof value !== "string") {
      fields[key] = value;
      continue;
    }
    if (OPAQUE_HANDLE.test(value)) {
      // A minted handle (an opaque correlation/error/incident id) — never content; leave it intact.
      fields[key] = value;
      continue;
    }
    let scrubbed = value;
    for (const pattern of PATTERNS) {
      scrubbed = scrubbed.replace(pattern, REPLACEMENT);
    }
    if (scrubbed !== value) trips.push({ field: key });
    fields[key] = scrubbed;
  }
  return { event: { ...event, fields }, trips };
}
