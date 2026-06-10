import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  accountBalance,
  ledgerAccount,
  ledgerEntry,
  ledgerLine,
} from "@magna-carta/database/per-firm-schema";
import { describe, expect, it } from "vitest";
import {
  inconsistentBalancesStatement,
  parentAccountsWithPostingsStatement,
  unbalancedEntriesStatement,
} from "../src/fitness.ts";
import { ACCOUNT_TYPES } from "../src/types.ts";
import {
  ACCOUNT_BALANCE_TABLE,
  LEDGER_ACCOUNT_TABLE,
  LEDGER_ENTRY_TABLE,
  LEDGER_LINE_TABLE,
  applyBalanceDeltaStatement,
  insertAccountStatement,
  insertBalanceRowStatement,
  insertEntryStatement,
  insertLineStatement,
  selectAccountHasLinesStatement,
  selectAccountSnapshotsStatement,
  selectEntryStatement,
  selectLinesForEntryStatement,
  selectReversalOfStatement,
  setAccountBoundsStatement,
} from "../src/statements.ts";

// Fitness function: the raw SQL in this package must track @magna-carta/database's schema — the
// single source of truth (ADR-0065). Renaming a table/column there fails here, not in production.

// SQL-capturing stub: the builders only need prepare/bind, and SqlStatement carries the SQL text.
function stubDatabase(): SqlDatabase {
  const statement = (sql: string): SqlStatement => ({
    sql,
    bind: () => statement(sql),
    run: () => Promise.resolve({ meta: { changes: 0 } }),
    all: <T>() => Promise.resolve({ results: [] as T[] }),
  });
  return { prepare: statement };
}

function sqlOf(statement: SqlStatement): string {
  return statement.sql ?? "";
}

function columnsOf(table: Parameters<typeof getTableConfig>[0]): Set<string> {
  return new Set(getTableConfig(table).columns.map((column) => column.name));
}

// SQL keywords are written UPPERCASE in the builders, so the lowercase-identifier extraction below
// only ever sees column names, table names, and aliases. Identifiers must START with a letter or
// underscore, so ?1-style placeholders stay invisible while digit-containing identifiers (a future
// balance_v2) are still extracted and checked rather than silently skipped. Single-quoted string
// literals ('debit', 'asset', …) are values, not identifiers — stripped before extraction, with
// SQL's doubled-quote escape ('it''s') consumed as part of the literal so its tail can't leak out
// as a phantom identifier.
const identifiers = (sql: string) =>
  sql.replace(/'(?:[^']|'')*'/g, " ").match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];

function expectOnlyKnownIdentifiers(sql: string, allowed: ReadonlySet<string>, label: string) {
  for (const identifier of identifiers(sql)) {
    expect(allowed.has(identifier), `${label} SQL names "${identifier}"`).toBe(true);
  }
}

const ACCOUNT_ID = "acct_x" as never;
const PARENT_ID = "acct_p" as never;
const ENTRY_ID = "led_x" as never;
const LINE_ID = "lln_x" as never;

