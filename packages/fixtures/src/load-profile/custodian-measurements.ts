import type { SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { NodeSqlStatement } from "@magna-carta/database/node-sqlite";
import {
  readCustodyLocationOccupancy,
  readCustodyLocationSubtreeIds,
  selectCustodyLocationOccupancyStatement,
  selectCustodyLocationSubtreeStatement,
} from "@magna-carta/custodian/location-statements";
import {
  readCustodyMovements,
  selectCustodyMovementsStatement,
} from "@magna-carta/custodian/movement-statements";
import { createCustodyPacket } from "@magna-carta/custodian/packet-service";
import {
  readCustodyItems,
  readCustodyOwners,
  readCustodyPacket,
  selectCustodyItemsStatement,
  selectCustodyOwnersStatement,
  selectCustodyPacketStatement,
} from "@magna-carta/custodian/packet-statements";
import {
  readActiveCustodyHolds,
  selectActiveCustodyHoldsStatement,
} from "@magna-carta/custodian/hold-statements";
import {
  listCustodyPackets,
  listCustodyPacketsStatement,
  readOverdueCustodyCheckouts,
  selectOverdueCustodyCheckoutsStatement,
} from "@magna-carta/custodian/queries";
import {
  readCustodyReviewsDue,
  selectCustodyReviewsDueStatement,
} from "@magna-carta/custodian/review-statements";
import { fixtureContext, type FixtureContext } from "../context.ts";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";

// The custody volume-shaped measured set: the six operations the subsystem's design names, plus the
// reviews-due read that shares the reminder emission point with the overdue sweep.
//
//   1. the REGISTER LIST filtered by owner entity across the whole packet corpus — the register's
//      primary filter, "everything this firm holds for one person";
//   2. the REGISTER LIST filtered by LOCATION SUBTREE — the recursive walk, and the one read in this
//      subsystem with a genuinely non-obvious plan. The subtree is expanded ONCE per request and
//      passed down as a value list; recomputing it per row is the N+1 this subsystem is most likely
//      to grow, so the subtree walk is ALSO measured on its own below;
//   3. the PACKET DETAIL read — packet, items, owners, holds, and the current location path, which is
//      five reads whose total is what a person waits for;
//   4. the OVERDUE CHECK-OUT SWEEP across every open check-out — the operational signal the register
//      exists to produce, and the read whose correlated most-recent-check-out sub-select is the
//      likeliest thing here to grow with the ledger rather than with the answer;
//   5. a packet's MOVEMENT HISTORY at the TAIL of the distribution, keyset-paginated, taken at a real
//      second-page cursor rather than at the head. The ledger is the only table in this subsystem
//      that grows without bound, so this is the read that has to stay flat as a packet ages;
//   6. a CUSTODY NUMBER DRAW, which is the counter read plus the guarded increment plus the
//      allocation claim, on the same footing the matters counter draw is measured on.
//
// Everything heavier is off the request path by design (reminder evaluation, destruction eligibility,
// any read of scan bytes), so none of it is measured here — measuring it would imply it belonged.

export interface CustodianMeasurementHandle {
  readonly snapshot: LoadedSnapshot;
  // A DIFFERENT seed from generation: replaying the generation seed would mint the identifier
  // sequence the snapshot already contains, so the first measured write would collide on a primary
  // key rather than measure anything.
  readonly context: FixtureContext;
}

export function custodianMeasurementHandle(
  snapshot: LoadedSnapshot,
  seed: string,
): CustodianMeasurementHandle {
  return { snapshot, context: fixtureContext(`${seed}:measure`) };
}

// The register's default page, and the sweep's batch cap — the same numbers the reads take in
// production, so a measured cost is one real page rather than an arbitrary slice.
const REGISTER_PAGE_SIZE = 50;
const SWEEP_BATCH = 100;
const HISTORY_PAGE_SIZE = 50;

// The packet detail surface: everything a person opening one packet sees. It is composed here rather
// than in the custodian package because no single detail reader exists there — the route assembles it
// — so this is the measurement of the ASSEMBLY, which is the thing whose cost a person experiences.
async function readPacketDetail(handle: CustodianMeasurementHandle): Promise<void> {
  const { database } = handle.snapshot;
  const { custodianProbes } = handle.snapshot.manifest;
  const packetId = custodianProbes.deepHistoryPacketId;
  const packet = await readCustodyPacket(database, packetId);
  await Promise.all([
    readCustodyItems(database, packetId),
    readCustodyOwners(database, packetId),
    readActiveCustodyHolds(database, packetId),
  ]);
  // The breadcrumb: how many shelves up from where the packet sits to the root it hangs off. Resolved
  // through the subtree read from the packet's own node, which is the same walk the location surface
  // makes — a packet that is checked out has no location at all, and that is a real shape.
  if (packet?.current_location_id != null) {
    await readCustodyLocationSubtreeIds(database, packet.current_location_id);
  }
}

export const custodianMeasurements: readonly Measurement<CustodianMeasurementHandle, unknown>[] = [
  {
    name: "custody-register.by-owner",
    operation: async (handle) => {
      await listCustodyPackets(handle.snapshot.database, {
        ownerEntityId: handle.snapshot.manifest.custodianProbes.busiestOwnerEntityId,
        pageSize: REGISTER_PAGE_SIZE,
      });
    },
  },
  {
    name: "custody-register.by-location-subtree",
    operation: async (handle) => {
      // The whole read, subtree expansion included — which is the honest unit, because the expansion
      // is what the filter costs and the list is what it buys.
      await listCustodyPackets(handle.snapshot.database, {
        locationSubtreeId: handle.snapshot.manifest.custodianProbes.subtreeRootLocationId,
        pageSize: REGISTER_PAGE_SIZE,
      });
    },
  },
  {
    name: "custody-location.subtree-walk",
    operation: async (handle) => {
      // The recursive walk on its own, from the root of the largest branch. Separated from the list
      // above so a regression in the walk is distinguishable from a regression in the list: the two
      // have different answers (a materialized path, a closure table) and the measurement is what
      // decides between them.
      await readCustodyLocationSubtreeIds(
        handle.snapshot.database,
        handle.snapshot.manifest.custodianProbes.subtreeRootLocationId,
      );
    },
  },
  {
    name: "custody-location.occupancy",
    operation: async (handle) => {
      // How many packets are physically present under one branch — the register report, and the read
      // the close path refuses on. Fans over the whole subtree's node list.
      const subtree = await readCustodyLocationSubtreeIds(
        handle.snapshot.database,
        handle.snapshot.manifest.custodianProbes.midTreeLocationId,
      );
      await readCustodyLocationOccupancy(handle.snapshot.database, subtree);
    },
  },
  {
    name: "custody-packet.detail",
    operation: async (handle) => {
      await readPacketDetail(handle);
    },
  },
  {
    name: "custody-overdue.sweep",
    operation: async (handle) => {
      await readOverdueCustodyCheckouts(
        handle.snapshot.database,
        handle.snapshot.manifest.custodianProbes.asOfDate,
        SWEEP_BATCH,
      );
    },
  },
  {
    name: "custody-reviews.due-sweep",
    operation: async (handle) => {
      // The other half of the one reminder emission point: packets and items whose review date has
      // arrived, over the two hand-written partial indexes.
      await readCustodyReviewsDue(
        handle.snapshot.database,
        handle.snapshot.manifest.custodianProbes.asOfDate,
        SWEEP_BATCH,
      );
    },
  },
  {
    name: "custody-history.deep-packet-page",
    operation: async (handle) => {
      const { custodianProbes } = handle.snapshot.manifest;
      // A page taken at a real keyset boundary rather than at the head: the whole claim keyset
      // pagination makes is that the second page costs what the first did, and a measurement that
      // only ever read the head could never see that claim fail.
      await readCustodyMovements(
        handle.snapshot.database,
        custodianProbes.deepHistoryPacketId,
        HISTORY_PAGE_SIZE,
        {
          occurredAt: custodianProbes.deepHistoryCursorOccurredAt,
          id: custodianProbes.deepHistoryCursorId,
        },
      );
    },
  },
  {
    name: "custody-number.counter-draw",
    operation: async (handle) => {
      const { custodianProbes } = handle.snapshot.manifest;
      // The draw is inseparable from the packet write it rides in: the counter read, the guarded
      // increment, the allocation claim, the packet row, its owner link, and the opening ledger entry
      // are one commit by construction. Measuring the draw alone would measure a thing the register
      // never does.
      const created = await createCustodyPacket(
        handle.snapshot.database,
        {
          name: "Load-profile measurement packet",
          owners: [{ entityId: custodianProbes.busiestOwnerEntityId }],
          currentLocationId: custodianProbes.intakeLocationId,
          matterId: custodianProbes.intakeMatterId,
        },
        {
          clock: handle.context.clock,
          actorUserId: custodianProbes.actorUserId,
          randomSource: handle.context.randomSource,
          responsibleMemberId: custodianProbes.actorUserId,
        },
      );
      if (created.packetId.length === 0) {
        throw new Error("load-profile: custody number draw produced no packet");
      }
    },
  },
];

// One entry, and it is not a table scan at all. A recursive common table expression plans as a
// co-routine over its OWN materialized rows, so its plan always carries `SCAN subtree` — the name of
// the recursion, not of a table. The two reads that touch `custody_location` inside it both seek:
// the anchor by primary key, and each recursive step through `custody_location_parent_index`. The
// scan detector cannot tell a recursion's working set from a table, so the exemption is declared here
// with the reason, and the seeks it is standing in front of are the thing to watch — if either of
// those ever stops being a seek, this label stops meaning what it means now.
export const CUSTODIAN_PLAN_SCAN_ALLOWLIST: readonly string[] = ["custody-location.subtree-walk"];

function capturedStatement(statement: SqlStatement): NodeSqlStatement {
  return statement as NodeSqlStatement;
}

export function custodianHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { custodianProbes } = snapshot.manifest;
  const database = snapshot.database;
  const statements: readonly { label: string; statement: NodeSqlStatement }[] = [
    {
      label: "custody-register.by-owner",
      statement: capturedStatement(
        listCustodyPacketsStatement(
          database,
          { ownerEntityId: custodianProbes.busiestOwnerEntityId },
          undefined,
          REGISTER_PAGE_SIZE + 1,
        ),
      ),
    },
    {
      // The list's second half: the subtree expanded to a value list, exactly as the read composes it
      // once per request. Probed with the REAL expansion rather than a hand-written id set, so a
      // change to how the subtree resolves changes this plan with it.
      label: "custody-register.by-location-subtree",
      statement: capturedStatement(
        listCustodyPacketsStatement(
          database,
          { locationIds: custodianProbes.subtreeLocationIds },
          undefined,
          REGISTER_PAGE_SIZE + 1,
        ),
      ),
    },
    {
      label: "custody-location.subtree-walk",
      statement: capturedStatement(
        selectCustodyLocationSubtreeStatement(database, custodianProbes.subtreeRootLocationId),
      ),
    },
    {
      label: "custody-location.occupancy",
      statement: capturedStatement(
        selectCustodyLocationOccupancyStatement(database, custodianProbes.subtreeLocationIds),
      ),
    },
    // The packet detail surface's four keyed reads, probed individually — a detail read that grew a
    // scan would grow it in exactly one of them, and a single combined probe could not say which.
    {
      label: "custody-packet.detail.packet",
      statement: capturedStatement(
        selectCustodyPacketStatement(database, custodianProbes.deepHistoryPacketId),
      ),
    },
    {
      label: "custody-packet.detail.items",
      statement: capturedStatement(
        selectCustodyItemsStatement(database, custodianProbes.deepHistoryPacketId),
      ),
    },
    {
      label: "custody-packet.detail.owners",
      statement: capturedStatement(
        selectCustodyOwnersStatement(database, custodianProbes.deepHistoryPacketId),
      ),
    },
    {
      label: "custody-packet.detail.holds",
      statement: capturedStatement(
        selectActiveCustodyHoldsStatement(database, custodianProbes.deepHistoryPacketId),
      ),
    },
    {
      label: "custody-overdue.sweep",
      statement: capturedStatement(
        selectOverdueCustodyCheckoutsStatement(database, custodianProbes.asOfDate, SWEEP_BATCH),
      ),
    },
    {
      label: "custody-reviews.due-sweep",
      statement: capturedStatement(
        selectCustodyReviewsDueStatement(database, custodianProbes.asOfDate, SWEEP_BATCH),
      ),
    },
    {
      label: "custody-history.deep-packet-page",
      statement: capturedStatement(
        selectCustodyMovementsStatement(
          database,
          custodianProbes.deepHistoryPacketId,
          HISTORY_PAGE_SIZE,
          {
            occurredAt: custodianProbes.deepHistoryCursorOccurredAt,
            id: custodianProbes.deepHistoryCursorId,
          },
        ),
      ),
    },
  ];
  return statements.map(({ label, statement }) => ({
    label,
    details: explainStatement(snapshot.raw, statement.sql, statement.bindings),
  }));
}
