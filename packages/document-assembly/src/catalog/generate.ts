import { PROTECTED_DICTIONARY_ENTRIES } from "../protected-bindings.ts";
import type {
  AbsenceBehaviour,
  MergeSource,
  MergeValue,
  MergeValueType,
  Sensitivity,
} from "../types.ts";
import type { DictionaryEntry, DictionaryItemField } from "./entry.ts";
import { exampleRenderingsFor } from "./examples.ts";
import { facetsForKind, type FacetProminence, type MergeFacet } from "./facets.ts";
import { MERGE_SUBJECTS, type MergeSubject } from "./subjects.ts";

// The catalogue, materialized.
//
// SUBJECTS × FACETS(subject.kind) -> the flat dictionary. A key stays exactly what it always was — a
// flat, dotted, exactly-matched token — and what changes is how the list of keys is WRITTEN DOWN.
// Adding a party role is one row in the subject registry and its whole facet set follows; adding a
// facet is one row and every subject of that kind gains it with identical behaviour.
//
// Beside the product sit the WRITTEN-OUT entries. A subject of kind `matter`, `office`, `firm`, or
// `system` is one of a kind, and its facts are its own columns rather than a vocabulary shared with
// siblings — so those are spelled out, and spelling them out is correct: there is exactly one of each.
//
// THE MISTAKE MODE INVERTS. A hand-written catalogue produces local errors that are invisible; a
// generated one produces systematic errors that every test sees at once. The golden key list
// (test/fixtures/shipped-keys.json) and the generation fitness test are what buy that back.

// A written-out fact about a one-of-a-kind subject, or a fact one subject carries that its siblings do
// not. The subject supplies the key's first segment, the group, and the availability derivation; this
// supplies the rest.
export interface NamedFacet {
  readonly name: string;
  readonly source: MergeSource;
  readonly valueType: MergeValueType;
  readonly defaultFormat: string;
  readonly absence: AbsenceBehaviour;
  readonly sensitivity: Sensitivity;
  readonly prominence: FacetProminence;
  readonly label: string;
  readonly description: string;
  readonly synonyms: readonly string[];
  // Omitted for a value type with no legal format — a list and an image are never rendered as text, so
  // there is nothing to show an example of.
  readonly example?: MergeValue;
  readonly itemFields?: readonly DictionaryItemField[];
}

// The one place a generated entry differs from its siblings. Keyed by the whole key, so an override is a
// visible line naming exactly which key departs from the facet's declaration and nothing is special-
// cased silently.
//
// There is exactly one today: the client's name FAILS the assembly when it cannot be resolved, where
// every other party's name shows a marker. A letter to nobody is a letter; a retainer agreement naming
// no client is not a document at all.
const FACET_OVERRIDES: Readonly<
  Record<string, Partial<Pick<DictionaryEntry, "absence" | "description" | "label" | "prominence">>>
> = {
  "client.displayName": {
    absence: "fail",
    // The client's name comes off the matter's own row rather than out of the party collection, so the
    // sibling wording — "when the matter links exactly one" — would describe a resolution this key does
    // not perform.
    description: "The client's name as it should appear in a document.",
  },
};

function applyTemplate(template: string, subject: MergeSubject): string {
  return template.replace("{subject}", subject.label).replace(/\{prose\}/g, subject.proseLabel);
}

function entryFromFacet(subject: MergeSubject, facet: MergeFacet): DictionaryEntry {
  const key = `${subject.key}.${facet.name}`;
  const base: DictionaryEntry = {
    key,
    source: facet.source,
    valueType: facet.valueType,
    defaultFormat: facet.defaultFormat,
    sensitivity: facet.sensitivity,
    absence: facet.absence,
    description: applyTemplate(facet.descriptionTemplate, subject),
    label: applyTemplate(facet.labelTemplate, subject),
    group: subject.group,
    subject: subject.key,
    prominence: facet.prominence,
    // The subject's own search words plus the facet's: someone typing "defendant" is naming the
    // subject, and someone typing "surname" is naming the facet, and both have to find the same row.
    synonyms: [...subject.synonyms, ...facet.synonyms],
    exampleRenderings: exampleRenderingsFor(facet.valueType, facet.example),
    status: "current",
    ...(facet.itemFields === undefined ? {} : { itemFields: facet.itemFields }),
  };
  const override = FACET_OVERRIDES[key];
  return override === undefined ? base : { ...base, ...override };
}

