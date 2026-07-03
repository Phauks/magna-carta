import { describe, expect, it } from "vitest";
import { defaultOffEvaluator } from "../src/index.ts";
import type { FlagContext } from "../src/port.ts";

const context: FlagContext = { targetingKey: "usr_1", firmId: "firm_1", channel: "alpha" };

describe("defaultOffEvaluator", () => {
  it("returns the supplied default regardless of channel", async () => {
    expect(await defaultOffEvaluator.getBoolean("anything", false, context)).toBe(false);
    expect(await defaultOffEvaluator.getBoolean("anything", true, context)).toBe(true);
  });
});
