import type {
  AbsenceBehaviour,
  MergeSource,
  MergeValue,
  MergeValueType,
  Sensitivity,
} from "../types.ts";
import type { SubjectKind } from "./subjects.ts";

// The facet registry: one fact about a subject of a given kind.
//
// A FACET THAT APPLIES TO FOURTEEN SUBJECTS IS DECLARED ONCE. That is the whole point of the shape: a
// hand-written catalogue produces local errors that are invisible — one row in ten quietly given a
// different absence behaviour than its siblings — while a generated one produces systematic errors that
// every test sees at once. A facet whose behaviour genuinely differs on one subject is then a deliberate
// line in the override table (generate.ts) rather than a divergence nobody notices.
//
// A FACET IS A DIFFERENT FACT; A FORMAT IS THE SAME FACT RENDERED DIFFERENTLY. The test that settles it:
// could both renderings appear in the same sentence about the same thing? "Ashcroft, Rowan" and "Rowan
// Ashcroft" cannot — one fact, two renderings, so surname-first is a format. A party's name and a
// party's record type can — two facts, two facets. Formats are the reason a catalogue of hundreds is not
// a catalogue of thousands.

// Ordering and default visibility in the picker, never a filter on what exists. A `secondary` facet is
// one interaction away, and always findable by search.
export type FacetProminence = "primary" | "secondary";

export interface MergeFacet {
  // The key's second segment.
  readonly name: string;
  // Every subject kind this facet applies to. A kind listed here means EVERY subject of that kind gains
  // the facet — a hole in the product is a defect, not a choice.
  readonly kinds: readonly SubjectKind[];
  readonly source: MergeSource;
  readonly valueType: MergeValueType;
  readonly defaultFormat: string;
  readonly absence: AbsenceBehaviour;
  readonly sensitivity: Sensitivity;
  readonly prominence: FacetProminence;
  // `{subject}` is the subject's label ("Opposing counsel"), `{prose}` its running-prose label
  // ("opposing counsel"). The label is what a person reads in the picker and what an absence marker
  // spells out, so it is written the way a person says it rather than the way the key spells it.
  readonly labelTemplate: string;
  readonly descriptionTemplate: string;
  readonly synonyms: readonly string[];
  // Invented sample data, rendered through the real format table so the catalogue's example renderings
  // are what the formatter actually produces rather than a second hand-written copy of them. Never firm
  // data: the catalogue is safe to show before a matter is chosen and safe to cache in a browser.
  // Omitted for a value type with no legal format — a list is never rendered, so there is nothing to
  // show an example of.
  readonly example?: MergeValue;
  readonly itemFields?: readonly {
    readonly name: string;
    readonly valueType: MergeValueType;
    readonly description: string;
  }[];
}

// The invented person every name example renders. One sample, seven renderings, so the picker's format
// chooser shows the same person in every row and the difference between the formats is the only thing
// that moves.
const EXAMPLE_NAME: MergeValue = {
  kind: "name",
  display: "Rowan Ashcroft",
  prefix: "Dr.",
  given: "Rowan",
  middle: "Tobias",
  family: "Ashcroft",
  suffix: "Jr.",
  isOrganisation: false,
};

