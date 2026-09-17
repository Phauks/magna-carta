/*
 * The Fees ledger's columns — what a fee record says about itself, declared once.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering,
 * pinning, resizing or totalling is decided here. This file says only WHAT the columns are: their
 * words, their value types, which of them sum, and which the server cannot fill yet.
 *
 * NO INVOICE, NO KIND, NO AGREEMENT VERSION, AND NO "DRAWN FROM". A fee is not an invoice line and
 * is not produced by one, so a column naming the document it eventually rides would be asserting
 * the record is born on a bill. It is not: it is born as a draft on this matter and reaches a bill
 * only when a draft invoice claims it, exactly as a cost does. The invoice a billed fee rides is a
 * fact about the record and lives on the record, not in the reader's way.
 *
 * THE DESCRIPTION CARRIES THE WIDTH. It is the line the client reads on the bill, so it takes the
 * flexible column and everything narrow and fixed sits around it.
 *
 * A COLUMN THE LISTING CANNOT FILL STILL EXISTS. Its label is real, it is in the columns menu, and
 * its cells say what they wait on instead of showing a value nobody recorded. Entry Number and
 * Attachments are the two left, and they start hidden, because a column of identical gap marks in
 * front of every reader is noise rather than honesty. Date Entered, Entered By and Returned start
 * hidden for the opposite reason: they carry real values that nearly every reader can ignore.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { statusEntry } from "@magna-carta/design-system/status-register";
import type { FilterChoice } from "$lib/money/listing-scope.ts";
import { gapCellTitle, type FeeLedgerGapName } from "./fee-gaps.ts";
import { recorderText, returnedDraftReason } from "$lib/records/work-in-progress-record.ts";
import { billingLabel, feeMatterText, feeStatusKey, type FeeRecord } from "./fee-record.ts";

/**
 * Every status a fee can hold, as the wire spells it and as the Status column shows it. The
 * column's set filter offers the whole vocabulary rather than only what the loaded rows carry, and
 * the firm's Fees screen reads a single choice off it to send as the listing's own `status`.
 */
export const FEE_STATUS_CHOICES: readonly FilterChoice<FeeRecord["status"]>[] = (
  ["draft", "submitted", "approved", "billed", "void"] as const
).map((status) => ({ value: status, label: statusEntry(feeStatusKey(status)).label }));

/** The Billable column's two words, keyed by the listing's own `billable` value. */
export const FEE_BILLING_CHOICES: readonly FilterChoice<"true" | "false">[] = [
  { value: "true", label: billingLabel(true) },
  { value: "false", label: billingLabel(false) },
];

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const FEE_COLUMN_IDENTIFIERS = {
  serviceDate: "serviceDate",
  matter: "matter",
  entryNumber: "entryNumber",
  dateEntered: "dateEntered",
  enteredBy: "enteredBy",
  returned: "returned",
  timekeeper: "timekeeper",
  description: "description",
  amount: "amount",
  billable: "billable",
  attachments: "attachments",
  status: "status",
} as const;

/** The ledger opens on the most recent charge, which is where the work is. */
export const FEE_LEDGER_INITIAL_SORT = {
  columnId: FEE_COLUMN_IDENTIFIERS.serviceDate,
  direction: "descending",
} as const;

/** Which columns carry a value the listing does not serve, and which gap each of them names. */
export const UNSERVED_FEE_COLUMNS: Readonly<Record<string, FeeLedgerGapName>> = {
  [FEE_COLUMN_IDENTIFIERS.entryNumber]: "entryNumber",
  [FEE_COLUMN_IDENTIFIERS.attachments]: "attachments",
};

/** Whether this column's values can be read at all yet. */
export function isUnservedFeeColumn(columnIdentifier: string): boolean {
  return columnIdentifier in UNSERVED_FEE_COLUMNS;
}

/** The gap a column names, or undefined where the column carries real data. */
export function feeColumnGap(columnIdentifier: string): FeeLedgerGapName | undefined {
  return UNSERVED_FEE_COLUMNS[columnIdentifier];
}

/** What an unserved cell's hover says. */
export function unservedFeeCellTitle(columnIdentifier: string): string {
  const gap = feeColumnGap(columnIdentifier);
  return gap === undefined ? "" : gapCellTitle(gap);
}

/** What a timekeeper cell reads where the record does not name one. */
export const TIMEKEEPER_UNRECORDED = "Not recorded";

