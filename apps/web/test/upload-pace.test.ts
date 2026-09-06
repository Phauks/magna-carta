import { describe, expect, it } from "vitest";
import {
  formatRate,
  formatRemaining,
  paceOf,
  paceText,
  withSample,
} from "$lib/file-manager/upload-pace.ts";

/*
 * The rate and the time remaining are read off byte samples over a trailing window. What is pinned:
 * the window keeps one foot outside itself so the rate exists the moment it fills, a stall reads as
 * stalled rather than as a stale promise, and the words say "about" because they are an estimate.
 */

describe("withSample", () => {
  it("drops samples past the window but keeps the newest one outside it as the foot", () => {
    let samples = withSample([], { at: 0, bytes: 0 }, 1_000);
    samples = withSample(samples, { at: 500, bytes: 50 }, 1_000);
    samples = withSample(samples, { at: 1_600, bytes: 160 }, 1_000);
    samples = withSample(samples, { at: 2_200, bytes: 220 }, 1_000);
    expect(samples.map((sample) => sample.at)).toEqual([500, 1_600, 2_200]);
  });
});

describe("paceOf", () => {
  it("has no rate until two samples a moment apart exist", () => {
    expect(paceOf([{ at: 0, bytes: 0 }], 100)).toEqual({
      bytesPerSecond: null,
      secondsRemaining: null,
    });
  });

  it("measures the rate across the window and the time left at that rate", () => {
    const pace = paceOf(
      [
        { at: 0, bytes: 0 },
        { at: 4_000, bytes: 4_096 * 1024 },
      ],
      8_192 * 1024,
    );
    expect(pace.bytesPerSecond).toBe(1024 * 1024);
    expect(pace.secondsRemaining).toBe(8);
  });

  it("reads a stall as stalled once the whole window has seen nothing move", () => {
    const pace = paceOf(
      [
        { at: 0, bytes: 500 },
        { at: 9_000, bytes: 500 },
      ],
      100,
    );
    expect(pace).toEqual({ bytesPerSecond: 0, secondsRemaining: null });
    expect(paceText(pace)).toBe("stalled");
  });

  it("says nothing, rather than stalled, while a pause is shorter than the window", () => {
    const pace = paceOf(
      [
        { at: 0, bytes: 500 },
        { at: 6_000, bytes: 500 },
      ],
      100,
    );
    expect(pace).toEqual({ bytesPerSecond: null, secondsRemaining: null });
    expect(paceText(pace)).toBe("");
  });
});

describe("the words", () => {
  it("prints the rate in the size column's units", () => {
    expect(formatRate(900)).toBe("900 B/s");
    expect(formatRate(2.4 * 1024 * 1024)).toBe("2.4 MB/s");
  });

  it("rounds the time left to what a reader can hold, and says about", () => {
    expect(formatRemaining(3)).toBe("a moment left");
    expect(formatRemaining(42)).toBe("about 45 s left");
    expect(formatRemaining(200)).toBe("about 3 min left");
    expect(formatRemaining(4_260)).toBe("about 1 h 11 min left");
    expect(formatRemaining(7_200)).toBe("about 2 h left");
  });

  it("joins rate and remaining into one tally phrase", () => {
    expect(paceText({ bytesPerSecond: 1024 * 1024, secondsRemaining: 30 })).toBe(
      "1.0 MB/s · about 30 s left",
    );
    expect(paceText({ bytesPerSecond: null, secondsRemaining: null })).toBe("");
  });
});
