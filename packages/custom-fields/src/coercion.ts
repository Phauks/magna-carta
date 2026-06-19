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

// The rule supplied by the caller when the classification returned needs-rule.
//   magnitude    — multiply the numeric prefix by the k/M/B suffix.
//   create-option — the text becomes a new picklist option with a given label.
export type CoercionRule = { kind: "magnitude" } | { kind: "create-option"; label: string };

// The result of applying a rule. For magnitude coercions the result is a
// CoercedValue. For create-option it is an action descriptor so the caller
// can create the option before recording the field value.
export type RuleResult = CoercedValue | { action: "create-option"; label: string };

// ── internal helpers ──────────────────────────────────────────────────────────

const TEXT_KINDS: readonly CustomFieldKind[] = ["single-line", "multi-line", "url", "email"];

// Plain integer: optional leading minus, digits only (commas and $ already stripped).
const INTEGER_PATTERN = /^-?\d+$/;

// Numeric prefix with optional decimal, optional whitespace, then k/K/m/M/b/B.
const MAGNITUDE_PATTERN = /^-?\d+(\.\d+)?\s*[kKmMbB]$/;

// ISO date prefix — accepts 2025-01-15 or 2025-01-15T14:30:00Z etc.
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

const MAGNITUDE_MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

// Coerce the raw value to a string for use when targeting text-family kinds.
function asText(value: RawStoredValue): string {
  if ("text" in value) return value.text;
  if ("optionLabel" in value) return value.optionLabel;
  if ("number" in value) return String(value.number);
  if ("date" in value) return value.date;
  return String(value.checkbox);
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
 * Pure function — no database access, no side effects.
 */
export function classifyCoercion(
  value: RawStoredValue,
  fromKind: CustomFieldKind,
  toKind: CustomFieldKind,
): Classification {
  // Trivial: same kind, no transformation.
  if (fromKind === toKind) {
    return { outcome: "clean", coerced: trivialCoercion(value) };
  }

  // Any target in the text family: stringify the source value.
  if (TEXT_KINDS.includes(toKind)) {
    return { outcome: "clean", coerced: { column: "value_text", text: asText(value) } };
  }

  // number ↔ currency: the numeric storage column is shared; re-scaling the
  // minor-unit exponent is handled at apply time using the field's number_scale.
  if (
    (fromKind === "number" && toKind === "currency") ||
    (fromKind === "currency" && toKind === "number")
  ) {
    if ("number" in value) {
      return { outcome: "clean", coerced: { column: "value_number", number: value.number } };
    }
  }

  // → number or → currency from a text source.
  if (toKind === "number" || toKind === "currency") {
    const stripped = asText(value).replaceAll(",", "").replace(/^\$/, "").trim();
    if (INTEGER_PATTERN.test(stripped)) {
      return {
        outcome: "clean",
        coerced: { column: "value_number", number: Number(stripped) },
      };
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
    const text = asText(value).trim();
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
 * - `magnitude` rule: multiply the numeric prefix by the k/M/B suffix factor.
 * - `create-option` rule: the caller creates the option before writing the value;
 *   this function returns the action descriptor so the caller can sequence that.
 *
 * Pure function — no database access, no side effects.
 */
export function coerceWithRule(
  value: RawStoredValue,
  toKind: CustomFieldKind,
  rule: CoercionRule,
): RuleResult {
  if (rule.kind === "magnitude") {
    const stripped = asText(value).replaceAll(",", "").replace(/^\$/, "").trim();
    const suffix = stripped[stripped.length - 1]!.toLowerCase();
    const multiplier = MAGNITUDE_MULTIPLIERS[suffix] ?? 1;
    const base = parseFloat(stripped.slice(0, stripped.length - 1).trim());
    if (Number.isNaN(base)) {
      throw new Error(
        `coerceWithRule: magnitude rule received a value whose numeric prefix could not be parsed: ${JSON.stringify(asText(value))}`,
      );
    }
    return { column: "value_number", number: base * multiplier };
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
