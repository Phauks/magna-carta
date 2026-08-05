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

// One conditional or repeating block a template version carries. The EXPRESSION SOURCE is stored, never
// a serialized syntax tree: assembly re-parses and re-checks from the source, which is the only thing
// that catches dictionary drift — a template registered in March against a custom field archived in
// June must fail in September with the key named, rather than evaluate against a stored tree that still
// believes the key exists. A stored tree would also be a second representation to version, to migrate,
// and to trust; the source text is already the thing the author wrote and the thing the field inspector
// shows them.
export interface ManifestBlock {
  readonly kind: "if" | "unless" | "each";
  readonly source: string;
  // `boolean` for a condition, `list` for a repeat. Recorded so the field inspector can describe the
  // block without re-checking it.
  readonly resultType: string;
  readonly part: string;
  // The merge fields the block's expression reads. THESE JOIN THE MANIFEST'S KEY SET, which is what
  // keeps one-read-per-source true once a condition can read anything the dictionary has.
  readonly keys: readonly string[];
  // How many blocks enclose this one. Bounded at registration so expansion cannot multiply without a
  // ceiling.
  readonly depth: number;
}

// One `{{= expression}}` placeholder. `format` is the `:format` suffix when the author named one, and
// null when the placeholder took the result type's default.
export interface ManifestComputedField {
  readonly source: string;
  readonly format: string | null;
  readonly resultType: string;
  readonly part: string;
  readonly keys: readonly string[];
  readonly occurrences: number;
}

export interface FieldManifest {
  readonly fields: readonly ManifestField[];
  // Every placeholder occurrence across every part — the denominator the per-field counts sum to.
  readonly totalOccurrences: number;
  // The Word merge fields this version carries UNCONVERTED. Empty for a template authored in brace
  // form, and empty for one whose merge fields were converted. A non-empty list is the manifest saying
  // "this template has blanks the merge engine will not fill", which is what makes them visible to the
  // absence model instead of invisible to it.
  readonly unconvertedMergeFields: readonly UnconvertedMergeField[];
  readonly blocks: readonly ManifestBlock[];
  readonly computedFields: readonly ManifestComputedField[];
}

// The keys a manifest reads from EVERY source it has — plain placeholders, block conditions, and
// computed fields together. Resolution plans its reads from this, so an expression can never be the
// reason a read happens late.
export function manifestKeys(manifest: FieldManifest): readonly string[] {
  const keys = new Set<string>();
  for (const field of manifest.fields) keys.add(field.key);
  for (const block of manifest.blocks) for (const key of block.keys) keys.add(key);
  for (const computed of manifest.computedFields) for (const key of computed.keys) keys.add(key);
  return [...keys].sort();
}

// One Word merge field a REGISTERED template version still carries in its stored bytes, because the
// caller did not ask for conversion. Recorded on the manifest rather than refused, so it is a declared
// property of the template that every later reader — the field inspector, the assembly response, the
// provenance row — can see and report.
//
// A merge field is not a placeholder: nothing substitutes it, so at assembly it renders `frozenText`,
// the result Word cached the last time the document was merged. That is why the frozen text is recorded
// here — an author deciding whether to convert has to see the words the document will actually print,
// and "this field will silently print stale text" is not a statement a name alone can make.
export interface UnconvertedMergeField {
  readonly fieldName: string;
  readonly mappedKey: string;
  readonly part: string;
  readonly occurrences: number;
  readonly form: "simple" | "complex";
  readonly mapsToKnownField: boolean;
  // What the document renders where the field sits — Word's cached result, frozen at whatever it was
  // when the template was last merged. Empty when the construct carries no cached result at all.
  readonly frozenText: string;
}

