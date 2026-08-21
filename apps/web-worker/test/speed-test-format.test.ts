/*
 * Result formatting, pinned. An absent measurement renders as the absence marker — never as zero,
 * which would be a measurement claim we did not make. What the marker itself is (and that it is a
 * hyphen, never an em dash) is pinned in absence.test.ts; here we only pin that the formatters
 * defer to it.
 */
import { describe, expect, it } from "vitest";
import { ABSENT_MARKER } from "../src/lib/tools/speed-test/absence.ts";
import {
  formatBandwidth,
  formatMilliseconds,
  formatRatio,
} from "../src/lib/tools/speed-test/speed-test-format.ts";

describe("formatBandwidth", () => {
  it("renders megabits with one decimal below 100", () => {
    expect(formatBandwidth(94_500_000)).toBe("94.5 Mbps");
  });

  it("drops the decimal at or above 100 Mbps", () => {
    expect(formatBandwidth(432_000_000)).toBe("432 Mbps");
  });

  it("switches to gigabits at or above 1 Gbps", () => {
    expect(formatBandwidth(1_240_000_000)).toBe("1.24 Gbps");
  });

  it("renders an absent measurement as the marker", () => {
    expect(formatBandwidth(undefined)).toBe(ABSENT_MARKER);
  });
});

describe("formatMilliseconds", () => {
  it("renders one decimal", () => {
    expect(formatMilliseconds(12.44)).toBe("12.4 ms");
  });

  it("renders an absent measurement as the marker", () => {
    expect(formatMilliseconds(undefined)).toBe(ABSENT_MARKER);
  });
});

describe("formatRatio", () => {
  it("renders a loss ratio as a percentage", () => {
    expect(formatRatio(0.004)).toBe("0.4%");
  });

  it("renders zero loss as 0%", () => {
    expect(formatRatio(0)).toBe("0%");
  });

  it("renders an absent measurement as the marker", () => {
    expect(formatRatio(undefined)).toBe(ABSENT_MARKER);
  });
});

describe("an absent measurement", () => {
  it("reads as the marker, so an empty field does not read as broken", () => {
    expect(formatBandwidth(undefined)).toBe(ABSENT_MARKER);
    expect(formatMilliseconds(undefined)).toBe(ABSENT_MARKER);
    expect(formatRatio(undefined)).toBe(ABSENT_MARKER);
  });

  it("is never an em dash and never a zero", () => {
    expect(formatBandwidth(undefined)).not.toContain("—");
    expect(formatMilliseconds(undefined)).not.toMatch(/0/);
  });

  it("still distinguishes a measured zero from an absent one", () => {
    expect(formatRatio(0)).toBe("0%");
    expect(formatRatio(undefined)).toBe(ABSENT_MARKER);
  });
});
