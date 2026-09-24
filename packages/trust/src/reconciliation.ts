import { guarded } from "@magna-carta/data-access/effect-batch";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  LedgerEntryId,
  TrustAccountId,
  TrustBankStatementId,
  TrustBankStatementLineId,
  TrustMovementId,
  TrustReconciliationId,
  TrustReconciliationMatchId,
  TrustTransferId,
  UserId,
} from "@magna-carta/identifiers/types";
import { loadTrustAccount, type TrustServiceOptions } from "./account-tree.ts";
import { readTrustBankStatement } from "./bank-statements.ts";
import {
  closeTrustReconciliationStatement,
  insertTrustReconciliationStatement,
  selectTrustReconciliationMatchesStatement,
  selectTrustReconciliationStatement,
  selectTrustReconciliationsForAccountStatement,
} from "./statements.ts";
import { computeTrustThreeWayProof } from "./three-way-proof.ts";
import { TrustValidationError } from "./trust-validation.ts";
import type {
  TrustBankStatementLineDirection,
  TrustFrozenProof,
  TrustMovementKind,
  TrustReconciliationMatchRecord,
  TrustReconciliationSnapshot,
  TrustReconciliationStatus,
  TrustThreeWayProof,
} from "./types.ts";

// The reconciliation record: a firm's attempt to tie one bank statement to its own books, and — once
// closed — the frozen proof it produced.
//
// CLOSING IS THE FREEZE, AND IT RUNS ONE WAY. While a reconciliation is open the proof is recomputed
// on every read and moves as postings land. The close writes what the proof said at that instant,
// and the migration's triggers refuse every further write to the row. A reversal posted next week
// with a backdated effective date changes the LIVE proof of any still-open period and can never
// change a closed one, which is the entire reason the frozen columns exist.
//
// AN UNBALANCED PERIOD CLOSES. It closes recording that it did not tie out, which leg disagreed, and
// by how much — the difference is recoverable from the frozen totals. A close that refused an
// unbalanced proof would produce firms with a year of periods left permanently open, which is the
// same as no record at all, and it would put the platform in the position of deciding when a firm is
// allowed to have a problem. The record of a problem is the value.

interface ReconciliationRow {
  id: string;
  trust_account_id: string;
  statement_id: string;
  status: TrustReconciliationStatus;
  opened_by: string;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  frozen_statement_closing_minor: number | null;
  frozen_outstanding_deposits_minor: number | null;
  frozen_outstanding_disbursements_minor: number | null;
  frozen_adjusted_bank_minor: number | null;
  frozen_book_balance_minor: number | null;
  frozen_client_total_minor: number | null;
  frozen_unmatched_line_count: number | null;
  frozen_unmatched_movement_count: number | null;
  frozen_firm_funds_minor: number | null;
  frozen_balanced: number | null;
  supersedes_reconciliation_id: string | null;
  note: string | null;
}

function frozenProofOf(row: ReconciliationRow): TrustFrozenProof | null {
  if (row.frozen_balanced === null) return null;
  return {
    statementClosingMinor: row.frozen_statement_closing_minor ?? 0,
    outstandingDepositsMinor: row.frozen_outstanding_deposits_minor ?? 0,
    outstandingDisbursementsMinor: row.frozen_outstanding_disbursements_minor ?? 0,
    adjustedBankMinor: row.frozen_adjusted_bank_minor ?? 0,
    bookBalanceMinor: row.frozen_book_balance_minor ?? 0,
    clientLedgerTotalMinor: row.frozen_client_total_minor ?? 0,
    unmatchedLineCount: row.frozen_unmatched_line_count ?? 0,
    unmatchedItemCount: row.frozen_unmatched_movement_count ?? 0,
    // Zero for a reconciliation closed before the bank-charge carve-out existed: on those accounts
    // there was no firm money in the trust account to freeze, so zero is the true figure and not a
    // fallback.
    firmFundsMinor: row.frozen_firm_funds_minor ?? 0,
    balanced: row.frozen_balanced === 1,
  };
}

function toSnapshot(row: ReconciliationRow): TrustReconciliationSnapshot {
  return {
    id: row.id as TrustReconciliationId,
    trustAccountId: row.trust_account_id as TrustAccountId,
    statementId: row.statement_id as TrustBankStatementId,
    status: row.status,
    openedBy: row.opened_by as UserId,
    openedAt: row.opened_at,
    closedBy: row.closed_by as UserId | null,
    closedAt: row.closed_at,
    frozenProof: frozenProofOf(row),
    supersedesReconciliationId: row.supersedes_reconciliation_id as TrustReconciliationId | null,
    note: row.note,
  };
}

