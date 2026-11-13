/*
 * The bill register's columns — what bills say about themselves, declared once for both scopes.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering,
 * pinning, resizing or totalling is decided here. This file says only WHAT the columns are.
 *
 * ONE DECLARATION, TWO SCOPES, AND THE MONEY IS WHAT DIFFERS. A register standing inside a MATTER
 * states what that matter was charged: an invoice belongs to one client and may bill several of
 * that client's matters, so the document's own total is a fact about the document, and putting it
 * in a matter's register invites a reader to add up a column that is not theirs. The FIRM's
 * register has no matter to take a share of, so the document's total is the only honest figure
 * there, and the client — a constant inside one matter, and the identifying fact across the firm —
 * changes places with it.
 *
 * Both figures are declared in both scopes and one of each pair arrives hidden, rather than a
 * column existing in one scope and not the other: a member who wants the whole document's total
 * while standing in a matter turns it on from the same show-and-hide control every other column
 * uses, and a stored layout means the same thing on both screens.
 *
 * CREATED ANCHORS, AND IT LEADS. The register is a list of documents raised over time, and the date
 * one was raised is the fact that never goes missing: a draft has no number, a voided draft never
 * drew one, and anchoring on a column that is empty for two of the three states leaves the reader's
 * eye with nothing to hold. The number follows immediately, where it is read.
 *
 * A DRAFT'S FIGURES ARE COMPUTED AND SAY SO. A draft has no stored total — balances are created at
 * finalization — so its share is the sum of the lines it is carrying and moves as work is claimed.
 * The cell carries that fact on its hover rather than presenting a moving figure as a settled one.
 */
import type { GridColumn, GridColumnFilter } from "@magna-carta/design-system/data-table";
import { statusEntry, type StatusKey } from "@magna-carta/design-system/status-register";
import type { InvoiceStatus } from "./billing-api.ts";
import {
  billUnpaidMinor,
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
  billTotal: "billTotal",
  billUnpaid: "billUnpaid",
  delivered: "delivered",
  credited: "credited",
  client: "client",
} as const;

/** The register opens on what was raised most recently, which is where the work is. */
export const BILL_REGISTER_INITIAL_SORT = {
  columnId: BILL_COLUMN_IDENTIFIERS.createdAt,
  direction: "descending",
} as const;

/**
 * Every standing the Status column can show, and the invoice status each one is a reading of.
 *
 * The column shows five words and the listing takes three: Draft and Void are the invoice's own
 * status, and Unpaid, Partially Paid and Paid are all readings of a finalized bill. The set filter
 * offers the whole vocabulary rather than only what the loaded rows carry — a firm with no draft
 * open today can still have one tomorrow — and the firm's Billing screen reads a selection off it
 * to send as the listing's own `status` where the selection stays inside one.
 */
export const BILL_STANDING_CHOICES: readonly {
  readonly standing: StatusKey;
  readonly label: string;
  readonly status: InvoiceStatus;
}[] = (
  [
    ["draft", "draft"],
    ["unpaid", "final"],
    ["partially-paid", "final"],
    ["paid", "final"],
    ["void", "void"],
  ] as const satisfies readonly (readonly [StatusKey, InvoiceStatus])[]
).map(([standing, status]) => ({ standing, label: statusEntry(standing).label, status }));

/**
 * The invoice statuses a Status filter's selection reaches, in the order the listing knows them.
 * Draft with Paid asks for the drafts and the finalized; the table then narrows the finalized to
 * the paid over what the server returned. Empty where nothing is filtered.
 */
export function invoiceStatusesForStandings(
  filter: GridColumnFilter | undefined,
): readonly InvoiceStatus[] {
  if (filter?.kind !== "set") return [];
  const chosen = new Set(
    BILL_STANDING_CHOICES.filter((choice) => filter.values.includes(choice.label)).map(
      (choice) => choice.status,
    ),
  );
  return (["draft", "final", "void"] as const).filter((status) => chosen.has(status));
}

