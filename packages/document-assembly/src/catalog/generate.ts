import {
  ASSET_AGGREGATE_SUBJECT,
  ASSET_LIST_FIELD,
  assetItemFieldsFor,
} from "../asset-bindings.ts";
import {
  MEMBER_PROTECTED_DICTIONARY_ENTRIES,
  PROTECTED_DICTIONARY_ENTRIES,
} from "../protected-bindings.ts";
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
    description: "Whether the matter is in intake, a consultation, open, or closed.",
    synonyms: ["open", "closed", "consultation", "intake"],
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

// The invented judge every judge example renders — a name with parts, so the picker's format
// chooser shows what each rendering does to the same person.
const EXAMPLE_JUDGE: MergeValue = {
  kind: "name",
  display: "Mira Calloway",
  prefix: "Hon.",
  given: "Mira",
  family: "Calloway",
  isOrganisation: false,
};

// The invented decedent every estate example renders.
const EXAMPLE_DECEDENT: MergeValue = {
  kind: "name",
  display: "Rowan Ashcroft",
  prefix: "Dr.",
  given: "Rowan",
  middle: "Tobias",
  family: "Ashcroft",
  suffix: "Jr.",
  isOrganisation: false,
};

// WHERE the case is: the courthouse and the judge, both Directory records the court-case record
// points at, so the court's own identity comes from the Directory rather than from columns restated
// on the matter. The court's structured address facet arrives with the structured address value
// type; until then a court key set that cannot render an address honestly carries none.
const COURT_FACETS: readonly NamedFacet[] = [
  {
    name: "name",
    source: "court",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Court name",
    description: "The name of the court the matter's case is before.",
    synonyms: ["court name", "district court", "tribunal"],
    example: { kind: "text", text: "Second Judicial District Court" },
  },
  {
    name: "judge",
    source: "court",
    valueType: "name",
    defaultFormat: "full",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Assigned judge",
    description: "The judge assigned to the matter's case, in any name rendering.",
    synonyms: ["judge", "justice", "judicial officer"],
    example: EXAMPLE_JUDGE,
  },
];

// WHAT the case is: its number, its dates, and the two designation words this court's captions use.
// Side is a caption FACT recorded here, never a key axis — a fixed plaintiff/defendant pair would be
// wrong for every petition, appeal, and probate proceeding, so the caption prints the words the
// firm recorded for this court.
const CASE_FACETS: readonly NamedFacet[] = [
  {
    name: "number",
    source: "court",
    valueType: "text",
    defaultFormat: "plain",
    // A case not yet filed has no number, and the caption's "Case No. [CASE NUMBER]" marker is the
    // honest state of a draft prepared for filing — so a marker, not a stopped assembly.
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Case number",
    description: "The case number as the court issued it.",
    synonyms: ["case number", "cause number", "docket number", "case no"],
    example: { kind: "text", text: "CV26-01482" },
  },
  {
    name: "filedOn",
    source: "court",
    valueType: "date",
    defaultFormat: "long",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Date filed",
    description: "The date the case was filed, as recorded on the court-case record.",
    synonyms: ["filing date", "filed", "commenced"],
    example: { kind: "date", isoDate: "2026-04-09" },
  },
  {
    name: "division",
    source: "court",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Court division",
    description: "The division the case is assigned to, where the court has divisions.",
    synonyms: ["division"],
    example: { kind: "text", text: "Family Division" },
  },
  {
    name: "department",
    source: "court",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Court department",
    description: "The department the case is assigned to, where the court has departments.",
    synonyms: ["department", "dept"],
    example: { kind: "text", text: "Department 6" },
  },
  {
    name: "clientDesignation",
    source: "court",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Client's designation",
    description:
      "What this court's caption calls the client's side — recorded on the case, never guessed.",
    synonyms: ["plaintiff", "petitioner", "designation", "side"],
    example: { kind: "text", text: "Petitioner" },
  },
  {
    name: "opposingDesignation",
    source: "court",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Opposing designation",
    description:
      "What this court's caption calls the other side — recorded on the case, never guessed.",
    synonyms: ["defendant", "respondent", "designation", "side"],
    example: { kind: "text", text: "Respondent" },
  },
];

