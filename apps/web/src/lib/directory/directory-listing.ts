/*
 * The directory listing's column model, and the two kinds of row it prints.
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
 * THE INDEX AND THE SEARCH ANSWER ARE STILL DIFFERENT OBJECTS, AND THEY ARE NO LONGER DIFFERENT
 * TABLES. A listing is sorted, walkable and counted; a ranked answer is capped and arrives in the
 * firm's own relevance order. That difference is real and it is carried where it belongs — the
 * envelope, and one sentence in the footer — rather than by swapping the reader's table out for a
 * two-column list of hits the moment they type. So one column model serves both, and the answer's
 * order is simply the order it arrived in.
 *
 * WHICH IS ALSO WHY A ROW HERE IS A UNION. While a query is live the answer holds the firm's
 * MATTERS as well as its people and organizations, because somebody searching the directory for
 * "Pemberton" is looking for the file as often as for the person. A matter is not a directory
 * record and is not pretended to be one: it carries no contact detail, its Kind says Matter, and
 * activating it opens the matter. The resting index is the book of people and organizations, and
 * nothing else.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { DirectoryEntityListing } from "./directory-api.ts";
import type { MatterSummary } from "$lib/matters/matters-api.ts";
import { matterNumberText } from "$lib/matters/matter-columns.ts";
import { entityKindLabel, UNNAMED_ENTITY } from "./entity-presentation.ts";

/**
 * One of the firm's matters as the directory's search answer prints it.
 *
 * Deliberately thin. A matter has a docket of its own with nine columns on it, and the question
 * asked here is not "show me my matters" — it is "the firm holds something under this name, what is
 * it". So the row carries what a directory row carries: what to call it, what it is, when the firm
 * wrote it down, and where it lives.
 */
export interface MatterListing {
  /** The discriminant. Spelled like the directory row's so one union reads as one vocabulary. */
  readonly entityKind: "matter";
  readonly matterId: string;
  readonly title: string;
  /** The number the file is quoted under, or the designation where it carries none yet. */
  readonly matterNumber: string;
  /** When the firm opened the file. */
  readonly recordedAt: string;
}

/** Either row the one table prints, told apart by `entityKind`. */
export type DirectoryListingRow = DirectoryEntityListing | MatterListing;

/** What a matter row is called on the Kind column and in its set filter. */
export const MATTER_KIND_LABEL = "Matter";

/** One matter, as a row. */
export function matterListingRow(matter: MatterSummary): MatterListing {
  return {
    entityKind: "matter",
    matterId: matter.id,
    title: matter.title,
    matterNumber: matterNumberText(matter),
    recordedAt: matter.createdAt,
  };
}

/** Whether this row is one of the firm's matters rather than one of its directory records. */
export function isMatterListing(row: DirectoryListingRow): row is MatterListing {
  return row.entityKind === "matter";
}

/**
 * The row's identity in the table.
 *
 * A matter handle and a directory handle cannot collide — each carries its own prefix — so the
 * handle is the key, and the two kinds of row can sit in one list without a composite key that
 * would have to be kept in step with it.
 */
export function listingRowKey(row: DirectoryListingRow): string {
  return isMatterListing(row) ? row.matterId : row.entityId;
}

