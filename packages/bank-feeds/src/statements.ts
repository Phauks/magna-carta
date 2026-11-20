/*
 * Every read and write of the bank feed tables, as statements for the caller to run or commit
 * through the per-firm chokepoint. No statement here touches a ledger table except to READ the
 * books' side of an account (its balance and the entries that moved it); a feed never posts.
 */
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  BankConnectionId,
  BankFeedAccountId,
  BankFeedTransactionId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { BankFeedProvider, ReportedAccount, ReportedTransaction } from "./port.ts";

const memberName = (column: string) =>
  `(SELECT display_name FROM member WHERE user_id = ${column})`;

// ---- reads ---------------------------------------------------------------------------------------

export interface BankConnectionRow {
  readonly id: BankConnectionId;
  readonly provider: BankFeedProvider;
  readonly remote_item_id: string;
  readonly institution_name: string;
  readonly institution_logo: string | null;
  readonly credential_ref: string;
  readonly sync_cursor: string | null;
  readonly sign_in_needed: number;
  readonly last_synced_at: string | null;
  readonly connected_by: UserId;
  readonly connected_by_name: string | null;
  readonly connected_at: string;
}

const CONNECTION_COLUMNS = `c.id, c.provider, c.remote_item_id, c.institution_name, c.institution_logo, c.credential_ref, c.sync_cursor, c.sign_in_needed, c.last_synced_at, c.connected_by, ${memberName("c.connected_by")} AS connected_by_name, c.connected_at`;

/** Every connection still in use, oldest first. */
export function selectLiveBankConnectionsStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT ${CONNECTION_COLUMNS} FROM bank_connection c WHERE c.disconnected_at IS NULL ORDER BY c.connected_at, c.id`,
  );
}

export function selectLiveBankConnectionStatement(
  database: SqlDatabase,
  connectionId: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${CONNECTION_COLUMNS} FROM bank_connection c WHERE c.id = ?1 AND c.disconnected_at IS NULL`,
    )
    .bind(connectionId);
}

export function selectBankConnectionByRemoteItemStatement(
  database: SqlDatabase,
  provider: BankFeedProvider,
  remoteItemId: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT ${CONNECTION_COLUMNS} FROM bank_connection c WHERE c.provider = ?1 AND c.remote_item_id = ?2`,
    )
    .bind(provider, remoteItemId);
}

export interface BankFeedAccountRow {
  readonly id: BankFeedAccountId;
  readonly connection_id: BankConnectionId;
  readonly institution_name: string;
  readonly institution_logo: string | null;
  readonly remote_account_id: string;
  readonly name: string;
  readonly mask: string | null;
  readonly subtype: string | null;
  readonly currency: string;
  readonly current_balance_minor: number | null;
  readonly available_balance_minor: number | null;
  readonly balance_as_of: string | null;
  readonly ledger_account_id: string | null;
  /** The books' balance of the tied account: debits less credits, as for any bank account. */
  readonly books_balance_minor: number | null;
}

/** The feed accounts of every live connection, with the books' balance of each tied account. */
export function selectLiveBankFeedAccountsStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT a.id, a.connection_id, c.institution_name, c.institution_logo, a.remote_account_id, a.name, a.mask, a.subtype, a.currency, a.current_balance_minor, a.available_balance_minor, a.balance_as_of, a.ledger_account_id, CASE WHEN a.ledger_account_id IS NULL THEN NULL ELSE (SELECT COALESCE(SUM(CASE WHEN l.direction = 'debit' THEN l.amount_minor ELSE -l.amount_minor END), 0) FROM ledger_line l WHERE l.account_id = a.ledger_account_id) END AS books_balance_minor FROM bank_feed_account a JOIN bank_connection c ON c.id = a.connection_id WHERE c.disconnected_at IS NULL ORDER BY c.connected_at, c.id, a.name, a.id`,
  );
}

export function selectBankFeedAccountsOfConnectionStatement(
  database: SqlDatabase,
  connectionId: BankConnectionId,
): SqlStatement {
  return database
    .prepare(`SELECT a.id, a.remote_account_id FROM bank_feed_account a WHERE a.connection_id = ?1`)
    .bind(connectionId);
}

export interface BankBookAccountRow {
  readonly ledger_account_id: string;
  readonly name: string;
  readonly kind: "operating" | "trust";
  readonly trust_account_id: string | null;
  readonly feed_account_id: string | null;
}

/**
 * Every bank account in the books a feed account may be tied to: each open trust account's bank
 * leaf, and the firm's operating bank account. The one definition of "a bank account in the books";
 * the link route refuses any ledger account this does not list.
 */
