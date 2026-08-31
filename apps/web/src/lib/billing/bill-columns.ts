/*
 * The bill register's columns — what a matter's bills say about themselves, declared once.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering,
 * pinning, resizing or totalling is decided here. This file says only WHAT the columns are.
 *
 * CREATED ANCHORS, AND IT LEADS. The register is a list of documents raised over time, and the date
 * one was raised is the fact that never goes missing: a draft has no number, a voided draft never
 * drew one, and anchoring on a column that is empty for two of the three states leaves the reader's
 * eye with nothing to hold. The number follows immediately, where it is read.
 *
 * THE FIGURE IS THIS MATTER'S SHARE, AND IT IS THE ONLY ONE. An invoice belongs to one client and
 * may bill several of that client's matters, but a register standing inside one matter states what
 * this matter was charged. The whole document's total is a fact about the document; showing it in a
 * matter's own register invites a reader to add up a column that is not theirs.
 *
 * A DRAFT'S FIGURES ARE COMPUTED AND SAY SO. A draft has no stored total — balances are created at
 * finalization — so its share is the sum of the lines it is carrying and moves as work is claimed.
 * The cell carries that fact on its hover rather than presenting a moving figure as a settled one.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { statusEntry } from "@magna-carta/design-system/status-register";
import {
  creditedMinor,
  deliveryStateWord,
  invoiceReference,
  invoiceStanding,
  matterShareMinor,
  matterUnpaidMinor,
  type InvoiceRow,
} from "./invoice-standing.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const BILL_COLUMN_IDENTIFIERS = {
  createdAt: "createdAt",
  invoiceNumber: "invoiceNumber",
  standing: "standing",
  issueDate: "issueDate",
  dueDate: "dueDate",
  matterShare: "matterShare",
  matterUnpaid: "matterUnpaid",
  delivered: "delivered",
  credited: "credited",
  client: "client",
} as const;

/** The register opens on what was raised most recently, which is where the work is. */
export const BILL_REGISTER_INITIAL_SORT = {
  columnId: BILL_COLUMN_IDENTIFIERS.createdAt,
  direction: "descending",
} as const;

/** What the register needs to know that is not on an invoice: whose bills these are. */
export interface BillRegisterContext {
  /** The matter the register is standing in. Its share is the leading money column. */
  readonly matterId: string;
  /** The client every one of these bills belongs to, as the matter records their name. */
  readonly clientName: string;
  readonly currency: string;
}

/** The dash a figure uses where the question does not arise, so a zero never reads as "settled". */
export const NOT_APPLICABLE = "—";

/** Why a figure is absent rather than zero, for the cell's hover. */
export function absentShareTitle(row: InvoiceRow): string {
  return row.summary.status === "draft"
    ? "A draft owes nothing yet: balances are created at finalization."
    : "A voided draft never owed anything.";
}

export function draftShareTitle(): string {
  return (
    "Computed from the draft's lines. A draft has no stored total: its figure moves as work is " +
    "claimed and released."
  );
}

export function billColumns(context: BillRegisterContext): readonly GridColumn<InvoiceRow>[] {
  const { matterId, clientName, currency } = context;

  return [
    {
      id: BILL_COLUMN_IDENTIFIERS.createdAt,
      label: "Created",
      type: "date",
      anchored: true,
      value: (row) => row.summary.createdAt,
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.invoiceNumber,
      label: "Invoice",
      type: "text",
      filter: "set",
      fitExtra: 22,
      value: (row) => invoiceReference(row),
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.standing,
      label: "Status",
      type: "text",
      filter: "set",
      fitExtra: 40,
      value: (row) => statusEntry(invoiceStanding(row)).label,
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.issueDate,
      label: "Issued",
      type: "date",
      value: (row) => row.summary.issueDate,
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.dueDate,
      label: "Due",
      type: "date",
      value: (row) => row.summary.dueDate,
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.matterShare,
      label: "This Matter",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In the matter's currency.",
      value: (row) => {
        const share = matterShareMinor(row, matterId);
        return share === null ? null : share / 100;
      },
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.matterUnpaid,
      label: "Unpaid",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In the matter's currency.",
      value: (row) => {
        const unpaid = matterUnpaidMinor(row, matterId);
        return unpaid === null ? null : unpaid / 100;
      },
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.delivered,
      label: "Delivered",
      type: "text",
      filter: "set",
      value: (row) => deliveryStateWord(row),
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.credited,
      label: "Credited",
      type: "money",
      currency,
      hidden: true,
      total: "sum",
      filterNote: "In the matter's currency.",
      value: (row) => {
        const credited = creditedMinor(row);
        return credited === 0 ? null : credited / 100;
      },
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.client,
      label: "Client",
      type: "text",
      filter: "set",
      hidden: true,
      value: () => clientName,
    },
  ];
}