// The party facet set: the facts every party subject carries, filled by the one party read.
const PARTY_FACETS: readonly MergeFacet[] = [
  {
    name: "displayName",
    kinds: ["party"],
    source: "party",
    valueType: "name",
    // `full` renders the recorded display name unchanged, which is byte-for-byte what this key rendered
    // before it carried name parts at all. Every other rendering is opt-in at the placeholder, so no
    // registered template's output moved when the parts arrived.
    defaultFormat: "full",
    absence: "placeholder",
    sensitivity: "ordinary",
    prominence: "primary",
    labelTemplate: "{subject}'s name",
    descriptionTemplate: "The {prose}'s name, when the matter links exactly one.",
    synonyms: ["name"],
    example: EXAMPLE_NAME,
  },
  {
    name: "kind",
    kinds: ["party"],
    source: "party",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: "ordinary",
    // A sentence that has to read differently for a company needs this; an author writing a letter does
    // not, so it sits behind the subject's disclosure rather than beside the name.
    prominence: "secondary",
    labelTemplate: "{subject}'s record type",
    descriptionTemplate: "Whether the {prose} is a person or an organisation.",
    synonyms: ["person", "organisation", "company", "entity type"],
    example: { kind: "text", text: "person" },
  },
  {
    name: "capacity",
    kinds: ["party"],
    source: "party",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: "ordinary",
    // What lets a sentence name the fiduciary role a party acts in; an author writing an ordinary
    // letter does not reach for it, so it sits behind the subject's disclosure.
    prominence: "secondary",
    labelTemplate: "{subject}'s capacity",
    descriptionTemplate:
      "The capacity the {prose} acts in on this matter, as recorded on the party link — never guessed.",
    synonyms: ["administrator", "trustee", "executor", "attorney-in-fact", "fiduciary"],
    example: { kind: "text", text: "Administrator" },
  },
  {
    name: "capacityLine",
    kinds: ["party"],
    source: "party",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: "ordinary",
    prominence: "secondary",
    labelTemplate: "{subject}'s capacity line",
    // Composed IN THE RESOLVER, never in the template: a hand-concatenated
    // "name, as capacity of style" renders stray punctuation and three markers when a part is
    // missing, where this is one absence with a reason naming which part.
    descriptionTemplate:
      "The {prose}'s name, capacity, and the estate's style as one phrase — one marker, not three, when any part is unrecorded.",
    synonyms: ["as administrator", "fiduciary line", "capacity phrase"],
    example: {
      kind: "text",
      text: "Devon Marchetti, as Administrator of the Estate of Rowan Ashcroft, Deceased",
    },
  },
  {
    name: "pronouns",
    kinds: ["party"],
    source: "party",
    valueType: "text",
    defaultFormat: "plain",
    // THE ONE FACET WHOSE ABSENCE IS BLANK RATHER THAN A MARKER. Everywhere else the bias is a
    // visible hole, because a name silently missing is the worst thing this subsystem can produce.
    // Pronouns invert it: most people never state any, so a marker here would put "[CLIENT
    // PRONOUNS]" on the face of every ordinary letter and train a firm to ignore markers — and a
    // stated pronoun set is a courtesy the person offered, not a field the record owes. The
    // rendering helpers are where the unstated case gets an answer; this key states the fact.
    absence: "blank",
    sensitivity: "ordinary",
    // A field a firm reaches for when a document PRINTS the pronouns — a cover sheet, a signature
    // block. Writing a sentence about the person goes through the pronoun helper instead, so this
    // sits behind the subject's disclosure.
    prominence: "secondary",
    labelTemplate: "{subject}'s pronouns",
    descriptionTemplate:
      "The {prose}'s pronouns as the record states them, written she/her, he/him, they/them. Blank when the record states none — never worked out from a name or a title.",
    synonyms: ["pronoun", "she/her", "he/him", "they/them"],
    example: { kind: "text", text: "they/them" },
  },
  {
    name: "all",
    kinds: ["party"],
    source: "party",
    valueType: "list",
    // A list is never rendered — a repeating block walks it — so its default format is the empty
    // rendering the format table declares for the type.
    defaultFormat: "",
    // A matter with no party in the role has an empty list, which a repeating block correctly renders as
    // nothing at all. That is a correct document, not an absence.
    absence: "blank",
    sensitivity: "ordinary",
    prominence: "primary",
    labelTemplate: "Every {prose} on the matter",
    descriptionTemplate: "Everyone the matter links as {prose}, for a repeating block to walk.",
    synonyms: ["list", "each", "repeating"],
    itemFields: [
      {
        name: "displayName",
        valueType: "text",
        description: "The party's name as it should appear in a document.",
      },
      {
        name: "kind",
        valueType: "text",
        description: "Whether the party is a person or an organisation.",
      },
    ],
  },
];

