import { describe, expect, it } from "vitest";
import { recoverPlatformFeeDefinition, shouldRecover } from "../src/recovery-policy.ts";
import type { RecoverableChargeLine } from "../src/recoverable-charge.ts";

const passThrough: RecoverableChargeLine = {
  category: "courier",
  amountMinor: 1200,
  kind: "pass_through",
  description: "Overnight courier",
};

const platformFee: RecoverableChargeLine = {
  category: "shipping_service_fee",
  amountMinor: 150,
  kind: "platform_fee",
  description: "Shipping handling fee",
};

describe("shouldRecover", () => {
  it("recovers a pass_through line regardless of policy", () => {
    expect(shouldRecover(passThrough, false)).toBe(true);
    expect(shouldRecover(passThrough, true)).toBe(true);
  });

  it("recovers a platform_fee line only when the policy is on", () => {
    expect(shouldRecover(platformFee, false)).toBe(false);
    expect(shouldRecover(platformFee, true)).toBe(true);
  });
});

describe("recoverPlatformFeeDefinition", () => {
  it("namespaces the key per category under cost.recover_platform_fee", () => {
    expect(recoverPlatformFeeDefinition("shipping_service_fee").key).toBe(
      "cost.recover_platform_fee.shipping_service_fee",
    );
  });

  it("defaults to false (the firm has not opted to recover the platform fee)", () => {
    expect(recoverPlatformFeeDefinition("shipping_service_fee").defaultValue).toBe(false);
  });
});
