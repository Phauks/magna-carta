import type { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import {
  COST_ENTRY_TABLE,
  selectCostEntryStatement,
  selectMatterEBillingStatement,
} from "@magna-carta/costs/cost-entry-statements";
import { explainStatement, type LabeledPlan } from "./runner.ts";
import type { CostProbes } from "./costs-generate.ts";

// The costs volume-shaped plan set: the per-matter unbilled-cost read (the billing query), the by-id
// lifecycle-guard read, the matter e-billing-flag read, and the recovery dedup lookup — each riding the
// REAL query SQL, so the index walks are on the clock. The cost depends on the data SHAPE the costs
// generator laid down — matters carrying a disbursement backlog with a billed/void tail and a slice of
// recovery entries.

export interface CostsMeasurementHandle {
  readonly database: SqlDatabase; // D1-shaped — builds the statements the EXPLAIN probes run
  readonly raw: DatabaseSync; // the node:sqlite escape hatch EXPLAIN QUERY PLAN runs against
  readonly probes: CostProbes;
}

// No cost read is a table-wide aggregate — each must walk an index or the primary key. The allowlist
// is empty (kept as the explicit seam a future table-wide rollup would register through).
export const COSTS_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// Recover the runtime node-sqlite shape so the EXPLAIN probes run the REAL query SQL (the statement
// builders type their return as the narrower D1-shaped SqlStatement, which omits sql/bindings).
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

// Per-matter unbilled WIP — the billing read. Sums the amount over draft/submitted/approved (anything
// not yet billed and not void) for one matter, driven by the (matter_id, status) index. The cost
// service has no list query yet, so the SQL is reproduced here bound to the same parameters; a failing
// EXPLAIN on a populated snapshot catches any drift once the query is built.
function unbilledByMatterStatement(database: SqlDatabase, matterId: string): SqlStatement {
  return database
    .prepare(
      `SELECT matter_id,
         COALESCE(SUM(amount_minor), 0) AS unbilled_amount_minor,
         COUNT(*) AS entry_count
       FROM ${COST_ENTRY_TABLE}
       WHERE matter_id = ?1 AND status NOT IN ('billed', 'void')
       GROUP BY matter_id`,
    )
    .bind(matterId);
}

// The recovery dedup lookup — a redelivered cost-recovery event re-derives the same recovery_ref, so
// the consumer's idempotency floor is a point lookup on the partial-unique index. Reproduced here (the
// floor is enforced by the unique index on INSERT, with no standalone read in the service yet).
function recoveryRefLookupStatement(database: SqlDatabase, recoveryRef: string): SqlStatement {
  return database
    .prepare(`SELECT id FROM ${COST_ENTRY_TABLE} WHERE recovery_ref = ?1`)
    .bind(recoveryRef);
}

export function costsHotPathPlans(handle: CostsMeasurementHandle): LabeledPlan[] {
  const { database, raw, probes } = handle;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "unbilled-cost.by-matter",
      statement: capturedStatement(unbilledByMatterStatement(database, probes.busiestMatterId)),
    },
    {
      label: "cost-entry.by-id",
      statement: capturedStatement(selectCostEntryStatement(database, probes.probeCostEntryId)),
    },
    {
      label: "matter.e-billing-flag",
      statement: capturedStatement(selectMatterEBillingStatement(database, probes.busiestMatterId)),
    },
    {
      label: "cost-recovery.dedup-by-ref",
      statement: capturedStatement(recoveryRefLookupStatement(database, probes.probeRecoveryRef)),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(raw, statement.sql, statement.bindings),
  }));
}
