import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import type { TrustAccountId } from "@magna-carta/identifiers/types";
import { loadTrustAccount } from "./account-tree.ts";
import { loadTrustFirmFundsNode } from "./firm-funds.ts";
import {
  selectPendingTrustDisbursementRequestCountStatement,
  selectTrustAccountHeldTotalStatement,
  selectTrustBookBalanceAsOfStatement,
  selectTrustClientLedgerTotalAsOfStatement,
  selectTrustFirmFundsTotalAsOfStatement,
  selectTrustMatterLedgerCountStatement,
} from "./statements.ts";
import type { TrustAccountPosition, TrustAccountSnapshot } from "./types.ts";

// WHERE ONE TRUST ACCOUNT STANDS, as of a civil day.
//
// This is THE computation of the account's money legs, and the three-way proof calls it rather than
// keeping a second one: the book balance, the client total and the firm's cushion are the same three
// figures a period attests to, so a reader of an account and a reader of its reconciliation cannot
// be shown two answers to one question. Everything else here — what is under hold, how many client
// ledgers the account carries, how many payments out are waiting — is a fact about the account now,
// and is read beside the legs rather than derived from them.
//
// EVERY MONEY LEG IS COMPUTED FROM DATED LEDGER ROWS, never from a stored balance. A stored balance
// is a live figure with no as-of, so it cannot answer "as of today in the office's zone" and cannot
// be reproduced a year later. Holds are the deliberate exception and are not an as-of figure at all:
// a hold is a present claim on money, and the row carries no effective date to compute one from.

interface TotalRow {
  total_minor: number;
}

interface BalanceRow {
  balance_minor: number;
}

interface CountRow {
  row_count: number;
}

/** The three money legs a period attests to, as of a civil day. */
export interface TrustAccountMoneyLegs {
  readonly bookBalanceMinor: number;
  readonly clientLedgerTotalMinor: number;
  /** Null where the bank-charge carve-out was never opened: a zero would say it is open and empty. */
  readonly firmFundsMinor: number | null;
}

// The legs alone, which is what the three-way proof takes: a proof is about a period's money and
// never about how many ledgers the account carries or what is waiting today, so it does not pay for
// those reads. The position below is the legs plus the account's present facts.
export async function readTrustAccountMoneyLegs(
  database: SqlDatabase,
  account: TrustAccountSnapshot,
  asOfDate: string,
): Promise<TrustAccountMoneyLegs> {
  // The cushion's NODE, read before its total: an account that never opened the bank-charge
  // carve-out holds no firm money at all, and a zero would say the carve-out is open and empty.
  const firmFundsNode = await loadTrustFirmFundsNode(database, account.id);
  const [bookRows, clientRows, firmFundsRows] = await Promise.all([
    selectTrustBookBalanceAsOfStatement(
      database,
      account.bankLedgerAccountId,
      asOfDate,
    ).all<BalanceRow>(),
    selectTrustClientLedgerTotalAsOfStatement(database, account.id, asOfDate).all<TotalRow>(),
    selectTrustFirmFundsTotalAsOfStatement(database, account.id, asOfDate).all<TotalRow>(),
  ]);
  return {
    bookBalanceMinor: bookRows.results[0]?.balance_minor ?? 0,
    clientLedgerTotalMinor: clientRows.results[0]?.total_minor ?? 0,
    firmFundsMinor: firmFundsNode === null ? null : (firmFundsRows.results[0]?.total_minor ?? 0),
  };
}

export async function readTrustAccountPosition(
  database: SqlDatabase,
  trustAccountId: TrustAccountId,
  asOfDate: string,
): Promise<TrustAccountPosition> {
  const account = await loadTrustAccount(database, trustAccountId);
  // One round of parallel reads rather than a walk of anything per-row.
  const [legs, heldRows, matterLedgerRows, pendingRows] = await Promise.all([
    readTrustAccountMoneyLegs(database, account, asOfDate),
    selectTrustAccountHeldTotalStatement(database, account.id).all<TotalRow>(),
    selectTrustMatterLedgerCountStatement(database, account.id).all<CountRow>(),
    selectPendingTrustDisbursementRequestCountStatement(database, account.id).all<CountRow>(),
  ]);

  return {
    trustAccountId: account.id,
    currency: account.currency,
    asOfDate,
    bookBalanceMinor: legs.bookBalanceMinor,
    clientLedgerTotalMinor: legs.clientLedgerTotalMinor,
    heldMinor: heldRows.results[0]?.total_minor ?? 0,
    firmFundsMinor: legs.firmFundsMinor,
    matterLedgerCount: matterLedgerRows.results[0]?.row_count ?? 0,
    pendingRequestCount: pendingRows.results[0]?.row_count ?? 0,
  };
}
