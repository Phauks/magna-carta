/*
 * The written-out send time. Pinned against fixed zones rather than the machine's own, because the
 * whole point of the shape is that it resolves for somebody who is not in the zone that rendered it.
 */
import { describe, expect, it } from "vitest";
import { longDate, sentStamp } from "../src/lib/auth/sent-stamp.ts";

const SEPTEMBER = new Date("2026-09-04T21:03:00Z");
const JANUARY = new Date("2026-01-04T21:03:00Z");

describe("longDate", () => {
  it("spells the month out", () => {
    expect(longDate(SEPTEMBER, "UTC")).toBe("September 4, 2026");
  });

  it("never renders a numeric date, which half the world reads the other way round", () => {
    expect(longDate(SEPTEMBER, "UTC")).not.toMatch(/\d{1,2}\/\d{1,2}/);
  });
});

describe("sentStamp", () => {
  it("carries the date, a 24-hour clock, the zone abbreviation and the offset", () => {
    expect(sentStamp(SEPTEMBER, "America/Los_Angeles")).toBe(
      "September 4, 2026, 14:03 PDT (UTC-07:00)",
    );
  });

  it("derives the abbreviation from the instant, so summer and winter differ by themselves", () => {
    expect(sentStamp(JANUARY, "America/Los_Angeles")).toBe(
      "January 4, 2026, 13:03 PST (UTC-08:00)",
    );
  });

  it("spells the zero offset out rather than printing a bare name", () => {
    // A zone sitting exactly on UTC reports "GMT" with no numbers on it.
    expect(sentStamp(SEPTEMBER, "UTC")).toBe("September 4, 2026, 21:03 UTC (UTC+00:00)");
  });
});
