import { describe, expect, it } from "vitest";
import {
  classifyError,
  mapInsurance,
  mapLabel,
  mapRatedShipment,
  mapShipmentOptions,
  minorToDollars,
} from "../src/easypost/map.ts";

describe("EasyPost mapping", () => {
  it("maps a shipment payload to canonical rates (dollars → minor units)", () => {
    const result = mapRatedShipment({
      id: "shp_abc",
      rates: [
        {
          id: "rate_1",
          carrier: "USPS",
          service: "Priority",
          rate: "7.45",
          currency: "USD",
          delivery_days: 2,
          // EasyPost uses delivery_date (not est_delivery_date) on the Rate object
          delivery_date: "2026-06-18",
        },
      ],
    });
    expect(result.remoteId).toBe("shp_abc");
    // Non-null assertion: the Zod-generic constraint makes rates possibly undefined
    // in the inferred type; the test input guarantees the array and first element exist.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(result.rates![0]!).toMatchObject({
      remoteId: "rate_1",
      carrier: "USPS",
      amountMinor: 745,
      currency: "USD",
      deliveryDays: 2,
    });
  });

  it("maps a bought shipment to a canonical label", () => {
    const label = mapLabel({
      id: "shp_abc",
      tracking_code: "9400111",
      selected_rate: { carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
      postage_label: { label_url: "https://ep.example/l.pdf", label_file_type: "application/pdf" },
    });
    expect(label).toMatchObject({
      remoteId: "shp_abc",
      trackingCode: "9400111",
      costMinor: 745,
      labelFormat: "application/pdf",
    });
  });

  it("maps certified mail + electronic return receipt to EasyPost options", () => {
    // EasyPost return_receipt is a boolean; "electronic" and "physical" both map to true
    expect(mapShipmentOptions({ certifiedMail: true, returnReceipt: "electronic" })).toEqual({
      certified_mail: true,
      return_receipt: true,
    });
  });

  it("emits insurance as a top-level decimal-dollar string, never an options key", () => {
    expect(mapInsurance(24999)).toEqual({ insurance: "249.99" });
    expect(mapInsurance(500)).toEqual({ insurance: "5.00" });
    // Whole dollars still carry the cents places.
    expect(mapInsurance(100000)).toEqual({ insurance: "1000.00" });
    // Sub-dollar declared values keep their leading zero.
    expect(mapInsurance(7)).toEqual({ insurance: "0.07" });
    // Insurance is not an `options` key — it must never leak into the options map.
    expect(mapShipmentOptions({ insuranceAmountMinor: 24999 })).toEqual({});
  });

  it("omits insurance when none was requested", () => {
    expect(mapInsurance(undefined)).toEqual({});
    expect(mapInsurance(null)).toEqual({});
    // Zero is "insure nothing", which is an absent key rather than "0.00".
    expect(mapInsurance(0)).toEqual({});
  });

  it("round-trips minor units through the dollar string without float drift", () => {
    for (const amountMinor of [0, 1, 99, 100, 745, 24999, 99999999]) {
      expect(minorToDollars(amountMinor)).toBe((amountMinor / 100).toFixed(2));
    }
    // The value the naive float path gets wrong.
    expect(minorToDollars(1010)).toBe("10.10");
  });

  it("classifies a 401 as a terminal auth problem", () => {
    const problem = classifyError(401, "Unauthorized");
    expect(problem).toMatchObject({ category: "auth", retryable: false, status: 401 });
  });

  it("classifies a 429 as a retryable rate-limit problem", () => {
    expect(classifyError(429, "Too Many Requests")).toMatchObject({
      category: "rate_limit",
      retryable: true,
    });
  });
});
