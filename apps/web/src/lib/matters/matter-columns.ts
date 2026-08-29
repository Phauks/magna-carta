/*
 * The matters list's declarative column model — what the one table (DataTable.Grid) is told about
 * the firm's docket. Pure: it takes the rows' vocabulary lookups and returns columns. The screen
 * owns fetching and rendering; this module owns what a column IS, so the answer is unit-testable
 * and there is one place to change it.
 *
 * Two column decisions are worth stating, because both are about not inventing:
 *
 *   - The matter number ANCHORS the row. It is the identity a legal docket is read by, it always
 *     leads, and it is never hidden. A matter that has not drawn one is a consultation, and the
 *     cell says "Consultation" — the same word the matter header prints for the same fact, rather
 *     than a blank that reads as missing data.
 *   - Practice area and Location arrive as identifiers and are resolved against the firm's own two
 *     vocabularies. An identifier that resolves to nothing renders EMPTY, never as the handle: a
 *     matter type that was deactivated and is no longer listed is an honest gap, and printing
 *     `matterType_01J…` at a person is not an answer.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { MatterSummary } from "./matters-api.ts";
import { matterStatusLabel } from "./matter-status.ts";

/** What a matter's type and Location identifiers resolve to, by identifier. */
export interface MatterVocabulary {
  matterTypeNames: ReadonlyMap<string, string>;
  locationNames: ReadonlyMap<string, string>;
}

/** An empty vocabulary — what the screen has before the two lists land. */
export const EMPTY_MATTER_VOCABULARY: MatterVocabulary = {
  matterTypeNames: new Map(),
  locationNames: new Map(),
};

/** Build the lookup a column model needs from the two list responses. */
export function matterVocabulary(
  matterTypes: readonly { id: string; name: string }[],
  locations: readonly { id: string; name: string }[],
): MatterVocabulary {
  return {
    matterTypeNames: new Map(matterTypes.map((type) => [type.id, type.name])),
    locationNames: new Map(locations.map((location) => [location.id, location.name])),
  };
}

/**
 * What a PROSPECTIVE matter's number column reads. A consultation is unnumbered by design — the
 * number is drawn when it opens — so the cell states the designation rather than leaving a gap that
 * reads as a record the platform failed to fill.
 */
export const UNNUMBERED_DESIGNATION = "Consultation";

/**
 * The number as it prints.
 *
 * The designation is tied to the STATUS, not merely to the absence of a number. An open or closed
 * matter with no number is not a consultation: it is a numbered thing whose number is missing, which
 * happens where a row was written without drawing one. Calling that "Consultation" would assert a
 * lifecycle state the record does not hold, so it reads as an honest gap instead.
 */
export function matterNumberText(matter: MatterSummary): string {
  if (matter.matterNumber !== null) return matter.matterNumber;
  return matter.status === "prospective" ? UNNUMBERED_DESIGNATION : "";
}

/** A resolved vocabulary name, or "" where nothing answers — never the raw identifier. */
export function resolvedName(names: ReadonlyMap<string, string>, id: string | null): string {
  if (id === null) return "";
  return names.get(id) ?? "";
}

/**
 * The docket's columns. Sorting, the per-column filters, show/hide, reorder, pinning and resize are
 * the grid's; this only declares what each column is.
 *
 * Client, practice area and Location take the SET filter (a checkbox list with counts) because each
 * is a small closed vocabulary in practice — you filter a docket by picking the client you mean,
 * not by typing it. Title takes the default contains-text filter, and Created the date range.
 */
export function matterColumns(vocabulary: MatterVocabulary): GridColumn<MatterSummary>[] {
  return [
    {
      id: "matterNumber",
      label: "Matter Number",
      anchored: true,
      value: (matter) => matter.matterNumber,
      text: matterNumberText,
    },
    { id: "title", label: "Title", value: (matter) => matter.title },
    {
      id: "client",
      label: "Client",
      filter: "set",
      value: (matter) => matter.clientDisplayName,
    },
    {
      id: "status",
      label: "Status",
      filter: "set",
      // The label, not the enum: the set filter offers what the column shows, and a person filters
      // on "Open", never on `open`.
      value: (matter) => matterStatusLabel(matter.status),
    },
    {
      id: "practiceArea",
      label: "Practice Area",
      filter: "set",
      value: (matter) => resolvedName(vocabulary.matterTypeNames, matter.matterTypeId),
    },
    {
      id: "location",
      label: "Location",
      filter: "set",
      // Hidden until asked for: most firms run one office, where the column repeats one value on
      // every row. The columns menu shows it the moment a firm has more than one.
      hidden: true,
      value: (matter) => resolvedName(vocabulary.locationNames, matter.locationId),
    },
    {
      id: "createdAt",
      label: "Created",
      type: "date",
      // "Created", not "Opened": the listing serves the creation instant, and a matter opened long
      // after the consultation that started it has two different dates. Only the detail read
      // carries the second, so this column names the one it actually has.
      value: (matter) => matter.createdAt,
    },
  ];
}

/** The column the docket sorts by first, newest first — the way a caseload is read. */
export const MATTER_INITIAL_SORT = { columnId: "createdAt", direction: "descending" } as const;
