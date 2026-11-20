/*
 * The Banking screen's own decisions, as pure functions a test can hold without a browser: how the
 * bank accounts group down the left, which one is selected, what each card's badge says, how the
 * bank's lines narrow and count, and which account in the books a newly connected bank account is
 * probably meant to be.
 *
 * Imports are packages and relative paths only: the tests run in vitest's plugin-less node pool,
 * where the SvelteKit `$lib` alias does not resolve.
 *
 * Money stays in minor units until it is read. Every difference and every magnitude goes through
 * `@magna-carta/money`, so this file adds nothing up by hand.
 */
import {
  formatDate,
  formatInstantDate,
  formatMoney,
  formatTimeOfDay,
} from "@magna-carta/design-system/formatters";
import type { BadgeVariant } from "@magna-carta/design-system/badge";
import { abs, currencyFromCode, subtract } from "@magna-carta/money/money";
import { fromMinor, spreadsheetNumber, toMinor } from "@magna-carta/money/format";
import { isNegative, isPositive, isZero } from "@magna-carta/money/compare";
import type {
  BankBookAccount,
  BankConnection,
  BankFeedAccount,
  BankFeedTransaction,
  BankLineStatusName,
} from "@magna-carta/api-client";

/** The two permissions the Banking screen reads, spelled as the access-control registry spells them. */
export const BANKING_PERMISSIONS = {
  /** Read the Banking screen: the banks, their balances and lines. */
  read: "banking:read",
  /** Connect a bank, sign in again, tie a bank account to the books, disconnect. */
  manage: "banking:manage",
} as const;

// ---- money --------------------------------------------------------------------------------------

const moneyOf = (minor: number, currency: string) => fromMinor(minor, currencyFromCode(currency));

/** An amount in minor units, as the trust screens print one. */
export function bankMoneyText(minor: number, currency: string): string {
  return formatMoney(spreadsheetNumber(moneyOf(minor, currency)), { currency });
}

/** An amount's size, whichever way it moved, in whole currency units for a money column. */
export function wholeUnitsMagnitude(minor: number, currency: string): number {
  return spreadsheetNumber(abs(moneyOf(minor, currency)));
}

/** A bank line's amount without its sign: the Out or In column says which way it moved. */
export function lineMagnitudeText(transaction: BankFeedTransaction, currency: string): string {
  return formatMoney(wholeUnitsMagnitude(transaction.amountMinor, currency), { currency });
}

/** Whether a bank line is money arriving. Positive is in, as the bank feed reports it. */
export function isMoneyIn(transaction: BankFeedTransaction, currency: string): boolean {
  return isPositive(moneyOf(transaction.amountMinor, currency));
}

/** Whether a bank line is money leaving. */
export function isMoneyOut(transaction: BankFeedTransaction, currency: string): boolean {
  return isNegative(moneyOf(transaction.amountMinor, currency));
}

/**
 * How far the bank's balance and the books' balance are apart, as a positive amount, or null where
 * there is nothing to compare: an untied account has no books balance, and a bank that has not
 * reported one has no bank balance.
 */
export function apartMinor(account: BankFeedAccount): number | null {
  if (account.bookAccount === null) return null;
  if (account.bankBalanceMinor === null || account.booksBalanceMinor === null) return null;
  const gap = subtract(
    moneyOf(account.bankBalanceMinor, account.currency),
    moneyOf(account.booksBalanceMinor, account.currency),
  );
  return isZero(gap) ? null : toMinor(abs(gap));
}

// ---- the left column ----------------------------------------------------------------------------

/** The three groups the bank accounts fall into, in the order they read down the column. */
export type AccountGroupKind = "operating" | "trust" | "unused";

export interface AccountGroup {
  readonly kind: AccountGroupKind;
  readonly label: string;
  readonly accounts: readonly BankFeedAccount[];
}

const GROUP_LABELS: Readonly<Record<AccountGroupKind, string>> = {
  operating: "Operating",
  trust: "Trust",
  unused: "Not Used",
};

/** Which group a bank account belongs in: by the kind of account it is in the books. */
export function groupKindOf(account: BankFeedAccount): AccountGroupKind {
  return account.bookAccount === null ? "unused" : account.bookAccount.kind;
}

/** The bank accounts, grouped Operating, Trust, then Not Used. A group with none is left out. */
export function groupAccounts(accounts: readonly BankFeedAccount[]): readonly AccountGroup[] {
  const kinds: readonly AccountGroupKind[] = ["operating", "trust", "unused"];
  return kinds
    .map((kind) => ({
      kind,
      label: GROUP_LABELS[kind],
      accounts: accounts.filter((account) => groupKindOf(account) === kind),
    }))
    .filter((group) => group.accounts.length > 0);
}

/**
 * The account the right side shows: the one asked for where it still exists, otherwise the first
 * account down the column, otherwise none.
 */
export function selectedAccountId(
  accounts: readonly BankFeedAccount[],
  requested: string | null,
): string | null {
  if (requested !== null && accounts.some((account) => account.id === requested)) return requested;
  const first = groupAccounts(accounts)[0]?.accounts[0];
  return first?.id ?? null;
}

