/*
 * What a review set looks like in a listing, declared once for both surfaces that show one.
 *
 * The matter's Discovery section and the firm-wide register ask the same question at two scopes —
 * what corpora does this matter hold, and what corpora may I reach — so they read the same columns
 * from here rather than each deciding what a review set looks like.
 *
 * THE NAME ANCHORS THE ROW, and the matter is a column rather than a heading. A reviewer holding
 * four review sets tells them apart by the matter they belong to, and putting it in a column means
 * one table serves both surfaces: the matter's own section simply hides it, because on that screen
 * every row would carry the same value.
 *
 * DOCUMENTS AND CEILING ARE TWO COLUMNS AND NOT ONE FRACTION. "412 of 250,000" reads as progress
 * toward a target, and the ceiling is not a target — it is the point at which a load is refused. A
 * firm that reads it as a goal is being told something false about what the platform expects.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { ReviewSet } from "./discovery-api.ts";
import { reviewSetStateEntry } from "./discovery-vocabulary.ts";

/** Matter titles by identifier, resolved by the surface and joined here — never a read per row. */
export type MatterTitles = ReadonlyMap<string, string>;

export interface ReviewSetColumnOptions {
  /** Whether to carry the matter column. False on a matter's own section, where it is constant. */
  readonly showMatter: boolean;
  readonly matterTitles: MatterTitles;
}

/**
 * What the matter cell reads when the title is not in hand.
 *
 * Deliberately not the identifier. A reviewer on a review set may hold no access to the matter it
 * belongs to, so the title genuinely may not be readable to them, and printing `matter_01J…` at a
 * person is not an answer to "which case is this".
 */
export const MATTER_NOT_NAMED = "Not named here";

export function reviewSetColumns(options: ReviewSetColumnOptions): GridColumn<ReviewSet>[] {
  const columns: GridColumn<ReviewSet>[] = [
    { id: "name", label: "Review Set", anchored: true, value: (set) => set.name },
    {
      id: "state",
      label: "State",
      filter: "set",
      // The word, not the enum: a person narrows on "Open", never on `open`.
      value: (set) => reviewSetStateEntry(set.state).label,
    },
    {
      id: "documentCount",
      label: "Documents",
      type: "number",
      value: (set) => set.documentCount,
    },
    {
      id: "documentCeiling",
      label: "Ceiling",
      type: "number",
      // Hidden by default: it is a refusal threshold rather than a working number, and it is the
      // same for every review set a firm creates until the firm changes it.
      hidden: true,
      value: (set) => set.documentCeiling,
    },
    { id: "createdAt", label: "Created", type: "date", value: (set) => set.createdAt },
  ];
  if (options.showMatter) {
    columns.splice(1, 0, {
      id: "matter",
      label: "Matter",
      filter: "set",
      value: (set) => options.matterTitles.get(set.matterId) ?? MATTER_NOT_NAMED,
    });
  }
  return columns;
}

/** Newest first, which is how a register of corpora is read. */
export const REVIEW_SET_INITIAL_SORT = { columnId: "createdAt", direction: "descending" } as const;
