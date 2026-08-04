// The scrubbing backstop. A boundary pass over every STRING value that replaces denylisted shapes
// with [scrubbed] and reports whether it tripped. This is a TRIPWIRE,
// not the guarantee: the allowlist event builders (event.ts) are the defense — a non-zero trip
// count means a builder declared a field that carried content it should not have, which a test
// fails on. The Workers logger counts trips into the `telemetry.scrubbed` metric.
import { TOKEN_BODY_PATTERN_SOURCE } from "@magna-carta/identifiers/token";
import type { FieldValue, TelemetryEvent } from "./event.ts";

// Each pattern is global so every match in a field is replaced (a field may carry more than one).
// String.replace resets a global regex's lastIndex, so reusing these module-level literals is safe.
//
// The digit-shape patterns key on `(?<!\d)`/`(?!\d)` rather than `\b` wherever a separator can sit
// at the edge of the match: `\b` is a word-character boundary, so it does not exist between a space
// and `(` and would refuse to anchor a parenthesised area code at the start of a value.
const PATTERNS: readonly RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // email addresses
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN shapes
  // Card/account numbers written the way humans and payment forms actually write them: 12 to 19
  // digits carrying single space or dash separators anywhere between them. Matching on the digit
  // COUNT rather than on named groupings covers 4-4-4-4, the 4-6-5 American Express layout, 4-4-4,
  // and the 19-digit variants in one pattern, with no grouping left to be the one that got missed.
  // The unbroken-run pattern below only ever saw a card number pasted as a single uninterrupted
  // string, so the canonical separated form passed through verbatim with the tripwire silent — and
  // separated is the form a person types into the box whose error message becomes messageHead.
  /(?<!\d)\d(?:[ -]?\d){11,18}(?!\d)/g,
  // Phone numbers: an optional country code, then the 3-3-4 grouping, with the area code allowed to
  // sit in parentheses and any of space/dot/dash as the separator. A phone number is direct contact
  // information for a client or an opposing party and never belongs in a log line, but it is short
  // enough that neither the 9+ digit run nor the card groupings above ever matched it.
  /(?<!\d)(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/g,
  /\b\d{9,}\b/g, // long digit runs — account/card numbers
];

// A whole-value minted identifier handle (`<prefix>_<token body>`). These are
// opaque ids the pipeline CORRELATES on (errorId/correlationId/incidentId), never user content — so
// a value that IS one is exempt from scrubbing entirely. Without this, a token whose random body
// happens to contain a dash-flanked 9+ digit run (or an SSN-shaped substring) would be corrupted to
// [scrubbed], destroying the very Error ID the 500 is keyed by and firing a spurious trip. The
// `-`/`_` in the url-safe alphabet create the word boundaries the digit-run/SSN patterns key on, so
// "handles mix letters" was not actually a safe guarantee; this exemption is. The body fragment is
// sourced from the identifier generator seam so the length and alphabet are stated in exactly one
// place — a longer token would otherwise stop being recognised here and start being mangled.
const OPAQUE_HANDLE = new RegExp(`^[a-z]+_${TOKEN_BODY_PATTERN_SOURCE}$`);

const REPLACEMENT = "[scrubbed]";

export interface ScrubResult {
  readonly event: TelemetryEvent;
  readonly trips: ReadonlyArray<{ readonly field: string }>;
}

export interface ScrubbedText {
  readonly text: string;
  readonly tripped: boolean;
}

// The single-value primitive: the denylist pass over one string, plus whether anything changed.
// Both emission paths run through it — event string fields on their way to the log line, and metric
// dimension values on their way to Analytics Engine — so a pattern added here covers both at once.
export function scrubText(value: string): ScrubbedText {
  if (OPAQUE_HANDLE.test(value)) {
    // A minted handle (an opaque correlation/error/incident id) — never content; leave it intact.
    return { text: value, tripped: false };
  }
  let scrubbed = value;
  for (const pattern of PATTERNS) {
    scrubbed = scrubbed.replace(pattern, REPLACEMENT);
  }
  return { text: scrubbed, tripped: scrubbed !== value };
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
    const { text, tripped } = scrubText(value);
    if (tripped) trips.push({ field: key });
    fields[key] = text;
  }
  return { event: { ...event, fields }, trips };
}
