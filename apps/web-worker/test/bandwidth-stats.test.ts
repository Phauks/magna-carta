/*
 * The distribution behind the headline. The headline itself is the engine's 90th percentile; these
 * are the numbers that let a reader judge it. A 99th percentile is deliberately absent: one run
 * yields ~33 download samples, and at that size p99 is the maximum with decorations.
 */
import { describe, expect, it } from "vitest";
import { bandwidthStats, percentile } from "../src/lib/tools/speed-test/bandwidth-stats.ts";

describe("percentile", () => {
  it("returns the median at 0.5", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it("uses nearest-rank, so p95 of ten values is the tenth", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });

  it("returns the single value for a one-element set", () => {
    expect(percentile([7], 0.95)).toBe(7);
  });

  it("returns null for an empty set", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("does not care about input order", () => {
    expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
  });
});

describe("bandwidthStats", () => {
  it("summarizes the sample set", () => {
    const points = [10, 20, 30, 40].map((bps) => ({ bps }));
    expect(bandwidthStats(points)).toEqual({ median: 20, p95: 40, peak: 40, samples: 4 });
  });

  it("returns null when nothing was measured", () => {
    expect(bandwidthStats([])).toBeNull();
  });
});
