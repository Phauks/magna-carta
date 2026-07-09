/*
 * Chart geometry, pinned. An empty series must not produce a zero domain (which would divide by
 * zero and collapse every bar onto the baseline).
 */
import { describe, expect, it } from "vitest";
import { niceMax, scaleLinear } from "../src/lib/tools/speed-test/chart-scale.ts";

describe("niceMax", () => {
  it("rounds up to a readable ceiling", () => {
    expect(niceMax([12, 47, 31])).toBe(50);
  });

  it("returns 1 for an empty series so the scale never divides by zero", () => {
    expect(niceMax([])).toBe(1);
  });

  it("returns 1 when every value is zero", () => {
    expect(niceMax([0, 0])).toBe(1);
  });
});

describe("scaleLinear", () => {
  it("maps the domain maximum onto the range maximum", () => {
    expect(scaleLinear(50, 100)(50)).toBe(100);
  });

  it("maps zero onto zero", () => {
    expect(scaleLinear(50, 100)(0)).toBe(0);
  });

  it("clamps a value beyond the domain to the range maximum", () => {
    expect(scaleLinear(50, 100)(75)).toBe(100);
  });
});
