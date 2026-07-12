/*
 * Chart geometry, pinned. An empty series must not produce a zero domain (which would divide by
 * zero and collapse every bar onto the baseline).
 */
import { describe, expect, it } from "vitest";
import { linePath, niceMax, scaleLinear } from "../src/lib/tools/speed-test/chart-scale.ts";

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

describe("linePath", () => {
  it("draws a polyline through every sample, left to right", () => {
    expect(linePath([0, 50, 100], 100, 200, 100)).toBe("M0,100 L100,50 L200,0");
  });

  it("plants a single sample at the left edge", () => {
    expect(linePath([50], 100, 200, 100)).toBe("M0,50");
  });

  it("returns an empty path for an empty series", () => {
    expect(linePath([], 100, 200, 100)).toBe("");
  });
});
