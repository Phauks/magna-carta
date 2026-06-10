import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { ACCOUNT_BALANCE_TABLE, LEDGER_ACCOUNT_TABLE, LEDGER_LINE_TABLE } from "./statements.ts";

// Fitness queries (ADR-0051): re-prove the invariants over the WHOLE table. Zero rows = healthy.
// Run in tests after every scenario; later wired into CI / an admin diagnostic.

// Every entry must sum to zero across its lines.
export function unbalancedEntriesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT entry_id, SUM(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END) AS net FROM ${LEDGER_LINE_TABLE} GROUP BY entry_id HAVING net <> 0`,
    )
    .bind();
}

// Every materialized balance must equal the recomputed sum of its lines in normal-balance terms.
// The normal-balance CASE here mirrors normal-balance.ts — the SQL statement of the same single
// rule (asset/expense debit-normal).
export function inconsistentBalancesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT b.account_id, b.balance_minor, COALESCE(computed.total, 0) AS computed FROM ${ACCOUNT_BALANCE_TABLE} b LEFT JOIN (SELECT l.account_id, SUM(CASE WHEN l.direction = (CASE WHEN a.type IN ('asset', 'expense') THEN 'debit' ELSE 'credit' END) THEN l.amount_minor ELSE -l.amount_minor END) AS total FROM ${LEDGER_LINE_TABLE} l JOIN ${LEDGER_ACCOUNT_TABLE} a ON a.id = l.account_id GROUP BY l.account_id) computed ON computed.account_id = b.account_id WHERE COALESCE(computed.total, 0) <> b.balance_minor`,
    )
    .bind();
}
