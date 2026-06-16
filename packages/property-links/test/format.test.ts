import { describe, expect, it } from "vitest";
import { formatAddress } from "../src/format.ts";

describe("formatAddress", () => {
  it("joins components into one line", () => {
    expect(
      formatAddress({ street: "123 Main St", city: "Reno", region: "NV", postal: "89501" }),
    ).toBe("123 Main St, Reno, NV 89501");
  });

  it("returns a caller-provided formattedAddress verbatim (trimmed)", () => {
    expect(formatAddress({ formattedAddress: "  500 Oak Ave, Las Vegas, NV 89101 " })).toBe(
      "500 Oak Ave, Las Vegas, NV 89101",
    );
  });

  it("returns null without a street, or with a street but no city and no postal", () => {
    expect(formatAddress({ city: "Reno", region: "NV" })).toBeNull();
    expect(formatAddress({ street: "123 Main St", region: "NV" })).toBeNull();
    expect(formatAddress({})).toBeNull();
  });

  it("builds from street + postal when city is absent", () => {
    expect(formatAddress({ street: "123 Main St", postal: "89501" })).toBe("123 Main St, 89501");
  });
});
