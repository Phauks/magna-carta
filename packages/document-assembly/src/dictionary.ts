import type { AbsenceBehaviour, MergeSource, MergeValueType, Sensitivity } from "./types.ts";
import { legalFormatsFor } from "./format.ts";

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
