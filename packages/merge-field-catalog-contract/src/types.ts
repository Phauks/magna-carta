/*
 * The merge-field catalog contract — the shape the field-input user interface consumes, and the
 * ONLY thing it is allowed to know about where merge fields come from.
 *
 * A template carries {{key}} placeholders. Nobody types a key path from memory: a person authoring
 * or filling a template picks from the firm's catalog of merge fields, so every surface that offers
 * fields (the picker, the assembly input area, the detected-field review) reads the same entries,
 * with the same labels, groups, value types, and example renderings.
 *
 * Two reads make up the contract:
 *   - the CATALOG — every merge field the firm can offer, whatever template is in hand;
 *   - a template version's MANIFEST — the placeholders one template actually declares.
 * The input area is the intersection: manifest keys resolved against catalog entries.
 *
 * Nothing here holds a resolved VALUE. An example rendering is illustrative sample text that ships
 * with the entry, never a client's data — so a catalog response is safe to cache in the browser
 * and safe to show before a matter is chosen.
 */

/**
 * The picker's top-level heading. A DECLARED REGISTRY rather than a closed union: the catalog grows to
 * hundreds of fields and the headings grow with the subjects behind them, so adding one is a row in
 * `MERGE_FIELD_GROUPS` (and, upstream, in the engine's own group registry) rather than a type change
 * that every consumer has to be recompiled against.
 */
export type MergeFieldGroup = string;

/**
 * Fixes which formatters are legal for a field, and which input control the assembly area renders.
 *
 * PINNED TO THE ENGINE'S `MergeValueType`, member for member. Two unions describing the same thing and
 * disagreeing is a drift generator — this one used to carry `longText` and `address` where the engine
 * had `image`, `list`, and `rate` — so there is one list, and `test/fixture-projection.test.ts` asserts
 * the pairing rather than trusting two lists to stay in step by care.
 */
export type MergeFieldValueType =
  | "text"
  | "name"
  | "date"
  | "money"
  | "rate"
  | "number"
  | "boolean"
  | "reference"
  | "image"
  | "list";

/**
 * Where a field's value comes from when a document is assembled. This is the distinction the input
 * area exists to make legible: `automatic` fields are filled from firm data and are shown as
 * read-only context, `manual` fields are the ones a person actually has to type.
 */
export type MergeFieldAvailability =
  | "automatic"
  | "conditional"
  | "manual"
  /** The firm's data cannot supply this field at all — it renders as an absence, not an error. */
  | "unavailable";

/**
 * A `protected` field binds to an encrypted column, so resolving it is a permission check plus an
 * audit row. The input area never decrypts anything; it carries the flag so a surface can warn that
 * assembling this template will touch a protected value.
 */
export type MergeFieldSensitivity = "ordinary" | "protected";

/**
 * Ordering and default visibility in the picker — NEVER a filter on what exists. A `secondary` field is
 * one interaction away and always findable by search: hiding the field someone needs, in a product
 * whose alternative is retyping it into a filed document, is the worse failure.
 */
export type MergeFieldProminence = "primary" | "secondary";

/**
 * Whether this is still the way to name the fact. A withdrawn field is `deprecated`, never removed: it
 * keeps filling in for the templates already bound to it, and it names what replaced it.
 */
export type MergeFieldStatus = "current" | "deprecated";

/** One merge field a firm can put in a template. */
export interface MergeFieldEntry {
  /** The stable token a template writes between braces — `matter.number`, `client.displayName`. */
  readonly key: string;
  /** What a person calls it. This, not the key, is what a picker row reads out. */
  readonly label: string;
  readonly group: MergeFieldGroup;
  /**
   * The thing the field is ABOUT — the client, the opposing counsel, this office. The second level of
   * the picker's sectioning: a "Parties" heading with a hundred and thirty rows under it is a list
   * nobody scrolls, and the subject is what breaks it into a dozen readable ones.
   */
  readonly subject: string;
  /** What a person calls the subject — "Opposing counsel". Search matches it too. */
  readonly subjectLabel: string;
  readonly prominence: MergeFieldProminence;
  readonly valueType: MergeFieldValueType;
  /** One sentence, product voice: what this field holds. */
  readonly description: string;
  /** Illustrative sample text showing how the field renders in a document. Never real firm data. */
  readonly exampleRendering: string;
  /**
   * One sample per legal format, so a format chooser shows what each rendering does rather than naming
   * it. The same invented sample throughout — the only thing that changes between them is the
   * rendering.
   */
  readonly exampleRenderings: Readonly<Record<string, string>>;
  /**
   * Search words a firm would type — "defendant" for the opposing party, "SSN" for the tax identifier.
   * What makes a firm's own vocabulary find the platform's key.
   */
  readonly synonyms: readonly string[];
  readonly availability: MergeFieldAvailability;
  /** One sentence saying where the value comes from, or why it may be missing. */
  readonly availabilityNote: string;
  readonly sensitivity: MergeFieldSensitivity;
  /** The named formats legal for this field's type — `{{key:long}}` selects one at a placeholder. */
  readonly formats: readonly string[];
  readonly status: MergeFieldStatus;
  /** The key that replaced a deprecated one. `null` on a current field. */
  readonly supersededBy: string | null;
}

/** One picker heading: its key, what it reads, and where it sits in the order. */
export interface MergeFieldGroupDefinition {
  readonly key: MergeFieldGroup;
  readonly label: string;
}

