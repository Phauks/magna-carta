import { describe, expect, it } from "vitest";
import type { Bindings } from "../../src/bindings.ts";
import { resolveFlagEvaluator } from "../../src/flags/flag-evaluator.ts";
import type { FlagContext } from "@magna-carta/feature-flags/port";

const context: FlagContext = { targetingKey: "usr_1", firmId: "firm_1", channel: "beta" };

describe("resolveFlagEvaluator", () => {
  it("returns a default-off evaluator when no FLAGS binding is configured", async () => {
    const evaluator = resolveFlagEvaluator({} as Bindings);
    expect(await evaluator.getBoolean("release-channels.smoke", false, context)).toBe(false);
  });

  it("delegates to the FLAGS binding when present", async () => {
    const env = {
      FLAGS: {
        getBooleanValue: (flagKey: string) => Promise.resolve(flagKey === "release-channels.smoke"),
      },
    } as unknown as Bindings;
    const evaluator = resolveFlagEvaluator(env);
    expect(await evaluator.getBoolean("release-channels.smoke", false, context)).toBe(true);
  });
});
