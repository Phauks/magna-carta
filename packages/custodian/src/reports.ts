import { DEFAULT_PAGE_SIZE } from "@magna-carta/data-access/cursor-pagination";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type {
  CustodyHoldId,
  CustodyItemId,
  CustodyLocationId,
  CustodyPacketId,
} from "@magna-carta/identifiers/types";
import { CUSTODY_HOLD_TABLE } from "./hold-statements.ts";
import { CUSTODY_LOCATION_TABLE } from "./location-statements.ts";
import {
  CUSTODY_ITEM_TABLE,
  CUSTODY_OWNER_TABLE,
  CUSTODY_PACKET_TABLE,
} from "./packet-statements.ts";
import type { CustodyHoldKind, CustodyLocationKind, CustodyLocationStatus } from "./types.ts";

// The register reports: what a firm holds, aggregated the three ways a person actually asks. Each is
// a fixed-shape aggregate over the whole register rather than a paginated list, because that is what
// the question is — "how many packets are in the Reno safe" has one answer, not a first page of one.
//
// Two rules hold across all of them. Every aggregate is ONE query (or, for the location tree, two:
// the nodes and the direct counts, assembled in memory) — the recursive subtree walk is never
// recomputed per row, which is the N+1 this subsystem is most likely to grow. And no report resolves
// a name: an owner is an entity handle the caller resolves through the Directory, because the
// register has no business duplicating the Directory's display rules, and a report that carried
// owner names would be a list of the most sensitive things a firm holds with the names attached.

// ---- holdings per owner ----

export interface CustodyHoldingsByOwner {
  readonly entityId: string;
  // Packets currently owned by this entity, by the packet's own status. `held` and `out` are what a
  // firm means by "we hold this"; a released or destroyed packet stays out of the counts entirely,
  // because the report answers "what do we hold for this person" and not "what did we ever hold".
  readonly packetsHeld: number;
  readonly packetsOut: number;
  readonly itemsDescribed: number;
  readonly packetsUnderHold: number;
}

export function selectCustodyHoldingsByOwnerStatement(
  database: SqlDatabase,
  limit: number,
): SqlStatement {
  return database
    .prepare(
      // ONE PASS, and the grain is what makes it one. The owner links are reduced to DISTINCT
      // (entity, packet) pairs first, and items and holds are each pre-aggregated per packet, so
      // every join below is one-to-one against that grain and no count can be inflated by a fan-out.
      //
      // The item count used to be a CORRELATED subquery over the owner links, which read correctly
      // and scaled wrongly: `LIMIT` applies after `GROUP BY`, so the subquery ran once for every
      // owner entity in the firm rather than once for the fifty rows returned, and a fixed-shape
      // report grew with the whole register while satisfying this file's one-query rule only
      // textually. Pre-aggregated and joined, the answer is identical and the plan does not.
      `SELECT owner.entity_id AS entity_id,
              COUNT(CASE WHEN packet.status = 'held' THEN 1 END) AS packets_held,
              COUNT(CASE WHEN packet.status = 'out' THEN 1 END) AS packets_out,
              COALESCE(SUM(packet_items.item_count), 0) AS items_described,
              COUNT(packet_holds.packet_id) AS packets_under_hold
         FROM (SELECT DISTINCT link.entity_id AS entity_id, link.packet_id AS packet_id
                 FROM ${CUSTODY_OWNER_TABLE} AS link
                WHERE link.effective_to IS NULL) AS owner
         JOIN ${CUSTODY_PACKET_TABLE} AS packet ON packet.id = owner.packet_id
         LEFT JOIN (SELECT item.packet_id AS packet_id, COUNT(*) AS item_count
                      FROM ${CUSTODY_ITEM_TABLE} AS item
                     WHERE item.status IN ('held', 'out')
                     GROUP BY item.packet_id) AS packet_items
                ON packet_items.packet_id = packet.id
         LEFT JOIN (SELECT hold.packet_id AS packet_id
                      FROM ${CUSTODY_HOLD_TABLE} AS hold
                     WHERE hold.released_at IS NULL
                     GROUP BY hold.packet_id) AS packet_holds
                ON packet_holds.packet_id = packet.id
        WHERE packet.status IN ('held', 'out')
        GROUP BY owner.entity_id
        ORDER BY packets_held DESC, packets_out DESC, owner.entity_id ASC
        LIMIT ?1`,
    )
    .bind(limit);
}

export async function readCustodyHoldingsByOwner(
  database: SqlDatabase,
  limit = DEFAULT_PAGE_SIZE,
): Promise<CustodyHoldingsByOwner[]> {
  const { results } = await selectCustodyHoldingsByOwnerStatement(database, limit).all<{
    entity_id: string;
    packets_held: number;
    packets_out: number;
    items_described: number;
    packets_under_hold: number;
  }>();
  return results.map((row) => ({
    entityId: row.entity_id,
    packetsHeld: row.packets_held,
    packetsOut: row.packets_out,
    itemsDescribed: row.items_described,
    packetsUnderHold: row.packets_under_hold,
  }));
}

// ---- holdings per location, with occupancy ----

export interface CustodyLocationOccupancy {
  readonly locationId: CustodyLocationId;
  readonly name: string;
  readonly kind: CustodyLocationKind;
  readonly parentLocationId: CustodyLocationId | null;
  readonly status: CustodyLocationStatus;
  readonly depth: number;
  // Packets physically at THIS node. A checked-out packet has no current location, so the shelf
  // really is empty while the deed is at a completion meeting.
  readonly directOccupancy: number;
  // Packets at this node or anywhere beneath it — the number that answers "how much is in the safe".
  readonly subtreeOccupancy: number;
}

