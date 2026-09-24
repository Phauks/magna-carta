// @repo-wide-fitness scope=schema — the statements are here, the tables and permissions they name
// are in packages/database and packages/access-control, so a rename lands outside this package.
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { PERMISSIONS } from "@magna-carta/access-control/registry";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  accountBalance,
  directGrant,
  ledgerEntry,
  ledgerLine,
  location,
  matter,
  matterParty,
  member,
  memberRole,
  rolePermission,
  trustAccount,
  trustBankStatement,
  trustBankStatementLine,
  trustDisbursementDecision,
  trustDisbursementRequest,
  trustHold,
  trustLedgerNode,
  trustMovement,
  trustReconciliation,
  trustReconciliationMatch,
  trustTransfer,
} from "@magna-carta/database/per-firm-schema";
import { describe, expect, it } from "vitest";
import {
  assertTrustFitness,
  commingledTrustEntriesStatement,
  multiClientTrustEntriesStatement,
  trustHoldsExceedingBalanceStatement,
  trustLeavesWithoutZeroFloorStatement,
  trustMatterNodesMisattributedStatement,
  trustMovementsDisagreeingWithLedgerStatement,
  trustReconciliationDoubleMatchesStatement,
  trustReconciliationMatchesOffStatementStatement,
  trustReconciliationsCrossingAccountsStatement,
  trustReconciliationsWithIncoherentProofStatement,
  trustRollupNodesWithPostingsStatement,
  trustTransfersMissingCounterpartyLineStatement,
} from "../src/fitness.ts";
import {
  TRUST_ACCOUNT_TABLE,
  TRUST_BANK_STATEMENT_LINE_TABLE,
  TRUST_BANK_STATEMENT_TABLE,
  TRUST_DISBURSEMENT_DECISION_TABLE,
  TRUST_DISBURSEMENT_REQUEST_TABLE,
  TRUST_HOLD_TABLE,
  TRUST_LEDGER_NODE_TABLE,
  TRUST_MANAGE_PERMISSION,
  TRUST_MOVEMENT_TABLE,
  TRUST_RECONCILIATION_MATCH_TABLE,
  TRUST_RECONCILIATION_TABLE,
  TRUST_TRANSFER_TABLE,
  closeTrustReconciliationStatement,
  insertTrustAccountStatement,
  insertTrustBankStatementLineStatement,
  insertTrustBankStatementStatement,
  insertTrustDisbursementDecisionStatement,
  insertTrustDisbursementRequestStatement,
  insertTrustHoldStatement,
  insertTrustLedgerNodeStatement,
  insertTrustMovementStatement,
  insertTrustReconciliationMatchStatement,
  insertTrustReconciliationStatement,
  insertTrustTransferStatement,
  refuseMatterCloseWithTrustBalanceStatement,
  selectActiveTrustManagersStatement,
  selectActiveTrustReconciliationMatchesStatement,
  selectPendingTrustDisbursementRequestCountStatement,
  selectMatterTrustPositionsStatement,
  selectOutstandingTrustBankItemsStatement,
  selectPendingTrustDisbursementRequestsStatement,
  selectTrustAccountHeldTotalStatement,
  selectTrustAccountRolesStatement,
  selectTrustAccountStatement,
  selectTrustAccountTimeZoneStatement,
  selectTrustAvailableBalanceStatement,
  selectTrustBankStatementLinesStatement,
  selectTrustBankStatementStatement,
  selectTrustBankStatementsForAccountStatement,
  selectTrustBookBalanceAsOfStatement,
  selectTrustClientLedgerTotalAsOfStatement,
  selectTrustClientNodeStatement,
  selectTrustDisbursementRequestStatement,
  selectTrustHoldStatement,
  selectTrustMatterLedgerCountStatement,
  selectTrustMatterNodeStatement,
  selectTrustMovementStatement,
  selectTrustMovementsForNodeStatement,
  selectTrustNodeStatement,
  selectTrustReconciliationMatchesStatement,
  selectTrustReconciliationStatement,
  selectTrustReconciliationsForAccountStatement,
  selectUnmatchedTrustBankStatementLinesStatement,
} from "../src/statements.ts";
import {
  TRUST_BANK_STATEMENT_LINE_DIRECTIONS,
  TRUST_BANK_STATEMENT_SOURCES,
  TRUST_DISBURSEMENT_AUTHORIZATION_BASES,
  TRUST_DISBURSEMENT_DECISIONS,
  TRUST_DISBURSEMENT_METHODS,
  TRUST_MOVEMENT_KINDS,
  TRUST_MOVEMENT_METHODS,
  TRUST_NODE_KINDS,
  TRUST_RECONCILIATION_STATUSES,
} from "../src/types.ts";

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
const REQUEST_ID = "trustDisbursementRequest_x" as never;
const DECISION_ID = "trustDisbursementDecision_x" as never;
const LEDGER_ACCOUNT_ID = "ledgerAccount_x" as never;
const ENTRY_ID = "ledgerEntry_x" as never;
const STATEMENT_ID = "trustBankStatement_x" as never;
const STATEMENT_LINE_ID = "trustBankStatementLine_x" as never;
const RECONCILIATION_ID = "trustReconciliation_x" as never;
const MATCH_ID = "trustReconciliationMatch_x" as never;

