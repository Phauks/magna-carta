import type { AbsenceBehaviour, MergeSource, MergeValueType, Sensitivity } from "./types.ts";
import { DIRECTORY_ROLE_DICTIONARY_ENTRIES } from "./directory-role-bindings.ts";
import { PROTECTED_DICTIONARY_ENTRIES } from "./protected-bindings.ts";
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
  // member's decrypt permission is checked and an audit row is written. A member who does not hold that
  // permission gets a declared absence naming the field and the permission — never the value, never a
  // silent blank, and never a failed assembly. See protected-bindings.ts.
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

// The platform's shipped entries: matter, the matter's home location, the firm, the matter's client
// party, the Directory role sources the matter's party links supply, and system values. A firm's own
// fields widen this list per firm at read time (custom-field-bindings.ts); nothing else does.
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
    key: "location.letterheadLogo",
    source: "location",
    valueType: "image",
    // An image has no rendering to name. The empty default is what makes every `:format` suffix illegal
    // by the same check every other entry passes through.
    defaultFormat: "",
    sensitivity: "ordinary",
    // An office that has uploaded no logo yet is a firm mid-setup, not a document that must not be
    // filed — and a marker where the logo goes is exactly the reminder that produces the upload.
    absence: "placeholder",
    description: "The office's letterhead logo, drawn at the size the office set for it.",
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
  // The matter's other parties, one group of entries per role the platform ships a source for. Generated
  // rather than written out because the three keys a role contributes are the same three every time, and
  // a hand-written copy per role is four chances to give one of them a different absence behaviour than
  // its siblings. They resolve from the SAME party read `matter.parties` uses — see
  // directory-role-bindings.ts.
  ...DIRECTORY_ROLE_DICTIONARY_ENTRIES,
  // The client's sealed identifiers. Every one is `sensitivity: protected`, which is not a label on the
  // row but the routing decision: resolution reaches these through the protected-field chokepoint's
  // permission-gated, audited decrypt and through nothing else — see protected-bindings.ts.
  ...PROTECTED_DICTIONARY_ENTRIES,
];

// One index per entry list, built once and remembered against the list itself. A firm's catalogue is
// assembled per registration and per assembly and then looked up once per placeholder, so rebuilding the
// Map at every lookup would turn a template with 140 fields into 140 passes over the whole dictionary —
// and a linear scan would do the same. The cache is keyed by the array, so a catalogue that changes
// produces a different array and therefore a different index; nothing here can serve a stale answer.
const INDEX_BY_ENTRIES = new WeakMap<
  readonly DictionaryEntry[],
  ReadonlyMap<string, DictionaryEntry>
>();

export function dictionaryIndex(
  entries: readonly DictionaryEntry[] = DICTIONARY,
): ReadonlyMap<string, DictionaryEntry> {
  const cached = INDEX_BY_ENTRIES.get(entries);
  if (cached !== undefined) return cached;
  const index: ReadonlyMap<string, DictionaryEntry> = new Map(
    entries.map((entry) => [entry.key, entry]),
  );
  INDEX_BY_ENTRIES.set(entries, index);
  return index;
}

// A key resolves by EXACT MATCH against the catalogue the CALLER hands in — the firm's, when the caller
// has one. Defaulting to the platform's shipped list keeps every existing call site honest, but a caller
// that omits the firm's catalogue is asking whether the PLATFORM has a key, which is a different
// question from whether this firm does: a `custom.customField_…` binding exists for one firm and not for
// the next, and answering from the shipped list alone would report every firm's own fields as unknown.
export function lookupDictionaryEntry(
  key: string,
  entries: readonly DictionaryEntry[] = DICTIONARY,
): DictionaryEntry | undefined {
  return dictionaryIndex(entries).get(key);
}

// True when `format` is a legal rendering for the entry's value type. A format that is legal for money
// is not legal for a date, and a placeholder naming one is an authoring mistake worth reporting at
// registration rather than rendering as something surprising.
export function isLegalFormat(entry: DictionaryEntry, format: string): boolean {
  return legalFormatsFor(entry.valueType).includes(format);
}

// The dictionary as a firm sees it: the platform's shipped entries plus the firm's own
// `custom.<handle>` bindings, derived at read time from its custom-field catalogue. The firm's entries
// come LAST and cannot displace a shipped one — the key namespaces are disjoint by construction (a
// custom key always begins `custom.`), and the ordering makes that a property of the result rather than
// a claim about the inputs.
export function dictionaryForFirm(
  customFieldEntries: readonly DictionaryEntry[] = [],
): readonly DictionaryEntry[] {
  if (customFieldEntries.length === 0) return DICTIONARY;
  return [...DICTIONARY, ...customFieldEntries];
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
// Returns undefined for a value type the language has NO type for, which today is exactly one: an image.
// There is nothing an expression could do with a picture — it cannot be compared, concatenated, tested,
// or computed with — so rather than invent a type whose every operation is an error, the key is simply
// absent from the scope, and `{{#if location.letterheadLogo}}` is refused at registration as an unknown
// merge field with the same message any other unbindable name gets.
export function expressionTypeOf(valueType: MergeValueType): ExpressionType | undefined {
  switch (valueType) {
    case "image":
      return undefined;
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
    const type = expressionTypeOf(entry.valueType);
    if (type === undefined) continue;
    scope.set(entry.key, {
      type,
      origin: "dictionary",
      itemFields:
        entry.itemFields === undefined
          ? undefined
          : new Map(
              entry.itemFields.flatMap((field) => {
                const fieldType = expressionTypeOf(field.valueType);
                return fieldType === undefined ? [] : [[field.name, fieldType] as const];
              }),
            ),
    });
  }
  return scope;
}
