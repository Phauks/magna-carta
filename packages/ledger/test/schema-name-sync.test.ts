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
  ACCOUNT_BALANCE_TABLE,
  LEDGER_ACCOUNT_TABLE,
  LEDGER_ENTRY_TABLE,
  LEDGER_LINE_TABLE,
  applyBalanceDeltaStatement,
  insertAccountStatement,
  insertBalanceRowStatement,
  insertEntryStatement,
  insertLineStatement,
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
// only ever sees column names, table names, and aliases. Literals and placeholders never match.
const identifiers = (sql: string) => sql.match(/\b[a-z_]+\b/g) ?? [];

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
    expectOnlyKnownIdentifiers(lineSql, new Set([LEDGER_LINE_TABLE, ...lineColumns]), "line");
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
});