/** The name as it prints, stating the gap where the directory holds no name at all. */
export function listingName(row: DirectoryListingRow): string {
  if (isMatterListing(row)) {
    const title = row.title.trim();
    return title === "" ? row.matterNumber : title;
  }
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

/** What a column of a directory record reads on a matter row: nothing, because a matter has none. */
function recordOnly<T>(
  row: DirectoryListingRow,
  read: (record: DirectoryEntityListing) => T | null,
): T | "" {
  if (isMatterListing(row)) return "";
  return read(row) ?? "";
}

/**
 * The listing's columns.
 *
 * Name ANCHORS the row: it is the identity a directory is read by, it always leads, and it is never
 * hidden. Kind is a column and a set filter rather than a second screen, because a person and an
 * organization are two entries in one book — and while a query is live a matter is a third entry in
 * the same answer.
 *
 * EVERY COLUMN DECLARED HERE IS SHOWN. Seven of them used to start hidden — the name parts, the
 * legal name, the region, the country and the change date — on the reasoning that the assembled
 * name is what a reader reads and the rest is for a particular day. The owner added those columns
 * and reported them missing (2026-09-17: "it did not populate in, even with blank data"), which is
 * the whole verdict on that reasoning: the one way to reveal a hidden column is the header's
 * right-click menu, which nothing on the screen advertises, so a column declared hidden is a column
 * that does not exist for anyone who did not write it. So the table shows what the directory
 * declares, wide enough to scroll sideways on a narrow screen, and the header menu's Columns
 * submenu is where a reader hides what they do not need today. Adding a column here is one entry,
 * not a screen change, and it is visible the day it lands.
 *
 * The contact columns are the record's DEFAULT way to reach it — one email, one number, one place —
 * never a contact register. A record with three numbers shows the one a call would go to, and its
 * Contact section holds the rest. A matter has none of them, so every one of them is blank on a
 * matter row rather than borrowing the client's.
 *
 * Sorting and the per-column filters are the grid's, and they run over the rows LOADED so far
 * rather than over the whole record, because the listing is cursor-paged. The count beside the
 * table is what keeps that honest.
 */
export function directoryListingColumns(
  options: { readonly withMatters?: boolean } = {},
): GridColumn<DirectoryListingRow>[] {
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
      // Matter is offered only while matters are in the answer. A set filter otherwise reads its
      // options off the rows in hand, which is right here: the resting index holds no matters and
      // must not offer to narrow to a kind it cannot contain.
      filterValues: options.withMatters ? ["Person", "Organization", MATTER_KIND_LABEL] : undefined,
      // The label, not the stored code: a person filters on "Person", never on `person`.
      value: (row) => (isMatterListing(row) ? MATTER_KIND_LABEL : entityKindLabel(row.entityKind)),
    },
    // The parts the name was assembled from: sorting a book of people by family name is the one
    // thing the assembled name cannot do. An organization has neither, so both are blank on its rows.
    {
      id: "givenName",
      label: "First Name",
      value: (row) => recordOnly(row, (record) => record.givenName),
    },
    {
      id: "middleName",
      label: "Middle Name",
      value: (row) => recordOnly(row, (record) => record.middleName),
    },
    {
      id: "familyName",
      label: "Last Name",
      value: (row) => recordOnly(row, (record) => record.familyName),
    },
    {
      id: "legalName",
      label: "Legal Name",
      value: (row) => recordOnly(row, (record) => record.legalName),
    },
    {
      id: "emailAddress",
      label: "Email",
      value: (row) => recordOnly(row, (record) => record.emailAddress),
    },
    {
      id: "phoneNumber",
      label: "Number",
      value: (row) => recordOnly(row, (record) => record.phoneNumber),
    },
    { id: "city", label: "City", value: (row) => recordOnly(row, (record) => record.city) },
    // A set filter rather than free text: a firm works in a handful of states, and picking from
    // them is the question ("everyone in Nevada"), where typing is a guess at a spelling.
    {
      id: "region",
      label: "Region",
      filter: "set",
      value: (row) => recordOnly(row, (record) => record.region),
    },
    {
      id: "country",
      label: "Country",
      filter: "set",
      value: (row) => {
        const code = recordOnly(row, (record) => record.country);
        return code === "" ? "" : countryName(code);
      },
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
      // A matter's own record of when it last changed lives on its docket, not in this answer, so
      // the cell is an honest gap rather than the date it was opened wearing another label.
      value: (row) => recordOnly(row, (record) => record.changedAt),
    },
  ];
}

/** The index opens in name order, which is the order a book of names is read in. */
export const DIRECTORY_LISTING_INITIAL_SORT = {
  columnId: "name",
  direction: "ascending",
} as const;

/**
 * How a ranked answer opens: in the order it arrived.
 *
 * A search answer is the firm's own relevance order over a CAPPED set, so sorting it by a column
 * before the reader asks would put the best of an arbitrary slice at the top and read as the best of
 * the firm's record. A null sort column is the grid's way of saying "as given"; a reader who then
 * clicks a header is asking a different question and gets it.
 */
export const DIRECTORY_SEARCH_INITIAL_SORT = {
  columnId: null,
  direction: "ascending",
} as const;
