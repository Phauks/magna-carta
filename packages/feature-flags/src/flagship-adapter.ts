import type { FlagContext, FlagEvaluator } from "./port.ts";

// The subset of the Cloudflare Flagship Worker binding we use. Kept as a local interface so the
// package has no build-time dependency on the platform binding type and stays unit-testable with a
// plain fake.
export interface FlagshipBinding {
  getBooleanValue(
    flagKey: string,
    defaultValue: boolean,
    context: Record<string, string>,
  ): Promise<boolean>;
}

// Flagship evaluates inside the Worker against propagated config (no outbound HTTP). We pass only
// non-privileged identifiers. If the binding throws, we fall back to the supplied default so a
// provider fault degrades to stable behavior.
export function flagshipEvaluator(binding: FlagshipBinding): FlagEvaluator {
  return {
    async getBoolean(flagKey, defaultValue, context: FlagContext): Promise<boolean> {
      try {
        return await binding.getBooleanValue(flagKey, defaultValue, {
          targetingKey: context.targetingKey,
          firmId: context.firmId,
          channel: context.channel,
        });
      } catch {
        return defaultValue;
      }
    },
  };
}