function entryFromNamedFacet(subject: MergeSubject, facet: NamedFacet): DictionaryEntry {
  return {
    key: `${subject.key}.${facet.name}`,
    source: facet.source,
    valueType: facet.valueType,
    defaultFormat: facet.defaultFormat,
    sensitivity: facet.sensitivity,
    absence: facet.absence,
    description: facet.description,
    label: facet.label,
    group: subject.group,
    subject: subject.key,
    prominence: facet.prominence,
    synonyms: [...subject.synonyms, ...facet.synonyms],
    exampleRenderings: exampleRenderingsFor(facet.valueType, facet.example),
    status: "current",
    ...(facet.itemFields === undefined ? {} : { itemFields: facet.itemFields }),
  };
}

// ---------------------------------------------------------------------------------------------
// The written-out subjects
// ---------------------------------------------------------------------------------------------

const ORDINARY: Sensitivity = "ordinary";

const MATTER_FACETS: readonly NamedFacet[] = [
  {
    name: "number",
    source: "matter",
    valueType: "text",
    defaultFormat: "plain",
    // A pleading caption without a matter number is not a filing. An absence here stops the assembly
    // rather than producing a document that looks finished.
    absence: "fail",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Matter number",
    description: "The matter's file number.",
    synonyms: ["file number", "matter id", "reference"],
    example: { kind: "text", text: "2026-0142" },
  },
  {
    name: "title",
    source: "matter",
    valueType: "text",
    defaultFormat: "plain",
    absence: "fail",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Matter title",
    description: "The matter's title.",
    synonyms: ["matter name", "subject"],
    example: { kind: "text", text: "Estate of Rowan Ashcroft" },
  },
  {
    name: "description",
    source: "matter",
    valueType: "text",
    defaultFormat: "plain",
    absence: "blank",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Matter description",
    description: "The matter's description, if one was recorded.",
    synonyms: ["summary", "notes"],
    example: {
      kind: "text",
      text: "Administration of the estate, including sale of the Cavendish Row property.",
    },
  },
  {
    name: "status",
    source: "matter",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Matter status",
    description: "Whether the matter is prospective, open, or closed.",
    synonyms: ["open", "closed", "prospective"],
    example: { kind: "text", text: "open" },
  },
  {
    name: "openedOn",
    source: "matter",
    valueType: "date",
    defaultFormat: "long",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Date opened",
    description: "The date the matter was opened, in the matter's office's time zone.",
    synonyms: ["open date", "start date", "engaged"],
    example: { kind: "date", isoDate: "2026-03-14" },
  },
  {
    name: "eBilling",
    source: "matter",
    valueType: "boolean",
    defaultFormat: "yesNo",
    // A boolean the matter always carries: it is on or it is off, never missing. Declared `fail` so a
    // matter row that somehow supplied nothing is a loud defect rather than a silently absent clause.
    absence: "fail",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Electronic billing",
    description: "Whether the matter bills through an electronic billing channel.",
    synonyms: ["ebilling", "electronic invoicing"],
    example: { kind: "boolean", value: true },
  },
  {
    name: "parties",
    source: "party",
    valueType: "list",
    // A list is never rendered — a repeating block walks it — so its default format is the empty
    // rendering the format table declares for the type.
    defaultFormat: "",
    // A matter with no linked parties is an empty list, not an absence: a repeating block over it
    // simply produces nothing, which is the correct document.
    absence: "blank",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Everyone on the matter",
    description: "Everyone linked to the matter, for a repeating block to walk.",
    synonyms: ["party list", "everyone", "participants"],
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
];

const CLIENT_FACETS: readonly NamedFacet[] = [
  {
    name: "code",
    source: "party",
    valueType: "text",
    defaultFormat: "plain",
    absence: "blank",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Client code",
    description: "The firm's own client code for this client, if one was recorded.",
    synonyms: ["client number", "account code"],
    example: { kind: "text", text: "ASH-014" },
  },
];

// `location.*` resolves from THE MATTER'S home office, never the acting member's, so a document
// assembled by a member of one office on a matter belonging to another carries the correct office
// identity. That is the whole reason the Locations model carries letterhead columns.
const LOCATION_FACETS: readonly NamedFacet[] = [
  {
    name: "name",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Office name",
    description: "The name of the office the matter belongs to.",
    synonyms: ["branch"],
    example: { kind: "text", text: "Reno office" },
  },
  {
    name: "addressBlock",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Office address block",
    description: "The office's address block, as it appears on letterhead.",
    synonyms: ["address", "letterhead address"],
    example: { kind: "text", text: "14 Cavendish Row, Reno, NV 89501" },
  },
  {
    name: "footer",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    absence: "blank",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Letterhead footer",
    description: "The office's letterhead footer text.",
    synonyms: ["footer"],
    example: { kind: "text", text: "Admitted in Nevada and California" },
  },
  {
    name: "remitTo",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Remit-to address",
    description: "Where the office asks payment to be sent.",
    synonyms: ["payment address", "remittance"],
    example: { kind: "text", text: "PO Box 4417, Reno, NV 89505" },
  },
  {
    name: "jurisdiction",
    source: "location",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Office jurisdiction",
    description: "The jurisdiction the office practises in.",
    synonyms: ["state", "venue"],
    example: { kind: "text", text: "Nevada" },
  },
  {
    name: "letterheadLogo",
    source: "location",
    valueType: "image",
    // An image has no rendering to name. The empty default is what makes every `:format` suffix illegal
    // by the same check every other entry passes through.
    defaultFormat: "",
    // An office that has uploaded no logo yet is a firm mid-setup, not a document that must not be
    // filed — and a marker where the logo goes is exactly the reminder that produces the upload.
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Letterhead logo",
    description: "The office's letterhead logo, drawn at the size the office set for it.",
    synonyms: ["logo", "mark", "letterhead image"],
  },
];

const FIRM_FACETS: readonly NamedFacet[] = [
  {
    name: "name",
    source: "firm",
    valueType: "text",
    defaultFormat: "plain",
    absence: "fail",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Firm name",
    description: "The firm's name.",
    synonyms: ["our name"],
    example: { kind: "text", text: "Marchetti & Vale LLP" },
  },
];

const SYSTEM_FACETS: readonly NamedFacet[] = [
  {
    name: "today",
    source: "system",
    valueType: "date",
    defaultFormat: "long",
    // A system value can always be produced, so an absence here would be a defect rather than missing
    // firm data — failing loud is the honest treatment.
    absence: "fail",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Today's date",
    description: "The date the document was assembled, in the matter's office's time zone.",
    synonyms: ["date", "current date", "assembly date"],
    example: { kind: "date", isoDate: "2026-08-05" },
  },
];

// The written-out facets, per subject key. A subject with no row here carries only its generated facet
// set; a subject with no generated facets and no row here would carry nothing, which the fitness test
// refuses.
const NAMED_FACETS: Readonly<Record<string, readonly NamedFacet[]>> = {
  matter: MATTER_FACETS,
  client: CLIENT_FACETS,
  location: LOCATION_FACETS,
  firm: FIRM_FACETS,
  system: SYSTEM_FACETS,
};

// The client's sealed identifiers. Every one is `sensitivity: protected`, which is not a label on the
// row but the routing decision: resolution reaches these through the protected-field chokepoint's
// permission-gated, audited decrypt and through nothing else — see protected-bindings.ts.
const PROTECTED_BY_SUBJECT: Readonly<Record<string, readonly DictionaryEntry[]>> = {
  client: PROTECTED_DICTIONARY_ENTRIES,
};

// The whole platform catalogue, in the order a picker would walk it: subject by subject, and within a
// subject the written-out facts first, then the generated facet set, then anything the protected read
// path supplies.
export function generateDictionary(): readonly DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  for (const subject of MERGE_SUBJECTS) {
    for (const facet of NAMED_FACETS[subject.key] ?? []) {
      entries.push(entryFromNamedFacet(subject, facet));
    }
    for (const facet of facetsForKind(subject.kind)) {
      entries.push(entryFromFacet(subject, facet));
    }
    for (const entry of PROTECTED_BY_SUBJECT[subject.key] ?? []) entries.push(entry);
  }
  return entries;
}