export function timekeeperText(fee: FeeRecord): string {
  return fee.timekeeperName ?? TIMEKEEPER_UNRECORDED;
}

/**
 * The ledger's columns, in the order the design puts them.
 *
 * `currency` follows the records rather than being assumed: a matter's fees are written in the
 * firm's currency, and reading it off the data is what keeps the totals row and the cells agreeing.
 */
export function feeLedgerColumns(currency: string): readonly GridColumn<FeeRecord>[] {
  return [
    {
      id: FEE_COLUMN_IDENTIFIERS.serviceDate,
      label: "Date",
      type: "date",
      anchored: true,
      value: (fee) => fee.serviceDate,
    },
    /*
     * The matter a charge is against. Hidden on a matter's own ledger, where every row is the same
     * matter and the column would be one repeated phrase; the firm's own screen brings it forward
     * (firmFeeColumns below), which is the reason the period listing resolves it beside the record.
     */
    {
      id: FEE_COLUMN_IDENTIFIERS.matter,
      label: "Matter",
      type: "text",
      filter: "set",
      hidden: true,
      fitExtra: 30,
      value: (fee) => feeMatterText(fee),
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.entryNumber,
      label: "Entry Number",
      type: "text",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    /*
     * When the charge was written down, which is not the day the work was done. A fee captured
     * three weeks late is a different record from one captured as it happened, and only Date and
     * this one together say which of the two a reader is looking at.
     */
    {
      id: FEE_COLUMN_IDENTIFIERS.dateEntered,
      label: "Date Entered",
      type: "date",
      hidden: true,
      filter: "none",
      value: (fee) => fee.createdAt,
    },
    /*
     * Who wrote it down. It is not a permission fact — a fee belongs to the matter it charges and
     * not to its recorder — it is who to ask about a figure that looks wrong.
     */
    {
      id: FEE_COLUMN_IDENTIFIERS.enteredBy,
      label: "Entered By",
      type: "text",
      hidden: true,
      filter: "set",
      fitExtra: 30,
      value: (fee) => recorderText(fee),
    },
    /*
     * Why a draft came back. Empty on nearly every row and hidden for that reason, but the column
     * exists because it is the one fact that tells a returned draft from one nobody has submitted —
     * and a reviewer who sent back six fees wants to see all six reasons at once rather than
     * opening six records.
     */
    {
      id: FEE_COLUMN_IDENTIFIERS.returned,
      label: "Returned",
      type: "text",
      hidden: true,
      filter: "none",
      value: (fee) => returnedDraftReason(fee),
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.timekeeper,
      label: "Timekeeper",
      type: "text",
      filter: "set",
      fitExtra: 30,
      value: (fee) => timekeeperText(fee),
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.description,
      label: "Description",
      type: "text",
      // Prose: no two fees share a description, so a checklist of them would be the column read
      // twice. This is the column that keeps the contains box, and it has to say so.
      filter: "text",
      value: (fee) => fee.description,
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.amount,
      label: "Amount",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In the matter's currency, the charge exactly as recorded.",
      value: (fee) => fee.amountMinor / 100,
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.billable,
      label: "Billable",
      type: "text",
      hidden: true,
      filter: "set",
      filterValues: FEE_BILLING_CHOICES.map((choice) => choice.label),
      value: (fee) => billingLabel(fee.billable),
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.attachments,
      label: "Attachments",
      type: "text",
      hidden: true,
      filter: "none",
      fitExtra: 20,
      value: () => null,
      text: () => "",
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.status,
      label: "Status",
      type: "text",
      filter: "set",
      filterValues: FEE_STATUS_CHOICES.map((choice) => choice.label),
      fitExtra: 26,
      value: (fee) => statusEntry(feeStatusKey(fee.status)).label,
    },
  ];
}

/**
 * The same columns, arranged for the firm's own period screen.
 *
 * ONE DECLARATION, TWO ARRANGEMENTS. The firm-wide screen differs from the matter's by exactly one
 * thing — a fee read across every matter has to say which one it charges — so it takes the ledger's
 * own columns with Matter brought forward rather than declaring a set of its own. Two declarations
 * is two chances for a fee to carry different words depending on which screen found it.
 */
export function firmFeeColumns(currency: string): readonly GridColumn<FeeRecord>[] {
  return feeLedgerColumns(currency).map((column) =>
    column.id === FEE_COLUMN_IDENTIFIERS.matter ? { ...column, hidden: false } : column,
  );
}
