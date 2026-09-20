/*
 * The three tables a reconciliation is worked in, as columns.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering,
 * pinning or resizing is decided here. This file says only WHAT the columns are: their words, their
 * value types, and which of them a reader narrows from.
 *
 * THE DAY LEADS ON BOTH SIDES AND IS ANCHORED, because reconciling is reading two columns of dates
 * against each other: the day the bank posted a line on the left, the day the firm recorded an
 * entry on the right. Everything beside it is what tells two movements of the same amount apart.
 *
 * EVERY COLUMN A SIDE CAN ANSWER IS DECLARED AND SHOWN. A column that starts hidden is a column
 * nobody who did not write the screen can find, and a reference or a counterparty is often the only
 * thing distinguishing two lines a bank posted on one day for one amount.
 *
 * THE DESCRIPTION IS NOT AMONG THEM, AND THAT IS THE RULE RATHER THAN AN OMISSION. What the bank
 * called a line, and what the firm called an entry, are each far longer than every fact beside them
 * put together: as a column either is truncated to a few words, which is not a description, or wide
 * enough to push the facts a reader matches on off the pane. Both are the row's own second line,
 * through the grid's `rowDetail`, which is where the workbench passes them.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import type {
  TrustBankItem,
  TrustBankStatementLine,
  TrustReconciliationMatch,
} from "./trust-api.ts";
import {
  bankItemDirectionLabel,
  bankItemKindLabel,
  matchStandingLabel,
} from "./reconciliation-model.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const STATEMENT_LINE_COLUMN_IDENTIFIERS = {
  postedOn: "postedOn",
  direction: "direction",
  amount: "amount",
  reference: "reference",
  counterparty: "counterparty",
} as const;

export const BANK_ITEM_COLUMN_IDENTIFIERS = {
  effectiveDate: "effectiveDate",
  direction: "direction",
  amount: "amount",
  reference: "reference",
  counterparty: "counterparty",
  kind: "kind",
  suggested: "suggested",
} as const;

export const MATCH_COLUMN_IDENTIFIERS = {
  line: "line",
  item: "item",
  amount: "amount",
  recordedBy: "recordedBy",
  recordedAt: "recordedAt",
  standing: "standing",
  withdrawnBy: "withdrawnBy",
  withdrawnAt: "withdrawnAt",
  act: "act",
} as const;

/** A bank posts in date order, and a reader works down the period the same way. */
export const STATEMENT_LINE_INITIAL_SORT = {
  columnId: STATEMENT_LINE_COLUMN_IDENTIFIERS.postedOn,
  direction: "ascending",
} as const;

export const BANK_ITEM_INITIAL_SORT = {
  columnId: BANK_ITEM_COLUMN_IDENTIFIERS.effectiveDate,
  direction: "ascending",
} as const;

/** The matches read oldest first, which is the order they were asserted in. */
export const MATCH_INITIAL_SORT = {
  columnId: MATCH_COLUMN_IDENTIFIERS.recordedAt,
  direction: "ascending",
} as const;

/**
 * The two directions, in the BANK'S own words, on both sides of the workbench.
 *
 * Reconciling is reading two columns against each other, and a reader doing it had to translate In
 * to Deposit and Out to Withdrawal on every row. Both sides are statements about the same bank
 * account — one the bank has posted, one the firm expects it to — so they read the same two words,
 * and a recorded entry's sign is mapped onto them rather than given a vocabulary of its own.
 * Declared here so a period with only deposits can still be asked for withdrawals.
 */
export const DIRECTION_FILTER_VALUES: readonly string[] = ["Deposit", "Withdrawal"];

/** The two standings a recorded match can be in. */
export const MATCH_STANDING_FILTER_VALUES: readonly string[] = ["Standing", "Withdrawn"];

/** What a statement line's direction is called. */
export function statementLineDirectionLabel(
  direction: TrustBankStatementLine["direction"],
): string {
  return direction === "deposit" ? "Deposit" : "Withdrawal";
}

export interface ReconciliationColumnOptions {
  /** How an amount reads, from the surface's own money vocabulary. */
  readonly money: (amountMinor: number) => string;
}

/** The statement lines this period has not accounted for. */
export function statementLineColumns(
  options: ReconciliationColumnOptions,
): readonly GridColumn<TrustBankStatementLine>[] {
  return [
    {
      id: STATEMENT_LINE_COLUMN_IDENTIFIERS.postedOn,
      label: "Posted On",
      type: "date",
      anchored: true,
      value: (line) => line.postedOn,
    },
    {
      id: STATEMENT_LINE_COLUMN_IDENTIFIERS.direction,
      label: "Direction",
      type: "text",
      filter: "set",
      filterValues: DIRECTION_FILTER_VALUES,
      value: (line) => statementLineDirectionLabel(line.direction),
    },
    {
      id: STATEMENT_LINE_COLUMN_IDENTIFIERS.amount,
      label: "Amount",
      // Sorted on the whole cents the record carries and READ through the surface's own money
      // vocabulary. A range filter over this column would ask for a figure in cents, which is not
      // a question anybody asks about a bank statement, so the column offers none.
      type: "number",
      align: "end",
      filter: "none",
      value: (line) => line.amountMinor,
      text: (line) => options.money(line.amountMinor),
    },
    {
      id: STATEMENT_LINE_COLUMN_IDENTIFIERS.reference,
      label: "Reference",
      type: "text",
      value: (line) => line.reference,
      text: (line) => line.reference ?? "",
    },
    {
      id: STATEMENT_LINE_COLUMN_IDENTIFIERS.counterparty,
      label: "Counterparty",
      type: "text",
      filter: "set",
      value: (line) => line.counterpartyName,
      text: (line) => line.counterpartyName ?? "",
    },
  ];
}

