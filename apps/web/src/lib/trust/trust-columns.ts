/*
 * The Trust ledger's columns: what a trust movement says about itself, declared once.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering,
 * pinning, resizing or totalling is decided here. This file says only WHAT the columns are: their
 * words, their value types, which of them sum, and which the reader cannot read as designed yet.
 *
 * IN AND OUT ARE TWO COLUMNS, NOT ONE SIGNED AMOUNT. A trust ledger is read the way a bank
 * statement is: money that came in on one side, money that went out on the other, each totalling
 * on its own. A single column with negatives would make a reader do the arithmetic the ledger
 * exists to have done, and a transfer, which is In on one matter and Out on the other, would have
 * to carry a sign the record does not.
 *
 * NO STATUS. A movement that reached the ledger is a fact; there is no draft, no void and no
 * chain, so the status column every other ledger carries is absent rather than emptied.
 *
 * THE PURPOSE CARRIES THE WIDTH. It is the line that says why client money moved, so it takes the
 * flexible column and everything narrow and fixed sits around it.
 *
 * RECORDED BY AND AUTHORIZED BY READ AS USER IDENTIFIERS, because that is what the ledger serves.
 * The column is real and the value is served; what waits is the name behind it, and the hover
 * says so rather than the cell pretending the identifier is a name.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { formatInstant } from "@magna-carta/design-system/formatters";
import type { TrustMovementRecord } from "./trust-api.ts";
import {
  TRUST_MOVEMENT_KINDS,
  TRUST_MOVEMENT_METHODS,
  authorizedByText,
  counterpartyText,
  direction,
  kindLabel,
  methodLabel,
} from "./trust-vocabulary.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const TRUST_COLUMN_IDENTIFIERS = {
  effectiveDate: "effectiveDate",
  kind: "kind",
  method: "method",
  reference: "reference",
  counterparty: "counterparty",
  purpose: "purpose",
  amountIn: "amountIn",
  amountOut: "amountOut",
  recordedBy: "recordedBy",
  authorizedBy: "authorizedBy",
  recordedAt: "recordedAt",
} as const;

/** The ledger opens on the most recent movement, which is where the question usually is. */
export const TRUST_LEDGER_INITIAL_SORT = {
  columnId: TRUST_COLUMN_IDENTIFIERS.effectiveDate,
  direction: "descending",
} as const;

/** What an amount reads in the currency's major unit, or null on the side the money did not go. */
function amountOnSide(
  movement: TrustMovementRecord,
  side: "in" | "out",
  ownTrustLedgerNodeId: string | null,
): number | null {
  return direction(movement, ownTrustLedgerNodeId) === side ? movement.amountMinor / 100 : null;
}

/**
 * The ledger's columns, in the order the design puts them.
 *
 * `currency` follows the records rather than being assumed, and `ownTrustLedgerNodeId` is the
 * node the reader is standing on: the ledger read names it, and it is what turns a transfer into
 * In or Out. Null until the read exists, which is also when there are no movements to turn.
 */
export function trustLedgerColumns(
  currency: string,
  ownTrustLedgerNodeId: string | null,
): readonly GridColumn<TrustMovementRecord>[] {
  return [
    {
      id: TRUST_COLUMN_IDENTIFIERS.effectiveDate,
      label: "Date",
      type: "date",
      anchored: true,
      value: (movement) => movement.effectiveDate,
    },
    {
      id: TRUST_COLUMN_IDENTIFIERS.kind,
      label: "Kind",
      type: "text",
      filter: "set",
      filterValues: TRUST_MOVEMENT_KINDS.map(kindLabel),
      fitExtra: 12,
      value: (movement) => kindLabel(movement.kind),
    },
    {
      id: TRUST_COLUMN_IDENTIFIERS.method,
      label: "Method",
      type: "text",
      filter: "set",
      filterValues: TRUST_MOVEMENT_METHODS.map(methodLabel),
      value: (movement) => methodLabel(movement.method),
    },
    {
      id: TRUST_COLUMN_IDENTIFIERS.reference,
      label: "Reference",
      type: "text",
      value: (movement) => movement.reference,
      text: (movement) => movement.reference ?? "",
    },
    {
      id: TRUST_COLUMN_IDENTIFIERS.counterparty,
      label: "Counterparty",
      type: "text",
      filter: "set",
      value: (movement) => counterpartyText(movement, ownTrustLedgerNodeId),
    },
    {
      id: TRUST_COLUMN_IDENTIFIERS.purpose,
      label: "Purpose",
      type: "text",
      value: (movement) => movement.purpose,
    },
    {
      id: TRUST_COLUMN_IDENTIFIERS.amountIn,
      label: "In",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In the account's currency: deposits and transfers into this matter.",
      value: (movement) => amountOnSide(movement, "in", ownTrustLedgerNodeId),
    },
    {
      id: TRUST_COLUMN_IDENTIFIERS.amountOut,
      label: "Out",
      type: "money",
      currency,
      total: "sum",
      filterNote: "In the account's currency: disbursements and transfers out of this matter.",
      value: (movement) => amountOnSide(movement, "out", ownTrustLedgerNodeId),
    },
    {
      id: TRUST_COLUMN_IDENTIFIERS.recordedBy,
      label: "Recorded By",
      type: "text",
      filter: "set",
      value: (movement) => movement.recordedBy,
    },
    {
      id: TRUST_COLUMN_IDENTIFIERS.authorizedBy,
      label: "Authorized By",
      type: "text",
      filter: "set",
      value: (movement) => authorizedByText(movement),
    },
    {
      // Hidden by default: the day the money moved is the Date column, and a column of timestamps
      // beside it is noise until somebody asks when a row was written down.
      id: TRUST_COLUMN_IDENTIFIERS.recordedAt,
      label: "Recorded At",
      type: "date",
      hidden: true,
      value: (movement) => movement.recordedAt,
      text: (movement) => formatInstant(movement.recordedAt),
    },
  ];
}
