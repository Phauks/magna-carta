/*
 * The fee ledger's columns — every fee-side charge the matter's bills carry, declared once.
 *
 * DATE ANCHORS, AND IT IS THE DOCUMENT'S DATE. A charge has no date of its own: it is the invoice's
 * issue date, or the date a credit note took effect. That is what a firm reconciles against, and it
 * is why the column is called Date rather than anything more specific.
 *
 * AMOUNT IS SIGNED AND SUMS. A discount and a credit note are negative, so the totals row states the
 * NET the matter was charged rather than a gross figure nobody owes.
 *
 * DRAWN FROM IS REAL AND EMPTY. The count of time entries a fee line consolidated is a column the
 * design asks for and the read cannot fill: the invoice detail carries lines, not the claims behind
 * them. It exists, it is in the columns menu, and its cells say what they are waiting on — starting
 * hidden, because a column of identical gap marks in front of every reader is noise rather than
 * honesty.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { FEE_KIND_LABELS, type FeeCharge } from "./fee-charges.ts";

export const FEE_COLUMN_IDENTIFIERS = {
  date: "date",
  document: "document",
  kind: "kind",
  narrative: "narrative",
  arrangement: "arrangement",
  drawnFrom: "drawnFrom",
  amount: "amount",
  standing: "standing",
} as const;

export const FEE_LEDGER_INITIAL_SORT = {
  columnId: FEE_COLUMN_IDENTIFIERS.date,
  direction: "descending",
} as const;

/** Which columns carry a value the read does not serve. */
export const UNSERVED_FEE_COLUMNS: readonly string[] = [FEE_COLUMN_IDENTIFIERS.drawnFrom];

export function isUnservedFeeColumn(columnIdentifier: string): boolean {
  return UNSERVED_FEE_COLUMNS.includes(columnIdentifier);
}

/** The dash a charge uses where the column does not apply to it. */
export const NOT_ARRANGEMENT_COMPOSED =
  "The agreement version rides only arrangement-composed lines, such as a flat fee. An hourly fee " +
  "line derives from time entries and the rate cards in force.";

export function feeLedgerColumns(currency: string): readonly GridColumn<FeeCharge>[] {
  return [
    {
      id: FEE_COLUMN_IDENTIFIERS.date,
      label: "Date",
      type: "date",
      anchored: true,
      value: (charge) => charge.date,
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.document,
      label: "Invoice",
      type: "text",
      filter: "set",
      value: (charge) => charge.document,
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.kind,
      label: "Kind",
      type: "text",
      filter: "set",
      value: (charge) => FEE_KIND_LABELS[charge.kind],
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.narrative,
      label: "Info",
      type: "text",
      value: (charge) => charge.narrative,
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.arrangement,
      label: "Agreement",
      type: "text",
      filter: "set",
      hidden: true,
      value: (charge) => charge.arrangementLabel,
      text: (charge) => charge.arrangementLabel ?? "—",
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.drawnFrom,
      label: "Drawn From",
      type: "number",
      hidden: true,
      filter: "none",
      align: "end",
      value: () => null,
      text: () => "",
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.amount,
      label: "Amount",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In the matter's currency, net: discounts and credit notes are negative.",
      value: (charge) => charge.amountMinor / 100,
    },
    {
      id: FEE_COLUMN_IDENTIFIERS.standing,
      label: "Standing",
      type: "text",
      filter: "set",
      fitExtra: 40,
      value: (charge) => statusEntry(charge.standing).label,
    },
  ];
}