/** A card's name: the account in the books it is, or the bank's own name where it is not tied. */
export function accountTitle(account: BankFeedAccount): string {
  return account.bookAccount?.name ?? account.name;
}

/**
 * A bank logo the feed sends, as an image address: a base64 PNG with no prefix, or null where the
 * feed has none for that bank and the name's initials stand in.
 */
export function bankLogoSource(logo: string | null): string | null {
  if (logo === null || logo.trim() === "") return null;
  return `data:image/png;base64,${logo.trim()}`;
}

/** "Cumberland Bank · ending 4417". */
export function accountBankLine(account: BankFeedAccount): string {
  return account.mask === null
    ? account.institutionName
    : `${account.institutionName} · ending ${account.mask}`;
}

/** "Books $61,880.12 · 3 not in books", or what stands in for it on an untied account. */
export function accountBooksLine(account: BankFeedAccount): string {
  if (account.bookAccount === null) return "Not used in the books";
  const parts: string[] = [];
  parts.push(
    account.booksBalanceMinor === null
      ? "Books not read"
      : `Books ${bankMoneyText(account.booksBalanceMinor, account.currency)}`,
  );
  if (account.notInBooksCount > 0) parts.push(`${account.notInBooksCount} not in books`);
  return parts.join(" · ");
}

/** The bank's balance, large on the card. */
export function accountBalanceText(account: BankFeedAccount): string {
  return account.bankBalanceMinor === null
    ? "No balance yet"
    : bankMoneyText(account.bankBalanceMinor, account.currency);
}

export interface CardBadge {
  readonly tone: BadgeVariant;
  readonly text: string;
}

/** How a moment is read, so a test can pin the zone. */
export interface ReadingOptions {
  readonly now: Date;
  readonly timeZone?: string;
}

/**
 * The one word a card wears. Signing in again comes first, because nothing else on the card is
 * current until it happens; then an account whose bank and books disagree; then when the bank was
 * last read, as a time on today and a date before it.
 */
export function cardBadge(
  account: BankFeedAccount,
  connection: BankConnection | null,
  options: ReadingOptions,
): CardBadge | null {
  if (connection?.signInNeeded === true) return { tone: "warning", text: "Sign in again" };
  const apart = apartMinor(account);
  if (apart !== null) {
    return { tone: "danger", text: `${bankMoneyText(apart, account.currency)} apart` };
  }
  const readAt = connection?.lastSyncedAt ?? account.balanceAsOf;
  if (readAt === null) return null;
  return {
    tone: account.bookAccount === null ? "neutral" : "success",
    text: readTime(readAt, options),
  };
}

/** A read time: the time of day when it was today where the reader is, else the date. */
export function readTime(instant: string, options: ReadingOptions): string {
  const zone = { timeZone: options.timeZone };
  const sameDay =
    formatInstantDate(instant, zone) === formatInstantDate(options.now.toISOString(), zone);
  return sameDay ? formatTimeOfDay(instant, zone) : formatInstantDate(instant, zone);
}

/** A window the screen opens as it arrives: the gallery's way to show each one. */
export type BankingOpening =
  | { readonly kind: "connect"; readonly connectionId: string }
  | { readonly kind: "addToBooks"; readonly transactionId: string };

// ---- the right side -----------------------------------------------------------------------------

/** The three ways the bank's lines narrow. Pending shows only under All. */
export type LineFilter = "notInBooks" | "inBooks" | "all";

export interface LineCounts {
  readonly notInBooks: number;
  readonly inBooks: number;
  readonly all: number;
}

export function lineCounts(transactions: readonly BankFeedTransaction[]): LineCounts {
  return {
    notInBooks: transactions.filter((line) => line.status === "notInBooks").length,
    inBooks: transactions.filter((line) => line.status === "inBooks").length,
    all: transactions.length,
  };
}

export function filterLines(
  transactions: readonly BankFeedTransaction[],
  filter: LineFilter,
): readonly BankFeedTransaction[] {
  if (filter === "all") return transactions;
  return transactions.filter((line) => line.status === filter);
}

const STATUS_LABELS: Readonly<Record<BankLineStatusName, string>> = {
  notInBooks: "Not in Books",
  inBooks: "In Books",
  pending: "Pending",
};

/** Every status in the order the Status column's filter offers them. */
export const STATUS_WORDS: readonly string[] = [
  STATUS_LABELS.notInBooks,
  STATUS_LABELS.inBooks,
  STATUS_LABELS.pending,
];

export function statusLabel(status: BankLineStatusName): string {
  return STATUS_LABELS[status];
}

export function statusTone(status: BankLineStatusName): BadgeVariant {
  if (status === "notInBooks") return "warning";
  if (status === "inBooks") return "success";
  return "neutral";
}

/** "Bank transactions, Aug 22, 2026 to Nov 20, 2026": the window the lines were read over. */
export function windowLine(from: string, to: string): string {
  return `Bank transactions, ${formatDate(from)} to ${formatDate(to)}`;
}