// The member facet set. Declared as its own rows rather than by adding "member" to the party rows,
// because a facet row carries ONE source and the two families are filled by different reads — the
// party read and the staffing read. The vocabulary deliberately rhymes: `{{opposingCounsel.displayName}}`
// and `{{responsibleAttorney.displayName}}` are the same shape, the same formats, and the same
// ambiguity rule, differing only in which batched read answers them.
//
// Deliberately absent until the structured value types land: `address` (the office's, needing the
// structured address type) and `signatureBlock` (multi-line, needing real line-break emission — a
// literal newline in a w:t renders as a space). Both are stored today; neither becomes a facet that
// would render a subtly wrong document.
const MEMBER_FACETS: readonly MergeFacet[] = [
  {
    name: "displayName",
    kinds: ["member"],
    source: "staffing",
    valueType: "name",
    defaultFormat: "full",
    absence: "placeholder",
    sensitivity: "ordinary",
    prominence: "primary",
    labelTemplate: "{subject}'s name",
    descriptionTemplate: "The {prose}'s name, when the matter staffs exactly one.",
    synonyms: ["name"],
    example: EXAMPLE_NAME,
  },
  {
    name: "title",
    kinds: ["member"],
    source: "staffing",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: "ordinary",
    prominence: "primary",
    labelTemplate: "{subject}'s title",
    descriptionTemplate: "The {prose}'s professional title, from their professional profile.",
    synonyms: ["position", "partner", "associate"],
    example: { kind: "text", text: "Partner" },
  },
  {
    name: "emailAddress",
    kinds: ["member"],
    source: "staffing",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: "ordinary",
    prominence: "primary",
    labelTemplate: "{subject}'s email address",
    descriptionTemplate: "The {prose}'s professional email address, from their profile.",
    synonyms: ["email", "e-mail"],
    example: { kind: "text", text: "r.ashcroft@marchettivale.example" },
  },
  {
    name: "directDial",
    kinds: ["member"],
    source: "staffing",
    valueType: "text",
    defaultFormat: "plain",
    absence: "placeholder",
    sensitivity: "ordinary",
    prominence: "secondary",
    labelTemplate: "{subject}'s direct dial",
    descriptionTemplate: "The {prose}'s direct telephone line, from their profile.",
    synonyms: ["phone", "telephone", "direct line"],
    example: { kind: "text", text: "(775) 555-0114" },
  },
  {
    name: "pronouns",
    kinds: ["member"],
    source: "staffing",
    valueType: "text",
    defaultFormat: "plain",
    // Blank rather than a marker, for the reason the party twin states.
    absence: "blank",
    sensitivity: "ordinary",
    prominence: "secondary",
    labelTemplate: "{subject}'s pronouns",
    descriptionTemplate:
      "The {prose}'s pronouns as their Directory record states them, written she/her, he/him, they/them. Blank when the record states none — never worked out from a name or a title.",
    synonyms: ["pronoun", "she/her", "he/him", "they/them"],
    example: { kind: "text", text: "they/them" },
  },
  {
    name: "all",
    kinds: ["member"],
    source: "staffing",
    valueType: "list",
    // A list is never rendered — a repeating block walks it — so its default format is the empty
    // rendering the format table declares for the type.
    defaultFormat: "",
    // A matter that staffs nobody in the role has an empty list, which a repeating block correctly
    // renders as nothing at all. That is a correct document, not an absence.
    absence: "blank",
    sensitivity: "ordinary",
    prominence: "primary",
    labelTemplate: "Every {prose} on the matter",
    descriptionTemplate:
      "Everyone staffed on the matter as {prose}, for a repeating block to walk.",
    synonyms: ["list", "each", "repeating"],
    itemFields: [
      {
        name: "displayName",
        valueType: "text",
        description: "The member's name as it should appear in a document.",
      },
      {
        name: "title",
        valueType: "text",
        description: "The member's professional title, when their profile records one.",
      },
    ],
  },
];

// The whole facet registry — the party family and the member family together. Two rows may share a
// name ("displayName") when their kind sets are disjoint: a facet row carries ONE source, and the
// two families are filled by different reads.
export const MERGE_FACETS: readonly MergeFacet[] = [...PARTY_FACETS, ...MEMBER_FACETS];

export function facetsForKind(kind: SubjectKind): readonly MergeFacet[] {
  return MERGE_FACETS.filter((facet) => facet.kinds.includes(kind));
}
