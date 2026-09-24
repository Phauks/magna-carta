import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type {
  LedgerEntryId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustMovementId,
  TrustTransferId,
} from "@magna-carta/identifiers/types";
import { readTrustAccountMoneyLegs } from "./account-position.ts";
import { loadTrustAccount } from "./account-tree.ts";
import { readTrustBankStatement } from "./bank-statements.ts";
import {
  MAX_TRUST_RECONCILIATION_ROWS,
  selectOutstandingTrustBankItemsStatement,
  selectUnmatchedTrustBankStatementLinesStatement,
} from "./statements.ts";
import { TrustValidationError } from "./trust-validation.ts";
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

// The outstanding-item read asks for one row past its ceiling; that row arriving means the list is
// not the whole list. Refusing here rather than summing what came back is the difference between a
// firm being told its reconciliation is too large to prove and a firm filing an attestation that is
// short by the items it never saw. It is not a number that can be nearly right: every figure the
// proof derives — the outstanding totals, the adjusted bank balance, whether it balanced — is
// computed from this list, and a close freezes all of them.
function assertOutstandingItemsComplete(rowCount: number, asOfDate: string): void {
  if (rowCount > MAX_TRUST_RECONCILIATION_ROWS) {
    throw new TrustValidationError(
      "reconciliation-outstanding-items-truncated",
      `this trust bank account has more than ${MAX_TRUST_RECONCILIATION_ROWS} items outstanding as of ${asOfDate}, which is more than one reconciliation can account for: reconcile the earlier periods first so the cleared items leave this list`,
    );
  }
}

// The same probe on the other list the proof is built from, for the same reason. The two reads are
// capped independently and a caller reads whichever one it needs, so the guarantee cannot be one
// check standing in front of both. It held only by arithmetic before: a statement is separately
// capped at a line count that happens to sit below this ceiling, which nothing in either constant
// states and no test would have caught if either moved. `frozen_unmatched_line_count` is one of the
// figures a close freezes as the firm's attestation, so a short list here is the same failure the
// outstanding read refuses — a confidently wrong answer rather than an obviously incomplete one.
function assertUnmatchedStatementLinesComplete(
  rowCount: number,
  statementId: TrustBankStatementId,
): void {
  if (rowCount > MAX_TRUST_RECONCILIATION_ROWS) {
    throw new TrustValidationError(
      "reconciliation-unmatched-lines-truncated",
      `statement ${statementId} has more than ${MAX_TRUST_RECONCILIATION_ROWS} lines this reconciliation has not accounted for, which is more than one reconciliation can attest to: record the period as several shorter statements and reconcile each of them`,
    );
  }
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

// THE unmatched statement lines of one reconciliation: the lines of the statement it covers that no
// active match in it ties to a ledger entry. Every surface that shows a member unmatched lines reads
// them through here, and so does the proof that counts them — the list a person works through and
// the list a close attests to must be one list. A second derivation of the same word (filtering the
// statement's lines against the reconciliation's active matches in memory, say) produces an equally
// plausible list from different rows, and would drift the first time either definition learned
// something about withdrawn matches or superseded periods that the other did not.
export async function readUnmatchedTrustBankStatementLines(
  database: SqlDatabase,
  reconciliation: TrustReconciliationSnapshot,
): Promise<readonly TrustBankStatementLineSnapshot[]> {
  const { results } = await selectUnmatchedTrustBankStatementLinesStatement(
    database,
    reconciliation.id,
    reconciliation.statementId,
  ).all<StatementLineRow>();
  assertUnmatchedStatementLinesComplete(results.length, reconciliation.statementId);
  return results.map(toLineSnapshot);
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

  // Three reads, none of them per-row: where the account stands as of the period end, the
  // outstanding items, and the lines this reconciliation has not accounted for. The last one carries
  // its own truncation refusal, so both lists the proof is derived from are known to be whole before
  // any figure is computed.
  //
  // The money legs come from readTrustAccountMoneyLegs rather than from three reads spelled out
  // here, so the figures a person sees on the account and the figures a close freezes for the period
  // are one computation. The account's present facts (holds, counts) are not a period's proof and
  // are not read here.
  const [position, itemRows, unmatchedStatementLines] = await Promise.all([
    readTrustAccountMoneyLegs(database, account, asOfDate),
    selectOutstandingTrustBankItemsStatement(
      database,
      account.bankLedgerAccountId,
      asOfDate,
    ).all<OutstandingItemRow>(),
    readUnmatchedTrustBankStatementLines(database, reconciliation),
  ]);

  assertOutstandingItemsComplete(itemRows.results.length, asOfDate);

  const bookBalanceMinor = position.bookBalanceMinor;
  const clientLedgerTotalMinor = position.clientLedgerTotalMinor;
  // Zero on every account that has not opened the bank-charge carve-out, which is most of them —
  // so the arithmetic below is identical for both kinds of account rather than branching on one.
  // The position reports the absence of a cushion as null; a proof has no use for that distinction,
  // because an account with no cushion holds none of the firm's money.
  const firmFundsMinor = position.firmFundsMinor ?? 0;
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
  // The book side holds everything in the bank account; the client side holds only what is owed to
  // other people. The difference between them is the firm's own bank-charge cushion, and that is an
  // identity rather than a tolerance: every entry that moves the cushion moves the bank leaf by the
  // same amount, so the two stay in step exactly as book and client do. Leaving the cushion out of
  // this comparison would report a `book-to-client` disagreement on every account that enabled the
  // carve-out — poisoning the one signal that means something reached the ledger without going
  // through the composition guard.
  if (bookBalanceMinor !== clientLedgerTotalMinor + firmFundsMinor) {
    disagreements.push({
      leg: "book-to-client",
      differenceMinor: bookBalanceMinor - clientLedgerTotalMinor - firmFundsMinor,
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
    firmFundsMinor,
    unmatchedStatementLines,
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
  // The same refusal the proof raises, for the same reason: a member working this list, and the
  // match composer that checks an entry against it, must not be shown a silently short version of
  // it. Without this, `composeTrustReconciliationMatch` refuses a genuinely outstanding entry with
  // `entry-is-not-a-bank-item` and three explanations, none of them the real one.
  assertOutstandingItemsComplete(results.length, statement.periodEnd);
  return results.map(toBankItem);
}
