/*
 * One occurrence of a series, and a series cut at one: the arithmetic behind "this event only",
 * "this and all later events" and "all events", answered without a database or a browser.
 */
import { describe, expect, it } from "vitest";
import {
  civilDaysBetween,
  isOccurrenceOf,
  lastOccurrenceOf,
  movedLikeOccurrence,
  occurrencesOf,
  splitSeriesAt,
  weeklyRecurrence,
  type RecurrenceRule,
} from "../src/recurrence.ts";

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { ...weeklyRecurrence(), ...overrides };
}

// Tuesday 2026-11-10, then Tuesday and Thursday every second week.
const START = "2026-11-10";
const FORTNIGHTLY = rule({
  interval: 2,
  weekdays: ["TU", "TH"],
  end: { kind: "after", count: 12 },
});

describe("which days are occurrences", () => {
  it("answers yes for a day the series falls on and no for one it skips", () => {
    expect(isOccurrenceOf(FORTNIGHTLY, START, "2026-11-12")).toBe(true);
    expect(isOccurrenceOf(FORTNIGHTLY, START, "2026-11-17")).toBe(false);
    expect(isOccurrenceOf(FORTNIGHTLY, START, "2026-11-24")).toBe(true);
  });

  it("answers no before the series starts and after its count is spent", () => {
    expect(isOccurrenceOf(FORTNIGHTLY, START, "2026-11-03")).toBe(false);
    const last = lastOccurrenceOf(FORTNIGHTLY, START);
    expect(last).toBe("2027-01-21");
    expect(isOccurrenceOf(FORTNIGHTLY, START, "2027-02-02")).toBe(false);
  });
});

describe("the last day a series falls on", () => {
  it("is null for a series that never ends", () => {
    expect(lastOccurrenceOf(rule(), START)).toBeNull();
  });

  it("is the last occurrence on or before an end date, not the end date itself", () => {
    expect(lastOccurrenceOf(rule({ end: { kind: "on", date: "2026-12-07" } }), START)).toBe(
      "2026-12-01",
    );
  });
});

describe("moving every occurrence like one", () => {
  it("moves a date by the days the occurrence moved, in either direction", () => {
    expect(movedLikeOccurrence(START, "2026-11-24", "2026-11-25")).toBe("2026-11-11");
    expect(movedLikeOccurrence(START, "2026-11-24", "2026-11-23")).toBe("2026-11-09");
    expect(civilDaysBetween("2026-11-24", "2026-12-01")).toBe(7);
  });
});

describe("cutting a series at an occurrence", () => {
  it("shares a count out between the two halves instead of restarting it", () => {
    const { before, after } = splitSeriesAt(FORTNIGHTLY, START, "2026-11-24");
    expect(before?.end).toEqual({ kind: "after", count: 2 });
    expect(after.end).toEqual({ kind: "after", count: 10 });
    const earlier = occurrencesOf(before!, START, { from: START, to: "2027-12-31" });
    const later = occurrencesOf(after, "2026-11-24", { from: "2026-11-24", to: "2027-12-31" });
    expect([...earlier, ...later]).toEqual(
      occurrencesOf(FORTNIGHTLY, START, { from: START, to: "2027-12-31" }),
    );
  });

  it("ends an open series the day before the cut, and leaves the later half open", () => {
    const { before, after } = splitSeriesAt(rule(), START, "2026-12-01");
    expect(before?.end).toEqual({ kind: "on", date: "2026-11-30" });
    expect(after.end).toEqual({ kind: "never" });
  });

  it("has no earlier half when the cut is the series' first day", () => {
    expect(splitSeriesAt(FORTNIGHTLY, START, START).before).toBeNull();
  });
});
