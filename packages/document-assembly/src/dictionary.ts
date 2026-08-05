import type { AbsenceBehaviour, MergeSource, MergeValueType, Sensitivity } from "./types.ts";
import { legalFormatsFor } from "./format.ts";
import type { ExpressionType } from "./expression/catalog.ts";
import type { ExpressionScope, NameBinding } from "./expression/check.ts";

// The merge-field data dictionary: a declarative catalogue, one entry per key, rather than a resolver
// per field. A growing list of similar things is a declaration — adding a merge field is a row here plus
// a line in the source's batched read, never a new code path on the assembly hot path.
//
// The dictionary is also what makes batched resolution possible: because normalization already recorded
// which keys a template version uses, looking each up here plans every read before any XML is touched.

export interface DictionaryEntry {
  // The stable, user-visible token a paralegal types between braces.
  readonly key: string;
  // Which batched read supplies it. One read per source per assembly, regardless of field count.
  readonly source: MergeSource;
  readonly valueType: MergeValueType;
  // The rendering applied when the placeholder names no format of its own.
  readonly defaultFormat: string;
  // A `protected` entry resolves through the protected-field read path and nothing else, so the acting
  // member's decrypt permission is checked and an audit row is written. No slice-1 entry is protected;
  // the property is declared now because retrofitting a sensitivity axis onto a shipped dictionary means
  // re-auditing every entry.
  readonly sensitivity: Sensitivity;
  readonly absence: AbsenceBehaviour;
  // What the field inspector shows an author. Consumer-facing text: it names the fact, not the schema.
  readonly description: string;
  // Present only on a `list` entry: the fields ONE ITEM of the collection carries, which is what a
  // repeating block pushes into scope as `<collectionKey>.<field>`. A collection is read once, as a
  // whole; the item fields cost no read of their own.
  readonly itemFields?: readonly DictionaryItemField[];
}

export interface DictionaryItemField {
  readonly name: string;
  readonly valueType: MergeValueType;
  readonly description: string;
}

// The slice-1 dictionary: matter, the matter's home location, the firm, the matter's client party, and
// system values. Directory role links and firm-defined custom fields widen it in slice 2·6·2.
//
// `location.*` resolves from THE MATTER'S home location, never the acting member's, so a document
// assembled by a member of one office on a matter belonging to another carries the correct office
// identity. That is the whole reason the Locations model carries letterhead columns.
export const DICTIONARY: readonly DictionaryEntry[] = [
  {
    key: "matter.number",
    source: "matter",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    // A pleading caption without a matter number is not a filing. An absence here stops the assembly
    // rather than producing a document that looks finished.
    absence: "fail",
    description: "The matter's file number.",
  },
  {
    key: "matter.title",
    source: "matter",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "fail",
    description: "The matter's title.",
  },
  {
    key: "matter.description",
    source: "matter",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "blank",
    description: "The matter's description, if one was recorded.",
  },
  {
    key: "matter.status",
    source: "matter",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "placeholder",
    description: "Whether the matter is prospective, open, or closed.",
  },
  {
    key: "matter.openedOn",
    source: "matter",
    valueType: "date",
    defaultFormat: "long",
    sensitivity: "ordinary",
    absence: "placeholder",
    description: "The date the matter was opened, in the matter's office's time zone.",
  },
  {
    key: "matter.eBilling",
    source: "matter",
    valueType: "boolean",
    defaultFormat: "yesNo",
    sensitivity: "ordinary",
    // A boolean the matter always carries: it is on or it is off, never missing. Declared `fail` so a
    // matter row that somehow supplied nothing is a loud defect rather than a silently absent clause.
    absence: "fail",
    description: "Whether the matter bills through an electronic billing channel.",
  },
  {
    key: "matter.parties",
    source: "party",
    valueType: "list",
    // A list is never rendered — a repeating block walks it — so its default format is the empty
    // rendering the format table declares for the type.
    defaultFormat: "",
    sensitivity: "ordinary",
    // A matter with no linked parties is an empty list, not an absence: a repeating block over it
    // simply produces nothing, which is the correct document.
    absence: "blank",
    description: "Everyone linked to the matter, for a repeating block to walk.",
    itemFields: [
      {
        name: "displayName",
        valueType: "text",
        description: "The party's name as it should appear in a document.",
      },
      { name: "role", valueType: "text", description: "The role the party plays on the matter." },
      {
        name: "kind",
        valueType: "text",
        description: "Whether the party is a person or an organisation.",
      },
    ],
  },
  {
    key: "client.displayName",
    source: "party",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "fail",
    description: "The client's name as it should appear in a document.",
  },
  {
    key: "client.code",
    source: "party",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "blank",
    description: "The firm's own client code for this client, if one was recorded.",
  },
  {
    key: "location.name",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "placeholder",
    description: "The name of the office the matter belongs to.",
  },
  {
    key: "location.addressBlock",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "placeholder",
    description: "The office's address block, as it appears on letterhead.",
  },
  {
    key: "location.footer",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "blank",
    description: "The office's letterhead footer text.",
  },
  {
    key: "location.remitTo",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "placeholder",
    description: "Where the office asks payment to be sent.",
  },
  {
    key: "location.jurisdiction",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "placeholder",
    description: "The jurisdiction the office practises in.",
  },
  {
    key: "firm.name",
    source: "firm",
    valueType: "text",
    defaultFormat: "plain",
    sensitivity: "ordinary",
    absence: "fail",
    description: "The firm's name.",
  },
  {
    key: "system.today",
    source: "system",
    valueType: "date",
    defaultFormat: "long",
    sensitivity: "ordinary",
    // A system value can always be produced, so an absence here would be a defect rather than missing
    // firm data — failing loud is the honest treatment.
    absence: "fail",
    description: "The date the document was assembled, in the matter's office's time zone.",
  },
];

