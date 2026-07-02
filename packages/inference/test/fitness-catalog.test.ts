import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog.ts";

describe("catalog zdrEligible invariant (fitness)", () => {
  it("every selectable reasoning model is ZDR-eligible — non-ZDR never enters the reasoning slot", () => {
    for (const entry of CATALOG.filter((e) => e.slot === "reasoning")) {
      expect(entry.zdrEligible, entry.modelId).toBe(true);
    }
  });

  it("exactly one embedding entry exists (the platform-fixed, index-pinned model)", () => {
    expect(CATALOG.filter((e) => e.slot === "embedding")).toHaveLength(1);
  });
});
