import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  accountBalance,
  ledgerLine,
  trustAccount,
  trustHold,
  trustLedgerNode,
  trustMovement,
  trustTransfer,
} from "@magna-carta/database/per-firm-schema";
import { describe, expect, it } from "vitest";
import {
  assertTrustFitness,
  commingledTrustEntriesStatement,
  multiClientTrustEntriesStatement,
  trustHoldsExceedingBalanceStatement,
  trustLeavesWithoutZeroFloorStatement,
  trustMovementsDisagreeingWithLedgerStatement,
  trustRollupNodesWithPostingsStatement,
  trustTransfersMissingCounterpartyLineStatement,
} from "../src/fitness.ts";
import {
  TRUST_ACCOUNT_TABLE,
  TRUST_HOLD_TABLE,
  TRUST_LEDGER_NODE_TABLE,
  TRUST_MOVEMENT_TABLE,
  TRUST_TRANSFER_TABLE,
  insertTrustAccountStatement,
  insertTrustHoldStatement,
  insertTrustLedgerNodeStatement,
  insertTrustMovementStatement,
  insertTrustTransferStatement,
  refuseMatterCloseWithTrustBalanceStatement,
  selectMatterTrustPositionsStatement,
  selectTrustAccountRolesStatement,
  selectTrustAccountStatement,
  selectTrustAvailableBalanceStatement,
  selectTrustClientNodeStatement,
  selectTrustHoldStatement,
  selectTrustMatterNodeStatement,
  selectTrustMovementStatement,
  selectTrustMovementsForNodeStatement,
  selectTrustNodeStatement,
} from "../src/statements.ts";
import { TRUST_MOVEMENT_KINDS, TRUST_MOVEMENT_METHODS, TRUST_NODE_KINDS } from "../src/types.ts";

// Fitness function: the raw SQL in this package must track @magna-carta/database's schema — the
// single source of truth. Renaming a table or column there fails here, not in production.

function stubDatabase(): SqlDatabase {
  const statement = (sql: string): SqlStatement => ({
    sql,
    bind: () => statement(sql),
    run: () => Promise.resolve({ meta: { changes: 0 } }),
    all: <T>() => Promise.resolve({ results: [] as T[] }),
    first: () => Promise.resolve(null),
  });
  return { prepare: statement };
}

const sqlOf = (statement: SqlStatement): string => statement.sql ?? "";

const columnsOf = (table: Parameters<typeof getTableConfig>[0]): Set<string> =>
  new Set(getTableConfig(table).columns.map((column) => column.name));

// SQL keywords are UPPERCASE in the builders, so this lowercase extraction only ever sees column
// names, table names, and aliases. Single-quoted literals are values, not identifiers.
const identifiers = (sql: string) =>
  sql.replace(/'(?:[^']|'')*'/g, " ").match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];

function expectOnlyKnownIdentifiers(sql: string, allowed: ReadonlySet<string>, label: string) {
  for (const identifier of identifiers(sql)) {
    expect(allowed.has(identifier), `${label} SQL names "${identifier}"`).toBe(true);
  }
}

const TRUST_ACCOUNT_ID = "trustAccount_x" as never;
const NODE_ID = "trustLedgerNode_x" as never;
const HOLD_ID = "trustHold_x" as never;
const TRANSFER_ID = "trustTransfer_x" as never;
const MOVEMENT_ID = "trustMovement_x" as never;
const LEDGER_ACCOUNT_ID = "ledgerAccount_x" as never;
const ENTRY_ID = "ledgerEntry_x" as never;

