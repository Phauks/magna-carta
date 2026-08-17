// The shared vocabulary of the document-assembly engine: the typed outcome shape every stage returns,
// the field manifest normalization records on a template version, and the merge context resolution
// produces. Every stage returns a tagged result rather than throwing, so a caller in a queue consumer
// can classify a failure without a try/catch ladder.

import type { PronounDeclension } from "./expression/pronoun.ts";

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
// The template kind
// ---------------------------------------------------------------------------------------------

// WHAT KIND OF DOCUMENT A REGISTERED TEMPLATE VERSION HOLDS. Stored on the version rather than sniffed
// from the bytes, so every reader asks the row instead of assuming a `.docx`.
//
// `wordProcessing` is the normalized OOXML package this package's own engine walks: run-split
// placeholders reassembled into one run each, blocks and expression sites recorded, a normalizer
// version stamped on the row. `pdfForm` is a firm-supplied fillable PDF — no normalization pass, no run
// splitting, no blocks, no expression sites, and a field manifest DISCOVERED from the AcroForm field
// set rather than authored by a person typing keys.
//
// The two kinds share everything about a template except the engine: the catalogue row, the immutable
// version ladder, the ingest gate, the manifest shape, the binding index, the absence model, and the
// provenance record. That is the whole reason a discriminator is cheaper than a second subsystem.
export type TemplateKind = "wordProcessing" | "pdfForm";

export const TEMPLATE_KINDS: readonly TemplateKind[] = ["wordProcessing", "pdfForm"];

export function isTemplateKind(value: string): value is TemplateKind {
  return TEMPLATE_KINDS.includes(value as TemplateKind);
}

// ---------------------------------------------------------------------------------------------
// Placeholders and the field manifest
// ---------------------------------------------------------------------------------------------

// How a placeholder was authored before normalization rewrote it. Recorded per occurrence so the
// registration telemetry can answer whether text delimiters were the right primary authoring form —
// and so a firm migrating from Word mail merge can see that its constructs were understood.
// `acroForm` is the third: a fillable-PDF widget, whose binding was never authored in the document at
// all — it was confirmed once, by a person, against the form's own field name. Named rather than folded
// into one of the two above, because "how was this placeholder written" is the question the
// registration telemetry answers, and a form field was not written.
export type PlaceholderForm = "brace" | "mergeField" | "acroForm";

// One merge field a template version uses, with everywhere it appears. `key` is the dictionary key
// (`matter.number`); `format` is the per-placeholder format override, absent when the placeholder took
// the dictionary entry's default. A key that appears twice with two different formats produces two
// manifest entries — they are different placeholders that happen to read the same source value.
export interface ManifestField {
  readonly key: string;
  readonly format: string | null;
  readonly occurrences: number;
  // The OPC part names the placeholder occurs in, sorted, so the field inspector can say "in the
  // header" rather than only "in this template". A `pdfForm` version has no parts, so it records the
  // pages its widgets sit on in the same slot — the field inspector's sentence is "where in the
  // document", and a page answers that question exactly as a part name does.
  readonly parts: readonly string[];
  readonly forms: readonly PlaceholderForm[];
  // WHICH ACROFORM FIELDS THIS MERGE KEY FILLS, present only on a `pdfForm` manifest. A Word template's
  // binding IS the key an author typed, so there is nothing further to record; a form template's
  // binding is a confirmed mapping from the form's OWN field name onto the key, and the fill pass needs
  // that name to know which widget to write. Two sites for one key is ordinary — a court form asks for
  // the client's name on the caption and again on the verification page.
  readonly formFields?: readonly ManifestFormFieldSite[];
}

// One AcroForm field a merge key fills. Everything here is read off the form at registration and
// recorded, so the fill pass plans from the manifest rather than re-reading the document — the same
// reason a Word manifest exists at all.
export interface ManifestFormFieldSite {
  // The form's fully-qualified field name, as the PDF records it.
  readonly fieldName: string;
  readonly kind: AcroFormFieldKind;
  // 0-based page index of the field's first widget; null when the form declares a field no page
  // carries a widget for.
  readonly page: number | null;
  // Whether the FORM says the field must be answered (/Ff bit 2). Recorded but never enforced here: it
  // is the form's own statement about its own filing requirements, and the absence behaviour that
  // decides whether an unfilled field fails an assembly is the DICTIONARY entry's, which is the one
  // place that decision lives for both kinds of template.
  readonly required: boolean;
  // The states a choice or radio field will accept. A value that is not one of them cannot be written:
  // the engine would set a state with no appearance behind it, which prints as an empty box that looks
  // answered. Recorded so the fill pass can refuse it as a reported absence instead.
  readonly options: readonly string[];
}

