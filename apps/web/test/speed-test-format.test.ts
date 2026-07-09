/*
 * Result formatting, pinned. An absent measurement renders as nothing — never as zero, which
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

  it("renders an absent measurement as nothing", () => {
    expect(formatBandwidth(undefined)).toBe("");
  });
});

describe("formatMilliseconds", () => {
  it("renders one decimal", () => {
    expect(formatMilliseconds(12.44)).toBe("12.4 ms");
  });

  it("renders an absent measurement as nothing", () => {
    expect(formatMilliseconds(undefined)).toBe("");
  });
});

describe("formatRatio", () => {
  it("renders a loss ratio as a percentage", () => {
    expect(formatRatio(0.004)).toBe("0.4%");
  });

  it("renders zero loss as 0%", () => {
    expect(formatRatio(0)).toBe("0%");
  });

  it("renders an absent measurement as nothing", () => {
    expect(formatRatio(undefined)).toBe("");
  });
});

describe("an absent measurement", () => {
  it("renders as nothing, not as an em dash", () => {
    expect(formatBandwidth(undefined)).toBe("");
    expect(formatMilliseconds(undefined)).toBe("");
    expect(formatRatio(undefined)).toBe("");
  });

  it("never renders as zero", () => {
    expect(formatBandwidth(undefined)).not.toMatch(/0/);
    expect(formatMilliseconds(undefined)).not.toMatch(/0/);
    expect(formatRatio(undefined)).not.toMatch(/0/);
  });

  it("still distinguishes a measured zero from an absent one", () => {
    expect(formatRatio(0)).toBe("0%");
    expect(formatRatio(undefined)).toBe("");
  });
});

describe("NOT_MEASURED_YET", () => {
  it("is the one sentence the page uses for a measurement not taken", () => {
    expect(NOT_MEASURED_YET).toBe("Not measured yet.");
  });
});
