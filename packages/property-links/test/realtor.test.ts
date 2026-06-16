import { describe, expect, it } from "vitest";
import { realtorProvider } from "../src/providers/realtor.ts";

describe("realtorProvider", () => {
  it("builds the realestateandhomes-search slug (hyphens within parts, underscores between)", () => {
    expect(
      realtorProvider.build({
        street: "123 Main St",
        city: "Las Vegas",
        region: "NV",
        postal: "89101",
      }),
    ).toBe("https://www.realtor.com/realestateandhomes-search/123-Main-St_Las-Vegas_NV_89101");
  });

  it("declares its id and label", () => {
    expect(realtorProvider.id).toBe("realtor");
    expect(realtorProvider.label).toBe("Realtor.com");
  });

  it("returns null without the full structured address (cannot use a formattedAddress)", () => {
    expect(realtorProvider.build({ formattedAddress: "123 Main St, Reno, NV 89501" })).toBeNull();
    expect(realtorProvider.build({ street: "123 Main St", city: "Reno", region: "NV" })).toBeNull();
  });
});
