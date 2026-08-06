import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  LedgerEntryId,
  TrustBankStatementLineId,
  TrustMovementId,
  TrustTransferId,
} from "@magna-carta/identifiers/types";
import { loadTrustAccount } from "./account-tree.ts";
import { readTrustBankStatement } from "./bank-statements.ts";
import {
  selectOutstandingTrustBankItemsStatement,
  selectTrustBookBalanceAsOfStatement,
  selectTrustClientLedgerTotalAsOfStatement,
  selectUnmatchedTrustBankStatementLinesStatement,
} from "./statements.ts";
import type {
  TrustBankItem,
  TrustBankStatementLineDirection,
  TrustBankStatementLineSnapshot,
  TrustMovementKind,
  TrustReconciliationDisagreement,
  TrustReconciliationSnapshot,
  TrustThreeWayProof,
} from "./types.ts";

// THE THREE-WAY PROOF. For one trust account, as of one statement's period end, three totals must
// agree:
//
//   bank     the institution's closing balance, ADJUSTED for items the firm recorded that have not
//            reached the bank yet — deposits in transit add, outstanding disbursements subtract
//   book     the trust bank account's own balance in the firm's ledger
//   client   the sum of every client ledger under that account
//
// Book and client agree BY CONSTRUCTION as long as the composition guard holds: every trust entry
// touches exactly one trust-bank account and exactly one leaf under its liability root. So the
// book-to-client leg is not a calculation that is expected to be interesting — it is a re-proof that
// the guard held, and a difference there means something reached the ledger without going through
// it. The bank leg is the only genuinely external input, and the only one that can catch an item the
// firm never recorded at all.
//
// EVERY TOTAL IS COMPUTED FROM THE LEDGER'S OWN ROWS, by effective date, never from a stored
// current balance. That is what makes the same period reproduce the same answer a year later, and
// it is why a backdated reversal changes a LIVE proof — which is exactly why a close freezes one.
//
// A PROOF THAT DOES NOT BALANCE IS REPORTED, NEVER FORCED. It names which leg disagrees and by how
// much. There is no plug figure, no rounding to agreement, and no "unreconciled difference" line
// that quietly absorbs the gap: the whole value of the exercise is the number that will not go away.

interface TotalRow {
  balance_minor?: number;
  total_minor?: number;
}

interface OutstandingItemRow {
  entry_id: string;
  effective_date: string;
  description: string;
  bank_delta_minor: number;
  movement_id: string | null;
  movement_kind: TrustMovementKind | null;
  reference: string | null;
  counterparty_name: string | null;
  transfer_id: string | null;
}

interface StatementLineRow {
  id: string;
  statement_id: string;
  posted_on: string;
  direction: TrustBankStatementLineDirection;
  amount_minor: number;
  description: string;
  reference: string | null;
  counterparty_name: string | null;
  source_row_number: number | null;
}

function toBankItem(row: OutstandingItemRow): TrustBankItem {
  return {
    entryId: row.entry_id as LedgerEntryId,
    effectiveDate: row.effective_date,
    description: row.description,
    bankDeltaMinor: row.bank_delta_minor,
    movementId: row.movement_id as TrustMovementId | null,
    movementKind: row.movement_kind,
    transferId: row.transfer_id as TrustTransferId | null,
    reference: row.reference,
    counterpartyName: row.counterparty_name,
  };
}

function toLineSnapshot(row: StatementLineRow): TrustBankStatementLineSnapshot {
  return {
    id: row.id as TrustBankStatementLineId,
    statementId: row.statement_id as TrustBankStatementLineSnapshot["statementId"],
    postedOn: row.posted_on,
    direction: row.direction,
    amountMinor: row.amount_minor,
    description: row.description,
    reference: row.reference,
    counterpartyName: row.counterparty_name,
    sourceRowNumber: row.source_row_number,
  };
}

