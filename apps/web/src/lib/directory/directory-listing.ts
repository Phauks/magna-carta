/*
 * The directory index's column model and the one control that narrows it.
 *
 * Pure: it declares WHAT a column is and what the kind filter offers, so the answers are
 * unit-testable and there is one place to change them. The screen owns fetching and rendering.
 *
 * The index and the ranked search are deliberately different objects, and this module is half of
 * why. A listing is sorted, walkable and counted; its columns are therefore sortable and its scope
 * is a stated filter. A search answer is ranked and capped, so it carries no column model at all
 * and is never re-sorted — sorting a capped best-of would put the best of an arbitrary slice at the
 * top and read as the best of the firm's record.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { DirectoryEntityKind, DirectoryEntityListing } from "./directory-api.ts";
import { entityKindLabel, UNNAMED_ENTITY } from "./entity-presentation.ts";

/** Which side of the directory the index is showing, or both. */
export type DirectoryListingKind = DirectoryEntityKind | "all";

/** The default: one book. Splitting people from organizations is the reader's choice, not ours. */
export const DEFAULT_LISTING_KIND: DirectoryListingKind = "all";

export interface ListingKindItem {
  value: DirectoryListingKind;
  label: string;
}

/**
 * What the kind control offers. "Everyone" leads because the directory is one book of the people
 * and organizations the firm deals with, and a reader who wanted only one of them says so.
 */
export const LISTING_KIND_ITEMS: readonly ListingKindItem[] = [
  { value: "all", label: "Everyone" },
  { value: "person", label: "People" },
  { value: "organization", label: "Organizations" },
];

/** What the chosen scope is called, for the control's own accessible name. */
export function listingKindLabel(kind: DirectoryListingKind): string {
  return LISTING_KIND_ITEMS.find((item) => item.value === kind)?.label ?? "Everyone";
}

/** The kind to send to the server — "all" is the absence of the parameter, not a value. */
export function listingKindParameter(kind: DirectoryListingKind): DirectoryEntityKind | undefined {
  return kind === "all" ? undefined : kind;
}

/** The name as it prints, stating the gap where the directory holds no name at all. */
export function listingName(row: DirectoryEntityListing): string {
  const name = row.displayName?.trim() ?? "";
  return name === "" ? UNNAMED_ENTITY : name;
}

/**
 * The index's columns.
 *
 * Name ANCHORS the row: it is the identity a directory is read by, it always leads, and it is never
 * hidden. Kind is a column and a set filter rather than a second screen, because a person and an
 * organization are two entries in one book. Added is the date the firm wrote the record down, which
 * is the one thing a reader asks of a directory row that the name does not answer — "is this the
 * one I entered this morning".
 *
 * Sorting and the per-column filters are the grid's, and they run over the rows LOADED so far
 * rather than over the whole record, because the listing is cursor-paged. The count beside the
 * table is what keeps that honest.
 */
export function directoryListingColumns(): GridColumn<DirectoryEntityListing>[] {
  return [
    {
      id: "name",
      label: "Name",
      anchored: true,
      value: (row) => listingName(row),
    },
    {
      id: "kind",
      label: "Kind",
      filter: "set",
      // The label, not the stored code: a person filters on "Person", never on `person`.
      value: (row) => entityKindLabel(row.entityKind),
    },
    {
      id: "recordedAt",
      label: "Added",
      type: "date",
      value: (row) => row.recordedAt,
    },
  ];
}

/** The index opens in name order, which is the order a book of names is read in. */
export const DIRECTORY_LISTING_INITIAL_SORT = {
  columnId: "name",
  direction: "ascending",
} as const;
