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
 * Number starts hidden, because a column of identical gap marks in front of every reader is noise.
 * Attachments stays showing, because a cost's files are part of what a reader came to check and
 * the shape of the record is the thing worth seeing.
 *
 * DATE ENTERED AND ENTERED BY ARE SERVED, AND STILL START HIDDEN. The reason changed: they carry
 * real values now, and they stay off by default because they answer a question about the RECORD
 * rather than about the money — who captured this and when, which is what somebody asks while
 * reconciling a month, not while reading a matter's disbursements. A reader who wants them turns
 * them on and the layout is remembered.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { statusEntry } from "@magna-carta/design-system/status-register";
import type { CostSummary } from "$lib/matters/cost-api.ts";
import { costStatusKey } from "$lib/matters/cost-api.ts";
import { gapCellTitle, type CostLedgerGapName } from "./cost-gaps.ts";
import { billingLabel, costAmount, payeeText } from "./cost-vocabulary.ts";
import { recorderText, returnedDraftReason } from "$lib/records/work-in-progress-record.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const COST_COLUMN_IDENTIFIERS = {
  incurredDate: "incurredDate",
  matter: "matter",
  entryNumber: "entryNumber",
  dateEntered: "dateEntered",
  enteredBy: "enteredBy",
  returned: "returned",
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
 * How a row names its matter: the number and the title, as the firm's own screens name it.
 *
 * The listing resolves both, so nothing here looks a matter up. Empty where the row carries
 * neither, which the cell renders as its own blank — never a raw handle, which names the matter to
 * nobody, and never a stand-in, which names the wrong thing.
 */
export function costMatterText(cost: CostSummary): string {
  const title = cost.matterTitle ?? null;
  if (title === null) return "";
  const number = cost.matterNumber ?? null;
  return number === null ? title : `${number} — ${title}`;
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
      // Hidden inside a matter, where every row is on the same one and the column would be one
      // repeated phrase; the firm's own screen brings it forward (firmCostColumns below).
      id: COST_COLUMN_IDENTIFIERS.matter,
      label: "Matter",
      type: "text",
      filter: "set",
      hidden: true,
      fitExtra: 30,
      value: (cost) => costMatterText(cost),
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
    /*
     * When the cost was written down, which is not the day the money went out. A disbursement
     * captured three weeks late is a different record from one captured the day it was paid, and
     * only Incurred and this one together say which of the two a reader is looking at.
     */
    {
      id: COST_COLUMN_IDENTIFIERS.dateEntered,
      label: "Date Entered",
      type: "date",
      hidden: true,
      filter: "none",
      value: (cost) => cost.createdAt,
    },
    /*
     * Who wrote it down. It is not a permission fact — a cost belongs to the matter and not to its
     * recorder, so nothing is scoped by this — it is who to ask about a figure that looks wrong.
     */
    {
      id: COST_COLUMN_IDENTIFIERS.enteredBy,
      label: "Entered By",
      type: "text",
      hidden: true,
      filter: "set",
      fitExtra: 30,
      value: (cost) => recorderText(cost),
    },
    /*
     * Why a draft came back. Empty on nearly every row and hidden for that reason, but the column
     * exists because it is the one fact that tells a returned draft from one nobody has submitted —
     * and a reviewer who sent back six costs wants to see all six reasons at once rather than
     * opening six records.
     */
    {
      id: COST_COLUMN_IDENTIFIERS.returned,
      label: "Returned",
      type: "text",
      hidden: true,
      filter: "none",
      value: (cost) => returnedDraftReason(cost),
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

/**
 * The same declaration, arranged for the firm's own cost record.
 *
 * The matter is what a reader picks a row out by when the rows come from every matter at once, so
 * it stands second — immediately after the date the cost was incurred, which is what the period is
 * read by. Nothing else moves: one declaration, two arrangements, so a column means the same thing
 * and carries the same words on both screens.
 */
export function firmCostColumns(options: {
  readonly currency: string;
  readonly expenseCodeLabels: ExpenseCodeLabels;
}): readonly GridColumn<CostSummary>[] {
  return costLedgerColumns(options).map((column) =>
    column.id === COST_COLUMN_IDENTIFIERS.matter ? { ...column, hidden: false } : column,
  );
}