// The outstanding items and the two ledger totals, read for one reconciliation. Split out so the
// close path freezes exactly what a reader of the live proof would have seen, rather than from a
// second computation that would eventually drift from this one.
export async function computeTrustThreeWayProof(
  database: SqlDatabase,
  reconciliation: TrustReconciliationSnapshot,
): Promise<TrustThreeWayProof> {
  const account = await loadTrustAccount(database, reconciliation.trustAccountId);
  const statement = await readTrustBankStatement(database, reconciliation.statementId);
  const asOfDate = statement.periodEnd;

  // Four reads, none of them per-row: the two as-of totals, the outstanding items, and the lines
  // this reconciliation has not accounted for.
  const [bookRows, clientRows, itemRows, lineRows] = await Promise.all([
    selectTrustBookBalanceAsOfStatement(database, account.bankLedgerAccountId, asOfDate).all<
      Required<Pick<TotalRow, "balance_minor">>
    >(),
    selectTrustClientLedgerTotalAsOfStatement(database, account.id, asOfDate).all<
      Required<Pick<TotalRow, "total_minor">>
    >(),
    selectOutstandingTrustBankItemsStatement(
      database,
      account.bankLedgerAccountId,
      asOfDate,
    ).all<OutstandingItemRow>(),
    selectUnmatchedTrustBankStatementLinesStatement(
      database,
      reconciliation.id,
      statement.id,
    ).all<StatementLineRow>(),
  ]);

  const bookBalanceMinor = bookRows.results[0]?.balance_minor ?? 0;
  const clientLedgerTotalMinor = clientRows.results[0]?.total_minor ?? 0;
  const items = itemRows.results.map(toBankItem);

  // An item that moved nothing across the bank cannot be in transit in either direction. It reaches
  // this list only when an entry's bank lines cancel out, which the ledger's balanced rule permits
  // and which no statement line will ever clear.
  const outstandingDeposits = items.filter((item) => item.bankDeltaMinor > 0);
  const outstandingDisbursements = items.filter((item) => item.bankDeltaMinor < 0);
  const outstandingDepositsMinor = outstandingDeposits.reduce(
    (total, item) => total + item.bankDeltaMinor,
    0,
  );
  const outstandingDisbursementsMinor = outstandingDisbursements.reduce(
    (total, item) => total - item.bankDeltaMinor,
    0,
  );

  // The classic bank reconciliation, and the direction of each adjustment is the whole of it: the
  // firm recorded a deposit the bank has not yet credited, so the bank's figure is short by it; the
  // firm wrote a check the bank has not yet paid, so the bank's figure is high by it.
  const adjustedBankMinor =
    statement.closingBalanceMinor + outstandingDepositsMinor - outstandingDisbursementsMinor;

  const disagreements: TrustReconciliationDisagreement[] = [];
  if (adjustedBankMinor !== bookBalanceMinor) {
    disagreements.push({
      leg: "bank-to-book",
      differenceMinor: adjustedBankMinor - bookBalanceMinor,
    });
  }
  if (bookBalanceMinor !== clientLedgerTotalMinor) {
    disagreements.push({
      leg: "book-to-client",
      differenceMinor: bookBalanceMinor - clientLedgerTotalMinor,
    });
  }

  return {
    trustAccountId: account.id,
    statementId: statement.id,
    asOfDate,
    currency: account.currency,
    statementClosingMinor: statement.closingBalanceMinor,
    outstandingDeposits,
    outstandingDepositsMinor,
    outstandingDisbursements,
    outstandingDisbursementsMinor,
    adjustedBankMinor,
    bookBalanceMinor,
    clientLedgerTotalMinor,
    unmatchedStatementLines: lineRows.results.map(toLineSnapshot),
    balanced: disagreements.length === 0,
    disagreements,
  };
}

// The candidate book items a member matches from: everything recorded up to the period end that no
// binding match has already tied to a statement line. It is the same read the proof's outstanding
// list comes from, deliberately — the list a person works through and the list the proof adjusts by
// must be one list, or a firm would clear an item that the proof still counted as in transit.
export async function readOutstandingTrustBankItems(
  database: SqlDatabase,
  reconciliation: TrustReconciliationSnapshot,
): Promise<readonly TrustBankItem[]> {
  const account = await loadTrustAccount(database, reconciliation.trustAccountId);
  const statement = await readTrustBankStatement(database, reconciliation.statementId);
  const { results } = await selectOutstandingTrustBankItemsStatement(
    database,
    account.bankLedgerAccountId,
    statement.periodEnd,
  ).all<OutstandingItemRow>();
  return results.map(toBankItem);
}
