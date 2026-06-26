import { FLAG_CATALOG } from "./catalog.ts";
import type { FlagContext, FlagEvaluator } from "./port.ts";

export * from "./port.ts";
export * from "./catalog.ts";
export * from "./flagship-adapter.ts";
export * from "./default-off-adapter.ts";

// Evaluate every catalog flag for one context and return a plain map the bootstrap ships to the SPA.
export async function evaluateCatalog(
  evaluator: FlagEvaluator,
  context: FlagContext,
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    Object.entries(FLAG_CATALOG).map(
      async ([flagKey, { defaultValue }]) =>
        [flagKey, await evaluator.getBoolean(flagKey, defaultValue, context)] as const,
    ),
  );
  return Object.fromEntries(entries);
}
