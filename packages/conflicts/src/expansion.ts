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
  const visited = new Map<string, readonly EdgeStep[]>();
  // Breadth-first so the first path found to an entity is a shortest one.
  const queue: Array<{ entityId: string; path: readonly EdgeStep[]; hops: number }> = [];

  for (const seedEntityId of seedEntityIds) {
    if (visited.has(seedEntityId)) continue;
    visited.set(seedEntityId, []);
    queue.push({ entityId: seedEntityId, path: [], hops: 0 });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    const edges = await readEdges(database, current.entityId as never);
    // Sort so traversal order does not depend on the database's row order.
    const ordered = [...edges].sort((a, b) => a.id.localeCompare(b.id));

    for (const edge of ordered) {
      const isCorporate = CORPORATE_EDGE_TYPES.includes(edge.edgeType);
      // A non-corporate edge may only be walked while hops remain.
      if (!isCorporate && current.hops >= depth) continue;

      const neighbourId =
        edge.fromEntityId === current.entityId ? edge.toEntityId : edge.fromEntityId;
      if (visited.has(neighbourId)) continue;

      const step: EdgeStep = {
        edgeId: edge.id,
        edgeType: edge.edgeType,
        fromEntityId: edge.fromEntityId,
        toEntityId: edge.toEntityId,
      };
      const path = [...current.path, step];
      visited.set(neighbourId, path);
      // A corporate hop does not consume the depth budget; every other hop does.
      queue.push({ entityId: neighbourId, path, hops: isCorporate ? current.hops : current.hops + 1 });
    }
  }

  return [...visited.entries()]
    .map(([entityId, path]) => ({ entityId, path }))
    .sort((a, b) => a.path.length - b.path.length || a.entityId.localeCompare(b.entityId));
}