/**
 * Human-facing group headings, in the order a picker should present them. ADDING A GROUP IS A ROW —
 * here and in the engine's own registry, which is where the entries get their group in the first place.
 */
export const MERGE_FIELD_GROUPS: readonly MergeFieldGroupDefinition[] = [
  { key: "matter", label: "Matter" },
  { key: "client", label: "The client" },
  { key: "otherParties", label: "Other parties" },
  { key: "ourPeople", label: "Our people" },
  { key: "courtCase", label: "Court and case" },
  { key: "estate", label: "The estate" },
  { key: "firm", label: "The firm" },
  { key: "office", label: "This office" },
  { key: "document", label: "Dates and the document" },
  { key: "assets", label: "What the client or estate owns" },
  { key: "custom", label: "The firm's own fields" },
];

/** The group keys in rendering order — the registry's own order, never a second copy of it. */
export const MERGE_FIELD_GROUP_ORDER: readonly MergeFieldGroup[] = MERGE_FIELD_GROUPS.map(
  (group) => group.key,
);

export const MERGE_FIELD_GROUP_LABELS: Readonly<Record<MergeFieldGroup, string>> =
  Object.fromEntries(MERGE_FIELD_GROUPS.map((group) => [group.key, group.label]));

/** A group's label, falling back to its key for a group a newer server sent that this build has not. */
export function mergeFieldGroupLabel(group: MergeFieldGroup): string {
  return MERGE_FIELD_GROUP_LABELS[group] ?? group;
}

export const MERGE_FIELD_VALUE_TYPE_LABELS: Readonly<Record<MergeFieldValueType, string>> = {
  text: "Text",
  name: "Name",
  date: "Date",
  money: "Money",
  rate: "Rate",
  number: "Number",
  boolean: "Yes or no",
  reference: "Reference",
  image: "Picture",
  list: "List",
};

/** The firm's catalog as one read. */
export interface MergeFieldCatalog {
  /**
   * Changes whenever the firm's catalog changes — a custom field added, renamed, or archived. A
   * surface holding a cached catalog compares this to know it is looking at stale entries.
   */
  readonly revision: string;
  readonly entries: readonly MergeFieldEntry[];
}

/** One placeholder a template version declares. */
export interface TemplateFieldPlaceholder {
  readonly key: string;
  /** How many times the placeholder appears in the document. */
  readonly occurrences: number;
  /** The per-placeholder format override the author wrote, when they wrote one. */
  readonly format?: string;
}

/**
 * How a placeholder was written in the uploaded document. Text delimiters are what a person types;
 * the other two forms exist in templates a firm already has.
 */
export type PlaceholderAuthoringForm = "textDelimiter" | "mergeField" | "contentControl";

/**
 * A placeholder found in an uploaded document that is NOT yet part of the template's field list —
 * a proposal awaiting a person's confirmation.
 *
 * This type exists to make the posture structural rather than a matter of interface wording:
 * detecting a Word MERGEFIELD and mapping it to a catalog key is GUIDANCE, and every surface that
 * renders one of these presents it as something to confirm. There is deliberately no field here
 * that could read as "already applied" — a conversion becomes real when a person accepts it, and
 * accepting it is the consuming surface's action, not this record's state.
 */
export interface DetectedFieldConversion {
  /** Stable row identity for the review list. */
  readonly id: string;
  /** The placeholder exactly as it appears in the document, so a person can find it. */
  readonly sourceText: string;
  readonly sourceForm: PlaceholderAuthoringForm;
  /** Where in the document it sits — a page, a paragraph, a caption — for a person to locate it. */
  readonly sourceLocation: string;
  /** The catalog key we believe it means. `null` when nothing in the catalog fits. */
  readonly proposedKey: string | null;
  readonly confidence: "exact" | "likely" | "uncertain";
  /** One sentence explaining the proposal, in the voice of a suggestion. */
  readonly note: string;
}

/** Everything one template version declares, as the input area needs it. */
export interface TemplateFieldManifest {
  readonly templateVersionId: string;
  readonly templateName: string;
  /** Placeholders in document order — the order the input area lays out its fields within a group. */
  readonly placeholders: readonly TemplateFieldPlaceholder[];
  /** Placeholder keys with no catalog entry: the template cannot be activated until they resolve. */
  readonly unrecognizedKeys: readonly string[];
  /** Proposals awaiting confirmation. Never applied by anything that produced this manifest. */
  readonly detectedConversions: readonly DetectedFieldConversion[];
}

/**
 * The read seam the field-input user interface is built against.
 *
 * Every consuming surface takes a provider rather than calling an endpoint, so the interface can be
 * built, storied, and tested against the in-repo mock and then switched to the live one by changing
 * which provider is constructed — no consumer edit. The live provider arrives when the merge-field
 * dictionary and template-fields endpoints land; `createMockMergeFieldCatalogProvider` is the only
 * thing it replaces.
 */
export interface MergeFieldCatalogProvider {
  /** The firm's catalog, custom-field entries included. */
  listMergeFields(): Promise<MergeFieldCatalog>;
  /** One template version's declared placeholders. */
  getTemplateFieldManifest(templateVersionId: string): Promise<TemplateFieldManifest>;
  /** The template versions this provider can answer for — the mock's small fixture set. */
  listTemplateVersions(): Promise<readonly TemplateVersionSummary[]>;
}

/** Enough of a template version to choose one; the catalogue listing surface owns the rest. */
export interface TemplateVersionSummary {
  readonly templateVersionId: string;
  readonly templateName: string;
  readonly description: string;
}
