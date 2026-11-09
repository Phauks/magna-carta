import {
  defaultOffEvaluator,
  flagshipEvaluator,
  type FlagEvaluator,
} from "@magna-carta/feature-flags";
import type { Bindings } from "../bindings.ts";

// Resolve the flag evaluator for a request. With the Flagship binding present, flags evaluate at the
// edge against propagated config; without it (local dev, tests, or pre-provider deployments), every
// flag resolves to its safe default — stable behavior. The binding is never load-bearing.
export function resolveFlagEvaluator(env: Bindings): FlagEvaluator {
  return env.FLAGS === undefined ? defaultOffEvaluator : flagshipEvaluator(env.FLAGS);
}
