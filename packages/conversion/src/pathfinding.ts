import type { ConversionEdge, FormatId } from "./format.ts";
import { edgesFrom } from "./registry.ts";

export type PathResult =
  | { readonly ok: true; readonly path: readonly ConversionEdge[] }
  | { readonly ok: false; readonly reason: "no-path" };

// Dijkstra over the edge graph (weights are small positive integers). Returns the lowest-total-weight
// edge chain, so a higher-fidelity multi-hop path can be preferred over a lossy direct one by giving
// the lossy edge a higher weight. With all weights equal this is shortest-hop.
export function findPath(from: FormatId, to: FormatId): PathResult {
  if (from === to) return { ok: false, reason: "no-path" };
  const best = new Map<FormatId, number>([[from, 0]]);
  const prev = new Map<FormatId, ConversionEdge>();
  const visited = new Set<FormatId>();

  while (visited.size < best.size) {
    let node: FormatId | undefined;
    let nodeCost = Infinity;
    for (const [candidate, cost] of best) {
      if (!visited.has(candidate) && cost < nodeCost) {
        node = candidate;
        nodeCost = cost;
      }
    }
    if (node === undefined) break;
    visited.add(node);

    for (const edge of edgesFrom(node)) {
      const next = nodeCost + edge.weight;
      if (next < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, next);
        prev.set(edge.to, edge);
      }
    }
  }

  if (!prev.has(to)) return { ok: false, reason: "no-path" };

  const path: ConversionEdge[] = [];
  let cursor: FormatId = to;
  while (cursor !== from) {
    const edge = prev.get(cursor);
    if (edge === undefined) return { ok: false, reason: "no-path" };
    path.unshift(edge);
    cursor = edge.from;
  }
  return { ok: true, path };
}

// Every target format reachable from `from` (the Convert-to menu). Plain breadth-first reachability.
export function availableConversions(from: FormatId): readonly FormatId[] {
  const seen = new Set<FormatId>();
  const queue: FormatId[] = [from];
  while (queue.length > 0) {
    const node = queue.shift() as FormatId;
    for (const edge of edgesFrom(node)) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  seen.delete(from);
  return [...seen];
}
