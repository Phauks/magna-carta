import {
  decimalStringFromScaledInteger,
  isDecimalString,
  rescaleStoredInteger,
  scaledIntegerFromDecimalString,
} from "./number-scale.ts";
import type { CustomFieldKind } from "./types.ts";

// The value as read from the populated storage column. Each variant carries
// only the field(s) relevant to its kind family, matching the DB column layout.
export type RawStoredValue =
  | { kind: "single-line" | "multi-line" | "url" | "email"; text: string }
  | { kind: "number" | "currency"; number: number }
  | { kind: "date" | "time"; date: string }
  | { kind: "checkbox"; checkbox: number }
  | { kind: "picklist"; optionLabel: string };

// The target storage column and the value that will be written after coercion.
export type CoercedValue =
  | { column: "value_text"; text: string }
  | { column: "value_number"; number: number }
  | { column: "value_date"; date: string };

// The outcome of classifying a single value for a kind change.
//   clean      — coercion is mechanical; coerced holds the ready value.
//   needs-rule — requires an admin-confirmed rule before the value can move.
//   parked     — no automatic path; the value is held aside for manual review.
export type Classification =
  | { outcome: "clean"; coerced: CoercedValue }
  | { outcome: "needs-rule" }
  | { outcome: "parked" };

// The minor-unit exponents the two sides of a coercion are expressed at (see number-scale.ts): `from`
// is the scale the stored value already carries, `to` the scale the target kind stores at. They differ
// whenever a kind change crosses scale semantics — a plain number (whole units) retyped to currency
// (cents) is the common case — and a coercion that ignored them would shift the value by a power of
// ten. Both are required so no caller can classify a numeric value without stating what its digits
// mean.
export interface CoercionScale {
  readonly from: number;
  readonly to: number;
}

// The rule supplied by the caller when the classification returned needs-rule.
//   magnitude    — multiply the numeric prefix by the k/M/B suffix.
//   create-option — the text becomes a new picklist option with a given label.
export type CoercionRule = { kind: "magnitude" } | { kind: "create-option"; label: string };

// The result of applying a rule. For magnitude coercions the result is a
// CoercedValue. For create-option it is an action descriptor so the caller
// can create the option before recording the field value.
export type RuleResult = CoercedValue | { action: "create-option"; label: string };

// ── internal helpers ──────────────────────────────────────────────────────────

const TEXT_KINDS: ReadonlySet<CustomFieldKind> = new Set<CustomFieldKind>([
  "single-line",
  "multi-line",
  "url",
  "email",
]);

// Numeric prefix with optional decimal, optional whitespace, then k/K/m/M/b/B.
const MAGNITUDE_PATTERN = /^-?\d+(\.\d+)?\s*[kKmMbB]$/;

// ISO date prefix — accepts 2025-01-15 or 2025-01-15T14:30:00Z etc.
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

// How many decimal places each magnitude suffix shifts the numeric prefix by. Expressed as an
// exponent, not a multiplier, so the shift composes with the target scale as one exact decimal move.
const MAGNITUDE_EXPONENTS: Record<string, number> = { k: 3, m: 6, b: 9 };

// Coerce the raw value to a string for use when targeting text-family kinds. A numeric value renders
// as the decimal a person would recognize at the scale it is stored at — 50000 held at scale 2 reads
// as "500.00", not "50000" — so retyping to text and back is lossless.
function asText(value: RawStoredValue, fromScale: number): string {
  if ("text" in value) return value.text;
  if ("optionLabel" in value) return value.optionLabel;
  if ("number" in value) return decimalStringFromScaledInteger(value.number, fromScale);
  if ("date" in value) return value.date;
  return String(value.checkbox);
}

// The integer a numeric-family raw value holds, or null for a text/date/picklist source.
function storedInteger(value: RawStoredValue): number | null {
  if ("number" in value) return value.number;
  if ("checkbox" in value) return value.checkbox;
  return null;
}

