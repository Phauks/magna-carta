import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { ENTITY_PREFIXES, prefixFor } from "../src/registry.ts";
import type { CostEntryId } from "../src/types.ts";

describe("costs identifier prefixes", () => {
  it("mints handles with the full-name prefix and the branded alias compiles", () => {
    const costEntryId: CostEntryId = newIdentifier("costEntry");
    expect(costEntryId).toMatch(/^costEntry_[A-Za-z0-9_-]{21}$/);
  });

  it("registers the costEntry prefix spelled out in full (prefix === key)", () => {
    expect(ENTITY_PREFIXES.costEntry).toBe("costEntry");
    expect(prefixFor("costEntry")).toBe("costEntry");
  });
});
