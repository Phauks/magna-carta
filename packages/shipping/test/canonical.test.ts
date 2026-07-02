import { describe, expect, it } from "vitest";
import { addressSchema, rateSchema, labelSchema } from "../src/canonical.ts";

describe("canonical shipping schemas", () => {
  it("accepts a well-formed address with remoteId", () => {
    const parsed = addressSchema.parse({
      remoteId: "adr_1",
      name: "Jane Roe",
      company: null,
      street1: "1 Main St",
      street2: null,
      city: "Reno",
      state: "NV",
      zip: "89501",
      country: "US",
      phone: null,
      residential: true,
      verified: true,
    });
    expect(parsed.city).toBe("Reno");
  });

  it("rejects a rate missing remoteId (boundary guard)", () => {
    expect(() =>
      rateSchema.parse({
        carrier: "USPS",
        service: "Priority",
        amountMinor: 745,
        currency: "USD",
        deliveryDays: 2,
        estDeliveryDate: null,
      }),
    ).toThrow();
  });

  it("rejects a label with a negative cost", () => {
    expect(() =>
      labelSchema.parse({
        remoteId: "shp_1",
        carrier: "USPS",
        service: "Priority",
        trackingCode: "9400...",
        labelUrl: "https://easypost.example/label.pdf",
        labelFormat: "PDF",
        costMinor: -1,
        currency: "USD",
      }),
    ).toThrow();
  });
});
