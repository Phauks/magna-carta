import { describe, expect, it } from "vitest";
import { firmRateGate, tokenUsageKeyForDay } from "../src/inference/inference-consumer.ts";

describe("firmRateGate (the back-pressure seam)", () => {
  it("is a pass-through no-op at launch — never throws, returns nothing", () => {
    expect(firmRateGate("firm_anything")).toBeUndefined();
  });
});

describe("tokenUsageKeyForDay", () => {
  it("buckets a run by UTC civil date + slot + model id", () => {
    const key = tokenUsageKeyForDay(
      "2026-06-18T13:45:00.000Z",
      "reasoning",
      "anthropic/claude-opus-4-8",
    );
    expect(key).toEqual({
      day: "2026-06-18",
      slot: "reasoning",
      modelId: "anthropic/claude-opus-4-8",
    });
  });
});
