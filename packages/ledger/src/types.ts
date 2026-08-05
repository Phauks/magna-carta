import type { LedgerAccountId } from "@magna-carta/identifiers/types";
import type { Money } from "@magna-carta/money/money";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type Direction = "debit" | "credit";

export interface EntryLineInput {
  readonly accountId: LedgerAccountId;
  readonly direction: Direction;
  readonly amount: Money;
}

export interface PostEntryInput {
  readonly description: string;
  readonly effectiveDate: string; // YYYY-MM-DD civil date
  readonly lines: readonly EntryLineInput[];
}

// Injected time — the ledger never reads wall-clock. now() is an ISO-8601 UTC instant; today() is
// the caller's resolved civil date (zone resolution is a boundary concern).
export interface ClockPort {
  now(): string;
  today(): string;
}

// An account THIS SAME effect is creating, which no read can see yet. Building a sub-ledger account
// and its first posting in one batch is otherwise impossible: both the parent check and the posting
// check read the database, and the row does not exist until the batch commits. Splitting them across
// batches would leave a window in which a half-built tree exists. Only the two facts a read cannot
// supply are declared — everything else the checks prove is already known for such an account and is
// re-stated by the consumer rather than assumed: it is active, it has no children, its balance row
// is created alongside it, and nothing can have posted to a row that did not exist.
export interface PendingAccount {
  readonly type: AccountType;
  readonly currency: string;
}

// What validation needs to know about an account, loaded pre-batch (the pre-check pattern).
export interface AccountSnapshot {
  readonly id: LedgerAccountId;
  readonly type: AccountType;
  readonly currency: string;
  readonly active: boolean;
  readonly hasChildren: boolean; // postings land on leaves only — parents are roll-ups
  readonly hasBalanceRow: boolean; // a missing balance row is corruption, surfaced loud pre-batch
}
