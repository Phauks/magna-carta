/*
 * The bank's lines, as the grid's columns. Out and In are two money columns rather than one signed
 * amount, the way a bank statement and QuickBooks' Banking screen print them.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { BankFeedTransaction } from "./banking-api.ts";
import {
  STATUS_WORDS,
  isMoneyIn,
  isMoneyOut,
  statusLabel,
  wholeUnitsMagnitude,
} from "./banking-model.ts";

export const LINE_COLUMNS = {
  date: "date",
  description: "description",
  out: "out",
  in: "in",
  status: "status",
  actions: "actions",
} as const;

export function lineColumns(currency: string): readonly GridColumn<BankFeedTransaction>[] {
  return [
    {
      id: LINE_COLUMNS.date,
      label: "Date",
      type: "date",
      anchored: true,
      value: (line) => line.postedOn,
    },
    {
      id: LINE_COLUMNS.description,
      label: "Bank Description",
      type: "text",
      filter: "text",
      value: (line) => line.description,
    },
    {
      id: LINE_COLUMNS.out,
      label: "Out",
      type: "money",
      currency,
      value: (line) =>
        isMoneyOut(line, currency) ? wholeUnitsMagnitude(line.amountMinor, currency) : null,
    },
    {
      id: LINE_COLUMNS.in,
      label: "In",
      type: "money",
      currency,
      value: (line) =>
        isMoneyIn(line, currency) ? wholeUnitsMagnitude(line.amountMinor, currency) : null,
    },
    {
      id: LINE_COLUMNS.status,
      label: "Status",
      type: "text",
      filterValues: STATUS_WORDS,
      value: (line) => statusLabel(line.status),
    },
    {
      id: LINE_COLUMNS.actions,
      label: "Actions",
      filter: "none",
      pinnedEnd: true,
      value: () => null,
      text: () => "",
    },
  ];
}
