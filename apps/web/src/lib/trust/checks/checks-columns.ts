/*
 * The Checks screen's three lists, as columns. The grid is the product's one table, so sorting,
 * filtering, hiding and widths are all its own; this file says only what each list's columns are.
 *
 * THE NUMBER LEADS THE REGISTER. A check is read back by its number, off the paper and off the bank
 * statement, so it anchors every row that has one. In To Print nothing has a number yet, so the
 * payee leads and the number column previews what each chosen payment will print on.
 */
import { fromMinor, spreadsheetNumber } from "@magna-carta/money/format";
import { currencyFromCode } from "@magna-carta/money/money";
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type { TrustCheckRegisterRow, TrustCheckToPrint } from "./checks-api.ts";
import { checkStatusLabel, matterLabel } from "./checks-model.ts";

/** An amount as whole currency units, the number a money column sorts and totals by. */
function wholeUnits(amountMinor: number, currency: string): number {
  return spreadsheetNumber(fromMinor(amountMinor, currencyFromCode(currency)));
}

export const QUEUE_COLUMNS = {
  chosen: "chosen",
  payee: "payee",
  matter: "matter",
  memo: "memo",
  approvedBy: "approvedBy",
  date: "date",
  amount: "amount",
  checkNumber: "checkNumber",
} as const;

export const REGISTER_COLUMNS = {
  checkNumber: "checkNumber",
  date: "date",
  payee: "payee",
  matter: "matter",
  amount: "amount",
  status: "status",
  reason: "reason",
  settledOn: "settledOn",
  act: "act",
} as const;

export interface QueueColumnOptions {
  readonly currency: string;
  readonly memberName: (identifier: string) => string;
  readonly previewNumber: (trustMovementId: string) => number | null;
}

export function queueColumns(
  options: QueueColumnOptions,
): readonly GridColumn<TrustCheckToPrint>[] {
  return [
    {
      id: QUEUE_COLUMNS.chosen,
      label: "Print",
      anchored: true,
      filter: "none",
      value: () => null,
      text: () => "",
    },
    { id: QUEUE_COLUMNS.payee, label: "Payee", type: "text", value: (row) => row.payee },
    { id: QUEUE_COLUMNS.matter, label: "Matter", type: "text", value: (row) => matterLabel(row) },
    {
      id: QUEUE_COLUMNS.memo,
      label: "Memo",
      type: "text",
      filter: "text",
      value: (row) => row.memo,
    },
    {
      id: QUEUE_COLUMNS.approvedBy,
      label: "Approved By",
      type: "text",
      value: (row) => (row.authorizedBy === null ? null : options.memberName(row.authorizedBy)),
    },
    {
      id: QUEUE_COLUMNS.date,
      label: "Date",
      type: "date",
      hidden: true,
      value: (row) => row.effectiveDate,
    },
    {
      id: QUEUE_COLUMNS.amount,
      label: "Amount",
      type: "money",
      currency: options.currency,
      value: (row) => wholeUnits(row.amountMinor, row.currency),
    },
    {
      id: QUEUE_COLUMNS.checkNumber,
      label: "Check No.",
      type: "text",
      filter: "none",
      // A preview is not a value the queue sorts by: it is derived from the queue's own order.
      value: () => null,
      text: (row) => {
        const number = options.previewNumber(row.trustMovementId);
        return number === null ? "" : `${number} at print`;
      },
    },
  ];
}

export interface RegisterColumnOptions {
  readonly currency: string;
  /** Whether the list is the voided one, which reads its reason and the day it was taken out. */
  readonly voided: boolean;
}

export function registerColumns(
  options: RegisterColumnOptions,
): readonly GridColumn<TrustCheckRegisterRow>[] {
  const columns: GridColumn<TrustCheckRegisterRow>[] = [
    {
      id: REGISTER_COLUMNS.checkNumber,
      label: "Check No.",
      type: "number",
      anchored: true,
      align: "start",
      value: (row) => row.checkNumber,
      text: (row) => String(row.checkNumber),
    },
    { id: REGISTER_COLUMNS.date, label: "Date", type: "date", value: (row) => row.effectiveDate },
    { id: REGISTER_COLUMNS.payee, label: "Payee", type: "text", value: (row) => row.payee },
    {
      id: REGISTER_COLUMNS.matter,
      label: "Matter",
      type: "text",
      value: (row) =>
        row.matterNumber === null && row.matterTitle === null ? null : matterLabel(row),
    },
    {
      id: REGISTER_COLUMNS.amount,
      label: "Amount",
      type: "money",
      currency: options.currency,
      value: (row) =>
        row.amountMinor === null
          ? null
          : wholeUnits(row.amountMinor, row.currency ?? options.currency),
    },
    {
      id: REGISTER_COLUMNS.status,
      label: "Status",
      type: "text",
      fitExtra: 12,
      value: (row) => checkStatusLabel(row.status),
    },
  ];
  if (options.voided) {
    columns.push(
      {
        id: REGISTER_COLUMNS.reason,
        label: "Reason",
        type: "text",
        filter: "text",
        value: (row) => row.settledReason,
      },
      {
        id: REGISTER_COLUMNS.settledOn,
        label: "Voided On",
        type: "date",
        value: (row) => row.lastEventAt,
      },
    );
  } else {
    columns.push({
      id: REGISTER_COLUMNS.act,
      label: "Actions",
      filter: "none",
      pinnedEnd: true,
      value: () => null,
      text: () => "",
    });
  }
  return columns;
}