/** The Status filter naming every standing these statuses can show: what a linked address seeds. */
export function standingFilterForStatuses(
  statuses: readonly string[],
): GridColumnFilter | undefined {
  const labels = BILL_STANDING_CHOICES.filter((choice) => statuses.includes(choice.status)).map(
    (choice) => choice.label,
  );
  return labels.length === 0 ? undefined : { kind: "set", values: labels };
}

/**
 * Which register this is: one matter's, or the firm's own.
 *
 * The matter scope carries the two facts a matter's register knows and the firm's cannot — which
 * matter to take a share of, and the one client whose bills these are. The firm scope carries
 * neither, because across the firm every row answers for itself.
 */
export type BillRegisterScope =
  | {
      readonly kind: "matter";
      /** The matter the register is standing in. Its share is the leading money column. */
      readonly matterId: string;
      /** The client every one of these bills belongs to, as the matter records their name. */
      readonly clientName: string;
    }
  | { readonly kind: "firm" };

/** What the register needs to know that is not on an invoice. */
export interface BillRegisterContext {
  readonly scope: BillRegisterScope;
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
  const { scope, currency } = context;
  const inMatter = scope.kind === "matter";
  const matterId = scope.kind === "matter" ? scope.matterId : null;

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
      label: "Bill",
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
      filterValues: BILL_STANDING_CHOICES.map((choice) => choice.label),
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
      hidden: !inMatter,
      filterNote: "In the matter's currency.",
      // Null outside a matter rather than the document's total: the column asks what ONE matter was
      // charged, and answering it with the whole bill would be a wrong answer rather than no answer.
      value: (row) => {
        const share = matterId === null ? null : matterShareMinor(row, matterId);
        return share === null ? null : share / 100;
      },
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.matterUnpaid,
      label: "Unpaid, this matter",
      type: "money",
      currency,
      total: "sum",
      hidden: !inMatter,
      filterNote: "In the matter's currency.",
      value: (row) => {
        const unpaid = matterId === null ? null : matterUnpaidMinor(row, matterId);
        return unpaid === null ? null : unpaid / 100;
      },
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.billTotal,
      // Named for what it covers, because inside a matter it sits beside a column that does not:
      // the two figures differ exactly when a bill charges more than this matter, and a reader who
      // turned this on wants to see that difference rather than wonder which total they are reading.
      label: inMatter ? "Total (all matters)" : "Total",
      type: "money",
      currency,
      total: "sum",
      hidden: inMatter,
      filterNote: "In the bill's own currency.",
      // A draft's total is the lines it carries; a finalized bill's is the sum of its balances,
      // which is what the listing already states. Both come off the summary, so the figure is right
      // before any detail has been read.
      value: (row) => (row.summary.status === "void" ? null : row.summary.totalMinor / 100),
    },
    {
      id: BILL_COLUMN_IDENTIFIERS.billUnpaid,
      label: "Unpaid",
      type: "money",
      currency,
      total: "sum",
      hidden: inMatter,
      filterNote: "In the bill's own currency.",
      // Only a finalized bill owes anything: a draft has no balance yet and a voided draft never
      // owed. Null rather than zero for both, because a zero reads as "settled".
      value: (row) => (row.summary.status === "final" ? billUnpaidMinor(row) / 100 : null),
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
      // Hidden inside a matter, where every row names the same client and the column would be one
      // repeated word; shown across the firm, where it is what a reader picks a row out by.
      hidden: inMatter,
      // The matter's register prefers the name the MATTER records — what a reader there knows the
      // client by — and the firm's register has only what the listing resolved from the directory.
      // A bill whose client is not in the directory says so rather than printing an identifier.
      value: (row) =>
        scope.kind === "matter" ? scope.clientName : (row.summary.clientName ?? "Unnamed client"),
    },
  ];
}