describe("schema name sync (trust SQL pinned to @magna-carta/database)", () => {
  it("table names match the drizzle schema", () => {
    expect(getTableConfig(trustAccount).name).toBe(TRUST_ACCOUNT_TABLE);
    expect(getTableConfig(trustLedgerNode).name).toBe(TRUST_LEDGER_NODE_TABLE);
    expect(getTableConfig(trustHold).name).toBe(TRUST_HOLD_TABLE);
    expect(getTableConfig(trustTransfer).name).toBe(TRUST_TRANSFER_TABLE);
    expect(getTableConfig(trustMovement).name).toBe(TRUST_MOVEMENT_TABLE);
    expect(getTableConfig(trustDisbursementRequest).name).toBe(TRUST_DISBURSEMENT_REQUEST_TABLE);
    expect(getTableConfig(trustDisbursementDecision).name).toBe(TRUST_DISBURSEMENT_DECISION_TABLE);
    expect(getTableConfig(trustBankStatement).name).toBe(TRUST_BANK_STATEMENT_TABLE);
    expect(getTableConfig(trustBankStatementLine).name).toBe(TRUST_BANK_STATEMENT_LINE_TABLE);
    expect(getTableConfig(trustReconciliation).name).toBe(TRUST_RECONCILIATION_TABLE);
    expect(getTableConfig(trustReconciliationMatch).name).toBe(TRUST_RECONCILIATION_MATCH_TABLE);
  });

  it("the reconciliation vocabularies match the drizzle enums", () => {
    expect(
      getTableConfig(trustBankStatement).columns.find((column) => column.name === "source")
        ?.enumValues,
    ).toEqual([...TRUST_BANK_STATEMENT_SOURCES]);
    expect(
      getTableConfig(trustBankStatementLine).columns.find((column) => column.name === "direction")
        ?.enumValues,
    ).toEqual([...TRUST_BANK_STATEMENT_LINE_DIRECTIONS]);
    expect(
      getTableConfig(trustReconciliation).columns.find((column) => column.name === "status")
        ?.enumValues,
    ).toEqual([...TRUST_RECONCILIATION_STATUSES]);
  });

  // The sole-authorizer trigger in the per-firm migration counts members by this literal, and a
  // permission key that no longer exists would make the exception silently available to every firm.
  it("TRUST_MANAGE_PERMISSION is a key the permission registry issues", () => {
    expect(PERMISSIONS as readonly string[]).toContain(TRUST_MANAGE_PERMISSION);
  });

  it("the disbursement-authorization vocabularies match the drizzle enums", () => {
    const requestColumns = getTableConfig(trustDisbursementRequest).columns;
    expect(requestColumns.find((column) => column.name === "method")?.enumValues).toEqual([
      ...TRUST_DISBURSEMENT_METHODS,
    ]);
    const decisionColumns = getTableConfig(trustDisbursementDecision).columns;
    expect(decisionColumns.find((column) => column.name === "decision")?.enumValues).toEqual([
      ...TRUST_DISBURSEMENT_DECISIONS,
    ]);
    expect(
      decisionColumns.find((column) => column.name === "authorization_basis")?.enumValues,
    ).toEqual([...TRUST_DISBURSEMENT_AUTHORIZATION_BASES]);
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
    ].join("\n");
    const authorizationSql = [
      sqlOf(
        insertTrustDisbursementRequestStatement(stub, {
          id: REQUEST_ID,
          trustAccountId: TRUST_ACCOUNT_ID,
          nodeId: NODE_ID,
          amountMinor: 1,
          currency: "USD",
          method: "check",
          reference: null,
          payee: "payee",
          purpose: "p",
          description: "d",
          effectiveDate: "2026-08-05",
          requestedBy: "user_x" as never,
          requestedAt: "t",
          kind: "disbursement",
          operatingDescription: null,
          policyId: null,
        }),
      ),
      sqlOf(
        insertTrustDisbursementDecisionStatement(stub, {
          id: DECISION_ID,
          requestId: REQUEST_ID,
          decision: "approved",
          decidedBy: "user_y" as never,
          decidedAt: "t",
          reason: null,
          authorizationBasis: "second_person",
          movementId: MOVEMENT_ID,
          transferId: null,
        }),
      ),
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
        authorizedBy: "user_y" as never,
        recordedBy: "user_x" as never,
        policyId: null,
        approvedRequestId: null,
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
    expectOnlyKnownIdentifiers(
      authorizationSql,
      new Set([
        TRUST_DISBURSEMENT_REQUEST_TABLE,
        TRUST_DISBURSEMENT_DECISION_TABLE,
        ...columnsOf(trustDisbursementRequest),
        ...columnsOf(trustDisbursementDecision),
      ]),
      "trust disbursement authorization",
    );

    const reconciliationSql = [
      sqlOf(
        insertTrustBankStatementStatement(stub, {
          id: STATEMENT_ID,
          trustAccountId: TRUST_ACCOUNT_ID,
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          openingBalanceMinor: 0,
          closingBalanceMinor: -1,
          currency: "USD",
          statementReference: null,
          source: "entered",
          supersedesStatementId: null,
          recordedBy: "user_x" as never,
          recordedAt: "t",
        }),
      ),
      sqlOf(
        insertTrustBankStatementLineStatement(stub, {
          id: STATEMENT_LINE_ID,
          statementId: STATEMENT_ID,
          postedOn: "2026-08-05",
          direction: "deposit",
          amountMinor: 1,
          description: "d",
          reference: null,
          counterpartyName: null,
          sourceRowNumber: null,
          recordedAt: "t",
        }),
      ),
      sqlOf(
        insertTrustReconciliationStatement(stub, {
          id: RECONCILIATION_ID,
          trustAccountId: TRUST_ACCOUNT_ID,
          statementId: STATEMENT_ID,
          openedBy: "user_x" as never,
          openedAt: "t",
          supersedesReconciliationId: null,
          note: null,
        }),
      ),
      sqlOf(
        closeTrustReconciliationStatement(
          stub,
          RECONCILIATION_ID,
          {
            statementClosingMinor: 1,
            outstandingDepositsMinor: 0,
            outstandingDisbursementsMinor: 0,
            adjustedBankMinor: 1,
            bookBalanceMinor: 1,
            clientLedgerTotalMinor: 1,
            unmatchedLineCount: 0,
            unmatchedItemCount: 0,
            firmFundsMinor: 0,
            balanced: true,
          },
          "user_x" as never,
          "t",
        ),
      ),
      sqlOf(
        insertTrustReconciliationMatchStatement(stub, {
          id: MATCH_ID,
          reconciliationId: RECONCILIATION_ID,
          statementLineId: STATEMENT_LINE_ID,
          entryId: ENTRY_ID,
          unmatchesMatchId: null,
          matchedBy: "user_x" as never,
          matchedAt: "t",
        }),
      ),
      sqlOf(selectTrustBankStatementStatement(stub, STATEMENT_ID)),
      sqlOf(selectTrustBankStatementsForAccountStatement(stub, TRUST_ACCOUNT_ID)),
      sqlOf(selectTrustBankStatementLinesStatement(stub, STATEMENT_ID)),
      sqlOf(selectTrustReconciliationStatement(stub, RECONCILIATION_ID)),
      sqlOf(selectTrustReconciliationsForAccountStatement(stub, TRUST_ACCOUNT_ID)),
    ].join("\n");

    expectOnlyKnownIdentifiers(
      reconciliationSql,
      new Set([
        TRUST_BANK_STATEMENT_TABLE,
        TRUST_BANK_STATEMENT_LINE_TABLE,
        TRUST_RECONCILIATION_TABLE,
        TRUST_RECONCILIATION_MATCH_TABLE,
        "l",
        ...columnsOf(trustBankStatement),
        ...columnsOf(trustBankStatementLine),
        ...columnsOf(trustReconciliation),
        ...columnsOf(trustReconciliationMatch),
      ]),
      "trust reconciliation",
    );
  });

  // The proof's three reads reach into the LEDGER — the only place this package computes an as-of
  // total from lines rather than from a stored balance — so they are pinned against the ledger
  // schema as well as the trust one.
  it("the proof reads name only schema identifiers and their own aliases", () => {
    const stub = stubDatabase();
    const proofSql = [
      sqlOf(selectTrustBookBalanceAsOfStatement(stub, LEDGER_ACCOUNT_ID, "2026-08-31")),
      sqlOf(selectTrustClientLedgerTotalAsOfStatement(stub, TRUST_ACCOUNT_ID, "2026-08-31")),
      sqlOf(selectOutstandingTrustBankItemsStatement(stub, LEDGER_ACCOUNT_ID, "2026-08-31")),
      sqlOf(selectUnmatchedTrustBankStatementLinesStatement(stub, RECONCILIATION_ID, STATEMENT_ID)),
      sqlOf(selectActiveTrustReconciliationMatchesStatement(stub, RECONCILIATION_ID)),
      sqlOf(selectTrustReconciliationMatchesStatement(stub, RECONCILIATION_ID, LEDGER_ACCOUNT_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      proofSql,
      new Set([
        TRUST_ACCOUNT_TABLE,
        TRUST_LEDGER_NODE_TABLE,
        TRUST_MOVEMENT_TABLE,
        TRUST_TRANSFER_TABLE,
        TRUST_BANK_STATEMENT_LINE_TABLE,
        TRUST_RECONCILIATION_TABLE,
        TRUST_RECONCILIATION_MATCH_TABLE,
        "ledger_entry",
        "ledger_line",
        // Aliases and computed output names.
        "bl",
        "e",
        "l",
        "m",
        "n",
        "s",
        "t",
        "w",
        "x",
        "balance_minor",
        "total_minor",
        "bank_delta_minor",
        "entry_id",
        "movement_id",
        "movement_kind",
        "transfer_id",
        "unmatched_by_match_id",
        "withdrawn_by",
        "withdrawn_at",
        "line_id",
        "line_statement_id",
        "line_posted_on",
        "line_direction",
        "line_amount_minor",
        "line_description",
        "line_reference",
        "line_counterparty_name",
        "line_source_row_number",
        ...columnsOf(trustLedgerNode),
        ...columnsOf(trustMovement),
        ...columnsOf(trustTransfer),
        ...columnsOf(trustBankStatementLine),
        ...columnsOf(trustReconciliation),
        ...columnsOf(trustReconciliationMatch),
        ...columnsOf(ledgerEntry),
        ...columnsOf(ledgerLine),
      ]),
      "trust proof reads",
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
      sqlOf(selectTrustMovementsForNodeStatement(stub, NODE_ID)),
      sqlOf(selectTrustDisbursementRequestStatement(stub, REQUEST_ID)),
      sqlOf(selectPendingTrustDisbursementRequestsStatement(stub, TRUST_ACCOUNT_ID)),
      sqlOf(selectPendingTrustDisbursementRequestCountStatement(stub, TRUST_ACCOUNT_ID)),
      sqlOf(selectTrustAccountHeldTotalStatement(stub, TRUST_ACCOUNT_ID)),
      sqlOf(selectTrustMatterLedgerCountStatement(stub, TRUST_ACCOUNT_ID)),
      sqlOf(selectTrustAccountTimeZoneStatement(stub, TRUST_ACCOUNT_ID)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      readSql,
      new Set([
        TRUST_ACCOUNT_TABLE,
        TRUST_LEDGER_NODE_TABLE,
        TRUST_HOLD_TABLE,
        TRUST_MOVEMENT_TABLE,
        TRUST_DISBURSEMENT_REQUEST_TABLE,
        TRUST_DISBURSEMENT_DECISION_TABLE,
        "account_balance",
        // The two tables the trust reads reach for a caption rather than for a money fact: the
        // matter a queued request would leave, and the office whose zone a day resolves in.
        "matter",
        "location",
        // Aliases and computed output names.
        "a",
        "b",
        "d",
        "h",
        "l",
        "m",
        "mt",
        "n",
        "p",
        "r",
        "role",
        "node_id",
        "node_kind",
        "released_by_hold_id",
        "held_minor",
        "trust_account_name",
        "decision_id",
        "disbursement_request_id",
        "matter_title",
        "location_time_zone",
        "row_count",
        "total_minor",
        ...columnsOf(trustAccount),
        ...columnsOf(trustLedgerNode),
        ...columnsOf(trustHold),
        ...columnsOf(trustMovement),
        ...columnsOf(trustDisbursementRequest),
        ...columnsOf(trustDisbursementDecision),
        ...columnsOf(accountBalance),
        ...columnsOf(matter),
        ...columnsOf(location),
      ]),
      "trust reads",
    );
  });

  // The sole-authorizer read reaches OUTSIDE the trust tables, into the per-firm RBAC rows, which
  // is the one place this package does that. Pinned here for the same reason as everything else in
  // this suite: a rename over there must fail in this test rather than at a firm's approval.
  it("the trust-manager read names only the RBAC schema identifiers and its own aliases", () => {
    expectOnlyKnownIdentifiers(
      sqlOf(selectActiveTrustManagersStatement(stubDatabase())),
      new Set([
        "member",
        "member_role",
        "role_permission",
        "direct_grant",
        "dg",
        "m",
        "mr",
        "rp",
        "user_id",
        ...columnsOf(member),
        ...columnsOf(memberRole),
        ...columnsOf(rolePermission),
        ...columnsOf(directGrant),
      ]),
      "trust manager read",
    );
  });

  it("the fitness queries name only schema identifiers and their own aliases", () => {
    const stub = stubDatabase();
    const fitnessSql = [
      sqlOf(commingledTrustEntriesStatement(stub)),
      sqlOf(multiClientTrustEntriesStatement(stub)),
      sqlOf(trustMatterNodesMisattributedStatement(stub)),
      sqlOf(trustLeavesWithoutZeroFloorStatement(stub)),
      sqlOf(trustRollupNodesWithPostingsStatement(stub)),
      sqlOf(trustHoldsExceedingBalanceStatement(stub)),
      sqlOf(trustMovementsDisagreeingWithLedgerStatement(stub)),
      sqlOf(trustTransfersMissingCounterpartyLineStatement(stub)),
      sqlOf(trustReconciliationDoubleMatchesStatement(stub)),
      sqlOf(trustReconciliationMatchesOffStatementStatement(stub)),
      sqlOf(trustReconciliationsWithIncoherentProofStatement(stub)),
      sqlOf(trustReconciliationsCrossingAccountsStatement(stub)),
    ].join("\n");
    expectOnlyKnownIdentifiers(
      fitnessSql,
      new Set([
        TRUST_ACCOUNT_TABLE,
        TRUST_LEDGER_NODE_TABLE,
        TRUST_HOLD_TABLE,
        TRUST_MOVEMENT_TABLE,
        TRUST_BANK_STATEMENT_TABLE,
        TRUST_BANK_STATEMENT_LINE_TABLE,
        TRUST_RECONCILIATION_TABLE,
        TRUST_RECONCILIATION_MATCH_TABLE,
        "ledger_line",
        "account_balance",
        "matter_party",
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
        "s",
        "v",
        "w",
        "x",
        "account_id",
        "trust_account_id",
        "entry_id",
        "clients",
        "node_id",
        "movement_id",
        "match_id",
        "matched_key",
        "matches",
        "reconciliation_id",
        "side",
        "held_minor",
        ...columnsOf(trustAccount),
        ...columnsOf(trustLedgerNode),
        ...columnsOf(trustHold),
        ...columnsOf(trustMovement),
        ...columnsOf(trustBankStatement),
        ...columnsOf(trustBankStatementLine),
        ...columnsOf(trustReconciliation),
        ...columnsOf(trustReconciliationMatch),
        ...columnsOf(ledgerLine),
        ...columnsOf(accountBalance),
        ...columnsOf(matterParty),
      ]),
      "trust fitness",
    );
  });

  it("assertTrustFitness runs every query it declares", async () => {
    const stub = stubDatabase();
    await expect(assertTrustFitness(stub)).resolves.toBeUndefined();
  });
});
