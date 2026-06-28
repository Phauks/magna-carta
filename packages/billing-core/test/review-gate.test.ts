import { describe, expect, it } from "vitest";
import { approvalRequiredDefinition } from "../src/review-gate.ts";

describe("approvalRequiredDefinition", () => {
  it("uses the billing namespace key", () => {
    expect(approvalRequiredDefinition.key).toBe("billing.approval_required");
  });

  it("defaults to false (the frictionless capture path)", () => {
    expect(approvalRequiredDefinition.defaultValue).toBe(false);
  });
});
