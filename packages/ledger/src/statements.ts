import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId, LedgerEntryId, LedgerLineId } from "@magna-carta/identifiers/types";
import type { AccountType, Direction } from "./types.ts";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync test.
export const LEDGER_ACCOUNT_TABLE = "ledger_account";
export const LEDGER_ENTRY_TABLE = "ledger_entry";
export const LEDGER_LINE_TABLE = "ledger_line";
export const ACCOUNT_BALANCE_TABLE = "account_balance";

export interface InsertAccountRow {
  readonly id: LedgerAccountId;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly parentAccountId: LedgerAccountId | null;
  readonly createdAt: string;
}

export function insertAccountStatement(database: SqlDatabase, row: InsertAccountRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${LEDGER_ACCOUNT_TABLE} (id, name, type, currency, parent_account_id, active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)`,
    )
    .bind(row.id, row.name, row.type, row.currency, row.parentAccountId, row.createdAt);
}

// The balance row is created WITH the account (same batch), unbounded, at zero.
export function insertBalanceRowStatement(
  database: SqlDatabase,
  accountId: LedgerAccountId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${ACCOUNT_BALANCE_TABLE} (account_id, balance_minor, min_balance_minor, max_balance_minor, updated_at) VALUES (?1, 0, NULL, NULL, ?2)`,
    )
    .bind(accountId, updatedAt);
}

export interface InsertEntryRow {
  readonly id: LedgerEntryId;
  readonly description: string;
  readonly effectiveDate: string;
  readonly recordedAt: string;
  readonly reversesEntryId: LedgerEntryId | null;
}

export function insertEntryStatement(database: SqlDatabase, row: InsertEntryRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${LEDGER_ENTRY_TABLE} (id, description, effective_date, recorded_at, reverses_entry_id) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(row.id, row.description, row.effectiveDate, row.recordedAt, row.reversesEntryId);
}

export interface InsertLineRow {
  readonly id: LedgerLineId;
  readonly entryId: LedgerEntryId;
  readonly accountId: LedgerAccountId;
  readonly lineIndex: number;
  readonly direction: Direction;
  readonly amountMinor: number;
}

export function insertLineStatement(database: SqlDatabase, row: InsertLineRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${LEDGER_LINE_TABLE} (id, entry_id, account_id, line_index, direction, amount_minor) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(row.id, row.entryId, row.accountId, row.lineIndex, row.direction, row.amountMinor);
}

// The in-batch balance write. A bounds violation makes the CHECK fire and the WHOLE batch roll
// back — the enforcement mechanism of ADR-0072/ADR-0009. delta is in normal-balance terms.
export function applyBalanceDeltaStatement(
  database: SqlDatabase,
  accountId: LedgerAccountId,
  deltaMinor: number,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${ACCOUNT_BALANCE_TABLE} SET balance_minor = balance_minor + ?2, updated_at = ?3 WHERE account_id = ?1`,
    )
    .bind(accountId, deltaMinor, updatedAt);
}

// The Phase-3 trust seam primitive (ADR-0009): setting bounds on an account whose current balance
// already violates them fails the CHECK immediately — bounds can never be born violated.
export function setAccountBoundsStatement(
  database: SqlDatabase,
  accountId: LedgerAccountId,
  minBalanceMinor: number | null,
  maxBalanceMinor: number | null,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${ACCOUNT_BALANCE_TABLE} SET min_balance_minor = ?2, max_balance_minor = ?3, updated_at = ?4 WHERE account_id = ?1`,
    )
    .bind(accountId, minBalanceMinor, maxBalanceMinor, updatedAt);
}

// Pre-batch reads (ADR-0063 pre-check pattern). has_children: parents take no postings.
// has_balance_row: a missing row would make the in-batch UPDATE a silent no-op — refused upstream.
export function selectAccountSnapshotsStatement(
  database: SqlDatabase,
  accountIds: readonly LedgerAccountId[],
): SqlStatement {
  const placeholders = accountIds.map((_, index) => `?${index + 1}`).join(", ");
  return database
    .prepare(
      `SELECT a.id, a.type, a.currency, a.active, EXISTS(SELECT 1 FROM ${LEDGER_ACCOUNT_TABLE} c WHERE c.parent_account_id = a.id) AS has_children, (b.account_id IS NOT NULL) AS has_balance_row FROM ${LEDGER_ACCOUNT_TABLE} a LEFT JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = a.id WHERE a.id IN (${placeholders})`,
    )
    .bind(...accountIds);
}

export function selectEntryStatement(database: SqlDatabase, entryId: LedgerEntryId): SqlStatement {
  return database
    .prepare(
      `SELECT id, description, effective_date, recorded_at, reverses_entry_id FROM ${LEDGER_ENTRY_TABLE} WHERE id = ?1`,
    )
    .bind(entryId);
}

export function selectLinesForEntryStatement(
  database: SqlDatabase,
  entryId: LedgerEntryId,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, entry_id, account_id, line_index, direction, amount_minor FROM ${LEDGER_LINE_TABLE} WHERE entry_id = ?1 ORDER BY line_index`,
    )
    .bind(entryId);
}

// Reversed-status is DERIVED from the link (never a flag): an entry is reversed iff some entry names
// it here. The UNIQUE index makes the concurrent double-reversal race lose at commit time.
export function selectReversalOfStatement(
  database: SqlDatabase,
  entryId: LedgerEntryId,
): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${LEDGER_ENTRY_TABLE} WHERE reverses_entry_id = ?1`)
    .bind(entryId);
}