// The interactive role of an AcroForm field, as this package sees it. `unclassified` is this package's
// own name for the engine's "unknown": a field whose /FT the form does not state, or states as
// something no version of the specification defines. It is NEVER defaulted to text — a text fill writes
// an appearance stream into a widget whose real type nobody established, and the result prints as a
// filled-in answer.
export type AcroFormFieldKind =
  | "text"
  | "checkbox"
  | "radio"
  | "choice"
  | "pushButton"
  | "signature"
  | "unclassified";

// One ACROFORM FIELD A REGISTERED FORM TEMPLATE CARRIES THAT NOTHING WILL FILL IN. The fourth list on
// the manifest, and the direct counterpart of `legacyFormFields` and `unboundContentControls`: a hole
// the merge engine leaves, recorded at registration so it is visible at every later surface rather than
// discovered by whoever receives the document.
//
// A FIELD IS NEVER SILENTLY DROPPED AND NEVER DEFAULTED TO A TYPE. Every terminal field the form
// declares appears either in `fields` (bound, through a confirmed mapping) or here, with the reason it
// is not bound stated. The platform has been bitten twice by form fields that bind nothing and report
// no absence — a Word `FORMTEXT`, and a content control showing its placeholder — and both times the
// document read as finished and was not.
//
// `proposedMergeKey` IS A PROPOSAL, NOT A BINDING, and it is offered only where the form's field name
// is EXACTLY a merge key the firm's dictionary has. Nothing resembling anything is ever proposed: a
// `ClientName` that becomes `client.displayName` because it looked close is a silent binding decision
// on privileged content, which is the rule the Word merge-field conversion is built on and the reason
// the mapping library exists. A proposal is what an administrator confirms; until they do, the field
// is unbound and says so.
export interface UnboundFormField {
  readonly fieldName: string;
  readonly kind: AcroFormFieldKind;
  readonly page: number | null;
  readonly required: boolean;
  readonly reason: UnboundFormFieldReason;
  // A merge key the firm could confirm this field means, or the empty string when the platform has
  // nothing to propose. Never applied by anything.
  readonly proposedMergeKey: string;
  // What the form prints in the field today — the value the PDF was stored carrying. Empty for a field
  // the form left blank, which is the ordinary case for a template.
  readonly frozenText: string;
}

// Why a field the form declares binds nothing. Three distinct repairs, so three distinct reasons.
//
// `no-confirmed-mapping` — an ordinary fillable field nobody has said what to fill from. The repair is
// to confirm a mapping, which is a person's decision and a one-line registration input.
//
// `not-fillable` — a push button or a signature field. Nothing about a merge value can be written into
// either: a push button carries an action, and a signature field is filled by the signing ceremony, not
// by an assembly. There is no repair and none is wanted; it is listed so the field set the manifest
// reports is the field set the form has.
//
// `unclassified` — the form declares a field whose type this engine could not establish. The repair is
// to the FORM, and the reason it is reported rather than guessed at is that a wrong guess writes a
// visible answer into a field nobody classified.
export type UnboundFormFieldReason = "no-confirmed-mapping" | "not-fillable" | "unclassified";

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
  // The LEGACY WORD FORM FIELDS this version carries. A separate list from the unconverted merge
  // fields on purpose: those name a field the engine could bind if the firm asked, and these name a
  // construct it will not bind at all. Blending them would offer conversion as the remedy for
  // something conversion does not answer.
  readonly legacyFormFields: readonly LegacyFormField[];
  // The CONTENT CONTROLS this version carries that nothing will fill in — a `w:sdt` showing its
  // unfilled placeholder, or one bound to data in the template's own package. A third list rather than
  // a widening of either of the two above: a legacy form field is a dead construct whose only remedy is
  // replacement, while a content control is what Word produces today and what this engine intends to
  // bind, so the two entries stand for different futures as well as different repairs.
  readonly unboundContentControls: readonly UnboundContentControl[];
  // The ACROFORM FIELDS a `pdfForm` version carries that nothing will fill in. Always empty on a
  // word-processing manifest, and the fourth list rather than a widening of any of the three above for
  // the same reason those three are separate: the repairs differ. A Word merge field is converted, a
  // legacy form field is replaced, a content control awaits a binding this engine intends to grow, and
  // an unbound AcroForm field is CONFIRMED — one sentence from a person and it fills in.
  readonly unboundFormFields: readonly UnboundFormField[];
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

