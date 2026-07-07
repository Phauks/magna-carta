import { describe, expect, it } from "vitest";
import type { WellbeingResource } from "../src/types.ts";

describe("types", () => {
  it("a WellbeingResource literal satisfies the contract", () => {
    const r: WellbeingResource = {
      name: "Example LAP",
      operator: "Example State Bar",
      operatorType: "stateBar",
      scope: "statewide",
      phones: [{ number: "555-0100", label: "Intake", availability: "unspecified" }],
      services: ["counseling", "peerSupport"],
      confidential: "Confidential",
      cost: "Free",
      description: "Example.",
      verifiedOn: "2026-07-02",
    };
    expect(r.services).toContain("counseling");
  });
});