describe("schema name sync (trust SQL pinned to @magna-carta/database)", () => {
  it("table names match the drizzle schema", () => {
    expect(getTableConfig(trustAccount).name).toBe(TRUST_ACCOUNT_TABLE);
    expect(getTableConfig(trustLedgerNode).name).toBe(TRUST_LEDGER_NODE_TABLE);
    expect(getTableConfig(trustHold).name).toBe(TRUST_HOLD_TABLE);
    expect(getTableConfig(trustTransfer).name).toBe(TRUST_TRANSFER_TABLE);
    expect(getTableConfig(trustMovement).name).toBe(TRUST_MOVEMENT_TABLE);
  });

  it("TRUST_NODE_KINDS matches the drizzle kind enum — one vocabulary, pinned across packages", () => {
    const kind = getTableConfig(trustLedgerNode).columns.find((column) => column.name === "kind");
    expect(kind?.enumValues).toEqual([...TRUST_NODE_KINDS]);
  });

  it("the movement kind and method vocabularies match the drizzle enums", () => {
    const columns = getTableConfig(trustMovement).columns;
    expect(columns.find((column) => column.name === "kind")?.enumValues).toEqual([
      ...TRUST_MOVEMENT_KINDS,
    ]);
    expect(columns.find((column) => column.name === "method")?.enumValues).toEqual([
      ...TRUST_MOVEMENT_METHODS,
    ]);
  });

  it("every column the write statements name exists in the schema", () => {
    const stub = stubDatabase();
    const accountSql = [
      sqlOf(
        insertTrustAccountStatement(stub, {
          id: TRUST_ACCOUNT_ID,
          name: "n",
          locationId: "location_x",
          jurisdiction: null,
          bankName: null,
          accountNumberLastFour: null,
          currency: "USD",
          iolta: 1,
          bankLedgerAccountId: LEDGER_ACCOUNT_ID,
          clientLiabilityAccountId: LEDGER_ACCOUNT_ID,
          openedOn: "2026-08-01",
          createdAt: "t",
        }),
      ),
      sqlOf(selectTrustAccountStatement(stub, TRUST_ACCOUNT_ID)),
    ].join("\n");
    const nodeSql = [
      sqlOf(
        insertTrustLedgerNodeStatement(stub, {
          id: NODE_ID,
          trustAccountId: TRUST_ACCOUNT_ID,
          ledgerAccountId: LEDGER_ACCOUNT_ID,
          kind: "matter",
          clientEntityId: "entity",
          matterId: "matter_x" as never,
          parentNodeId: NODE_ID,
          createdAt: "t",
        }),
      ),
      sqlOf(selectTrustNodeStatement(stub, NODE_ID)),
      sqlOf(selectTrustClientNodeStatement(stub, TRUST_ACCOUNT_ID, "entity")),
      sqlOf(selectTrustMatterNodeStatement(stub, TRUST_ACCOUNT_ID, "matter_x" as never)),
    ].join("\n");
    const holdSql = [
      sqlOf(
        insertTrustHoldStatement(stub, {
          id: HOLD_ID,
          nodeId: NODE_ID,
          amountMinor: 1,
          currency: "USD",
          reason: "r",
          placedAt: "t",
          placedBy: null,
          releasesHoldId: null,
        }),
      ),
    ].join("\n");
    const movementSql = [
      sqlOf(
        insertTrustMovementStatement(stub, {
          id: MOVEMENT_ID,
          trustAccountId: TRUST_ACCOUNT_ID,
          kind: "deposit",
          nodeId: NODE_ID,
          counterpartyNodeId: null,
          amountMinor: 1,
          currency: "USD",
          entryId: ENTRY_ID,
          method: "check",
          reference: null,
          counterpartyName: "source",
          purpose: "p",
          recordedBy: "user_x" as never,
          authorizedBy: null,
          effectiveDate: "2026-08-05",
          recordedAt: "t",
        }),
      ),
      sqlOf(selectTrustMovementStatement(stub, MOVEMENT_ID)),
      sqlOf(selectTrustMovementsForNodeStatement(stub, NODE_ID)),
    ].join("\n");
    const transferSql = sqlOf(
      insertTrustTransferStatement(stub, {
        id: TRANSFER_ID,
        trustAccountId: TRUST_ACCOUNT_ID,
        fromNodeId: NODE_ID,
        amountMinor: 1,
        currency: "USD",
        trustEntryId: ENTRY_ID,
        operatingEntryId: ENTRY_ID,
        authorizedBy: null,
        effectiveDate: "2026-08-05",
        recordedAt: "t",
      }),
    );

    expectOnlyKnownIdentifiers(
      accountSql,
      new Set([TRUST_ACCOUNT_TABLE, ...columnsOf(trustAccount)]),
      "trust account",
    );
    expectOnlyKnownIdentifiers(
      nodeSql,
      new Set([TRUST_LEDGER_NODE_TABLE, ...columnsOf(trustLedgerNode)]),
      "trust ledger node",
    );
    expectOnlyKnownIdentifiers(
      holdSql,
      new Set([TRUST_HOLD_TABLE, ...columnsOf(trustHold)]),
      "trust hold",
    );
    expectOnlyKnownIdentifiers(
      transferSql,
      new Set([TRUST_TRANSFER_TABLE, ...columnsOf(trustTransfer)]),
      "trust transfer",
    );
    expectOnlyKnownIdentifiers(
      movementSql,
      new Set([TRUST_MOVEMENT_TABLE, ...columnsOf(trustMovement)]),
      "trust movement",
    );
  });

  it("the cross-table reads name only schema identifiers and their own aliases", () => {
    const stub = stubDatabase();
    const readSql = [
      sqlOf(selectTrustAccountRolesStatement(stub, [LEDGER_ACCOUNT_ID])),
      sqlOf(selectTrustHoldStatement(stub, HOLD_ID)),
      sqlOf(selectTrustAvailableBalanceStatement(stub, NODE_ID)),
      sqlOf(selectMatterTrustPositionsStatement(stub, "matter_x" as never)),
      sqlOf(refuseMatterCloseWithTrustBalanceStatement(stub, "matter_x" as never)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      readSql,
      new Set([
        TRUST_ACCOUNT_TABLE,
        TRUST_LEDGER_NODE_TABLE,
        TRUST_HOLD_TABLE,
        "account_balance",
        // Aliases and computed output names.
        "a",
        "b",
        "h",
        "n",
        "p",
        "r",
        "role",
        "node_id",
        "node_kind",
        "released_by_hold_id",
        "held_minor",
        "trust_account_name",
        ...columnsOf(trustAccount),
        ...columnsOf(trustLedgerNode),
        ...columnsOf(trustHold),
        ...columnsOf(accountBalance),
      ]),
      "trust reads",
    );
  });

  it("the fitness queries name only schema identifiers and their own aliases", () => {
    const stub = stubDatabase();
    const fitnessSql = [
      sqlOf(commingledTrustEntriesStatement(stub)),
      sqlOf(multiClientTrustEntriesStatement(stub)),
      sqlOf(trustLeavesWithoutZeroFloorStatement(stub)),
      sqlOf(trustRollupNodesWithPostingsStatement(stub)),
      sqlOf(trustHoldsExceedingBalanceStatement(stub)),
      sqlOf(trustMovementsDisagreeingWithLedgerStatement(stub)),
      sqlOf(trustTransfersMissingCounterpartyLineStatement(stub)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      fitnessSql,
      new Set([
        TRUST_ACCOUNT_TABLE,
        TRUST_LEDGER_NODE_TABLE,
        TRUST_HOLD_TABLE,
        TRUST_MOVEMENT_TABLE,
        "ledger_line",
        "account_balance",
        "a",
        "b",
        "h",
        "l",
        "m",
        "m2",
        "n",
        "o",
        "p",
        "r",
        "v",
        "account_id",
        "trust_account_id",
        "entry_id",
        "clients",
        "node_id",
        "movement_id",
        "held_minor",
        ...columnsOf(trustAccount),
        ...columnsOf(trustLedgerNode),
        ...columnsOf(trustHold),
        ...columnsOf(trustMovement),
        ...columnsOf(ledgerLine),
        ...columnsOf(accountBalance),
      ]),
      "trust fitness",
    );
  });

  it("assertTrustFitness runs every query it declares", async () => {
    const stub = stubDatabase();
    await expect(assertTrustFitness(stub)).resolves.toBeUndefined();
  });
});
