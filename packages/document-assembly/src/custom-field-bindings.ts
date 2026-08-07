import { effectiveNumberScale } from "@magna-carta/custom-fields/number-scale";
import type { CustomFieldKind } from "@magna-carta/custom-fields/types";
import { MONEY_SCALE } from "@magna-carta/money/money";
import type { DictionaryEntry } from "./catalog/entry.ts";
import { exampleRenderingsFor } from "./catalog/examples.ts";
import { mergeSubject } from "./catalog/subjects.ts";
import type { AbsenceBehaviour, MergeValue, MergeValueType } from "./types.ts";

// A firm's own fields, as merge fields.
//
// BINDING IS BY HANDLE, NEVER BY NAME. `custom.customField_…` names the field's immutable identity, so
// renaming "Retainer cap" to "Engagement cap" changes nothing a template has to be re-registered for —
// which is precisely the property the custom-fields engine was built to have, and the reason its handle
// rather than its label is what a template stores. A name-bound merge field would put every firm one
// rename away from a template that silently stops filling in a number.
//
// The catalogue is therefore DERIVED PER FIRM AT READ TIME rather than declared: a dictionary entry per
// active custom field, produced from the same `custom_field` rows the resolution read returns. That is
// also what makes drift detectable — a template bound in March to a field archived in June is checked
// in September against the catalogue the firm has THEN, and fails naming the key.

// The one reserved segment a firm's field keys live under. A dictionary key is matched by exact string,
// so the prefix is the whole namespace mechanism: nothing a firm can name collides with `matter.` or
// `location.`, and nothing the platform later adds collides with a firm's handles.
export const CUSTOM_KEY_PREFIX = "custom.";

// The handle shape a custom merge key carries after the prefix. Restated here rather than imported
// from @magna-carta/identifiers because it also has to hold as a LEXICAL rule inside the expression
// language, which stays free of platform imports so its checker can run in a browser; the two are
// pinned to the minted shape by test (test/custom-field-bindings.test.ts) rather than trusted to stay
// in step by care.
export const CUSTOM_FIELD_HANDLE_PREFIX = "customField_";
export const CUSTOM_FIELD_HANDLE_TOKEN_LENGTH = 21;

const CUSTOM_KEY_PATTERN = new RegExp(
  `^${CUSTOM_KEY_PREFIX.replace(".", "\\.")}${CUSTOM_FIELD_HANDLE_PREFIX}[A-Za-z0-9_-]{${CUSTOM_FIELD_HANDLE_TOKEN_LENGTH}}$`,
);

export function customMergeKeyFor(handle: string): string {
  return `${CUSTOM_KEY_PREFIX}${handle}`;
}

// The handle a custom merge key names, or undefined when the key is not one. Shape-checked rather than
// merely prefix-stripped: the handle goes into a bound SQL parameter, and a key that only LOOKS like one
// should be reported as an unknown merge field at registration rather than read as a lookup for a row
// that cannot exist.
export function customFieldHandleOf(key: string): string | undefined {
  return CUSTOM_KEY_PATTERN.test(key) ? key.slice(CUSTOM_KEY_PREFIX.length) : undefined;
}

export function isCustomMergeKey(key: string): boolean {
  return CUSTOM_KEY_PATTERN.test(key);
}

// What each firm-definable kind becomes in a document. Two of the mappings are worth stating out loud:
//
// - A `time` field is TEXT, not a date. There is no time-of-day type in the merge model and deliberately
//   none in the expression language, because a document that could do arithmetic on an hour would make a
//   filing date depend on the hour a job happened to run. The stored time renders as the firm typed it.
// - A reference field is TEXT holding the REFERENCED RECORD'S LABEL, never the handle. A
//   `directoryPerson_…` printed into a letter is not a fact anyone can read; the label is the fact the
//   firm meant when it pointed one record at another.
//
// Each kind also carries an INVENTED sample value, rendered through the real format table to produce the
// entry's example renderings. Never a firm's data: the catalogue is read before any matter is chosen.
const KIND_BINDINGS: Readonly<
  Record<
    CustomFieldKind,
    {
      readonly valueType: MergeValueType;
      readonly defaultFormat: string;
      readonly example: MergeValue;
    }
  >
