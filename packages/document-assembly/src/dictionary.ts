import type { MergeValueType } from "./types.ts";
import { generateDictionary } from "./catalog/generate.ts";
import { legalFormatsFor } from "./format.ts";
import type { ExpressionType } from "./expression/catalog.ts";
import type { ExpressionScope, NameBinding } from "./expression/check.ts";

// The merge-field data dictionary: a declarative catalogue, one entry per key, rather than a resolver
// per field. Adding a merge field is a declaration plus a line in the source's batched read, never a new
// code path on the assembly hot path.
//
// The catalogue is GENERATED — the cross product of a subject registry and a facet registry, plus the
// written-out facts of the one-of-a-kind subjects. See `src/catalog/`. Everything below consumes
// `readonly DictionaryEntry[]` and is indifferent to how the array was built.
//
// The dictionary is also what makes batched resolution possible: because normalization already recorded
// which keys a template version uses, looking each up here plans every read before any XML is touched.

export type {
  DictionaryEntry,
  DictionaryItemField,
  EntryStatus,
  MergeFieldAvailability,
} from "./catalog/entry.ts";
export { availabilityFor, availabilityNoteFor } from "./catalog/entry.ts";

import type { DictionaryEntry } from "./catalog/entry.ts";

// The platform's shipped entries: the matter, the matter's home office, the firm, the matter's party
// subjects and their facets, the client's sealed identifiers, and the document's own values. A firm's
// own fields widen this list per firm at read time (custom-field-bindings.ts); nothing else does.
export const DICTIONARY: readonly DictionaryEntry[] = generateDictionary();

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
// A NAME IS TEXT IN THE LANGUAGE, at its default rendering. A document prints text, and a computation
// over a name part is not something this language does — `upper(client.displayName)` is the composition
// an author writes, visibly, and it operates on the rendered name exactly as it operates on any string.
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
    case "name":
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
