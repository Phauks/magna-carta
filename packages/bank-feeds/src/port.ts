/*
 * BankFeedPort: the one way Magna Carta asks a bank what it holds. Read only, on purpose: the port
 * has no operation that moves money, verifies an account for a payment, or changes anything at the
 * bank. What comes back is EVIDENCE beside the firm's books (a statement the bank keeps writing),
 * never a posting, and nothing that serves this port may write to a ledger.
 *
 * Every operation returns a typed outcome and never throws, so a caller pattern-matches rather than
 * catches, the same discipline as the translation and address-lookup ports.
 *
 * THE ACCESS TOKEN IS A SECRET. It reads the firm's bank accounts for as long as it lives. An
 * implementation never logs it, never puts it in a URL, and never returns it in a failure's
 * `detail`, which is a fixed sentence and at most the provider's error code.
 */

export type BankFeedProvider = "plaid";

/** A short-lived token the browser hands to the provider's own sign-in window. */
export interface SignInToken {
  readonly token: string;
  /** UTC instant after which the provider refuses it. */
  readonly expiresAt: string;
}

export interface SignInTokenInput {
  /** Stable, opaque, and not personal: the provider keys its own records of the sign-in by it. */
  readonly clientUserId: string;
  /** Present to sign in again to an existing connection (the bank asked for it), absent for new. */
  readonly accessToken?: string;
}

export interface ExchangedConnection {
  readonly remoteItemId: string;
  readonly accessToken: string;
}

export interface Institution {
  readonly name: string;
  /** The bank's logo as a base64 PNG, or null when the provider has none for it. */
  readonly logo: string | null;
}

export interface ReportedAccount {
  readonly remoteAccountId: string;
  readonly name: string;
  readonly officialName: string | null;
  /** The last four (or so) digits the bank shows. */
  readonly mask: string | null;
  /** `depository`, `credit`, `loan`, `investment`, as the provider classes it. */
  readonly kind: string;
  /** `checking`, `savings`, `money market`, and so on. */
  readonly subtype: string | null;
  readonly currency: string;
  /** In minor units, as the bank reports it: money in the account for a deposit account. */
  readonly currentBalanceMinor: number | null;
  readonly availableBalanceMinor: number | null;
}

export interface ReportedTransaction {
  readonly remoteTransactionId: string;
  readonly remoteAccountId: string;
  /** YYYY-MM-DD, the date the bank posted it (or will). */
  readonly postedOn: string;
  readonly description: string;
  /** Signed minor units in the firm's sense: positive is money INTO the account. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly checkNumber: string | null;
  readonly pending: boolean;
}

export interface TransactionChanges {
  readonly added: readonly ReportedTransaction[];
  readonly modified: readonly ReportedTransaction[];
  /** Transactions the bank withdrew (a pending line that never posted, mostly). */
  readonly removed: readonly string[];
  /** Hand back on the next call to get only what changed since. */
  readonly nextCursor: string;
}

/**
 * Why a call did not answer. `not-configured`: this deployment has no provider keys.
 * `sign-in-needed`: the bank wants the firm to sign in again before it shares more.
 * `refused`: the provider turned the request down (a revoked token, a bad sign-in token).
 * `unavailable`: the provider or the bank did not answer, or answered something unreadable.
 */
export type BankFeedFailureReason = "not-configured" | "sign-in-needed" | "refused" | "unavailable";

export interface BankFeedFailure {
  readonly ok: false;
  readonly reason: BankFeedFailureReason;
  readonly detail: string;
}

export type BankFeedResult<T> = { readonly ok: true; readonly value: T } | BankFeedFailure;

export interface BankFeedPort {
  readonly provider: BankFeedProvider;
  signInToken(input: SignInTokenInput): Promise<BankFeedResult<SignInToken>>;
  exchange(publicToken: string): Promise<BankFeedResult<ExchangedConnection>>;
  institution(accessToken: string): Promise<BankFeedResult<Institution>>;
  /** Every account under the connection, with the bank's balance as of now. */
  accounts(accessToken: string): Promise<BankFeedResult<readonly ReportedAccount[]>>;
  /** What changed since `cursor` (everything the bank will share, when absent). */
  transactions(
    accessToken: string,
    cursor: string | null,
  ): Promise<BankFeedResult<TransactionChanges>>;
  /** Ends the connection at the provider, so the bank stops sharing and the provider stops billing. */
  disconnect(accessToken: string): Promise<BankFeedResult<null>>;
}

export function bankFeedFailure(reason: BankFeedFailureReason, detail: string): BankFeedFailure {
  return { ok: false, reason, detail };
}

/**
 * The port a deployment with no provider keys gets: it answers `not-configured` to everything and
 * reaches nothing, so the Banking screen shows connecting a bank as not set up rather than failing.
 */
export function unconfiguredBankFeedPort(): BankFeedPort {
  const failure = bankFeedFailure("not-configured", "No bank feed provider is set up.");
  const answer = <T>(): Promise<BankFeedResult<T>> => Promise.resolve(failure);
  return {
    provider: "plaid",
    signInToken: answer,
    exchange: answer,
    institution: answer,
    accounts: answer,
    transactions: answer,
    disconnect: answer,
  };
}

/**
 * A decimal amount as a provider sends it (12.3, -0.07) to minor units. Every currency a US firm's
 * bank reports in has two decimal places; rounding, not truncating, because 0.07 * 100 is
 * 7.000000000000001 in floating point.
 */
export function decimalToMinor(amount: number): number {
  return Math.round(amount * 100);
}