/** A bank line as plain text, for Copy Details: date, description, amount, check number. */
export function lineDetailsText(transaction: BankFeedTransaction, currency: string): string {
  const parts = [
    formatDate(transaction.postedOn),
    transaction.description,
    bankMoneyText(transaction.amountMinor, currency),
  ];
  if (transaction.checkNumber !== null) parts.push(`Check ${transaction.checkNumber}`);
  return parts.join("\t");
}

/** Where Add to Books sends a line, by the kind of account it is in the books. */
export type BooksEntryRoute =
  | { readonly kind: "trust"; readonly href: string }
  | { readonly kind: "operating" }
  | { readonly kind: "untied" };

export function booksEntryRoute(account: BankFeedAccount): BooksEntryRoute {
  const book = account.bookAccount;
  if (book === null) return { kind: "untied" };
  if (book.kind === "trust") {
    return {
      kind: "trust",
      href:
        book.trustAccountId === null
          ? "/trust"
          : `/trust?account=${encodeURIComponent(book.trustAccountId)}`,
    };
  }
  return { kind: "operating" };
}

// ---- the connect window -------------------------------------------------------------------------

/** What a row's dropdown holds when the account is not to be used. */
export const DONT_USE = "dont-use";

/** The last four digits in a book account's name, or null where it has fewer than four. */
export function lastFourDigits(name: string): string | null {
  const digits = name.replace(/\D/gu, "");
  return digits.length < 4 ? null : digits.slice(-4);
}

/**
 * Whether a book account is already tied to a feed account other than `feedAccountId`. Those are
 * shown as taken: one feed per account in the books.
 */
export function isTakenBy(book: BankBookAccount, feedAccountId: string): boolean {
  return book.feedAccountId !== null && book.feedAccountId !== feedAccountId;
}

/**
 * Which account in the books a bank account starts on in the connect window: the one it is already
 * tied to; else the one whose name ends in the bank's last four digits, where exactly one free
 * account does; else Don't Use.
 */
export function preselectedBookAccount(
  account: BankFeedAccount,
  bookAccounts: readonly BankBookAccount[],
): string {
  if (account.bookAccount !== null) return account.bookAccount.ledgerAccountId;
  if (account.mask === null) return DONT_USE;
  const matches = bookAccounts.filter(
    (book) => lastFourDigits(book.name) === account.mask && !isTakenBy(book, account.id),
  );
  return matches.length === 1 ? (matches[0]?.ledgerAccountId ?? DONT_USE) : DONT_USE;
}

/** One row of the connect window, as chosen. */
export interface AccountChoice {
  readonly accountId: string;
  /** The ledger account chosen, or DONT_USE. */
  readonly ledgerAccountId: string;
}

/** A tie to write: the bank account, and the account in the books, or null to untie. */
export interface LinkChange {
  readonly accountId: string;
  readonly ledgerAccountId: string | null;
}

/**
 * The ties to write, for the rows whose choice differs from what is stored. Unties first, so an
 * account in the books another row is giving up is free before the row taking it is written.
 */
export function linkChanges(
  accounts: readonly BankFeedAccount[],
  choices: readonly AccountChoice[],
): readonly LinkChange[] {
  const changes: LinkChange[] = [];
  for (const choice of choices) {
    const account = accounts.find((one) => one.id === choice.accountId);
    if (account === undefined) continue;
    const stored = account.bookAccount?.ledgerAccountId ?? DONT_USE;
    if (stored === choice.ledgerAccountId) continue;
    changes.push({
      accountId: choice.accountId,
      ledgerAccountId: choice.ledgerAccountId === DONT_USE ? null : choice.ledgerAccountId,
    });
  }
  return [
    ...changes.filter((change) => change.ledgerAccountId === null),
    ...changes.filter((change) => change.ledgerAccountId !== null),
  ];
}

/**
 * Why the connect window cannot save, or undefined where it can: one account in the books chosen
 * for two bank accounts, or chosen while another bank account outside this window holds it.
 */
export function choicesRefusal(
  choices: readonly AccountChoice[],
  bookAccounts: readonly BankBookAccount[],
): string | undefined {
  const inWindow = new Set(choices.map((choice) => choice.accountId));
  const seen = new Set<string>();
  for (const choice of choices) {
    if (choice.ledgerAccountId === DONT_USE) continue;
    const book = bookAccounts.find((one) => one.ledgerAccountId === choice.ledgerAccountId);
    const name = book?.name ?? "That account";
    if (seen.has(choice.ledgerAccountId)) return `${name} is chosen twice.`;
    seen.add(choice.ledgerAccountId);
    if (
      book !== undefined &&
      book.feedAccountId !== null &&
      book.feedAccountId !== choice.accountId &&
      !inWindow.has(book.feedAccountId)
    ) {
      return `${name} is already used by another bank account.`;
    }
  }
  return undefined;
}

/** "Business Checking", "ending 4417 · $61,880.12": a bank account as the connect window lists it. */
export function connectRowDetail(account: BankFeedAccount): string {
  const parts: string[] = [];
  if (account.mask !== null) parts.push(`ending ${account.mask}`);
  if (account.bankBalanceMinor !== null) {
    parts.push(bankMoneyText(account.bankBalanceMinor, account.currency));
  }
  return parts.join(" · ");
}
