/*
 * The directory index's column model.
 *
 * Pure: it declares WHAT a column is, so the answers are unit-testable and there is one place to
 * change them. The screen owns fetching and rendering.
 *
 * NARROWING BELONGS TO THE COLUMNS, and this module holds no control of its own for it. The screen
 * carried a filter popover above the table whose only job was to choose people, organizations or
 * both — which the Kind column's own set filter already did, from the header the reader was
 * already reading. Two controls over one narrowing is two places for them to disagree about what
 * the table is showing, and the standing rule (docs/conventions/design-corrections.md, "Filtering
 * belongs to the columns") is that the column wins. So the index asks the server for the whole book
 * and every narrowing on this screen is a column's.
 *
 * The index and the ranked search are deliberately different objects, and this module is half of
 * why. A listing is sorted, walkable and counted; its columns are therefore sortable and filterable.
 * A search answer is ranked and capped, so it carries no column model at all and is never
 * re-sorted — sorting a capped best-of would put the best of an arbitrary slice at the top and read
 * as the best of the firm's record.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { DirectoryEntityListing } from "./directory-api.ts";
import { entityKindLabel, UNNAMED_ENTITY } from "./entity-presentation.ts";

/** The name as it prints, stating the gap where the directory holds no name at all. */
export function listingName(row: DirectoryEntityListing): string {
  const name = row.displayName?.trim() ?? "";
  return name === "" ? UNNAMED_ENTITY : name;
}

/** The country as a reader knows it, from the stored two-letter code. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The index's columns.
 *
 * Name ANCHORS the row: it is the identity a directory is read by, it always leads, and it is never
 * hidden. Kind is a column and a set filter rather than a second screen, because a person and an
 * organization are two entries in one book.
 *
 * WHAT IS OFFERED IS WIDER THAN WHAT IS SHOWN, and the difference is the whole design. A directory
 * is read for different reasons on different days — sorted by family name to work down a list,
 * narrowed to one city to find who is local, scanned for whether a number was ever recorded — and a
 * table that carried every one of those at once would be unreadable on the day somebody only wanted
 * the names. So the columns a reader most often wants are shown, the rest are declared and start
 * hidden, and the header menu's Columns submenu is where the reader says which book they are
 * reading today. Adding a column here is one entry, not a screen change.
 *
 * The contact columns are the record's DEFAULT way to reach it — one email, one number, one place —
 * never a contact register. A record with three numbers shows the one a call would go to, and its
 * Contact section holds the rest.
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
    // The parts the name was assembled from. Hidden by default because the assembled name is what a
    // reader reads; offered because sorting a book of people by family name is the one thing the
    // assembled name cannot do, and an organization has neither, so both are blank on those rows.
    { id: "givenName", label: "First Name", hidden: true, value: (row) => row.givenName ?? "" },
    { id: "middleName", label: "Middle Name", hidden: true, value: (row) => row.middleName ?? "" },
    { id: "familyName", label: "Last Name", hidden: true, value: (row) => row.familyName ?? "" },
    {
      id: "legalName",
      label: "Legal Name",
      hidden: true,
      value: (row) => row.legalName ?? "",
    },
    { id: "emailAddress", label: "Email", value: (row) => row.emailAddress ?? "" },
    { id: "phoneNumber", label: "Number", value: (row) => row.phoneNumber ?? "" },
    { id: "city", label: "City", value: (row) => row.city ?? "" },
    // A set filter rather than free text: a firm works in a handful of states, and picking from
    // them is the question ("everyone in Nevada"), where typing is a guess at a spelling.
    {
      id: "region",
      label: "Region",
      filter: "set",
      hidden: true,
      value: (row) => row.region ?? "",
    },
    {
      id: "country",
      label: "Country",
      filter: "set",
      hidden: true,
      value: (row) => (row.country === null || row.country === "" ? "" : countryName(row.country)),
    },
    {
      id: "recordedAt",
      label: "Added",
      type: "date",
      value: (row) => row.recordedAt,
    },
    {
      id: "changedAt",
      label: "Changed",
      type: "date",
      hidden: true,
      value: (row) => row.changedAt,
    },
  ];
}

/** The index opens in name order, which is the order a book of names is read in. */
export const DIRECTORY_LISTING_INITIAL_SORT = {
  columnId: "name",
  direction: "ascending",
} as const;
