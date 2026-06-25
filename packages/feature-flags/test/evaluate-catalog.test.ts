import { describe, expect, it } from "vitest";
import { evaluateCatalog } from "../src/index.ts";
import type { FlagContext, FlagEvaluator } from "../src/port.ts";

// A fake evaluator that lights "release-channels.smoke" only for beta/alpha firms — the shape a real
// channel-targeting rule takes — so the test proves evaluateCatalog returns the evaluator's verdict,
// not just the default.
function channelTargetingEvaluator(): FlagEvaluator {
  return {
    getBoolean: (flagKey, defaultValue, context) =>
      Promise.resolve(
        flagKey === "release-channels.smoke" ? context.channel !== "stable" : defaultValue,
      ),
  };
}

const betaContext: FlagContext = { targetingKey: "usr_1", firmId: "firm_1", channel: "beta" };
const stableContext: FlagContext = { targetingKey: "usr_1", firmId: "firm_1", channel: "stable" };

describe("evaluateCatalog", () => {
  it("returns every catalog flag's evaluated value", async () => {
    const flags = await evaluateCatalog(channelTargetingEvaluator(), betaContext);
    expect(flags).toEqual({ "release-channels.smoke": true });
  });

  it("returns the evaluator's verdict for a stable firm", async () => {
    const flags = await evaluateCatalog(channelTargetingEvaluator(), stableContext);
    expect(flags).toEqual({ "release-channels.smoke": false });
  });
});