// Two queries, then one pass over the tree in memory. The alternative — a recursive common table
// expression per node — is the N+1 the design names as this subsystem's most likely regression, and
// a firm's container tree is a few hundred nodes at the very outside, so assembling it here costs
// nothing and cannot degrade with the size of the register.
export async function readCustodyLocationOccupancyReport(
  database: SqlDatabase,
): Promise<CustodyLocationOccupancy[]> {
  const [{ results: nodes }, { results: counts }] = await Promise.all([
    database
      .prepare(
        `SELECT id, name, kind, parent_location_id, status FROM ${CUSTODY_LOCATION_TABLE} ORDER BY name ASC, id ASC`,
      )
      .all<{
        id: CustodyLocationId;
        name: string;
        kind: CustodyLocationKind;
        parent_location_id: CustodyLocationId | null;
        status: CustodyLocationStatus;
      }>(),
    database
      .prepare(
        `SELECT current_location_id AS location_id, COUNT(*) AS occupancy
           FROM ${CUSTODY_PACKET_TABLE}
          WHERE current_location_id IS NOT NULL AND status IN ('held', 'out')
          GROUP BY current_location_id`,
      )
      .all<{ location_id: CustodyLocationId; occupancy: number }>(),
  ]);

  const directByLocation = new Map<CustodyLocationId, number>();
  for (const row of counts) directByLocation.set(row.location_id, row.occupancy);

  const childrenByParent = new Map<CustodyLocationId | null, CustodyLocationId[]>();
  const nodeById = new Map<CustodyLocationId, (typeof nodes)[number]>();
  for (const node of nodes) {
    nodeById.set(node.id, node);
    const siblings = childrenByParent.get(node.parent_location_id) ?? [];
    siblings.push(node.id);
    childrenByParent.set(node.parent_location_id, siblings);
  }

  // Depth-first from the roots, parents before children — the order the tree renders in. A node
  // whose parent is missing (a hand-run SQL fix, or a parent outside this read) is unreachable from
  // a root and would silently vanish, so it is walked as its own root instead.
  const report: CustodyLocationOccupancy[] = [];
  const visited = new Set<CustodyLocationId>();
  const roots = [
    ...(childrenByParent.get(null) ?? []),
    ...nodes
      .filter((node) => node.parent_location_id !== null && !nodeById.has(node.parent_location_id))
      .map((node) => node.id),
  ];

  function walk(locationId: CustodyLocationId, depth: number): number {
    // Guards a cycle introduced outside the write path: a node already visited contributes nothing
    // a second time, so the walk terminates with an obviously-short answer rather than hanging.
    if (visited.has(locationId)) return 0;
    visited.add(locationId);
    const node = nodeById.get(locationId);
    if (node === undefined) return 0;
    const direct = directByLocation.get(locationId) ?? 0;
    const entry = {
      locationId,
      name: node.name,
      kind: node.kind,
      parentLocationId: node.parent_location_id,
      status: node.status,
      depth,
      directOccupancy: direct,
      subtreeOccupancy: direct,
    };
    const index = report.push(entry) - 1;
    let subtree = direct;
    for (const child of childrenByParent.get(locationId) ?? []) {
      subtree += walk(child, depth + 1);
    }
    report[index] = { ...entry, subtreeOccupancy: subtree };
    return subtree;
  }

  for (const root of roots) walk(root, 0);
  return report;
}

// ---- packets under hold ----

export interface CustodyPacketUnderHold {
  readonly holdId: CustodyHoldId;
  readonly packetId: CustodyPacketId;
  readonly itemId: CustodyItemId | null;
  readonly custodyNumber: string;
  readonly kind: CustodyHoldKind;
  readonly placedAt: string;
  readonly packetStatus: string;
}

// Every hold in force across the register, oldest first. This is the report that makes a hold
// visible as a standing state rather than only as a refusal somebody hit — a hold nobody can see is
// a hold nobody will remember to release.
export async function readCustodyPacketsUnderHold(
  database: SqlDatabase,
  limit = DEFAULT_PAGE_SIZE,
): Promise<CustodyPacketUnderHold[]> {
  const { results } = await database
    .prepare(
      `SELECT hold.id AS hold_id,
              hold.packet_id AS packet_id,
              hold.item_id AS item_id,
              hold.kind AS kind,
              hold.placed_at AS placed_at,
              packet.custody_number AS custody_number,
              packet.status AS packet_status
         FROM ${CUSTODY_HOLD_TABLE} AS hold
         JOIN ${CUSTODY_PACKET_TABLE} AS packet ON packet.id = hold.packet_id
        WHERE hold.released_at IS NULL
        ORDER BY hold.placed_at ASC, hold.id ASC
        LIMIT ?1`,
    )
    .bind(limit)
    .all<{
      hold_id: CustodyHoldId;
      packet_id: CustodyPacketId;
      item_id: CustodyItemId | null;
      kind: CustodyHoldKind;
      placed_at: string;
      custody_number: string;
      packet_status: string;
    }>();
  return results.map((row) => ({
    holdId: row.hold_id,
    packetId: row.packet_id,
    itemId: row.item_id,
    custodyNumber: row.custody_number,
    kind: row.kind,
    placedAt: row.placed_at,
    packetStatus: row.packet_status,
  }));
}
