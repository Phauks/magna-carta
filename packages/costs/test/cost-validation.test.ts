import { describe, expect, it } from "vitest";
import { CostValidationError } from "../src/cost-validation.ts";

describe("CostValidationError", () => {
  it("stores the code on the error instance", () => {
    const err = new CostValidationError("not-found", "x");
    expect(err.code).toBe("not-found");
  });

  it("sets the name to CostValidationError", () => {
    const err = new CostValidationError("not-found", "x");
    expect(err.name).toBe("CostValidationError");
  });
});
