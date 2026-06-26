import type { FlagEvaluator } from "./port.ts";

// Used when no Flagship binding is configured (local dev, tests, or a deployment before the flag
// provider is wired). Every flag resolves to its supplied default — i.e. stable behavior.
export const defaultOffEvaluator: FlagEvaluator = {
  getBoolean: (_flagKey, defaultValue) => Promise.resolve(defaultValue),
};
