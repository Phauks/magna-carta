// The shared vocabulary of the document-assembly engine: the typed outcome shape every stage returns,
// the field manifest normalization records on a template version, and the merge context resolution
// produces. Every stage returns a tagged result rather than throwing, so a caller in a queue consumer
// can classify a failure without a try/catch ladder.

// ---------------------------------------------------------------------------------------------
// Typed outcomes
// ---------------------------------------------------------------------------------------------

export type Outcome<T, R extends string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: R; readonly detail: string };

export function succeeded<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function failed<R extends string>(
  reason: R,
  detail: string,
): { readonly ok: false; readonly reason: R; readonly detail: string } {
  return { ok: false, reason, detail };
}

// ---------------------------------------------------------------------------------------------
// Placeholders and the field manifest
// ---------------------------------------------------------------------------------------------

// How a placeholder was authored before normalization rewrote it. Recorded per occurrence so the
// registration telemetry can answer whether text delimiters were the right primary authoring form —
// and so a firm migrating from Word mail merge can see that its constructs were understood.
export type PlaceholderForm = "brace" | "mergeField";

// One merge field a template version uses, with everywhere it appears. `key` is the dictionary key
// (`matter.number`); `format` is the per-placeholder format override, absent when the placeholder took
// the dictionary entry's default. A key that appears twice with two different formats produces two
// manifest entries — they are different placeholders that happen to read the same source value.
export interface ManifestField {
  readonly key: string;
  readonly format: string | null;
  readonly occurrences: number;
  // The OPC part names the placeholder occurs in, sorted, so the field inspector can say "in the
  // header" rather than only "in this template".
  readonly parts: readonly string[];
  readonly forms: readonly PlaceholderForm[];
}

export interface FieldManifest {
  readonly fields: readonly ManifestField[];
  // Every placeholder occurrence across every part — the denominator the per-field counts sum to.
  readonly totalOccurrences: number;
}

// A normalization finding that does NOT stop registration — the template is registrable, but the author
// should see what the pass did or noticed. A finding that makes a template unusable is a registration
// failure with a location instead (see NormalizationFailure in normalize.ts), never a warning: a
// template that assembles into a document with a hole in it is the outcome this subsystem exists to
// prevent.
export interface NormalizationWarning {
  readonly code:
    | "merge-field-converted" // a Word MERGEFIELD construct was rewritten into the canonical brace form
    | "no-placeholders"; // the package registered cleanly but carries no merge fields at all
  readonly part: string;
  readonly detail: string;
}

// One Word MERGEFIELD construct found in an uploaded template. DETECTION ALWAYS RUNS, whether or not
// the caller asked for conversion: converting a firm's template is a change to the firm's own document,
// so the product's job is to say what it found and what conversion would do, and let a human decide.
// Silently rewriting an uploaded template is the failure mode this shape exists to prevent.
export interface MergeFieldDetection {
  // The field name exactly as Word recorded it, before any mapping.
  readonly fieldName: string;
  // The merge-field key that name maps to — the identity mapping today; see the mapping-resolver seam
  // in normalize.ts.
  readonly mappedKey: string;
  readonly part: string;
  readonly occurrences: number;
  readonly form: "simple" | "complex";
  // Whether the mapped key is a merge field the dictionary actually has. A false here is what tells an
  // author that opting in to conversion would still leave the field unbound.
  readonly mapsToKnownField: boolean;
}

// ---------------------------------------------------------------------------------------------
// The merge context
// ---------------------------------------------------------------------------------------------

// Which batched read supplies a dictionary key's value. One read per source per assembly, never one
// per field — see resolve.ts.
export type MergeSource = "matter" | "party" | "location" | "firm" | "customField" | "system";

export type MergeValueType = "text" | "date" | "money" | "number" | "boolean" | "reference";

// What an unresolvable value renders as. The default is `placeholder`: the most dangerous failure in
// document assembly is a blank where a party name should be, filed without anyone noticing.
export type AbsenceBehaviour = "blank" | "placeholder" | "fail";

export type Sensitivity = "ordinary" | "protected";

// A resolved value, kept in memory for the life of one assembly and never persisted, logged, or placed
// on a queue message. The discriminant is the storage encoding, not the rendered string, so a formatter
// can move a decimal point without ever having to guess a value's scale.
export type MergeValue =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "date"; readonly isoDate: string } // a calendar date, YYYY-MM-DD
  | { readonly kind: "instant"; readonly isoInstant: string } // an instant, UTC-normalized
  | { readonly kind: "money"; readonly amountMinor: number; readonly currencyCode: string }
  | { readonly kind: "rate"; readonly rateE4: number; readonly currencyCode: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean };

// The resolved inputs for one assembly: a value per key the manifest asked for, the keys that could not
// be resolved, and the time zone dates render in (the matter's location's, never the server's).
export interface MergeContext {
  readonly values: ReadonlyMap<string, MergeValue>;
  readonly absentKeys: readonly string[];
  readonly timeZone: string;
}