> = {
  checkbox: {
    valueType: "boolean",
    defaultFormat: "yesNo",
    example: { kind: "boolean", value: true },
  },
  date: {
    valueType: "date",
    defaultFormat: "long",
    example: { kind: "date", isoDate: "2026-03-14" },
  },
  time: { valueType: "text", defaultFormat: "plain", example: { kind: "text", text: "09:30" } },
  number: {
    valueType: "number",
    defaultFormat: "plain",
    example: { kind: "number", value: 1200, scale: 0 },
  },
  currency: {
    valueType: "money",
    defaultFormat: "currency",
    example: { kind: "money", amountMinor: 120000, currencyCode: "USD" },
  },
  picklist: {
    valueType: "text",
    defaultFormat: "plain",
    example: { kind: "text", text: "Selected option" },
  },
  "single-line": {
    valueType: "text",
    defaultFormat: "plain",
    example: { kind: "text", text: "Recorded text" },
  },
  "multi-line": {
    valueType: "text",
    defaultFormat: "plain",
    example: { kind: "text", text: "Several lines of recorded text." },
  },
  url: {
    valueType: "text",
    defaultFormat: "plain",
    example: { kind: "text", text: "https://example.test/record" },
  },
  email: {
    valueType: "text",
    defaultFormat: "plain",
    example: { kind: "text", text: "someone@example.test" },
  },
  "matter-reference": {
    valueType: "text",
    defaultFormat: "plain",
    example: { kind: "text", text: "Estate of Rowan Ashcroft" },
  },
  "contact-reference": {
    valueType: "text",
    defaultFormat: "plain",
    example: { kind: "text", text: "Rowan Ashcroft" },
  },
};

// Every firm-defined field is `placeholder`, without exception and without a per-field override.
//
// A firm's own field is the one part of the dictionary the platform cannot reason about: nothing here
// knows whether "Settlement authority" is a figure a document must not be filed without or a note
// somebody fills in later. The visible marker is the safe answer to that ignorance in both directions —
// it never blocks a document a firm needed, and it never lets a blank leave without a human seeing it.
// A per-field absence policy is a real feature, but it belongs on the field's own definition surface
// where an administrator can see what they are choosing, not inferred from a kind.
const CUSTOM_FIELD_ABSENCE: AbsenceBehaviour = "placeholder";

// The one subject a firm supplies the facets of. Read from the registry rather than restated, so the
// group heading a firm's fields sit under is the registry's and cannot drift from it.
const CUSTOM_SUBJECT = mergeSubject("custom");

// One `custom_field` row, as the dictionary needs it. The projection is exactly the definition columns —
// no value columns — because the catalogue is what a template is AUTHORED against and must be readable
// without touching a single matter's data.
export interface CustomFieldDefinitionRow {
  readonly handle: string;
  readonly name: string;
  readonly kind: CustomFieldKind;
  readonly numberScale: number | null;
  readonly archived: boolean;
}

// The dictionary entries a firm's active fields contribute.
//
// AN ARCHIVED FIELD CONTRIBUTES NO ENTRY. That is the whole archived-as-absence behaviour, and it lands
// here rather than at the value read for a reason: a template bound to a field archived after it was
// registered is then checked against a catalogue that no longer has the key, so assembly fails NAMING
// THE KEY — the drift-detection the stored-expression-source rule exists to make possible. The value
// read reports the same fact for a template whose bindings were resolved before the archive.
export function customFieldDictionaryEntries(
  rows: readonly CustomFieldDefinitionRow[],
): readonly DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  for (const row of rows) {
    if (row.archived) continue;
    const binding = KIND_BINDINGS[row.kind];
    if (binding === undefined) continue;
    entries.push({
      key: customMergeKeyFor(row.handle),
      source: "customField",
      valueType: binding.valueType,
      defaultFormat: binding.defaultFormat,
      // A firm-defined field is never a protected one today: the protected-value binding path is the
      // decrypt-permission-plus-audit read, and a dictionary entry that claimed `protected` without
      // going through it would be a silent downgrade of that invariant rather than an implementation of
      // it. When a firm can declare a field protected, this is the line that reads the declaration.
      sensitivity: "ordinary",
      absence: CUSTOM_FIELD_ABSENCE,
      // The field's own label, which is what an author recognizes in the field list — the handle is what
      // the template stores, the name is what a human picks from.
      description: row.name,
      label: row.name,
      group: CUSTOM_SUBJECT?.group ?? "custom",
      subject: "custom",
      // A firm with thirty of its own fields must not bury the client's name, and a firm with three
      // wants them in front of an author. Ordering is what decides that; nothing here is ever hidden.
      prominence: "secondary",
      // The field's own name is the search vocabulary a firm would type, and it is already matched
      // through the label — so there is nothing to declare here that the platform could know.
      synonyms: [],
      exampleRenderings: exampleRenderingsFor(binding.valueType, binding.example),
      status: "current",
    });
  }
  return entries;
}

