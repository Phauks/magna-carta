import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { readEdges } from "@magna-carta/directory/edges";
import type { EdgeStep } from "./types.ts";

// An entity reached from a subject party, with the edges that connected it. The path is the hit's
// explanation: a reviewer must see WHY an entity surfaced, not merely that it did.
export interface ExpandedEntity {
  readonly entityId: string;
  readonly path: readonly EdgeStep[];
}

// Corporate-family edges are traversed transitively, regardless of the depth limit. A rename, merger,
// or successor entity must still match — stopping a corporate chain at the hop limit would miss
// exactly the entity the search exists to find. Every other edge type obeys depth.
export const CORPORATE_EDGE_TYPES: readonly string[] = [
  "corporate_parent",
  "corporate_subsidiary",
  "corporate_successor",
];

export async function expandGraph(
  database: BatchDatabase,
  seedEntityIds: readonly string[],
  depth: number,
): Promise<ExpandedEntity[]> {
  // 0-1 BFS. A corporate edge costs 0 hops (traversed transitively, budget-free — a rename/merger/
  // successor must always match); every other edge costs 1 and obeys `depth`. A plain FIFO queue fixes
  // a node's hop count on first discovery by fewest-EDGES, which is NOT the fewest-HOPS when a longer
  // all-corporate path is cheaper — so a node reached first by a 1-hop direct edge would have its onward
  // edges pruned at the boundary even though a 0-hop corporate chain also reaches it, silently dropping
  // a legitimate conflict. A double-ended queue (corporate neighbours pushed to the FRONT, others to the
  // BACK) plus hop relaxation makes the recorded hops the true minimum before a node is expanded.
  const best = new Map<string, { hops: number; path: readonly EdgeStep[] }>();
  const deque: Array<{ entityId: string; path: readonly EdgeStep[]; hops: number }> = [];

  for (const seedEntityId of seedEntityIds) {
    if (best.has(seedEntityId)) continue;
    best.set(seedEntityId, { hops: 0, path: [] });
    deque.push({ entityId: seedEntityId, path: [], hops: 0 });
  }

  while (deque.length > 0) {
    const current = deque.shift();
    if (current === undefined) break;
    // Skip a stale deque entry a cheaper relaxation has already superseded.
    const known = best.get(current.entityId);
    if (known === undefined || current.hops > known.hops) continue;

    const edges = await readEdges(database, current.entityId as never);
    // Sort so traversal order does not depend on the database's row order.
    const ordered = [...edges].sort((a, b) => a.id.localeCompare(b.id));

    for (const edge of ordered) {
      const isCorporate = CORPORATE_EDGE_TYPES.includes(edge.edgeType);
      // A non-corporate edge may only be walked while hops remain.
      if (!isCorporate && current.hops >= depth) continue;

      const neighbourId =
        edge.fromEntityId === current.entityId ? edge.toEntityId : edge.fromEntityId;
      const nextHops = isCorporate ? current.hops : current.hops + 1;
      const existing = best.get(neighbourId);
      // Relax only on a strictly cheaper path; equal-hop ties keep the first (edge-id-ordered) path so
      // the recorded explanation stays deterministic.
      if (existing !== undefined && nextHops >= existing.hops) continue;

      const step: EdgeStep = {
        edgeId: edge.id,
        edgeType: edge.edgeType,
        fromEntityId: edge.fromEntityId,
        toEntityId: edge.toEntityId,
      };
      const path = [...current.path, step];
      best.set(neighbourId, { hops: nextHops, path });
      // A 0-cost corporate hop goes to the front (processed before any 1-cost hop already queued); a
      // 1-cost hop goes to the back — the 0-1 BFS invariant that keeps `hops` monotonic at pop time.
      const entry = { entityId: neighbourId, path, hops: nextHops };
      if (isCorporate) deque.unshift(entry);
      else deque.push(entry);
    }
  }

  return [...best.entries()]
    .map(([entityId, { path }]) => ({ entityId, path }))
    .sort((a, b) => a.path.length - b.path.length || a.entityId.localeCompare(b.entityId));
}