export function selectBankBookAccountsStatement(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `SELECT b.ledger_account_id, b.name, b.kind, b.trust_account_id, (SELECT a.id FROM bank_feed_account a JOIN bank_connection c ON c.id = a.connection_id WHERE a.ledger_account_id = b.ledger_account_id AND c.disconnected_at IS NULL) AS feed_account_id FROM (SELECT t.bank_ledger_account_id AS ledger_account_id, t.name AS name, 'trust' AS kind, t.id AS trust_account_id FROM trust_account t WHERE t.status = 'open' UNION ALL SELECT r.ledger_account_id, la.name, 'operating', NULL FROM firm_account_role r JOIN ledger_account la ON la.id = r.ledger_account_id WHERE r.role = 'operating_bank') b ORDER BY CASE b.kind WHEN 'operating' THEN 0 ELSE 1 END, b.name, b.ledger_account_id`,
  );
}

export interface BankFeedTransactionRow {
  readonly id: BankFeedTransactionId;
  readonly posted_on: string;
  readonly description: string;
  readonly amount_minor: number;
  readonly check_number: string | null;
  readonly pending: number;
}

/** The most lines one account's window lists; past it the oldest are left off. */
export const MOST_TRANSACTIONS_LISTED = 2_000;

/** The bank's lines on one account dated on or after `from`, newest first, less withdrawn ones. */
export function selectBankFeedTransactionsStatement(
  database: SqlDatabase,
  accountId: string,
  from: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT t.id, t.posted_on, t.description, t.amount_minor, t.check_number, t.pending FROM bank_feed_transaction t WHERE t.account_id = ?1 AND t.posted_on >= ?2 AND t.removed_at IS NULL ORDER BY t.posted_on DESC, t.id DESC LIMIT ?3`,
    )
    .bind(accountId, from, MOST_TRANSACTIONS_LISTED);
}

export interface BookLineRow {
  readonly entry_id: string;
  readonly effective_date: string;
  readonly bank_delta_minor: number;
}

/**
 * The entries that moved a bank account in the books dated on or after `from`, each with its signed
 * effect on the account (a debit is money in). The same definition of a book item the trust
 * reconciliation uses: an entry that touched the account's bank leaf, whatever composed it.
 */
export function selectBookLinesStatement(
  database: SqlDatabase,
  ledgerAccountId: string,
  from: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT e.id AS entry_id, e.effective_date AS effective_date, SUM(CASE WHEN l.direction = 'debit' THEN l.amount_minor ELSE -l.amount_minor END) AS bank_delta_minor FROM ledger_entry e JOIN ledger_line l ON l.entry_id = e.id AND l.account_id = ?1 WHERE e.effective_date >= ?2 GROUP BY e.id, e.effective_date ORDER BY e.effective_date, e.id LIMIT ?3`,
    )
    .bind(ledgerAccountId, from, MOST_TRANSACTIONS_LISTED * 2);
}

/** A logo the column can hold, or none: an empty or oversized one is dropped rather than refused. */
const logoOrNull = (logo: string | null): string | null =>
  logo !== null && logo.length > 0 && logo.length <= 100_000 ? logo : null;

// ---- writes --------------------------------------------------------------------------------------

