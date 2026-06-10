import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { LedgerAccountId, LedgerEntryId, LedgerLineId } from "@magna-carta/identifiers/types";
import { assertSafeInteger } from "@magna-carta/money/money";
import type { AccountType, Direction } from "./types.ts";

// Table names tracked against @magna-carta/database's schema by the schema-name-sync test.
export const LEDGER_ACCOUNT_TABLE = "ledger_account";
export const LEDGER_ENTRY_TABLE = "ledger_entry";
export const LEDGER_LINE_TABLE = "ledger_line";
export const ACCOUNT_BALANCE_TABLE = "account_balance";

// Money columns are integer minor units (ADR-0061). SQLite would happily store a float or NaN as
// REAL in an INTEGER column, silently corrupting balances — so every minor-unit number is asserted
// at the last boundary before SQL, via the money package's guard (ONE home for the safe-integer
// rule: if the money engine's notion of a valid amount ever tightens, this boundary follows).
function assertMinorUnits(value: number, what: string): number {
  assertSafeInteger(value, `${what} (minor units)`);
  return value;
}

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
    .bind(
      row.id,
      row.entryId,
      row.accountId,
      row.lineIndex,
      row.direction,
      assertMinorUnits(row.amountMinor, "amount_minor"),
    );
}

// The in-batch balance write. A bounds violation makes the CHECK fire and the WHOLE batch roll
// back — the enforcement mechanism of ADR-0072/ADR-0009. delta is in normal-balance terms.
// PRECONDITION: the caller must have confirmed the balance row exists (selectAccountSnapshotsStatement,
// hasBalanceRow) — against a missing row this UPDATE affects 0 rows and the batch SUCCEEDS with the
// balance silently unwritten. The CHECK cannot fire on a no-op.
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
    .bind(accountId, assertMinorUnits(deltaMinor, "balance delta"), updatedAt);
}

// The Phase-3 trust seam primitive (ADR-0009): setting bounds on an account whose current balance
// already violates them fails the CHECK immediately — bounds can never be born violated.
// PRECONDITION: same silent-no-op hazard as applyBalanceDeltaStatement — confirm the balance row
// exists before composing this against an unknown account.
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
    .bind(
      accountId,
      minBalanceMinor === null ? null : assertMinorUnits(minBalanceMinor, "min balance bound"),
      maxBalanceMinor === null ? null : assertMinorUnits(maxBalanceMinor, "max balance bound"),
      updatedAt,
    );
}

// Cloudflare D1 caps bound parameters at 100 per query (D1 platform limits). The node:sqlite test
// substrate allows ~32k, so an oversized IN-list would pass every local test and fail only against
// production D1 — the builder asserts the cap so local runs fail the same way production would,
// and loadAccountSnapshots chunks at this size.
export const MAX_BOUND_PARAMETERS = 100;

// Pre-batch reads (ADR-0063 pre-check pattern). has_children: parents take no postings.
// has_balance_row: a missing row would make the in-batch UPDATE a silent no-op — refused upstream.
export function selectAccountSnapshotsStatement(
  database: SqlDatabase,
  accountIds: readonly LedgerAccountId[],
): SqlStatement {
  // An empty IN () is a SQLite syntax error, and an empty snapshot read is always a caller bug.
  if (accountIds.length === 0) {
    throw new Error("selectAccountSnapshotsStatement: accountIds must be non-empty");
  }
  if (accountIds.length > MAX_BOUND_PARAMETERS) {
    throw new Error(
      `selectAccountSnapshotsStatement: ${accountIds.length} accountIds exceeds D1's bound parameter cap (${MAX_BOUND_PARAMETERS}) — chunk the load`,
    );
  }
  const placeholders = accountIds.map((_, index) => `?${index + 1}`).join(", ");
  return database
    .prepare(
      `SELECT a.id, a.type, a.currency, a.active, EXISTS(SELECT 1 FROM ${LEDGER_ACCOUNT_TABLE} c WHERE c.parent_account_id = a.id) AS has_children, (b.account_id IS NOT NULL) AS has_balance_row FROM ${LEDGER_ACCOUNT_TABLE} a LEFT JOIN ${ACCOUNT_BALANCE_TABLE} b ON b.account_id = a.id WHERE a.id IN (${placeholders})`,
    )
    .bind(...accountIds);
}

// The one sanctioned balance read for consumers (fixtures, future reports): keeping it here puts
// the SQL inside the schema-name-sync net — a raw copy in a consumer package would not be.
export function selectAccountBalanceStatement(
  database: SqlDatabase,
  accountId: LedgerAccountId,
): SqlStatement {
  return database
    .prepare(`SELECT balance_minor FROM ${ACCOUNT_BALANCE_TABLE} WHERE account_id = ?1`)
    .bind(accountId);
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

// Creation-side guard for the leaf-only invariant: an account that already carries postings can
// never become a parent (its direct lines would sit outside every child roll-up). EXISTS, not
// COUNT — the first line is proof enough.
export function selectAccountHasLinesStatement(
  database: SqlDatabase,
  accountId: LedgerAccountId,
): SqlStatement {
  return database
    .prepare(`SELECT EXISTS(SELECT 1 FROM ${LEDGER_LINE_TABLE} WHERE account_id = ?1) AS has_lines`)
    .bind(accountId);
}
