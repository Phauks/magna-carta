/*
 * The Cost ledger's columns — what the matter's cost record says about itself, declared once.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering,
 * pinning, resizing or totalling is decided here. This file says only WHAT the columns are: their
 * words, their value types, which of them sum, and which of them the server cannot fill yet.
 *
 * NO HOURS AND NO RATE, AND THE ABSENCE IS THE POINT. A cost is an exact amount as spent, so the
 * honest difference from the time ledger is a missing column rather than an emptied one. What
 * replaces them is the cost's own vocabulary: the payee, the expense code and the files attached.
 *
 * THE DESCRIPTION CARRIES THE WIDTH. It is the line the client reads on the bill, so it leads the
 * record's own facts and the payee sits beside it; everything narrow and fixed follows.
 *
 * A COLUMN THE LISTING CANNOT FILL STILL EXISTS. Its label is real, it appears in the columns menu,
 * and its cells say what they are waiting on instead of showing a value nobody recorded. Entry
 * Number, Date Entered and Entered By start hidden, because a column of identical gap marks in
 * front of every reader is noise. Attachments stays showing, because a cost's files are part of
 * what a reader came to check and the shape of the record is the thing worth seeing.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { statusEntry } from "@magna-carta/design-system/status-register";
import type { CostSummary } from "$lib/matters/cost-api.ts";
import { costStatusKey } from "$lib/matters/cost-api.ts";
import { gapCellTitle, type CostLedgerGapName } from "./cost-gaps.ts";
import { billingLabel, costAmount, payeeText } from "./cost-vocabulary.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const COST_COLUMN_IDENTIFIERS = {
  incurredDate: "incurredDate",
  entryNumber: "entryNumber",
  dateEntered: "dateEntered",
  enteredBy: "enteredBy",
  description: "description",
  payee: "payee",
  expenseCode: "expenseCode",
  attachments: "attachments",
  amount: "amount",
  billing: "billing",
  status: "status",
} as const;

/** Which columns carry a value the listing does not serve, and which gap each of them names. */
export const UNSERVED_COST_COLUMNS: Readonly<Record<string, CostLedgerGapName>> = {
  [COST_COLUMN_IDENTIFIERS.entryNumber]: "entryNumber",
  [COST_COLUMN_IDENTIFIERS.dateEntered]: "dateEntered",
  [COST_COLUMN_IDENTIFIERS.enteredBy]: "enteredBy",
  [COST_COLUMN_IDENTIFIERS.attachments]: "attachments",
};

/** Whether this column's values can be read at all yet. */
export function isUnservedColumn(columnIdentifier: string): boolean {
  return columnIdentifier in UNSERVED_COST_COLUMNS;
}

/** The gap a column names, or undefined where the column carries real data. */
export function columnGap(columnIdentifier: string): CostLedgerGapName | undefined {
  return UNSERVED_COST_COLUMNS[columnIdentifier];
}

/** What an unserved cell's hover says. */
export function unservedCellTitle(columnIdentifier: string): string {
  const gap = columnGap(columnIdentifier);
  return gap === undefined ? "" : gapCellTitle(gap);
}

/** An expense code as this surface can read it: always a code, a label only where one is known. */
export interface ExpenseCodeReading {
  readonly code: string;
  readonly label: string | null;
}

/**
 * The ABA expense code a cost carries, read off its own identifier.
 *
 * The catalogue's identifiers are seeded in a stated handle format — `utbmsCode_expense_E101` — so
 * the code itself is legible without a catalogue read. The human label is not, which is why the
 * label is nullable and the catalogue supplies it when this account is allowed to read one.
 */
export function expenseCodeFromIdentifier(identifier: string | null): string | null {
  if (identifier === null) return null;
  const parts = identifier.split("_");
  const code = parts.at(-1) ?? "";
  return code === "" ? null : code;
}

/** How the catalogue is asked for a label. Absent labels are the catalogue's silence, not a blank. */
export type ExpenseCodeLabels = (identifier: string) => string | null;

/** What one cost's expense code reads as, code first, label beside it where there is one. */
export function expenseCodeReading(
  cost: CostSummary,
  labels: ExpenseCodeLabels,
): ExpenseCodeReading | null {
  const code = expenseCodeFromIdentifier(cost.utbmsExpenseCodeId);
  if (code === null) return null;
  return { code, label: labels(cost.utbmsExpenseCodeId ?? "") };
}

/** The expense code as one string, for a filter list, a fit measure and a printed sheet. */
export function expenseCodeText(cost: CostSummary, labels: ExpenseCodeLabels): string {
  const reading = expenseCodeReading(cost, labels);
  if (reading === null) return "";
  return reading.label === null ? reading.code : `${reading.code} ${reading.label}`;
}

/**
 * The ledger's columns, in the order the design puts them.
 *
 * `currency` follows the rows rather than being assumed: a matter's costs are written in the
 * firm's currency, and reading it off the data is what keeps the totals row and the cells agreeing.
 */
export function costLedgerColumns(options: {
  readonly currency: string;
  readonly expenseCodeLabels: ExpenseCodeLabels;
}): readonly GridColumn<CostSummary>[] {
  const { currency, expenseCodeLabels } = options;
  return [
    {
      id: COST_COLUMN_IDENTIFIERS.incurredDate,
      label: "Date",
      type: "date",
      anchored: true,
      value: (cost) => cost.incurredDate,
    },
    {
      id: COST_COLUMN_IDENTIFIERS.entryNumber,
      label: "Entry Number",
      type: "text",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: COST_COLUMN_IDENTIFIERS.dateEntered,
      label: "Date Entered",
      type: "date",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: COST_COLUMN_IDENTIFIERS.enteredBy,
      label: "Entered By",
      type: "text",
      hidden: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    {
      id: COST_COLUMN_IDENTIFIERS.description,
      label: "Description",
      type: "text",
      value: (cost) => cost.description,
    },
    {
      id: COST_COLUMN_IDENTIFIERS.payee,
      label: "Payee",
      type: "text",
      filter: "set",
      fitExtra: 30,
      value: (cost) => payeeText(cost),
    },
    {
      id: COST_COLUMN_IDENTIFIERS.expenseCode,
      label: "Expense Code",
      type: "text",
      filter: "set",
      value: (cost) => expenseCodeText(cost, expenseCodeLabels),
    },
    {
      id: COST_COLUMN_IDENTIFIERS.attachments,
      label: "Attachments",
      type: "text",
      filter: "none",
      fitExtra: 20,
      value: () => null,
      text: () => "",
    },
    {
      id: COST_COLUMN_IDENTIFIERS.amount,
      label: "Amount",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In $, as spent.",
      value: (cost) => costAmount(cost),
    },
    {
      id: COST_COLUMN_IDENTIFIERS.billing,
      label: "Billing",
      type: "text",
      hidden: true,
      filter: "set",
      value: (cost) => billingLabel(cost.billable),
    },
    {
      id: COST_COLUMN_IDENTIFIERS.status,
      label: "Status",
      type: "text",
      filter: "set",
      fitExtra: 26,
      value: (cost) => statusEntry(costStatusKey(cost.status)).label,
    },
  ];
}