// One LEGACY WORD FORM FIELD a registered template version carries — the `w:fldChar` complex field whose
// instruction is FORMTEXT, FORMCHECKBOX, or FORMDROPDOWN and which carries a `w:ffData` block. Word's
// own protected-form machinery, and the construct most of the appellate court forms and a great deal of
// legacy firm precedent are built from.
//
// NOTHING BINDS ONE, AND NOTHING HERE INVENTS A NAME FOR IT. `fieldName` is the `w:ffData` bookmark name
// exactly as Word recorded it — `Text1`, `Check1`, whatever the author typed — which is an identifier
// for the field, not a claim about what it means: it is reported so a person can find the field in Word,
// never as a merge key. Deriving `client.displayName` from a bookmark called `PartyName`, or from the
// help text beside it, would be the same silent binding decision on privileged content that the
// name-guessing rule refuses one construct over.
//
// So the entry exists to make the ABSENCE visible: this template has holes the merge engine will not
// fill, here is what each prints today, and here is the prompt whoever authored it wrote for whoever
// fills it in. Recorded rather than refused for the reason an unconverted merge field is — an
// unregisterable template is one nobody can inspect.
export interface LegacyFormField {
  // The `w:ffData` bookmark name, empty when the construct carries none. Never a merge key.
  readonly fieldName: string;
  readonly kind: LegacyFormFieldKind;
  readonly part: string;
  readonly occurrences: number;
  // The author's own prompt for the field — Word's status-bar text or help text. Empty when neither is
  // set. It is the one place a legacy form field says what it wants, so it is what a person mapping the
  // template by hand reads first.
  readonly helpText: string;
  // What the document prints where the field sits — the field's own placeholder text, which is what
  // gets filed if nobody notices. Empty when the construct carries no result.
  readonly frozenText: string;
}

export type LegacyFormFieldKind = "text" | "checkbox" | "dropDown";

// One CONTENT CONTROL (`w:sdt`) a registered template version carries that nothing will fill in. This
// is the construct Word produces TODAY where the two above are what it produced before: a structured
// region with its own properties block (`w:sdtPr`), which is why it is the placeholder form this engine
// means to bind eventually rather than a legacy shape to replace.
//
// AN ENTRY EXISTS ONLY WHERE THE DOCUMENT ITSELF SAYS THE REGION IS UNFILLED. Two properties say it,
// and one of them is always true on a recorded entry:
//
//   `showingPlaceholder` — the control carries `w:showingPlcHdr`, which is Word's own record that what
//   the reader sees is the control's placeholder prompt rather than content. `frozenText` is therefore
//   the prompt AND the printed text at once — "Click here to enter text." — which is why there is no
//   separate help-text field here as there is on a legacy form field: a content control has only the
//   one string, and reporting it twice would read as two different prompts.
//
//   `dataBound` — the control carries `w:dataBinding`, so Word refreshes its content from a custom XML
//   part in the package. Nothing in this engine writes such a part, and registration's metadata scrub
//   removes them outright (they typically hold a document-management system's own client and matter
//   record — `packages/metadata/src/ooxml/scrub.ts`), so the control has no source left and prints
//   whatever the document it was made from last put there: the unconverted-merge-field failure in a
//   different construct, and a blank that does not look like a blank.
//
// A control that is NEITHER is deliberately not recorded. Word wraps ordinary content in content
// controls constantly — a cover page, a citation, a table of contents, anything built from one of its
// own templates — and a filled control prints text the author typed, which is content, not a hole.
// Reporting those would put a warning on documents that have nothing wrong with them, and a warning
// every template earns is a warning every firm learns to skip past.
//
// A NAME HERE IS EVIDENCE, NOT A BINDING. Unlike a legacy form field's Word-minted `Text1`, `alias`
// (the title in Word's properties dialog) and `tag` are typed by an author or written by whatever tool
// produced the document — nothing mints them, and a control that has neither reports both empty. That
// makes them the same KIND of evidence a `MERGEFIELD` name is, and it is why a future conversion has a
// real thing to map from. It is still not a merge key: the mapping library exists precisely because a
// name has to be CONFIRMED by a human once before it means anything, and no confirmation has happened
// here. Both are reported so a person can find the control in Word and decide.
export interface UnboundContentControl {
  // `w:alias` — the control's title. Empty when the control carries none.
  readonly alias: string;
  // `w:tag` — the control's machine-facing name. Empty when the control carries none.
  readonly tag: string;
  readonly kind: ContentControlKind;
  readonly part: string;
  readonly occurrences: number;
  // Whether the control declares `w:showingPlcHdr`.
  readonly showingPlaceholder: boolean;
  // Whether the control declares `w:dataBinding`.
  readonly dataBound: boolean;
  // What the document prints where the control sits, which for a placeholder-showing control is the
  // prompt its author wrote. Empty when the control's content carries no text at all.
  readonly frozenText: string;
}

