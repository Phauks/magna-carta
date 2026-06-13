import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { normalBalanceFor } from "./normal-balance.ts";
import { ACCOUNT_BALANCE_TABLE, LEDGER_ACCOUNT_TABLE, LEDGER_LINE_TABLE } from "./statements.ts";
import { ACCOUNT_TYPES } from "./types.ts";

// Fitness queries: re-prove the invariants over the WHOLE table. Zero rows = healthy.
// Run via assertLedgerFitness after every scenario; later wired into CI / an admin diagnostic.

// The SQL's debit-normal type list is GENERATED from normal-balance.ts (the only home of the
// derivation) — restating it as a literal here would let the harness itself drift from the rule
// it re-proves when the type set or the rule changes.
const DEBIT_NORMAL_TYPES_SQL = ACCOUNT_TYPES.filter((type) => normalBalanceFor(type) === "debit")
  .map((type) => `'${type}'`)
  .join(", ");

// Every entry must sum to zero across its lines.
export function unbalancedEntriesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT entry_id, SUM(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END) AS net FROM ${LEDGER_LINE_TABLE} GROUP BY entry_id HAVING net <> 0`,
    )
    .bind();
}

// Every materialized balance must equal the recomputed sum of its lines in normal-balance terms.
export function inconsistentBalancesStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT b.account_id, b.balance_minor, COALESCE(computed.total, 0) AS computed FROM ${ACCOUNT_BALANCE_TABLE} b LEFT JOIN (SELECT l.account_id, SUM(CASE WHEN l.direction = (CASE WHEN a.type IN (${DEBIT_NORMAL_TYPES_SQL}) THEN 'debit' ELSE 'credit' END) THEN l.amount_minor ELSE -l.amount_minor END) AS total FROM ${LEDGER_LINE_TABLE} l JOIN ${LEDGER_ACCOUNT_TABLE} a ON a.id = l.account_id GROUP BY l.account_id) computed ON computed.account_id = b.account_id WHERE COALESCE(computed.total, 0) <> b.balance_minor`,
    )
    .bind();
}

// The leaf-only invariant's table-wide backstop. Both write-path guards (createAccount's
// parent-has-postings pre-check, postEntry's has_children pre-check) read before their batch
// commits, so the concurrent createAccount/postEntry race can land a parent that carries direct
// postings — lines stranded outside every child roll-up, uncorrectable through reverseEntry
// (its re-validation refuses non-leaf accounts). This query is where that corruption surfaces.
export function parentAccountsWithPostingsStatement(database: SqlDatabase): SqlStatement {
  return database
    .prepare(
      `SELECT DISTINCT l.account_id FROM ${LEDGER_LINE_TABLE} l WHERE EXISTS(SELECT 1 FROM ${LEDGER_ACCOUNT_TABLE} c WHERE c.parent_account_id = l.account_id)`,
    )
    .bind();
}

const FITNESS_STATEMENTS = [
  ["unbalanced entries", unbalancedEntriesStatement],
  ["inconsistent balances", inconsistentBalancesStatement],
  ["parent accounts with postings", parentAccountsWithPostingsStatement],
] as const;

// The one proof call sites use (scenario assertions, seeding, future diagnostics): every fitness
// query runs, so a query added above is automatically part of every proof. Corruption throws a
// plain Error — nothing a caller's user can fix — naming the failed query and the offending rows.
export async function assertLedgerFitness(database: SqlDatabase): Promise<void> {
  for (const [name, statement] of FITNESS_STATEMENTS) {
    const { results } = await statement(database).all();
    if (results.length > 0) {
      throw new Error(
        `ledger fitness: ${name} — ${results.length} offending row(s): ${JSON.stringify(results)}`,
      );
    }
  }
}
