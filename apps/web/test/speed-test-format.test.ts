/*
 * Result formatting, pinned. An absent measurement renders as "N/A" — never as zero, which
 * would be a measurement claim we did not make.
 */
import { describe, expect, it } from "vitest";
import {
  formatBandwidth,
  formatMilliseconds,
  formatRatio,
  NOT_MEASURED_YET,
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

  it("renders an absent measurement as N/A", () => {
    expect(formatBandwidth(undefined)).toBe("N/A");
  });
});

describe("formatMilliseconds", () => {
  it("renders one decimal", () => {
    expect(formatMilliseconds(12.44)).toBe("12.4 ms");
  });

  it("renders an absent measurement as N/A", () => {
    expect(formatMilliseconds(undefined)).toBe("N/A");
  });
});

describe("formatRatio", () => {
  it("renders a loss ratio as a percentage", () => {
    expect(formatRatio(0.004)).toBe("0.4%");
  });

  it("renders zero loss as 0%", () => {
    expect(formatRatio(0)).toBe("0%");
  });

  it("renders an absent measurement as N/A", () => {
    expect(formatRatio(undefined)).toBe("N/A");
  });
});

describe("an absent measurement", () => {
  it("reads N/A, so an empty field does not read as broken", () => {
    expect(formatBandwidth(undefined)).toBe("N/A");
    expect(formatMilliseconds(undefined)).toBe("N/A");
    expect(formatRatio(undefined)).toBe("N/A");
  });

  it("is never an em dash and never a zero", () => {
    expect(formatBandwidth(undefined)).not.toContain("—");
    expect(formatMilliseconds(undefined)).not.toMatch(/0/);
  });

  it("still distinguishes a measured zero from an absent one", () => {
    expect(formatRatio(0)).toBe("0%");
    expect(formatRatio(undefined)).toBe("N/A");
  });
});

describe("NOT_MEASURED_YET", () => {
  it("is the one sentence the page uses for a measurement not taken", () => {
    expect(NOT_MEASURED_YET).toBe("Not measured yet.");
  });
});