// One current custom-field value, already joined to whatever gives it meaning: a picklist option's
// label, or a referenced record's display name. One read produces all of them (see
// custom-field-statements.ts), so a template with forty custom fields costs the same read as one with
// two.
export interface CustomFieldValueRow {
  readonly handle: string;
  readonly kind: CustomFieldKind;
  readonly numberScale: number | null;
  readonly valueText: string | null;
  readonly valueNumber: number | null;
  readonly valueDate: string | null;
  // The option's label, or the referenced record's display name — resolved by the same read, never by a
  // lookup per value.
  readonly resolvedLabel: string | null;
}

// A stored custom-field value as a merge value.
//
// THE SCALE RULE IS REUSED, NOT RESTATED. `value_number` is an integer of minor units and what those
// units are is the field's kind plus its `number_scale` — the same 500 is five hundred on a number field
// and five dollars on a currency field. `effectiveNumberScale` is the custom-fields engine's own answer
// to that question, so the boundary that writes a value and the document that renders it cannot drift
// into disagreeing by a power of ten.
export function mergeValueForCustomField(
  row: CustomFieldValueRow,
  currencyCode: string,
): MergeValue | undefined {
  const scale = effectiveNumberScale(row.kind, row.numberScale);
  switch (row.kind) {
    case "checkbox":
      return row.valueNumber === null
        ? undefined
        : { kind: "boolean", value: row.valueNumber !== 0 };
    case "currency":
      // A currency field whose administrator declared a scale other than the currency's own minor unit
      // is not money the money package can hold — a "cent" that is not a hundredth has no currency to
      // belong to. It renders as the exact decimal it is instead of being silently re-scaled into an
      // amount that would look like money and be wrong.
      if (row.valueNumber === null) return undefined;
      return scale === MONEY_SCALE
        ? { kind: "money", amountMinor: row.valueNumber, currencyCode }
        : { kind: "number", value: row.valueNumber, scale };
    case "number":
      return row.valueNumber === null
        ? undefined
        : { kind: "number", value: row.valueNumber, scale };
    case "date":
    case "time":
      return row.valueDate === null || row.valueDate === ""
        ? undefined
        : dateOrTextValue(row.kind, row.valueDate);
    case "picklist":
    case "matter-reference":
    case "contact-reference":
      return row.resolvedLabel === null || row.resolvedLabel === ""
        ? undefined
        : { kind: "text", text: row.resolvedLabel };
    case "single-line":
    case "multi-line":
    case "url":
    case "email":
      return row.valueText === null || row.valueText === ""
        ? undefined
        : { kind: "text", text: row.valueText };
  }
}

// The calendar-date shape every consumer of a `date` merge value is built on. The per-firm column that
// backs a `date` custom field is a bare `text` with no CHECK, so what is stored is whatever a writer
// once put there — this is the boundary that constructs the merge value, and therefore the one place
// the shape can be established once instead of re-asserted at each consumer.
const ISO_CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A `date` field stores a calendar date and renders in the matter's office time zone like every other
// date; a `time` field stores a time of day, which has no calendar rendering, so it is text.
//
// A STORED STRING THAT IS NOT A CALENDAR DATE BECOMES TEXT, not a date-shaped lie. Carried as a date it
// would reach the expression language's comparison arm, where dates order as raw strings: "03/14/2026"
// sorts below "2026-01-01" and a condition silently takes the wrong branch. As text the key has a type
// the checker can see, so comparing it against a date is refused at registration — an author reads the
// error instead of a document reading the wrong way.
function dateOrTextValue(kind: CustomFieldKind, stored: string): MergeValue {
  return kind === "date" && ISO_CALENDAR_DATE.test(stored)
    ? { kind: "date", isoDate: stored }
    : { kind: "text", text: stored };
}
