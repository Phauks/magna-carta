import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import { readTrustAvailableBalance } from "@magna-carta/trust/holds";
import { assertTrustFitness } from "@magna-carta/trust/fitness";
import { readTrustMatchSuggestions } from "@magna-carta/trust/matching";
import { readTrustThreeWayProof } from "@magna-carta/trust/reconciliation";
import {
  selectOutstandingTrustBankItemsStatement,
  selectTrustBankStatementLinesStatement,
  selectTrustBookBalanceAsOfStatement,
  selectTrustClientLedgerTotalAsOfStatement,
  selectTrustMovementsForNodeStatement,
  selectTrustAvailableBalanceStatement,
  selectUnmatchedTrustBankStatementLinesStatement,
} from "@magna-carta/trust/statements";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The trust volume-shaped set. Everything here costs what it costs because of the SHAPE the trust
// generator laid down — a client ledger per matter that holds money, a couple of years of monthly
// statements, and one period left open whose proof is recomputed on every read.
//
// The three-way proof is the operation this stage exists for. It is four reads over the ledger and
// the reconciliation tables, and the two as-of totals are sums over `ledger_line` by account and
// effective date — the reads that would silently become table scans as a firm's book grows, which is
// why they carry EXPLAIN probes rather than only a stopwatch.

export interface TrustMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
}

export function trustMeasurementHandle(snapshot: LoadedSnapshot): TrustMeasurementHandle {
  return { snapshot };
}

// The fitness sweep is a table-wide aggregate by nature — it re-proves the invariants over every
// row, which is the point of it — so it is allowlisted by label. Every other read here must walk an
// index or the primary key.
export const TRUST_PLAN_SCAN_ALLOWLIST: readonly string[] = ["trust-fitness"];

// Recover the runtime node-sqlite shape so the EXPLAIN probes run the REAL query SQL (the statement
// builders type their return as the narrower D1-shaped SqlStatement, which omits sql/bindings).
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

export const trustMeasurements: readonly Measurement<TrustMeasurementHandle, unknown>[] = [
  {
    // THE reconciliation-relevant hot path: the whole three-way proof for the open period.
    name: "trust-proof.three-way",
    operation: async (handle) => {
      await readTrustThreeWayProof(
        handle.snapshot.database,
        handle.snapshot.manifest.trustProbes.openReconciliationId,
      );
    },
  },
  {
    // The matching surface a person works from: the unmatched lines, the outstanding items, and the
    // ranking between them. The ranking is in memory over two bounded reads, so what this measures
    // is whether those reads stay bounded as the book grows.
    name: "trust-match.suggestions",
    operation: async (handle) => {
      await readTrustMatchSuggestions(
        handle.snapshot.database,
        handle.snapshot.manifest.trustProbes.openReconciliationId,
      );
    },
  },
  {
    name: "trust-client-ledger.movements-by-node",
    operation: async (handle) => {
      await selectTrustMovementsForNodeStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.trustProbes.busiestNodeId,
      ).all();
    },
  },
  {
    name: "trust-available-balance.by-node",
    operation: async (handle) => {
      await readTrustAvailableBalance(
        handle.snapshot.database,
        handle.snapshot.manifest.trustProbes.busiestNodeId,
      );
    },
  },
  {
    name: "trust-fitness.table-wide",
    operation: async (handle) => {
      await assertTrustFitness(handle.snapshot.database);
    },
  },
];

export function trustHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const database: SqlDatabase = snapshot.database;
  const probes = snapshot.manifest.trustProbes;
  // Every period ends on or before the open reconciliation's statement period end; the exact date
  // only changes which rows the index walk returns, never whether it walks one.
  const asOfDate = snapshot.manifest.trustAsOfDate;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "trust-proof.book-balance-as-of",
      statement: capturedStatement(
        selectTrustBookBalanceAsOfStatement(database, probes.bankLedgerAccountId, asOfDate),
      ),
    },
    {
      label: "trust-proof.client-total-as-of",
      statement: capturedStatement(
        selectTrustClientLedgerTotalAsOfStatement(database, probes.trustAccountId, asOfDate),
      ),
    },
    {
      label: "trust-proof.outstanding-items",
      statement: capturedStatement(
        selectOutstandingTrustBankItemsStatement(database, probes.bankLedgerAccountId, asOfDate),
      ),
    },
    {
      label: "trust-proof.unmatched-lines",
      statement: capturedStatement(
        selectUnmatchedTrustBankStatementLinesStatement(
          database,
          probes.openReconciliationId,
          probes.probeStatementId,
        ),
      ),
    },
    {
      label: "trust-statement.lines-by-statement",
      statement: capturedStatement(
        selectTrustBankStatementLinesStatement(database, probes.probeStatementId),
      ),
    },
    {
      label: "trust-client-ledger.movements-by-node",
      statement: capturedStatement(
        selectTrustMovementsForNodeStatement(database, probes.busiestNodeId),
      ),
    },
    {
      label: "trust-available-balance.by-node",
      statement: capturedStatement(
        selectTrustAvailableBalanceStatement(database, probes.busiestNodeId),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