export function insertBankConnectionStatement(
  database: SqlDatabase,
  input: {
    readonly id: BankConnectionId;
    readonly provider: BankFeedProvider;
    readonly remoteItemId: string;
    readonly institutionName: string;
    readonly institutionLogo: string | null;
    readonly credentialRef: string;
    readonly connectedBy: UserId;
    readonly connectedAt: string;
  },
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO bank_connection (id, provider, remote_item_id, institution_name, institution_logo, credential_ref, sync_cursor, sign_in_needed, last_synced_at, connected_by, connected_at, disconnected_by, disconnected_at) VALUES (?1, ?2, ?3, ?4, ?8, ?5, NULL, 0, NULL, ?6, ?7, NULL, NULL)`,
    )
    .bind(
      input.id,
      input.provider,
      input.remoteItemId,
      input.institutionName.slice(0, 200) || "Bank",
      input.credentialRef,
      input.connectedBy,
      input.connectedAt,
      logoOrNull(input.institutionLogo),
    );
}

/** A connection signed in to again from a fresh sign-in: back in use, with nothing owed to the bank. */
export function reopenBankConnectionStatement(
  database: SqlDatabase,
  connectionId: BankConnectionId,
  institutionName: string,
  institutionLogo: string | null,
): SqlStatement {
  return database
    .prepare(
      `UPDATE bank_connection SET institution_name = ?2, institution_logo = ?3, sign_in_needed = 0, disconnected_by = NULL, disconnected_at = NULL WHERE id = ?1`,
    )
    .bind(connectionId, institutionName.slice(0, 200) || "Bank", logoOrNull(institutionLogo));
}

export function upsertBankFeedAccountStatement(
  database: SqlDatabase,
  input: {
    readonly id: BankFeedAccountId;
    readonly connectionId: BankConnectionId;
    readonly account: ReportedAccount;
    readonly now: string;
  },
): SqlStatement {
  const { account } = input;
  const hasBalance = account.currentBalanceMinor !== null || account.availableBalanceMinor !== null;
  return database
    .prepare(
      `INSERT INTO bank_feed_account (id, connection_id, remote_account_id, name, mask, kind, subtype, currency, current_balance_minor, available_balance_minor, balance_as_of, ledger_account_id, linked_by, linked_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, NULL, NULL, ?12) ON CONFLICT (connection_id, remote_account_id) DO UPDATE SET name = excluded.name, mask = excluded.mask, kind = excluded.kind, subtype = excluded.subtype, currency = excluded.currency, current_balance_minor = excluded.current_balance_minor, available_balance_minor = excluded.available_balance_minor, balance_as_of = excluded.balance_as_of`,
    )
    .bind(
      input.id,
      input.connectionId,
      account.remoteAccountId,
      account.name.slice(0, 200) || "Account",
      account.mask,
      account.kind,
      account.subtype,
      account.currency.length === 3 ? account.currency : "USD",
      account.currentBalanceMinor,
      account.availableBalanceMinor,
      hasBalance ? input.now : null,
      input.now,
    );
}

export function upsertBankFeedTransactionStatement(
  database: SqlDatabase,
  input: {
    readonly id: BankFeedTransactionId;
    readonly accountId: BankFeedAccountId;
    readonly transaction: ReportedTransaction;
    readonly now: string;
  },
): SqlStatement {
  const { transaction } = input;
  return database
    .prepare(
      `INSERT INTO bank_feed_transaction (id, account_id, remote_transaction_id, posted_on, description, amount_minor, check_number, pending, removed_at, first_seen_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?9) ON CONFLICT (account_id, remote_transaction_id) DO UPDATE SET posted_on = excluded.posted_on, description = excluded.description, amount_minor = excluded.amount_minor, check_number = excluded.check_number, pending = excluded.pending, removed_at = NULL, updated_at = excluded.updated_at`,
    )
    .bind(
      input.id,
      input.accountId,
      transaction.remoteTransactionId,
      transaction.postedOn,
      transaction.description.slice(0, 500),
      transaction.amountMinor,
      transaction.checkNumber,
      transaction.pending ? 1 : 0,
      input.now,
    );
}

// fitness:unguarded-write — matching no row means the bank withdrew a line this firm never stored, which is the outcome wanted.
/** A line the bank withdrew. Kept, marked: what the bank once said stays on the record. */
export function markBankFeedTransactionRemovedStatement(
  database: SqlDatabase,
  connectionId: BankConnectionId,
  remoteTransactionId: string,
  now: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE bank_feed_transaction SET removed_at = ?3, updated_at = ?3 WHERE remote_transaction_id = ?2 AND removed_at IS NULL AND account_id IN (SELECT id FROM bank_feed_account WHERE connection_id = ?1)`,
    )
    .bind(connectionId, remoteTransactionId, now);
}

export function recordBankSyncStatement(
  database: SqlDatabase,
  connectionId: BankConnectionId,
  input: { readonly cursor: string; readonly now: string },
): SqlStatement {
  return database
    .prepare(
      `UPDATE bank_connection SET sync_cursor = ?2, last_synced_at = ?3, sign_in_needed = 0 WHERE id = ?1`,
    )
    .bind(connectionId, input.cursor, input.now);
}

export function recordBankSignInNeededStatement(
  database: SqlDatabase,
  connectionId: BankConnectionId,
): SqlStatement {
  return database
    .prepare(`UPDATE bank_connection SET sign_in_needed = 1 WHERE id = ?1`)
    .bind(connectionId);
}

/**
 * Ties a feed account to a bank account in the books, or unties it (null). The partial unique index
 * on ledger_account_id is what refuses a second feed for one book account, at commit.
 */
export function linkBankFeedAccountStatement(
  database: SqlDatabase,
  input: {
    readonly accountId: string;
    readonly ledgerAccountId: string | null;
    readonly linkedBy: UserId;
    readonly now: string;
  },
): SqlStatement {
  return database
    .prepare(
      `UPDATE bank_feed_account SET ledger_account_id = ?2, linked_by = ?3, linked_at = ?4 WHERE id = ?1`,
    )
    .bind(input.accountId, input.ledgerAccountId, input.linkedBy, input.now);
}

/**
 * Ends a connection. Its feed accounts are untied in the same batch, so the book account is free to
 * take a feed from a new sign-in; the bank's lines stay.
 */
// fitness:unguarded-write — matching no row means nothing was tied or the connection was already closed; disconnecting again is not refused.
export function disconnectBankConnectionStatements(
  database: SqlDatabase,
  input: { readonly connectionId: BankConnectionId; readonly by: UserId; readonly now: string },
): SqlStatement[] {
  return [
    database
      .prepare(
        `UPDATE bank_feed_account SET ledger_account_id = NULL, linked_by = ?2, linked_at = ?3 WHERE connection_id = ?1 AND ledger_account_id IS NOT NULL`,
      )
      .bind(input.connectionId, input.by, input.now),
    database
      .prepare(
        `UPDATE bank_connection SET disconnected_by = ?2, disconnected_at = ?3 WHERE id = ?1 AND disconnected_at IS NULL`,
      )
      .bind(input.connectionId, input.by, input.now),
  ];
}
