import { describe, expect, it } from "vitest";
import {
  scanPolicyDefinition, flaggedTreatmentDefinition, stepUpReauthDefinition,
  DEFAULT_FLAGGED_TREATMENT,
} from "../src/scan-policy-settings.ts";
import { DEFAULT_SCAN_POLICY } from "../src/verdict.ts";

describe("scan policy settings", () => {
  it("defaults match the spec (extended/75, block, off)", () => {
    expect(scanPolicyDefinition.defaultValue).toEqual(DEFAULT_SCAN_POLICY);
    expect(flaggedTreatmentDefinition.defaultValue).toBe("block");
    expect(DEFAULT_FLAGGED_TREATMENT).toBe("block");
    expect(stepUpReauthDefinition.defaultValue).toBe(false);
  });
  it("policy schema accepts a valid policy and rejects an unknown tier / out-of-range floor", () => {
    expect(scanPolicyDefinition.schema.safeParse({ tier: "full", suspiciousScoreFloor: 0 }).success).toBe(true);
    expect(scanPolicyDefinition.schema.safeParse({ tier: "strict", suspiciousScoreFloor: 75 }).success).toBe(false);
    expect(scanPolicyDefinition.schema.safeParse({ tier: "core", suspiciousScoreFloor: 101 }).success).toBe(false);
    expect(scanPolicyDefinition.schema.safeParse({ tier: "core", suspiciousScoreFloor: -1 }).success).toBe(false);
  });
  it("treatment schema is the three-value enum", () => {
    expect(flaggedTreatmentDefinition.schema.safeParse("allow-and-flag").success).toBe(true);
    expect(flaggedTreatmentDefinition.schema.safeParse("delete").success).toBe(false);
  });
});
