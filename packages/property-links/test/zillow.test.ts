import { describe, expect, it } from "vitest";
import { zillowProvider } from "../src/providers/zillow.ts";

describe("zillowProvider", () => {
  it("builds the _rb homes slug (spaces to hyphens, commas dropped)", () => {
    expect(
      zillowProvider.build({ street: "123 Main St", city: "Reno", region: "NV", postal: "89501" }),
    ).toBe("https://www.zillow.com/homes/123-Main-St-Reno-NV-89501_rb/");
  });

  it("declares its id and label", () => {
    expect(zillowProvider.id).toBe("zillow");
    expect(zillowProvider.label).toBe("Zillow");
  });

  it("returns null when the reference is insufficient", () => {
    expect(zillowProvider.build({ city: "Reno" })).toBeNull();
  });
});