/** The entries the firm recorded that no statement line clears. */
export function bankItemColumns(
  options: ReconciliationColumnOptions & {
    /** Why each item is a candidate for the chosen line, where it is one. */
    readonly candidateText: (ledgerEntryId: string) => string | null;
  },
): readonly GridColumn<TrustBankItem>[] {
  return [
    {
      id: BANK_ITEM_COLUMN_IDENTIFIERS.effectiveDate,
      label: "Effective Date",
      type: "date",
      anchored: true,
      value: (item) => item.effectiveDate,
    },
    {
      id: BANK_ITEM_COLUMN_IDENTIFIERS.direction,
      label: "Direction",
      type: "text",
      filter: "set",
      filterValues: DIRECTION_FILTER_VALUES,
      value: (item) => bankItemDirectionLabel(item),
    },
    {
      id: BANK_ITEM_COLUMN_IDENTIFIERS.amount,
      label: "Amount",
      // Signed as the record holds it: positive into the bank, negative out of it. The Direction
      // column says which in words, so the sign is never the only statement of it.
      type: "number",
      align: "end",
      filter: "none",
      value: (item) => item.bankDeltaMinor,
      text: (item) => options.money(item.bankDeltaMinor),
    },
    {
      id: BANK_ITEM_COLUMN_IDENTIFIERS.reference,
      label: "Reference",
      type: "text",
      value: (item) => item.reference,
      text: (item) => item.reference ?? "",
    },
    {
      id: BANK_ITEM_COLUMN_IDENTIFIERS.counterparty,
      label: "Counterparty",
      type: "text",
      filter: "set",
      value: (item) => item.counterpartyName,
      text: (item) => item.counterpartyName ?? "",
    },
    {
      id: BANK_ITEM_COLUMN_IDENTIFIERS.kind,
      label: "Kind",
      type: "text",
      filter: "set",
      value: (item) => bankItemKindLabel(item),
    },
    {
      id: BANK_ITEM_COLUMN_IDENTIFIERS.suggested,
      label: "Suggested",
      type: "text",
      filter: "set",
      value: (item) => options.candidateText(item.ledgerEntryId),
      text: (item) => options.candidateText(item.ledgerEntryId) ?? "",
    },
  ];
}

/** Every match recorded on the reconciliation, withdrawn ones included. */
export function matchColumns(
  options: ReconciliationColumnOptions & {
    /** One member identifier as a name, from the firm's roster. */
    readonly memberName: (identifier: string) => string;
  },
): readonly GridColumn<TrustReconciliationMatch>[] {
  return [
    {
      id: MATCH_COLUMN_IDENTIFIERS.line,
      label: "Statement Line",
      type: "text",
      anchored: true,
      value: (match) => match.line.description,
    },
    {
      id: MATCH_COLUMN_IDENTIFIERS.item,
      label: "Recorded Item",
      type: "text",
      filter: "text",
      value: (match) => match.item.description,
    },
    {
      id: MATCH_COLUMN_IDENTIFIERS.amount,
      label: "Amount",
      type: "number",
      align: "end",
      filter: "none",
      value: (match) => match.line.amountMinor,
      text: (match) => options.money(match.line.amountMinor),
    },
    {
      id: MATCH_COLUMN_IDENTIFIERS.standing,
      label: "Standing",
      type: "text",
      filter: "set",
      filterValues: MATCH_STANDING_FILTER_VALUES,
      value: (match) => matchStandingLabel(match),
    },
    {
      id: MATCH_COLUMN_IDENTIFIERS.recordedBy,
      label: "Recorded By",
      type: "text",
      filter: "set",
      value: (match) => options.memberName(match.recordedBy),
    },
    {
      id: MATCH_COLUMN_IDENTIFIERS.recordedAt,
      label: "Recorded On",
      type: "date",
      value: (match) => match.recordedAt,
    },
    {
      id: MATCH_COLUMN_IDENTIFIERS.withdrawnBy,
      label: "Withdrawn By",
      type: "text",
      filter: "set",
      value: (match) => (match.withdrawnBy === null ? null : options.memberName(match.withdrawnBy)),
      text: (match) => (match.withdrawnBy === null ? "" : options.memberName(match.withdrawnBy)),
    },
    {
      id: MATCH_COLUMN_IDENTIFIERS.withdrawnAt,
      label: "Withdrawn On",
      type: "date",
      value: (match) => match.withdrawnAt,
      text: (match) => match.withdrawnAt ?? "",
    },
    {
      // The one act a match offers, pinned to the end of the row so it is in reach however far the
      // table is scrolled sideways. The column is always drawn; what comes and goes is the control
      // inside it, because a match that has already been withdrawn has nothing left to withdraw and
      // the Standing column beside it has already said so.
      id: MATCH_COLUMN_IDENTIFIERS.act,
      label: "Act",
      type: "text",
      filter: "none",
      pinnedEnd: true,
      value: () => null,
      text: () => "",
    },
  ];
}
