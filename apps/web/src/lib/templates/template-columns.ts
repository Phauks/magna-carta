/*
 * The template library's declarative column model — what the platform's one table is told about the
 * templates a firm has registered. Pure: it takes the firm's own vocabularies and returns columns, so
 * what a column IS has one home and one test, and the screen owns only fetching and rendering.
 *
 * Three decisions worth stating:
 *
 *   - The NAME anchors the row. It is what a person chooses a template by and what a matter's own
 *     Files page prints in its template picker, so it always leads and is never hidden.
 *   - STANDING is derived, not served. The listing carries a status word and a current-version
 *     handle, and neither alone answers the question a reader has — can I build from this today. A
 *     template whose bytes have not cleared the scan has no current version and cannot be assembled
 *     from, which the matter's Files page already knows and this register has to say out loud.
 *   - The DESCRIPTION is not a column. Prose is the row's second line (the grid's `rowDetail`),
 *     never a cell that truncates it; the register renders it beneath the row where it wraps.
 *   - PRACTICE AREA and OFFICE resolve against the firm's own lists, read once per screen and joined
 *     here — never one request per row. A template bound to no matter type is offered to every
 *     matter, and the cell says so rather than standing empty: "any" is a fact about the template,
 *     not a gap in the record.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { TemplateSummary } from "@magna-carta/api-client";

/** What a template's practice-area and office handles resolve to, by handle. */
export interface TemplateVocabulary {
  matterTypeNames: ReadonlyMap<string, string>;
  locationNames: ReadonlyMap<string, string>;
}

/** An empty vocabulary — what a screen holds before the firm's lists land. */
export const EMPTY_TEMPLATE_VOCABULARY: TemplateVocabulary = {
  matterTypeNames: new Map(),
  locationNames: new Map(),
};

/** Build the lookups the column model needs from the two list reads. */
export function templateVocabulary(
  matterTypes: readonly { id: string; name: string }[],
  locations: readonly { id: string; name: string }[],
): TemplateVocabulary {
  return {
    matterTypeNames: new Map(matterTypes.map((type) => [type.id, type.name])),
    locationNames: new Map(locations.map((location) => [location.id, location.name])),
  };
}

/** What the practice-area cell reads for a template bound to no matter type. */
export const ANY_MATTER_TYPE = "Any matter type";
/** What the office cell reads for a template bound to no Location. */
export const EVERY_OFFICE = "All offices";

/**
 * Where a template stands for somebody who wants to build from it.
 *
 * `ready` — active, with a version that cleared the scan; it can be added to a matter now.
 * `checking` — active, but its latest bytes have not cleared the gate yet (or were refused). The
 *   catalogue names it, and nothing can be built from it until a version is clean.
 * `archived` — withdrawn from the catalogue; kept so a document it produced stays explicable.
 */
export type TemplateStanding = "ready" | "checking" | "archived";

export function templateStanding(template: TemplateSummary): TemplateStanding {
  if (template.status === "archived") return "archived";
  return template.currentVersionId === null ? "checking" : "ready";
}

export interface StandingPresentation {
  readonly label: string;
  readonly tone: "success" | "warning" | "neutral";
  readonly meaning: string;
}

const STANDING: Readonly<Record<TemplateStanding, StandingPresentation>> = {
  ready: {
    label: "Ready",
    tone: "success",
    meaning: "The template's current version cleared its checks and can be added to a matter.",
  },
  checking: {
    label: "Being checked",
    tone: "warning",
    meaning:
      "The template hasn't passed the safety check yet, or failed it. Nothing can be built from it until a version passes.",
  },
  archived: {
    label: "Archived",
    tone: "neutral",
    meaning: "Withdrawn from the catalogue. Kept so documents it produced stay explicable.",
  },
};

export function standingPresentation(standing: TemplateStanding): StandingPresentation {
  return STANDING[standing];
}

/** The standing vocabulary, in the order a filter offers it. */
export const TEMPLATE_STANDING_VALUES: readonly string[] = [
  STANDING.ready.label,
  STANDING.checking.label,
  STANDING.archived.label,
];

/** The practice-area text for a template. Empty only for a handle the firm's list no longer names. */
export function templateMatterTypeText(
  template: TemplateSummary,
  vocabulary: TemplateVocabulary,
): string {
  if (template.matterTypeId === null) return ANY_MATTER_TYPE;
  return vocabulary.matterTypeNames.get(template.matterTypeId) ?? "";
}

/** The office text for a template. Empty only for a handle the firm's list no longer names. */
export function templateLocationText(
  template: TemplateSummary,
  vocabulary: TemplateVocabulary,
): string {
  if (template.locationId === null) return EVERY_OFFICE;
  return vocabulary.locationNames.get(template.locationId) ?? "";
}

/**
 * The library's columns. Sorting, the per-column filters, show/hide, reorder, pinning and resize
 * are the grid's; this only declares what each column is.
 *
 * Standing, Practice area and Office take the SET filter and declare their whole vocabularies —
 * "Archived" is offered whether or not an archived row is loaded, and every practice area the firm
 * declares is offered whether or not a template is bound to it — so a filter never tells the reader
 * the firm cannot have something it can.
 */
export function templateColumns(vocabulary: TemplateVocabulary): GridColumn<TemplateSummary>[] {
  return [
    { id: "name", label: "Template", anchored: true, value: (template) => template.name },
    {
      id: "standing",
      label: "Standing",
      filter: "set",
      filterValues: TEMPLATE_STANDING_VALUES,
      value: (template) => standingPresentation(templateStanding(template)).label,
    },
    {
      id: "matterType",
      label: "Practice Area",
      filter: "set",
      filterValues: [ANY_MATTER_TYPE, ...vocabulary.matterTypeNames.values()],
      value: (template) => templateMatterTypeText(template, vocabulary),
    },
    {
      id: "location",
      label: "Office",
      filter: "set",
      filterValues: [EVERY_OFFICE, ...vocabulary.locationNames.values()],
      value: (template) => templateLocationText(template, vocabulary),
    },
    {
      id: "updatedAt",
      label: "Updated",
      type: "date",
      value: (template) => template.updatedAt,
    },
    {
      id: "createdAt",
      label: "Registered",
      type: "date",
      hidden: true,
      value: (template) => template.createdAt,
    },
  ];
}

/** The column the library sorts by first — by name, the way a catalogue is read. */
export const TEMPLATE_INITIAL_SORT = { columnId: "name", direction: "ascending" } as const;
