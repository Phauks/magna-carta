import { describe, expect, it } from "vitest";
import { resolvePropertyLinks } from "../src/registry.ts";

const fullAddress = { street: "123 Main St", city: "Reno", region: "NV", postal: "89501" };

describe("resolvePropertyLinks", () => {
  it("returns every provider's link for a sufficient reference", () => {
    const links = resolvePropertyLinks(fullAddress);
    expect(links.map((link) => link.providerId)).toEqual([
      "zillow",
      "redfin",
      "googleMaps",
      "realtor",
    ]);
    expect(links).toContainEqual({
      providerId: "googleMaps",
      label: "Google Maps",
      url: "https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Reno%2C%20NV%2089501",
    });
    expect(links).toContainEqual({
      providerId: "realtor",
      label: "Realtor.com",
      url: "https://www.realtor.com/realestateandhomes-search/123-Main-St_Reno_NV_89501",
    });
  });

  it("from a pre-formatted address, omits providers that need structured components (Realtor)", () => {
    const links = resolvePropertyLinks({ formattedAddress: "123 Main St, Reno, NV 89501" });
    expect(links.map((link) => link.providerId)).toEqual(["zillow", "redfin", "googleMaps"]);
  });

  it("returns [] for an insufficient reference and never throws", () => {
    expect(resolvePropertyLinks({})).toEqual([]);
    expect(resolvePropertyLinks({ city: "Reno" })).toEqual([]);
  });
});
