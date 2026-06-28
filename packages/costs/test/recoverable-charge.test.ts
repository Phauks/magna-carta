import { describe, expect, it } from "vitest";
import { chargeToCaptureInputs } from "../src/recoverable-charge.ts";
import type { RecoverableChargeEvent } from "../src/recoverable-charge.ts";

// A shipping-shaped event: a fronted postage cost (always recovered) plus an absorbed handling fee
// (recovered only under firm policy). The two lines carry distinct categories.
const shippingEvent: RecoverableChargeEvent = {
  matterRef: "matter_x",
  currency: "USD",
  sourceRef: "shp_123",
  idempotencyKey: "shp_123",
  lines: [
    {
      category: "postage",
      amountMinor: 850,
      kind: "pass_through",
      description: "USPS postage",
    },
    {
      category: "shipping_service_fee",
      amountMinor: 150,
      kind: "platform_fee",
      description: "Shipping handling fee",
    },
  ],
};

const policyOff = () => false;
const policyOn = () => true;
const incurredDate = "2026-06-26";

describe("chargeToCaptureInputs", () => {
  it("emits only the pass_through line when the platform-fee policy is off", () => {
    const inputs = chargeToCaptureInputs(shippingEvent, policyOff, incurredDate);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.recoveryCategory).toBe("postage");
    expect(inputs[0]?.amountMinor).toBe(850);
  });

  it("emits both lines when the platform-fee policy is on", () => {
    const inputs = chargeToCaptureInputs(shippingEvent, policyOn, incurredDate);
    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => input.recoveryCategory)).toEqual([
      "postage",
      "shipping_service_fee",
    ]);
  });

  it("returns nothing for a firm-administrative event with no matter", () => {
    const event: RecoverableChargeEvent = { ...shippingEvent, matterRef: null };
    expect(chargeToCaptureInputs(event, policyOn, incurredDate)).toEqual([]);
  });

  it("stamps every emitted input as a billable hard-disbursement recovery on the passed date", () => {
    const inputs = chargeToCaptureInputs(shippingEvent, policyOn, incurredDate);
    for (const input of inputs) {
      expect(input.source).toBe("recovery");
      expect(input.disbursementClass).toBe("hard");
      expect(input.billable).toBe(true);
      expect(input.matterId).toBe("matter_x");
      expect(input.currency).toBe("USD");
      expect(input.incurredDate).toBe(incurredDate);
      expect(input.recoveryCategory).not.toBeUndefined();
      expect(Number.isInteger(input.amountMinor)).toBe(true);
    }
  });

  it("derives a distinct recoveryRef per line so the unique index never collides", () => {
    const inputs = chargeToCaptureInputs(shippingEvent, policyOn, incurredDate);
    const refs = inputs.map((input) => input.recoveryRef);
    expect(refs).toEqual(["shp_123:postage", "shp_123:shipping_service_fee"]);
    expect(new Set(refs).size).toBe(refs.length);
    for (const ref of refs) {
      expect(ref?.startsWith("shp_123")).toBe(true);
    }
  });
});