// Produce a CoercedValue for same-kind (trivial) coercions.
function trivialCoercion(value: RawStoredValue): CoercedValue {
  if ("text" in value) return { column: "value_text", text: value.text };
  if ("number" in value) return { column: "value_number", number: value.number };
  if ("date" in value) return { column: "value_date", date: value.date };
  if ("optionLabel" in value) return { column: "value_text", text: value.optionLabel };
  return { column: "value_number", number: value.checkbox };
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Classify whether a stored value can move cleanly from `fromKind` to
 * `toKind`, requires an admin-confirmed rule, or must be parked for manual
 * review.
 *
 * `scale` states the minor-unit exponents of both sides: a value only keeps its
 * magnitude across a kind change if the coercion re-expresses it at the target's
 * scale, and a re-expression that cannot be made exactly parks rather than
 * rounds.
 *
 * Pure function — no database access, no side effects.
 */
export function classifyCoercion(
  value: RawStoredValue,
  fromKind: CustomFieldKind,
  toKind: CustomFieldKind,
  scale: CoercionScale,
): Classification {
  // Trivial: same kind, no transformation (a field keeps its number_scale across a retype, so the
  // two scales are the same value here).
  if (fromKind === toKind) {
    return { outcome: "clean", coerced: trivialCoercion(value) };
  }

  // Any target in the text family: stringify the source value at the scale it is stored at.
  if (TEXT_KINDS.has(toKind)) {
    return {
      outcome: "clean",
      coerced: { column: "value_text", text: asText(value, scale.from) },
    };
  }

  // → number or → currency. A numeric source (number/currency/checkbox) already holds an integer, so
  // it is re-expressed at the target's scale — 500 whole units becoming 50000 cents — and parks when
  // the move would lose a fraction the target cannot hold. A text or picklist source holds what a
  // person typed, so its decimal is read at the target's scale directly.
  if (toKind === "number" || toKind === "currency") {
    const stored = storedInteger(value);
    if (stored !== null) {
      const rescaled = rescaleStoredInteger(stored, scale.from, scale.to);
      return rescaled === null
        ? { outcome: "parked" }
        : { outcome: "clean", coerced: { column: "value_number", number: rescaled } };
    }
    const stripped = asText(value, scale.from).replaceAll(",", "").replace(/^\$/, "").trim();
    if (isDecimalString(stripped)) {
      const scaled = scaledIntegerFromDecimalString(stripped, scale.to);
      return scaled === null
        ? { outcome: "parked" }
        : { outcome: "clean", coerced: { column: "value_number", number: scaled } };
    }
    if (MAGNITUDE_PATTERN.test(stripped)) {
      return { outcome: "needs-rule" };
    }
    return { outcome: "parked" };
  }

  // → picklist: every distinct value becomes an option the admin confirms.
  if (toKind === "picklist") {
    return { outcome: "needs-rule" };
  }

  // → date or → time from a text source: only an ISO-shaped string is clean.
  if (toKind === "date" || toKind === "time") {
    const text = asText(value, scale.from).trim();
    if (ISO_DATE_PREFIX.test(text)) {
      return { outcome: "clean", coerced: { column: "value_date", date: text } };
    }
    return { outcome: "parked" };
  }

  return { outcome: "parked" };
}

/**
 * Apply an admin-confirmed rule to a value that `classifyCoercion` returned
 * `needs-rule` for.
 *
 * - `magnitude` rule: shift the numeric prefix by the k/M/B suffix and express
 *   the result at `toScale`, the target field's minor-unit exponent — "4.25M" on
 *   a currency field in cents is 425000000, not 4250000.
 * - `create-option` rule: the caller creates the option before writing the value;
 *   this function returns the action descriptor so the caller can sequence that.
 *
 * Pure function — no database access, no side effects.
 */
export function coerceWithRule(
  value: RawStoredValue,
  toKind: CustomFieldKind,
  rule: CoercionRule,
  toScale: number,
): RuleResult {
  if (rule.kind === "magnitude") {
    // Only a text or picklist source ever classifies needs-rule for a magnitude suffix (a stored
    // integer has no suffix to read), so the source scale is not in play here.
    const text = asText(value, 0);
    const stripped = text.replaceAll(",", "").replace(/^\$/, "").trim();
    const suffix = stripped[stripped.length - 1]!.toLowerCase();
    const exponent = MAGNITUDE_EXPONENTS[suffix] ?? 0;
    const prefix = stripped.slice(0, stripped.length - 1).trim();
    // The suffix and the target scale are both decimal-point moves, so they compose into one exact
    // shift — no float multiply, and a prefix finer than the shift can hold refuses rather than
    // rounding a magnitude the user never wrote ("1.2345k" cannot be a whole-unit count).
    const scaled = scaledIntegerFromDecimalString(prefix, toScale + exponent);
    if (scaled === null) {
      throw new Error(
        `coerceWithRule: magnitude rule cannot express ${JSON.stringify(text)} as an exact integer at scale ${toScale}`,
      );
    }
    return { column: "value_number", number: scaled };
  }

  if (rule.kind === "create-option") {
    return { action: "create-option", label: rule.label };
  }

  // Exhaustive — toKind is kept in the signature so callers can assert
  // correctness at call sites (rule kind → target kind pairing).
  void toKind;
  const exhaustive: never = rule;
  throw new Error(`Unhandled coercion rule: ${JSON.stringify(exhaustive)}`);
}