// What a control declares it holds, taken from the type element in `w:sdtPr`. The kind is the whole
// reason one entry shape covers every control: it is what tells a person which merge field the control
// should have been — a date picker wants a date-typed field, a drop-down wants one of a listed set, and
// a picture control wants something the merge engine has no text field for at all.
//
// `unspecified` means the properties block declares NO type element. That is legal, and such a control
// is conventionally a rich-text one — but conventionally is not the same as stated, and this reports
// what the document declares rather than what it probably means, for the same reason a bookmark name
// never becomes a merge key.
export type ContentControlKind =
  | "plainText"
  | "richText"
  | "date"
  | "dropDownList"
  | "comboBox"
  | "checkBox"
  | "picture"
  | "buildingBlock"
  | "repeatingSection"
  | "repeatingSectionItem"
  | "citation"
  | "bibliography"
  | "equation"
  | "group"
  | "unspecified";

// A normalization finding that does NOT stop registration — the template is registrable, but the author
// should see what the pass did or noticed. A finding that makes a template unusable is a registration
// failure with a location instead (see NormalizationFailure in normalize.ts), never a warning: a
// template that assembles into a document with a hole in it is the outcome this subsystem exists to
// prevent.
export interface NormalizationWarning {
  readonly code:
    | "merge-field-converted" // a Word MERGEFIELD construct was rewritten into the canonical brace form
    | "merge-field-unconverted" // Word MERGEFIELD constructs were left as authored and will render frozen text
    | "legacy-form-field" // legacy Word form fields, which nothing binds and no opt-in converts
    | "unbound-content-control" // `w:sdt` regions showing a placeholder, or bound to the template's own data
    | "unbound-form-field" // AcroForm fields on a form template that no confirmed mapping binds
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
  | "system"
  // The matter's asset register. ONE read fills all eleven asset subjects — every class plus the
  // aggregate — because a subject is a pass over rows already in memory. Adding a class adds a left
  // join and no read.
  | "asset"
  // The matter's staffing: one read joining the matter's responsible attorney and its assignment
  // rows to the member table, the professional profile, and the member's mapped Directory person.
  // Every member subject is a pass over the rows it returns.
  | "staffing"
  // The matter's court-case record joined to the court organisation and the judge — the `court`
  // and `case` subjects share it.
  | "court"
  // The matter's estate record joined to the decedent's Directory person.
  | "estate";

export type MergeValueType =
  | "text"
  // A person's or an organisation's name, carried as the PARTS the Directory records rather than as one
  // string. A format can only render what the value holds, so two renderings that need parts require the
  // value to have parts: a surname-first rendering is not derivable out of a single display string, and
  // guessing at it is how a document ends up looking finished and being wrong.
  | "name"
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
  // A name, as its recorded parts. `display` is the string the Directory shows and the one the default
  // rendering prints unchanged; every other part is present only when the record separates it out, and a
  // rendering that needs a part the record lacks is a DECLARED ABSENCE with a reason rather than a
  // fallback to a different rendering — see format.ts.
  | {
      readonly kind: "name";
      readonly display: string;
      readonly prefix?: string;
      readonly given?: string;
      readonly middle?: string;
      readonly family?: string;
      readonly suffix?: string;
      // An organisation has one name and no parts. Carried as a fact rather than inferred from the
      // absent parts, because "a person whose family name was never split out" and "a company" want
      // different sentences when a template asks for a surname. Absent when the read that produced the
      // value does not record which it is — the matter's own row carries its client's display name and
      // nothing about the Directory record behind it — and an absent flag is treated as "not recorded",
      // never guessed either way.
      readonly isOrganisation?: boolean;
    }
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
  // The pronouns each person subject stated, keyed by SUBJECT ("client", "responsibleAttorney").
  // Kept out of `values` on purpose: a merge value is a fact a document prints and whose gap a
  // marker can stand in for, while a declension is the raw material the pronoun helpers spend, and
  // its gap is answered by the neutral set instead of by an absence. A subject with no entry is a
  // subject whose pronouns nobody stated, who is an organisation, or whom the matter does not
  // resolve to one person — all three get the neutral set, which is wrong about nobody.
  readonly pronouns?: ReadonlyMap<string, PronounDeclension>;
  readonly timeZone: string;
}
