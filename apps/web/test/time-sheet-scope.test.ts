/*
 * The Time Sheet's date scope.
 *
 * Two things are worth holding still here, because both were designed against a specific failure.
 * A preset's NAME and its SPAN come from one place, so "This week" can never be printed over three
 * days; and a row whose date falls outside the range in view WIDENS the range rather than
 * disappearing, because a row that saved and then vanished reads as work lost.
 */
import { describe, expect, it } from "vitest";
import {
  customRangeOutcome,
  isScopeShowing,
  monthDay,
  scopeHolds,
  scopePreset,
  shiftDays,
  spanLabel,
  widenedScope,
} from "../src/lib/time/time-sheet-scope.ts";

const WEDNESDAY = "2026-08-26";

describe("named spans", () => {
  it("names today as today, and spans one day", () => {
    const scope = scopePreset("today", WEDNESDAY, 1);
    expect(scope.from).toBe(WEDNESDAY);
    expect(scope.to).toBe(WEDNESDAY);
    expect(scope.label).toBe("Today, Aug 26");
  });

  it("names yesterday as the day before, and spans that day", () => {
    const scope = scopePreset("yesterday", WEDNESDAY, 1);
    expect(scope.from).toBe("2026-08-25");
    expect(scope.to).toBe("2026-08-25");
    expect(scope.label).toBe("Yesterday, Aug 25");
  });

  it("spans last week as the seven days before the current one", () => {
    const scope = scopePreset("lastWeek", WEDNESDAY, 1);
    expect(scope.from).toBe("2026-08-17");
    expect(scope.to).toBe("2026-08-23");
    expect(scope.label).toBe("Last week, Aug 17 to 23");
  });

  it("spans this month from its first day to its last, whatever the month's length", () => {
    const scope = scopePreset("month", WEDNESDAY, 1);
    expect(scope.from).toBe("2026-08-01");
    expect(scope.to).toBe("2026-08-31");
    expect(scope.label).toBe("This month, Aug 1 to 31");
  });

  it("spans last month, and crosses the year boundary rather than naming month zero", () => {
    const inJanuary = scopePreset("lastMonth", "2026-01-14", 1);
    expect(inJanuary.from).toBe("2025-12-01");
    expect(inJanuary.to).toBe("2025-12-31");
    expect(inJanuary.label).toBe("Last month, Dec 1 to 31");
  });

  it("gets February's length right in a leap year, from the calendar rather than a table", () => {
    // 2028 is a leap year; a month-length table is the classic place that gets this wrong.
    expect(scopePreset("month", "2028-02-09", 1).to).toBe("2028-02-29");
    expect(scopePreset("month", "2026-02-09", 1).to).toBe("2026-02-28");
  });

  it("spans the firm's WHOLE week, and says which days that was", () => {
    const scope = scopePreset("week", WEDNESDAY, 1);
    expect(scope.from).toBe("2026-08-24");
    expect(scope.to).toBe("2026-08-30");
    expect(scope.label).toBe("This week, Aug 24 to 30");
  });

  it("moves the week with the firm's own first weekday", () => {
    const sundayFirst = scopePreset("week", WEDNESDAY, 0);
    expect(sundayFirst.from).toBe("2026-08-23");
    expect(sundayFirst.to).toBe("2026-08-29");
  });

  it("marks the preset that is actually showing", () => {
    const today = scopePreset("today", WEDNESDAY, 1);
    expect(isScopeShowing(today, scopePreset("today", WEDNESDAY, 1))).toBe(true);
    expect(isScopeShowing(today, scopePreset("week", WEDNESDAY, 1))).toBe(false);
  });
});

describe("how a span reads", () => {
  it("reads one day as that day", () => {
    expect(spanLabel(WEDNESDAY, WEDNESDAY)).toBe("Aug 26");
  });

  it("does not repeat the month inside one month", () => {
    expect(spanLabel("2026-08-24", "2026-08-30")).toBe("Aug 24 to 30");
  });

  it("names both months across a boundary", () => {
    expect(spanLabel("2026-08-30", "2026-09-02")).toBe("Aug 30 to Sep 2");
  });

  it("drops a leading zero from the day", () => {
    expect(monthDay("2026-08-05")).toBe("Aug 5");
  });
});

describe("shifting days", () => {
  it("crosses a month boundary", () => {
    expect(shiftDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDays("2026-09-01", -1)).toBe("2026-08-31");
  });
});

describe("a row never falls out of view", () => {
  const scope = scopePreset("today", WEDNESDAY, 1);

  it("holds a date inside the span", () => {
    expect(scopeHolds(scope, WEDNESDAY)).toBe(true);
    expect(scopeHolds(scope, "2026-08-20")).toBe(false);
  });

  it("does not widen for a date already in view", () => {
    expect(widenedScope(scope, WEDNESDAY, "row you just added")).toBeNull();
  });

  it("widens BACKWARDS for an earlier date, and says why", () => {
    const widened = widenedScope(scope, "2026-08-20", "row you just re-dated");
    expect(widened?.from).toBe("2026-08-20");
    expect(widened?.to).toBe(WEDNESDAY);
    expect(widened?.note).toBe("widened to include the row you just re-dated on Aug 20");
  });

  it("widens FORWARDS for a later date", () => {
    const widened = widenedScope(scope, "2026-09-04", "row you just added");
    expect(widened?.from).toBe(WEDNESDAY);
    expect(widened?.to).toBe("2026-09-04");
  });
});

describe("a hand-picked range", () => {
  it("applies as it is picked", () => {
    const outcome = customRangeOutcome("2026-08-01", "2026-08-07");
    expect(outcome.kind).toBe("applied");
    if (outcome.kind !== "applied") return;
    expect(outcome.scope.label).toBe("Aug 1 to 7");
  });

  it("refuses a half-picked range rather than guessing the other half", () => {
    expect(customRangeOutcome("2026-08-01", "").kind).toBe("refused");
    expect(customRangeOutcome("", "2026-08-07").kind).toBe("refused");
  });

  it("refuses a backwards range rather than silently swapping it", () => {
    const outcome = customRangeOutcome("2026-08-07", "2026-08-01");
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toContain("range isn't applied");
  });
});
