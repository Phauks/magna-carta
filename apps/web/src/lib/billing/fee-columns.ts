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
 * its cells say what they wait on instead of showing a value nobody recorded. Entry Number, Date
 * Entered, Billable and Attachments start hidden, because a column of identical gap marks in front
 * of every reader is noise rather than honesty.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { gapCellTitle, type FeeLedgerGapName } from "./fee-gaps.ts";
import { billingLabel, feeStatusKey, type FeeRecord } from "./fee-record.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const FEE_COLUMN_IDENTIFIERS = {
  serviceDate: "serviceDate",
  entryNumber: "entryNumber",
  dateEntered: "dateEntered",
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
  [FEE_COLUMN_IDENTIFIERS.dateEntered]: "dateEntered",
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
    {
      id: FEE_COLUMN_IDENTIFIERS.entryNumber,
      label: "Entry Number",
      type: "text",
      hidden: true,
      filter: "none",
      value: (fee) => fee.entryNumber,
      text: (fee) => fee.entryNumber ?? "",
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.dateEntered,
      label: "Date Entered",
      type: "date",
      hidden: true,
      filter: "none",
      value: (fee) => fee.enteredDate,
      text: () => "",
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
      value: (fee) => fee.description,
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.amount,
      label: "Amount",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In the matter's currency, the charge exactly as recorded.",
      value: (fee) => (fee.amountMinor === null ? null : fee.amountMinor / 100),
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.billable,
      label: "Billable",
      type: "text",
      hidden: true,
      filter: "set",
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
      fitExtra: 26,
      value: (fee) => statusEntry(feeStatusKey(fee.status)).label,
    },
  ];
}