// The estate's several names, each used in a different place: the decedent's (a Directory person,
// so every name format applies), the style a caption and a bank account use, and the short style a
// letter's second reference uses. THE STYLES ARE STORED, NOT COMPOSED — a legal designation a court
// has fixed is not a string a template may invent.
const ESTATE_FACETS: readonly NamedFacet[] = [
  {
    name: "style",
    source: "estate",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Estate style",
    description: "The estate's style exactly as the court has it — stored, never composed.",
    synonyms: ["estate name", "estate of", "in the matter of"],
    example: { kind: "text", text: "the Estate of Rowan Ashcroft, Deceased" },
  },
  {
    name: "shortStyle",
    source: "estate",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Estate short style",
    description: "The estate's short style, for a letter's second reference.",
    synonyms: ["short name", "short style"],
    example: { kind: "text", text: "the Ashcroft Estate" },
  },
  {
    name: "decedent",
    source: "estate",
    valueType: "name",
    defaultFormat: "full",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Decedent's name",
    description: "The decedent's name, in any name rendering, from their Directory record.",
    synonyms: ["decedent", "deceased", "the departed"],
    example: EXAMPLE_DECEDENT,
  },
  {
    name: "dateOfDeath",
    source: "estate",
    valueType: "date",
    defaultFormat: "long",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: "Date of death",
    description: "The decedent's date of death, as recorded on the estate record.",
    synonyms: ["DOD", "died", "date of death"],
    example: { kind: "date", isoDate: "2026-01-17" },
  },
  {
    name: "proceedingType",
    source: "estate",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Proceeding type",
    description: "Whether the proceeding is testate, intestate, a small estate, or ancillary.",
    synonyms: ["testate", "intestate", "small estate", "ancillary"],
    example: { kind: "text", text: "intestate" },
  },
  {
    name: "lettersIssuedOn",
    source: "estate",
    valueType: "date",
    defaultFormat: "long",
    absence: "placeholder",
    sensitivity: ORDINARY,
    prominence: "secondary",
    label: "Letters issued",
    description: "The date the court issued letters, as recorded on the estate record.",
    synonyms: ["letters", "letters testamentary", "letters of administration"],
    example: { kind: "date", isoDate: "2026-03-02" },
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

// The asset register's subjects. Each one declares EXACTLY ONE facet — its collection — and the
// generator below is what makes that structural rather than a convention: an `assetClass` subject
// gets this list and nothing else, and `test/asset-subjects.test.ts` asserts no scalar ever appears
// under one. A scalar `realProperty.parcelNumber` would resolve to an absence naming the count on any
// estate with two houses, which is a slot that should not exist rather than a slot that refuses.
function assetCollectionFacet(subject: MergeSubject): NamedFacet {
  return {
    name: ASSET_LIST_FIELD,
    source: "asset",
    valueType: "list",
    // A list is never rendered — a repeating block walks it — so its default format is the empty
    // rendering the format table declares for the type.
    defaultFormat: "",
    // AN EMPTY LIST IS A CORRECT DOCUMENT. A matter with no vehicles produces nothing where the
    // repeating block sits, which is the catalogue's declared rule for collections and the honest
    // answer for a firm whose client owns no car.
    absence: "blank",
    sensitivity: ORDINARY,
    prominence: "primary",
    label: `${subject.label}, for a repeating block`,
    description:
      subject.key === ASSET_AGGREGATE_SUBJECT
        ? "Everything on the matter's asset register, for a repeating block to walk. Every value prints with the date it speaks to."
        : `Every ${subject.proseLabel} on the matter's asset register, for a repeating block to walk. Every value prints with the date it speaks to.`,
    synonyms: [],
    itemFields: assetItemFieldsFor(subject.key),
  };
}

// The written-out facets, per subject key. A subject with no row here carries only its generated facet
// set; a subject with no generated facets and no row here would carry nothing, which the fitness test
// refuses.
const NAMED_FACETS: Readonly<Record<string, readonly NamedFacet[]>> = {
  matter: MATTER_FACETS,
  client: CLIENT_FACETS,
  location: LOCATION_FACETS,
  firm: FIRM_FACETS,
  court: COURT_FACETS,
  case: CASE_FACETS,
  estate: ESTATE_FACETS,
  system: SYSTEM_FACETS,
  ...Object.fromEntries(
    MERGE_SUBJECTS.filter((subject) => subject.kind === "assetClass").map((subject) => [
      subject.key,
      [assetCollectionFacet(subject)],
    ]),
  ),
};

// The client's sealed identifiers. Every one is `sensitivity: protected`, which is not a label on the
// row but the routing decision: resolution reaches these through the protected-field chokepoint's
// permission-gated, audited decrypt and through nothing else — see protected-bindings.ts.
const PROTECTED_BY_SUBJECT: Readonly<Record<string, readonly DictionaryEntry[]>> = {
  client: PROTECTED_DICTIONARY_ENTRIES,
  // Each member subject carries the one protected fact a pleading actually states about the firm's
  // own people: the bar number, read through the same chokepoint the client's identifiers use.
  ...Object.fromEntries(
    MEMBER_PROTECTED_DICTIONARY_ENTRIES.map((entry) => [entry.subject, [entry]]),
  ),
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
