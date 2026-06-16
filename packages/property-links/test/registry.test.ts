import { describe, expect, it } from "vitest";
import { resolvePropertyLinks } from "../src/registry.ts";

const fullAddress = { street: "123 Main St", city: "Reno", region: "NV", postal: "89501" };

describe("resolvePropertyLinks", () => {
  it("returns every provider's link for a sufficient reference", () => {
    expect(resolvePropertyLinks(fullAddress)).toEqual([
      {
        providerId: "zillow",
        label: "Zillow",
        url: "https://www.zillow.com/homes/123-Main-St-Reno-NV-89501_rb/",
      },
      {
        providerId: "redfin",
        label: "Redfin",
        url: "https://www.redfin.com/?location=123%20Main%20St%2C%20Reno%2C%20NV%2089501",
      },
    ]);
  });

  it("works from a pre-formatted address too", () => {
    const links = resolvePropertyLinks({ formattedAddress: "123 Main St, Reno, NV 89501" });
    expect(links.map((link) => link.providerId)).toEqual(["zillow", "redfin"]);
  });

  it("returns [] for an insufficient reference and never throws", () => {
    expect(resolvePropertyLinks({})).toEqual([]);
    expect(resolvePropertyLinks({ city: "Reno" })).toEqual([]);
  });
});