// `.all()` + `results[0]`, never `.first()` — the one-row read convention (one sentinel for
// "no row"), stated in packages/data-access/src/idempotency-statements.ts.
export async function readTrustReconciliation(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
): Promise<TrustReconciliationSnapshot> {
  const { results } = await selectTrustReconciliationStatement(
    database,
    reconciliationId,
  ).all<ReconciliationRow>();
  const row = results[0];
  if (!row) {
    throw new TrustValidationError(
      "unknown-trust-reconciliation",
      `no such trust reconciliation: ${reconciliationId}`,
    );
  }
  return toSnapshot(row);
}

export async function readTrustReconciliations(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
): Promise<readonly TrustReconciliationSnapshot[]> {
  const { results } = await selectTrustReconciliationsForAccountStatement(
    database,
    trustAccountId,
  ).all<ReconciliationRow>();
  return results.map(toSnapshot);
}

interface ReconciliationMatchRow {
  id: string;
  reconciliation_id: string;
  statement_line_id: string;
  entry_id: string;
  matched_by: string;
  matched_at: string;
  unmatched_by_match_id: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string | null;
  line_id: string;
  line_statement_id: string;
  line_posted_on: string;
  line_direction: TrustBankStatementLineDirection;
  line_amount_minor: number;
  line_description: string;
  line_reference: string | null;
  line_counterparty_name: string | null;
  line_source_row_number: number | null;
  effective_date: string;
  description: string;
  bank_delta_minor: number;
  movement_id: string | null;
  movement_kind: TrustMovementKind | null;
  reference: string | null;
  counterparty_name: string | null;
  transfer_id: string | null;
}

function toMatchRecord(row: ReconciliationMatchRow): TrustReconciliationMatchRecord {
  return {
    id: row.id as TrustReconciliationMatchId,
    statementLineId: row.statement_line_id as TrustBankStatementLineId,
    entryId: row.entry_id as LedgerEntryId,
    matchedBy: row.matched_by as UserId,
    matchedAt: row.matched_at,
    // Both come off the withdrawing row, which is an append rather than an edit — so a withdrawn
    // match carries who took it back and when, and a standing one carries two nulls.
    withdrawnBy: row.withdrawn_by as UserId | null,
    withdrawnAt: row.withdrawn_at,
    line: {
      id: row.line_id as TrustBankStatementLineId,
      statementId: row.line_statement_id as TrustBankStatementId,
      postedOn: row.line_posted_on,
      direction: row.line_direction,
      amountMinor: row.line_amount_minor,
      description: row.line_description,
      reference: row.line_reference,
      counterpartyName: row.line_counterparty_name,
      sourceRowNumber: row.line_source_row_number,
    },
    item: {
      entryId: row.entry_id as LedgerEntryId,
      effectiveDate: row.effective_date,
      description: row.description,
      bankDeltaMinor: row.bank_delta_minor,
      movementId: row.movement_id as TrustMovementId | null,
      movementKind: row.movement_kind,
      transferId: row.transfer_id as TrustTransferId | null,
      reference: row.reference,
      counterpartyName: row.counterparty_name,
    },
  };
}

// EVERY MATCH ONE RECONCILIATION HOLDS, oldest first, withdrawn ones included — each with the bank
// line and the recorded item it pairs, so a reader sees the two rows somebody said were the same
// event rather than two identifiers.
//
// A withdrawn match stays on this list because the record is of what people asserted, not of what
// currently stands: the suggestion surface already answers "what is still unaccounted for", and a
// list that dropped a withdrawal would leave nothing anywhere saying the pairing was ever made.
export async function readTrustReconciliationMatches(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
): Promise<readonly TrustReconciliationMatchRecord[]> {
  const reconciliation = await readTrustReconciliation(database, reconciliationId);
  // The account's bank leaf, because an item's signed effect on the bank is what its entry did to
  // THAT account — the same leaf the outstanding read measures items against.
  const account = await loadTrustAccount(database, reconciliation.trustAccountId);
  const { results } = await selectTrustReconciliationMatchesStatement(
    database,
    reconciliationId,
    account.bankLedgerAccountId,
  ).all<ReconciliationMatchRow>();
  return results.map(toMatchRecord);
}

export interface OpenTrustReconciliationInput {
  readonly statementId: TrustBankStatementId;
  readonly supersedesReconciliationId?: TrustReconciliationId | null;
  readonly note?: string | null;
  readonly openedBy: UserId;
}