// A normalization finding that does NOT stop registration — the template is registrable, but the author
// should see what the pass did or noticed. A finding that makes a template unusable is a registration
// failure with a location instead (see NormalizationFailure in normalize.ts), never a warning: a
// template that assembles into a document with a hole in it is the outcome this subsystem exists to
// prevent.
export interface NormalizationWarning {
  readonly code:
    | "merge-field-converted" // a Word MERGEFIELD construct was rewritten into the canonical brace form
    | "merge-field-unconverted" // Word MERGEFIELD constructs were left as authored and will render frozen text
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
  // The merge-field key that name maps to — the identity mapping unless the firm's field-mapping
  // library has a confirmed mapping for this name; see the resolver seam in normalize.ts.
  readonly mappedKey: string;
  readonly part: string;
  readonly occurrences: number;
  readonly form: "simple" | "complex";
  // Whether the mapped key is a merge field the dictionary actually has. A false here is what tells an
  // author that opting in to conversion would still leave the field unbound.
  readonly mapsToKnownField: boolean;
  // Whether the mapping came from the firm's own confirmed mapping library rather than from the name
  // matching a dictionary key outright. The difference is what an administrator is being asked to
  // confirm, so it is reported rather than blended into one "mapped" flag.
  readonly mappedFromLibrary: boolean;
  // What the field renders today — Word's cached result. Carried on the detection as well as on the
  // manifest entry, because a caller deciding whether to convert sees this list first.
  readonly frozenText: string;
}

// ---------------------------------------------------------------------------------------------
// The merge context
// ---------------------------------------------------------------------------------------------

// Which batched read supplies a dictionary key's value. One read per source per assembly, never one
// per field — see resolve.ts.
// `protectedIdentifier` is the one source that is not a batched read. A sealed value is decrypted one at
// a time through the protected-field chokepoint — each ciphertext bound to its own row, each decrypt
// committing its own audit record — so its cost is fixed by the number of protected keys the MANIFEST
// names rather than by a read count, and it is the only source for which that distinction exists.
export type MergeSource =
  | "matter"
  | "party"
  | "location"
  | "firm"
  | "customField"
  | "protectedIdentifier"
  | "system";

export type MergeValueType =
  | "text"
  | "date"
  | "money"
  | "rate"
  | "number"
  | "boolean"
  | "reference"
  // A picture a placeholder is replaced BY, rather than a string a placeholder renders as. Not a
  // first-class value anywhere else: an image has no rendering, no format, and no expression type, so
  // it cannot be compared, concatenated, computed with, or walked — the only thing that can happen to
  // one is that it becomes a drawing in the document at the placeholder's position.
  | "image"
  // A collection a repeating block walks. Not a first-class value: it can be neither constructed,
  // indexed, assigned, nor passed anywhere but `count`, `isEmpty`, and `{{#each}}`.
  | "list";

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
  // An exact decimal held as a stored integer plus the minor-unit exponent it is expressed at: 1250 at
  // scale 2 is 12.50, and 1250 at scale 0 is 1250. The scale travels WITH the value because what a
  // stored integer means is its kind plus its scale — a firm's own numeric field declares that
  // exponent, so a value that arrived without it would be rendered a power of ten wrong and look
  // entirely plausible.
  | { readonly kind: "number"; readonly value: number; readonly scale: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  // A picture, resolved as bytes plus the box it renders in. The box is the ASSET'S, not the
  // template's: the firm sets how large its logo prints once, where it can see the result, rather than
  // every template author restating it in a unit no word processor exposes. The height is derived from
  // the intrinsic aspect ratio at resolution time, so a logo can never be stretched by a document.
  | {
      readonly kind: "image";
      readonly bytes: Uint8Array;
      readonly contentType: string;
      readonly widthEmu: number;
      readonly heightEmu: number;
      // The alternative text a screen reader announces and Word shows in the picture's properties.
      readonly description: string;
    }
  // A collection, resolved by ONE batched read for the whole thing rather than one read per item. Each
  // item is a record of the collection's declared item fields.
  | { readonly kind: "list"; readonly items: readonly MergeListItem[] };

export interface MergeListItem {
  readonly fields: ReadonlyMap<string, MergeValue>;
}

// The resolved inputs for one assembly: a value per key the manifest asked for, the keys that could not
// be resolved, and the time zone dates render in (the matter's location's, never the server's).
export interface MergeContext {
  readonly values: ReadonlyMap<string, MergeValue>;
  readonly absentKeys: readonly string[];
  // Why a key could not be resolved, for the cases where resolution KNOWS why and a marker on the page
  // does not say it. A matter with two opposing parties has no single one to name, and "[OPPOSING PARTY
  // DISPLAY NAME]" leaves the person filling it in to guess whether the data is missing or the question
  // is unanswerable; the sentence here says which, and names how many candidates there were. Absent for
  // an ordinary missing value, where the marker already says everything there is to say. A reason names
  // counts and roles only — never a value, which is the thing resolution refused to choose between.
  readonly absenceReasons: ReadonlyMap<string, string>;
  readonly timeZone: string;
}