describe("schema name sync (ledger SQL pinned to @magna-carta/database)", () => {
  it("table names match the drizzle schema", () => {
    expect(getTableConfig(ledgerAccount).name).toBe(LEDGER_ACCOUNT_TABLE);
    expect(getTableConfig(ledgerEntry).name).toBe(LEDGER_ENTRY_TABLE);
    expect(getTableConfig(ledgerLine).name).toBe(LEDGER_LINE_TABLE);
    expect(getTableConfig(accountBalance).name).toBe(ACCOUNT_BALANCE_TABLE);
  });

  it("every column the SQL statements name exists in the schema", () => {
    const stub = stubDatabase();
    const accountColumns = columnsOf(ledgerAccount);
    const entryColumns = columnsOf(ledgerEntry);
    const lineColumns = columnsOf(ledgerLine);
    const balanceColumns = columnsOf(accountBalance);

    const accountSql = sqlOf(
      insertAccountStatement(stub, {
        id: ACCOUNT_ID,
        name: "n",
        type: "asset",
        currency: "USD",
        parentAccountId: null,
        createdAt: "t",
      }),
    );
    const balanceSql = [
      sqlOf(insertBalanceRowStatement(stub, ACCOUNT_ID, "t")),
      sqlOf(applyBalanceDeltaStatement(stub, ACCOUNT_ID, 1, "t")),
      sqlOf(setAccountBoundsStatement(stub, ACCOUNT_ID, 0, null, "t")),
    ].join("\n");
    const entrySql = [
      sqlOf(
        insertEntryStatement(stub, {
          id: ENTRY_ID,
          description: "d",
          effectiveDate: "2026-01-05",
          recordedAt: "t",
          reversesEntryId: null,
        }),
      ),
      sqlOf(selectEntryStatement(stub, ENTRY_ID)),
      sqlOf(selectReversalOfStatement(stub, ENTRY_ID)),
    ].join("\n");
    const lineSql = [
      sqlOf(
        insertLineStatement(stub, {
          id: LINE_ID,
          entryId: ENTRY_ID,
          accountId: ACCOUNT_ID,
          lineIndex: 0,
          direction: "debit",
          amountMinor: 1,
        }),
      ),
      sqlOf(selectLinesForEntryStatement(stub, ENTRY_ID)),
      sqlOf(selectAccountHasLinesStatement(stub, ACCOUNT_ID)),
    ].join("\n");
    const snapshotSql = sqlOf(selectAccountSnapshotsStatement(stub, [ACCOUNT_ID, PARENT_ID]));

    expectOnlyKnownIdentifiers(
      accountSql,
      new Set([LEDGER_ACCOUNT_TABLE, ...accountColumns]),
      "account",
    );
    expectOnlyKnownIdentifiers(
      balanceSql,
      new Set([ACCOUNT_BALANCE_TABLE, ...balanceColumns]),
      "balance",
    );
    expectOnlyKnownIdentifiers(entrySql, new Set([LEDGER_ENTRY_TABLE, ...entryColumns]), "entry");
    // has_lines is the computed output name of selectAccountHasLinesStatement, not a column.
    expectOnlyKnownIdentifiers(
      lineSql,
      new Set([LEDGER_LINE_TABLE, "has_lines", ...lineColumns]),
      "line",
    );
    // The snapshot query joins ledger_account to account_balance; its aliases and computed output
    // names are the only non-column identifiers permitted.
    expectOnlyKnownIdentifiers(
      snapshotSql,
      new Set([
        LEDGER_ACCOUNT_TABLE,
        ACCOUNT_BALANCE_TABLE,
        "a",
        "b",
        "c",
        "has_children",
        "has_balance_row",
        ...accountColumns,
        ...balanceColumns,
      ]),
      "snapshot",
    );
  });

  it("ACCOUNT_TYPES matches the drizzle type enum — one type set, pinned across packages", () => {
    const type = getTableConfig(ledgerAccount).columns.find((column) => column.name === "type");
    expect(type?.enumValues).toEqual([...ACCOUNT_TYPES]);
  });

  it("the fitness queries name only schema identifiers and their own aliases", () => {
    const stub = stubDatabase();
    const accountColumns = columnsOf(ledgerAccount);
    const lineColumns = columnsOf(ledgerLine);
    const balanceColumns = columnsOf(accountBalance);
    const fitnessSql = [
      sqlOf(unbalancedEntriesStatement(stub)),
      sqlOf(inconsistentBalancesStatement(stub)),
      sqlOf(parentAccountsWithPostingsStatement(stub)),
    ].join("\n");
    // net / total / computed are computed output names; b / l / a / c / computed are table aliases.
    expectOnlyKnownIdentifiers(
      fitnessSql,
      new Set([
        LEDGER_LINE_TABLE,
        LEDGER_ACCOUNT_TABLE,
        ACCOUNT_BALANCE_TABLE,
        "net",
        "b",
        "l",
        "a",
        "c",
        "computed",
        "total",
        ...accountColumns,
        ...lineColumns,
        ...balanceColumns,
      ]),
      "fitness",
    );
  });
});
