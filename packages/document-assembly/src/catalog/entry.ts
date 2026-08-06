import type { AbsenceBehaviour, MergeSource, MergeValueType, Sensitivity } from "../types.ts";
import type { FacetProminence } from "./facets.ts";
import { mergeSubject } from "./subjects.ts";

// One merge field, as everything downstream sees it.
//
// THE DICTIONARY IS THE ONE HOME AND THE READ CONTRACT IS ITS PROJECTION, not its twin. The entry
// carries what resolution needs (source, value type, absence behaviour) AND what a person choosing a
// field needs (label, group, subject, prominence, synonyms, example renderings), because two catalogues
// describing the same fields is a drift generator: the second one invents keys the engine does not have
// and nobody notices until an author binds one.

export interface DictionaryItemField {
  readonly name: string;
  readonly valueType: MergeValueType;
  readonly description: string;
}

// Whether an entry is still the way to name this fact. A withdrawn key is DEPRECATED, never removed: it
// keeps resolving so registered templates keep working, and it is hidden from the picker's default view
// and flagged in the field inspector with what replaced it.
export type EntryStatus = "current" | "deprecated";

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
  // What a person calls it — "Opposing counsel's name". The picker row's subject, the words an absence
  // marker spells out, and the thing search matches first; the key is search vocabulary beside it.
  readonly label: string;
  // The picker's top-level heading, from the group registry.
  readonly group: string;
  // The subject the key's first segment names, so a picker can nest a hundred fields under a dozen
  // subheadings rather than under one.
  readonly subject: string;
  // Ordering and default visibility. NEVER a filter on what exists: a field that exists is always
  // findable by search, because hiding the field someone needs, in a product whose alternative is
  // retyping it into a filed document, is the worse failure.
  readonly prominence: FacetProminence;
  // Search vocabulary a firm would type — "defendant", "SSN". Declared per facet and per subject, so the
  // list stays about as long as the registries rather than as long as the catalogue.
  readonly synonyms: readonly string[];
  // One invented sample rendering per legal format, produced by running an invented value through the
  // real format table. Never firm data, so the catalogue is safe to show before a matter is chosen and
  // safe to cache in a browser — and never a second hand-written copy of what the formatter does.
  readonly exampleRenderings: Readonly<Record<string, string>>;
  readonly status: EntryStatus;
  // What replaced a deprecated key. Absent on a current one.
  readonly supersededBy?: string;
}

// Where a field's value comes from when a document is assembled — the distinction a field-input surface
// exists to make legible. DERIVED from the entry's source and its subject's optionality rather than
// declared on every row: one fact in one place, where declaring it three hundred times would drift the
// first time a source moved.
export type MergeFieldAvailability = "automatic" | "conditional" | "manual" | "unavailable";

// What each source can say for itself, in the product's voice. One sentence, and the same sentence for
// every key the source answers.
const SOURCE_NOTES: Readonly<Record<MergeSource, string>> = {
  matter: "Filled from the matter's own record.",
  party: "Filled from the parties linked to the matter.",
  location: "Filled from the office the matter belongs to.",
  firm: "Filled from the firm's own record.",
  customField: "Filled from this firm's own field on the matter.",
  protectedIdentifier:
    "Held encrypted. It is filled in only for a member permitted to decrypt it, and every such reading is recorded.",
  system: "Filled at the moment the document is assembled.",
};

export function availabilityFor(entry: DictionaryEntry): MergeFieldAvailability {
  // Every source the platform ships resolves from firm data, so nothing here is `manual` or
  // `unavailable` yet — those arrive with a facet whose fact no read can answer, and the contract
  // carries them because the field-input surface has to render that state when one does.
  return mergeSubject(entry.subject)?.presence === "conditional" ? "conditional" : "automatic";
}

export function availabilityNoteFor(entry: DictionaryEntry): string {
  const note = SOURCE_NOTES[entry.source];
  const subject = mergeSubject(entry.subject);
  if (subject === undefined || subject.presence !== "conditional") return note;
  return `${note} A matter with no ${subject.proseLabel} shows a marker where this would go.`;
}
