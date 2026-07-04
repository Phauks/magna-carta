import { describe, expect, it } from "vitest";
import { jurisdictionForRegion, locationHintForRegion } from "../src/data-region.ts";

describe("data-region → Cloudflare placement", () => {
  it("eu maps to the hard eu jurisdiction", () => {
    expect(jurisdictionForRegion("eu")).toBe("eu");
  });
  it("us has no jurisdiction (North-America placement, soft)", () => {
    expect(jurisdictionForRegion("us")).toBeUndefined();
  });
  it("us carries a North-America location hint; eu does not need one (jurisdiction is hard)", () => {
    expect(locationHintForRegion("us")).toBe("enam");
    expect(locationHintForRegion("eu")).toBeUndefined();
  });
});