export interface OpenedTrustReconciliation {
  readonly reconciliationId: TrustReconciliationId;
  readonly effect: EffectWrite;
}

// The trust account is taken from the STATEMENT rather than from the caller: a reconciliation about
// one account's statement and another account's ledger is not a thing that should be expressible,
// and asking the caller to state it twice is asking for the two to disagree.
export async function openTrustReconciliation(
  database: SqlDatabase,
  input: OpenTrustReconciliationInput,
  options: TrustServiceOptions,
): Promise<OpenedTrustReconciliation> {
  const statement = await readTrustBankStatement(database, input.statementId);
  await loadTrustAccount(database, statement.trustAccountId);

  if (input.supersedesReconciliationId != null) {
    const superseded = await readTrustReconciliation(database, input.supersedesReconciliationId);
    if (superseded.statementId !== statement.id) {
      throw new TrustValidationError(
        "reconciliation-statement-mismatch",
        `${input.supersedesReconciliationId} reconciles a different statement; a superseding reconciliation covers the same period as the one it replaces`,
      );
    }
  }

  const reconciliationId = newIdentifier("trustReconciliation", options.randomSource);
  return {
    reconciliationId,
    effect: {
      statements: [
        insertTrustReconciliationStatement(database, {
          id: reconciliationId,
          trustAccountId: statement.trustAccountId,
          statementId: statement.id,
          openedBy: input.openedBy,
          openedAt: options.clock.now(),
          supersedesReconciliationId: input.supersedesReconciliationId ?? null,
          note: input.note ?? null,
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface ClosedTrustReconciliation {
  readonly reconciliationId: TrustReconciliationId;
  // The proof as it stood at the close, in full — the caller shows this, and the frozen columns
  // store the totals from exactly it.
  readonly proof: TrustThreeWayProof;
  readonly frozen: TrustFrozenProof;
  readonly effect: EffectWrite;
}

// Closes a reconciliation and freezes what its proof said. It writes ONE row and nothing else: no
// ledger entry, no movement, no balance, no correction to anything the proof disagreed with. A close
// that adjusted the books into agreement with itself would erase the difference at the moment of
// finding it, and would put an entry in an append-only ledger that nobody asserted — the same
// boundary the custody stocktake holds, for the same reason.
export async function closeTrustReconciliation(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
  closedBy: UserId,
  options: TrustServiceOptions,
): Promise<ClosedTrustReconciliation> {
  const reconciliation = await readTrustReconciliation(database, reconciliationId);
  if (reconciliation.status !== "open") {
    throw new TrustValidationError(
      "reconciliation-closed",
      `this reconciliation is already closed; a period redone after the fact is a new reconciliation that supersedes it`,
    );
  }

  // Drawn from the same computation a reader of the live proof sees, so the number a firm files and
  // the report it read can never come from two different definitions of the same period.
  const proof = await computeTrustThreeWayProof(database, reconciliation);
  const frozen: TrustFrozenProof = {
    statementClosingMinor: proof.statementClosingMinor,
    outstandingDepositsMinor: proof.outstandingDepositsMinor,
    outstandingDisbursementsMinor: proof.outstandingDisbursementsMinor,
    adjustedBankMinor: proof.adjustedBankMinor,
    bookBalanceMinor: proof.bookBalanceMinor,
    clientLedgerTotalMinor: proof.clientLedgerTotalMinor,
    unmatchedLineCount: proof.unmatchedStatementLines.length,
    unmatchedItemCount: proof.outstandingDeposits.length + proof.outstandingDisbursements.length,
    firmFundsMinor: proof.firmFundsMinor,
    balanced: proof.balanced,
  };

  return {
    reconciliationId,
    proof,
    frozen,
    effect: {
      statements: [
        guarded(
          closeTrustReconciliationStatement(
            database,
            reconciliationId,
            frozen,
            closedBy,
            options.clock.now(),
          ),
          "trust-reconciliation.close",
        ),
      ],
      outboxMessages: [],
    },
  };
}

// The proof for a reconciliation as it stands NOW. A closed reconciliation still answers this — and
// the answer may differ from what it froze, which is not a fault: it is the ledger having moved
// since somebody attested to a period. Callers show both, and never present the recomputed figure
// as what the firm attested to.
export async function readTrustThreeWayProof(
  database: SqlDatabase,
  reconciliationId: TrustReconciliationId,
): Promise<{ reconciliation: TrustReconciliationSnapshot; proof: TrustThreeWayProof }> {
  const reconciliation = await readTrustReconciliation(database, reconciliationId);
  return { reconciliation, proof: await computeTrustThreeWayProof(database, reconciliation) };
}