const BY_KEY: ReadonlyMap<string, DictionaryEntry> = new Map(
  DICTIONARY.map((entry) => [entry.key, entry]),
);

export function lookupDictionaryEntry(key: string): DictionaryEntry | undefined {
  return BY_KEY.get(key);
}

// True when `format` is a legal rendering for the entry's value type. A format that is legal for money
// is not legal for a date, and a placeholder naming one is an authoring mistake worth reporting at
// registration rather than rendering as something surprising.
export function isLegalFormat(entry: DictionaryEntry, format: string): boolean {
  return legalFormatsFor(entry.valueType).includes(format);
}

// The dictionary as a firm sees it. Slice 2·6·2 appends the firm's own `custom.<handle>` entries here,
// derived at read time from the custom-field catalogue; today the catalogue is entirely static, so the
// seam is a function rather than the constant it would otherwise be.
export function dictionaryForFirm(): readonly DictionaryEntry[] {
  return DICTIONARY;
}

// ---------------------------------------------------------------------------------------------
// The dictionary as the expression language sees it
// ---------------------------------------------------------------------------------------------

// A stored value's encoding and an expression's type are deliberately different vocabularies. The one
// that matters here: THERE IS NO INSTANT TYPE IN THE LANGUAGE. A key whose stored value is an instant
// is projected to a calendar date in the matter's office time zone once, at the resolution boundary,
// before the evaluator ever sees it — so time-of-day arithmetic is not expressible, which is correct.
// Legal deadlines are date arithmetic, and an expression that could subtract hours would silently make
// a filing date depend on the hour a job happened to run.
export function expressionTypeOf(valueType: MergeValueType): ExpressionType {
  switch (valueType) {
    case "date":
      return "date";
    case "money":
      return "money";
    case "rate":
      return "rate";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "list":
      return "list";
    case "reference":
    case "text":
      return "text";
  }
}

// The base name scope every expression in a template is checked against: one entry per dictionary key,
// looked up by EXACT MATCH through a Map. A name that resolves to nothing here is a registration error
// naming it — which is why `__proto__.constructor` is uninteresting rather than dangerous.
export function expressionScopeFor(
  entries: readonly DictionaryEntry[] = DICTIONARY,
): ExpressionScope {
  const scope = new Map<string, NameBinding>();
  for (const entry of entries) {
    scope.set(entry.key, {
      type: expressionTypeOf(entry.valueType),
      origin: "dictionary",
      itemFields:
        entry.itemFields === undefined
          ? undefined
          : new Map(
              entry.itemFields.map((field) => [field.name, expressionTypeOf(field.valueType)]),
            ),
    });
  }
  return scope;
}
