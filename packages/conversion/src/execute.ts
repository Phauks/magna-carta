import { engineFor } from "./engines.ts";
import type { ConversionEdge, EngineId, FormatId } from "./format.ts";
import { type ConversionPort, type ConversionResult, unsupportedEdge } from "./port.ts";
import { findPath } from "./pathfinding.ts";

// How an engine id resolves to a port. Defaults to the registered engine map; injectable for tests.
export type EngineResolver = (id: EngineId) => ConversionPort;

// Run a path one hop at a time, threading each hop's output bytes into the next. Returns the final
// hop's success, or the first hop's failure — execution stops at the first failure and never runs a
// later hop (so a deferred engine mid-chain surfaces its `engine-not-implemented` without side effects
// from earlier hops being wasted on later ones).
export async function executePath(
  path: readonly ConversionEdge[],
  bytes: Uint8Array,
  resolve: EngineResolver = engineFor,
): Promise<ConversionResult> {
  let current = bytes;
  let last: ConversionResult | undefined;
  for (const edge of path) {
    const result = await resolve(edge.engineId).convert({
      bytes: current,
      from: edge.from,
      to: edge.to,
      recipeRef: edge.recipeRef,
    });
    if (!result.ok) return result;
    current = result.bytes;
    last = result;
  }
  return last ?? unsupportedEdge("empty conversion path");
}

// Find a path from `from` to `to` (multi-hop allowed) and execute it. A missing path is reported as an
// unsupported edge — the conversion is not something the registry can do.
export function runConversion(
  from: FormatId,
  to: FormatId,
  bytes: Uint8Array,
  resolve: EngineResolver = engineFor,
): Promise<ConversionResult> {
  const path = findPath(from, to);
  if (!path.ok) return Promise.resolve(unsupportedEdge(`no conversion path from ${from} to ${to}`));
  return executePath(path.path, bytes, resolve);
}
