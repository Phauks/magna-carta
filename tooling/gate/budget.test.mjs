import { describe, expect, it } from "vitest";
import {
  budgetFor,
  DEFAULT_BUDGET_MINUTES,
  describeBudget,
  DIMENSION_BUDGET_MINUTES,
  resolveScale,
  SCALE_VARIABLE,
} from "./budget.mjs";

describe("the gate's time budgets", () => {
  it("gives a dimension nobody budgeted the default rather than no budget at all", () => {
    // The point of the default is that an unbudgeted dimension cannot exist. A new dimension added
    // without a line in the table is the exact case this mechanism was built to stop being silent.
    expect(DIMENSION_BUDGET_MINUTES["a-dimension-invented-tomorrow"]).toBeUndefined();
    expect(budgetFor("a-dimension-invented-tomorrow")).toBe(DEFAULT_BUDGET_MINUTES * 60 * 1000);
  });

  it("budgets the test battery at least as long as the lock believes a run can take", async () => {
    // Two numbers answering "how long can a full test run honestly take" must not disagree: a budget
    // under the lock's stale window would kill runs the lock is still protecting.
    const { STALE_AFTER_MILLISECONDS } = await import("../test-single-flight/lock.mjs");
    expect(budgetFor("tests")).toBeGreaterThanOrEqual(STALE_AFTER_MILLISECONDS);
  });

  it("scales every budget together", () => {
    for (const dimension of Object.keys(DIMENSION_BUDGET_MINUTES)) {
      expect(budgetFor(dimension, { scale: 3 })).toBe(budgetFor(dimension) * 3);
    }
  });

  it("treats off as off rather than as zero", () => {
    // Zero milliseconds would fire instantly and fail everything; the words mean "do not bound this".
    for (const spelling of ["off", "none", "0", "OFF", " off "]) {
      expect(resolveScale(spelling)).toBeNull();
      expect(budgetFor("lint", { scale: resolveScale(spelling) })).toBeNull();
    }
  });

  it("defaults to unscaled when the variable is absent or empty", () => {
    expect(resolveScale(undefined)).toBe(1);
    expect(resolveScale("")).toBe(1);
  });

  it("refuses a value it cannot read instead of quietly running the original budgets", () => {
    // Someone who typed 1O believes the budgets are ten times larger. Falling back to 1 would fail
    // their step and blame their code for a typo in an environment variable.
    for (const bad of ["1O", "two", "-1", "NaN"]) {
      expect(() => resolveScale(bad)).toThrow(SCALE_VARIABLE);
    }
  });

  it("says a budget out loud in the unit a reader can act on", () => {
    expect(describeBudget(30 * 60 * 1000)).toBe("30 min");
    expect(describeBudget(45 * 1000)).toBe("45s");
  });
});
