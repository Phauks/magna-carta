import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import { listTrackingEventsStatement } from "@magna-carta/data-access/shipment-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import type { MattersMeasurementHandle } from "./matters-measurements.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The shipping volume-shaped measured set, on the matters/ledger-measurements pattern. Each
// operation's cost depends on the data SHAPE the shipping generator laid down — the per-matter
// shipment list (a matter's mailing history) and a shipment's full tracking history. Both must walk
// an index, never a full scan. The measurement handle is shared with the ledger/matters sets: its
// `${seed}:measure` context keeps any measured writes deterministic on a disjoint identifier stream.

// The per-matter shipment list a matter's shipping tab renders: newest-first, one page. Built inline
// here (the worker route has no list endpoint yet) but bound to the shipment_matter_ref_index.
function shipmentsByMatterStatement(snapshot: LoadedSnapshot, matterId: string): NodeSqlStatement {
  return snapshot.database
    .prepare(
      "SELECT id, status, tracking_code, carrier, service FROM shipment WHERE matter_ref = ?1 ORDER BY created_at DESC LIMIT 51",
    )
    .bind(matterId) as unknown as NodeSqlStatement;
}

export const shippingMeasurements: readonly Measurement<MattersMeasurementHandle, unknown>[] = [
  {
    name: "list-shipments.by-matter",
    operation: async (handle) => {
      await shipmentsByMatterStatement(
        handle.snapshot,
        handle.snapshot.manifest.shippingProbes.busiestMatterId,
      ).all();
    },
  },
  {
    name: "list-tracking-events.by-shipment",
    operation: async (handle) => {
      await listTrackingEventsStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.shippingProbes.multiEventShipmentId,
      ).all();
    },
  },
];

// Both plans walk an index (shipment_matter_ref_index, the tracking_event unique index on
// shipment_ref) — neither is allowlisted as a table-wide scan.
export const SHIPPING_PLAN_SCAN_ALLOWLIST: readonly string[] = [];

// Recover the runtime node-sqlite shape so the EXPLAIN probes run the REAL query SQL (the query
// builders type their return as the narrower D1-shaped SqlStatement, which omits sql/bindings).
function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

export function shippingHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { shippingProbes } = snapshot.manifest;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "list-shipments.by-matter",
      statement: shipmentsByMatterStatement(snapshot, shippingProbes.busiestMatterId),
    },
    {
      label: "list-tracking-events.by-shipment",
      statement: capturedStatement(
        listTrackingEventsStatement(snapshot.database, shippingProbes.multiEventShipmentId),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
