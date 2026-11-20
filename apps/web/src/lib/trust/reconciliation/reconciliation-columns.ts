/*
 * The reconciliation screens' lists, as columns. The grid is the product's one table, so sorting,
 * hiding and widths are its own; this file says only what each list's columns are. Every column
 * but the one a row is named by can be turned off from the header menu.
 */
import { fromMinor, spreadsheetNumber } from "@magna-carta/money/format";
import { currencyFromCode } from "@magna-carta/money/money";
import { balanceChangeMinor } from "@magna-carta/trust/bank-reconciliation-figures";
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type {
  TrustBankReconciliationItem,
  TrustBankReconciliationSummary,
} from "./reconciliation-api.ts";
import { periodText, statusLabel, statusOf, typeLabel } from "./reconciliation-model.ts";

/** An amount as whole currency units, the number a money column sorts and totals by. */
export function wholeUnits(amountMinor: number, currency: string): number {
  return spreadsheetNumber(fromMinor(amountMinor, currencyFromCode(currency)));
}

export const LIST_COLUMNS = {
  dates: "dates",
  startBalance: "startBalance",
  deposited: "deposited",
  withdrawn: "withdrawn",
  endBalance: "endBalance",
  change: "change",
  difference: "difference",
  status: "status",
  files: "files",
  notes: "notes",
  finishedBy: "finishedBy",
  interest: "interest",
} as const;

export function listColumns(
  currency: string,
): readonly GridColumn<TrustBankReconciliationSummary>[] {
  const money = (minor: number | null): number | null =>
    minor === null ? null : wholeUnits(minor, currency);
  return [
    {
      id: LIST_COLUMNS.dates,
      label: "Dates",
      type: "date",
      anchored: true,
      value: (row) => row.endDate,
      text: (row) => periodText(row.reconciliation.startDate, row.endDate),
    },
    {
      id: LIST_COLUMNS.startBalance,
      label: "Start Balance",
      type: "money",
      currency,
      value: (row) => money(row.reconciliation.startBalanceMinor),
    },
    {
      id: LIST_COLUMNS.deposited,
      label: "Deposited",
      type: "money",
      currency,
      value: (row) => money(row.depositedMinor),
    },
    {
      id: LIST_COLUMNS.withdrawn,
      label: "Withdrawn",
      type: "money",
      currency,
      value: (row) => money(row.withdrawnMinor),
    },
    {
      id: LIST_COLUMNS.endBalance,
      label: "End Balance",
      type: "money",
      currency,
      value: (row) => money(row.endBalanceMinor),
    },
    {
      id: LIST_COLUMNS.change,
      label: "Change",
      type: "money",
      currency,
      value: (row) =>
        money(
          balanceChangeMinor(currency, row.reconciliation.startBalanceMinor, row.endBalanceMinor),
        ),
    },
    {
      id: LIST_COLUMNS.difference,
      label: "Difference",
      type: "money",
      currency,
      value: (row) => money(row.differenceMinor),
    },
    {
      id: LIST_COLUMNS.status,
      label: "Status",
      type: "text",
      value: (row) => statusLabel(statusOf(row)),
    },
    {
      id: LIST_COLUMNS.files,
      label: "Files",
      type: "number",
      value: (row) => row.fileCount,
      text: (row) => (row.fileCount === 0 ? "None" : String(row.fileCount)),
    },
    {
      id: LIST_COLUMNS.notes,
      label: "Notes",
      type: "number",
      value: (row) => row.noteCount,
      text: (row) =>
        row.noteCount === 0
          ? "None"
          : row.needsReviewCount === 0
            ? String(row.noteCount)
            : `${row.noteCount}, ${row.needsReviewCount} to review`,
    },
    {
      id: LIST_COLUMNS.finishedBy,
      label: "Finished By",
      type: "text",
      hidden: true,
      value: (row) => row.reconciliation.finishedByName,
    },
    {
      id: LIST_COLUMNS.interest,
      label: "IOLTA Interest",
      type: "money",
      currency,
      hidden: true,
      value: (row) => money(row.interestCreditedMinor),
    },
  ];
}

export const ITEM_COLUMNS = {
  cleared: "cleared",
  date: "date",
  type: "type",
  number: "number",
  payee: "payee",
  matter: "matter",
  deposit: "deposit",
  withdrawal: "withdrawal",
  note: "note",
} as const;

export interface ItemColumnOptions {
  readonly currency: string;
  readonly noteCount: (entryId: string) => number;
}

export function itemColumns(
  options: ItemColumnOptions,
): readonly GridColumn<TrustBankReconciliationItem>[] {
  const { currency } = options;
  return [
    {
      id: ITEM_COLUMNS.cleared,
      label: "Cleared",
      anchored: true,
      filter: "none",
      value: (row) => (row.cleared ? 1 : 0),
      text: () => "",
    },
    {
      id: ITEM_COLUMNS.date,
      label: "Date",
      type: "date",
      value: (row) => row.effectiveDate,
    },
    { id: ITEM_COLUMNS.type, label: "Type", type: "text", value: (row) => typeLabel(row.type) },
    { id: ITEM_COLUMNS.number, label: "No.", type: "text", value: (row) => row.number },
    {
      id: ITEM_COLUMNS.payee,
      label: "Payee or From",
      type: "text",
      value: (row) => row.payeeOrFrom ?? row.description,
    },
    {
      id: ITEM_COLUMNS.matter,
      label: "Matter",
      type: "text",
      value: (row) => (row.firmFunds ? "Firm funds" : row.matterNumber),
    },
    {
      id: ITEM_COLUMNS.deposit,
      label: "Deposit",
      type: "money",
      currency,
      value: (row) => (row.amountMinor >= 0 ? wholeUnits(row.amountMinor, currency) : null),
    },
    {
      id: ITEM_COLUMNS.withdrawal,
      label: "Withdrawal",
      type: "money",
      currency,
      value: (row) => (row.amountMinor < 0 ? wholeUnits(-row.amountMinor, currency) : null),
    },

    {
      id: ITEM_COLUMNS.note,
      label: "Note",
      type: "number",
      filter: "none",
      // Kept in reach when the list scrolls sideways, as the way into a line's notes.
      pinnedEnd: true,
      value: (row) => options.noteCount(row.entryId),
      text: (row) => {
        const count = options.noteCount(row.entryId);
        return count === 0 ? "" : String(count);
      },
    },
  ];
}
