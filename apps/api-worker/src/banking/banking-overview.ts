/*
 * What the Banking screen shows, assembled from the bank feed tables and the books. Reads only.
 */
import type { z } from "@hono/zod-openapi";
import type {
  BankBookAccount,
  BankFeedTransaction,
  BankingOverviewResponse,
} from "@magna-carta/bank-feeds/contract";
import { TRANSACTION_WINDOW_DAYS } from "@magna-carta/bank-feeds/contract";
import { DATE_WINDOW_DAYS, matchBankLines } from "@magna-carta/bank-feeds/matching";
import {
  selectBankBookAccountsStatement,
  selectBankFeedTransactionsStatement,
  selectBookLinesStatement,
  selectLiveBankConnectionsStatement,
  selectLiveBankFeedAccountsStatement,
  type BankBookAccountRow,
  type BankConnectionRow,
  type BankFeedAccountRow,
  type BankFeedTransactionRow,
  type BookLineRow,
} from "@magna-carta/bank-feeds/statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";

type Overview = z.infer<typeof BankingOverviewResponse>;
type BookAccount = z.infer<typeof BankBookAccount>;
type Transaction = z.infer<typeof BankFeedTransaction>;

const DAY_MS = 86_400_000;

function civilDateDaysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

export function transactionWindow(now: Date): { from: string; to: string } {
  return { from: civilDateDaysBefore(now, TRANSACTION_WINDOW_DAYS), to: now.toISOString().slice(0, 10) };
}

export async function readLiveConnections(database: SqlDatabase): Promise<BankConnectionRow[]> {
  return (await selectLiveBankConnectionsStatement(database).all<BankConnectionRow>()).results;
}

/** The bank's lines on one feed account in the window, each marked against the books. */
export async function readMarkedTransactions(
  database: SqlDatabase,
  account: { readonly id: string; readonly ledger_account_id: string | null },
  now: Date,
): Promise<Transaction[]> {
  const { from } = transactionWindow(now);
  const bankRows = (
    await selectBankFeedTransactionsStatement(database, account.id, from).all<BankFeedTransactionRow>()
  ).results;
  // Book entries a little older than the window can still be the books' side of a line inside it.
  const bookRows =
    account.ledger_account_id === null
      ? []
      : (
          await selectBookLinesStatement(
            database,
            account.ledger_account_id,
            civilDateDaysBefore(now, TRANSACTION_WINDOW_DAYS + DATE_WINDOW_DAYS),
          ).all<BookLineRow>()
        ).results;
  const statuses = matchBankLines(
    bankRows.map((row) => ({
      id: row.id,
      postedOn: row.posted_on,
      amountMinor: row.amount_minor,
      pending: row.pending === 1,
    })),
    bookRows.map((row) => ({
      id: row.entry_id,
      effectiveOn: row.effective_date,
      amountMinor: row.bank_delta_minor,
    })),
  );
  return bankRows.map((row) => {
    const status = statuses.get(row.id);
    return {
      id: row.id,
      postedOn: row.posted_on,
      description: row.description,
      amountMinor: row.amount_minor,
      checkNumber: row.check_number,
      // An untied account has no books to be in.
      status:
        account.ledger_account_id === null && status?.status !== "pending"
          ? "notInBooks"
          : (status?.status ?? "notInBooks"),
    };
  });
}

export async function readBookAccounts(database: SqlDatabase): Promise<BookAccount[]> {
  const { results } = await selectBankBookAccountsStatement(database).all<BankBookAccountRow>();
  return results.map((row) => ({
    ledgerAccountId: row.ledger_account_id,
    name: row.name,
    kind: row.kind,
    trustAccountId: row.trust_account_id,
    feedAccountId: row.feed_account_id,
  }));
}

export async function readBankingOverview(
  database: SqlDatabase,
  input: { readonly providerConfigured: boolean; readonly now: Date },
): Promise<Overview> {
  const [connections, accountRows, bookAccounts] = await Promise.all([
    readLiveConnections(database),
    selectLiveBankFeedAccountsStatement(database).all<BankFeedAccountRow>(),
    readBookAccounts(database),
  ]);
  const bookByLedger = new Map(bookAccounts.map((account) => [account.ledgerAccountId, account]));
  const accounts = await Promise.all(
    accountRows.results.map(async (row) => {
      const book = row.ledger_account_id === null ? null : (bookByLedger.get(row.ledger_account_id) ?? null);
      const notInBooksCount =
        book === null
          ? 0
          : (await readMarkedTransactions(database, row, input.now)).filter(
              (transaction) => transaction.status === "notInBooks",
            ).length;
      return {
        id: row.id,
        connectionId: row.connection_id,
        institutionName: row.institution_name,
        name: row.name,
        mask: row.mask,
        subtype: row.subtype,
        currency: row.currency,
        bankBalanceMinor: row.current_balance_minor,
        availableBalanceMinor: row.available_balance_minor,
        balanceAsOf: row.balance_as_of,
        bookAccount: book,
        booksBalanceMinor: book === null ? null : row.books_balance_minor,
        notInBooksCount,
      };
    }),
  );
  return {
    providerConfigured: input.providerConfigured,
    connections: connections.map((connection) => ({
      id: connection.id,
      institutionName: connection.institution_name,
      signInNeeded: connection.sign_in_needed === 1,
      connectedAt: connection.connected_at,
      connectedBy: connection.connected_by_name ?? "A former member",
      lastSyncedAt: connection.last_synced_at,
    })),
    accounts,
    bookAccounts,
  };
}
