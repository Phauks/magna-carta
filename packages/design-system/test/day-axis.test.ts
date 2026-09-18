/*
 * The Day's arithmetic: which hours it draws, which column an entry lands in, and which hour row.
 *
 * Every question a reader would argue about is here rather than in the component, so a firm's 7am
 * deposition widening the day and an entry naming a column that is not there are both answered
 * without a browser.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIRST_HOUR,
  DEFAULT_LAST_HOUR,
  SINGLE_LANE_KEY,
  dayHours,
  dayLanes,
  hourOf,
  hourSlots,
  inAllDayBand,
  laneOf,
  placeDayEntries,
  wallClockMinutes,
} from "../src/lib/components/calendar-grid/day-axis.ts";
import type {
  CalendarGridEntry,
  CalendarGridLane,
} from "../src/lib/components/calendar-grid/types.ts";

function entry(overrides: Partial<CalendarGridEntry> & { id: string }): CalendarGridEntry {
  return { date: "2026-09-15", label: "Hearing", tone: "neutral", ...overrides };
}

const LANES: readonly CalendarGridLane[] = [
  { key: "ada", label: "Ada Lovelace" },
  { key: "grace", label: "Grace Hopper" },
];

describe("the hours a day draws", () => {
  it("is the working day when nothing pulls it wider", () => {
    expect(dayHours([])).toEqual({ first: DEFAULT_FIRST_HOUR, last: DEFAULT_LAST_HOUR });
  });

  it("widens for anything earlier or later, and never narrows", () => {
    const early = entry({ id: "a", startMinute: 6 * 60 + 30 });
    const late = entry({ id: "b", startMinute: 21 * 60 });
    expect(dayHours([early, late])).toEqual({ first: 6, last: 21 });
    // A 9am hearing does not narrow a day that opens at seven.
    expect(dayHours([entry({ id: "c", startMinute: 9 * 60 })])).toEqual({
      first: DEFAULT_FIRST_HOUR,
      last: DEFAULT_LAST_HOUR,
    });
  });

  it("does not spend a row on an hour a meeting only ends ON", () => {
    // A trial to 20:00 is over at 20:00; a row for it would be empty under every tidy afternoon.
    const toEight = entry({ id: "a", startMinute: 14 * 60, endMinute: 20 * 60 });
    expect(dayHours([toEight]).last).toBe(19);
    const pastEight = entry({ id: "b", startMinute: 14 * 60, endMinute: 20 * 60 + 1 });
    expect(dayHours([pastEight]).last).toBe(20);
  });

  it("never widens for a run of days: a span's hours are the band's, not the axis's", () => {
    const trial = entry({
      id: "trial",
      endDate: "2026-09-17",
      startMinute: 2 * 60,
      endMinute: 23 * 60,
    });
    expect(dayHours([trial])).toEqual({ first: DEFAULT_FIRST_HOUR, last: DEFAULT_LAST_HOUR });
  });

  it("leaves an all-day entry out of the range entirely", () => {
    expect(dayHours([entry({ id: "a" })])).toEqual({
      first: DEFAULT_FIRST_HOUR,
      last: DEFAULT_LAST_HOUR,
    });
  });

  it("answers a row per hour, inclusive of both ends", () => {
    expect(hourSlots({ first: 9, last: 11 })).toEqual([540, 600, 660]);
  });
});

describe("the columns a day draws", () => {
  it("is one unnamed column where the caller named none", () => {
    expect(dayLanes(undefined)).toEqual([{ key: SINGLE_LANE_KEY, label: "" }]);
    expect(dayLanes([])).toEqual([{ key: SINGLE_LANE_KEY, label: "" }]);
  });

  it("puts an entry in the column it names", () => {
    expect(laneOf(entry({ id: "a", lane: "grace" }), LANES)).toBe("grace");
  });

  it("puts an entry naming no column, or one that is not there, in the first", () => {
    // A row a reader can see in the wrong column is a smaller wrong than a row that vanished.
    expect(laneOf(entry({ id: "a" }), LANES)).toBe("ada");
    expect(laneOf(entry({ id: "b", lane: "nobody" }), LANES)).toBe("ada");
  });
});

describe("where a day's entries land", () => {
  const morning = entry({ id: "a", lane: "ada", startMinute: 9 * 60 + 30 });
  const alsoMorning = entry({ id: "b", lane: "ada", startMinute: 9 * 60 + 45 });
  const afternoon = entry({ id: "c", lane: "grace", startMinute: 14 * 60 });
  const filing = entry({ id: "d", lane: "grace" });
  const placed = placeDayEntries([morning, alsoMorning, afternoon, filing], LANES);

  it("puts what has no hour in the band above the hours", () => {
    expect(placed.allDay.get("grace")).toEqual([filing]);
    expect(placed.allDay.get("ada")).toEqual([]);
  });

  it("puts a run of days in the band too, hours or no hours", () => {
    // A three-day trial is a fact about days; drawn on the axis it was three full columns.
    const trial = entry({ id: "trial", lane: "ada", endDate: "2026-09-17", startMinute: 9 * 60 });
    const placedTrial = placeDayEntries([trial], LANES);
    expect(placedTrial.allDay.get("ada")).toEqual([trial]);
    expect(placedTrial.timed.get("ada")).toEqual([]);
  });

  it("keeps a timed entry in its own column, for the axis to place", () => {
    // WHERE on the axis it lands is time-placement.ts's answer; this module only says which
    // column holds it and that the hours hold it at all.
    expect(placed.timed.get("ada")).toEqual([morning, alsoMorning]);
    expect(placed.timed.get("grace")).toEqual([afternoon]);
  });

  it("gives every column a place to put things, empty or not", () => {
    expect([...placed.allDay.keys()]).toEqual(["ada", "grace"]);
    expect([...placed.timed.keys()]).toEqual(["ada", "grace"]);
  });

  it("keeps an entry outside the hours drawn rather than dropping it", () => {
    // The range already grew to hold it; a caller that clamped the hours by hand still gets the
    // entry, and the axis clips the block rather than losing the record.
    const dawn = entry({ id: "e", lane: "ada", startMinute: 2 * 60 });
    expect(placeDayEntries([dawn], LANES).timed.get("ada")).toEqual([dawn]);
  });
});

describe("a wall clock as minutes", () => {
  it("reads an HH:MM", () => {
    expect(wallClockMinutes("09:30")).toBe(570);
    expect(wallClockMinutes("00:00")).toBe(0);
    expect(wallClockMinutes("23:59")).toBe(1439);
  });

  it("refuses anything that is not one", () => {
    for (const text of ["9am", "24:00", "09:60", "", "9:5", "09:30:00"]) {
      expect(wallClockMinutes(text)).toBeNull();
    }
  });

  it("clamps an hour to a real one", () => {
    expect(hourOf(-30)).toBe(0);
    expect(hourOf(60 * 30)).toBe(23);
  });
});

describe("what the band above the hours holds", () => {
  it("is anything with no hour", () => {
    expect(inAllDayBand(entry({ id: "filing" }))).toBe(true);
  });

  it("is anything that runs past its day, whatever its hours", () => {
    expect(inAllDayBand(entry({ id: "trial", endDate: "2026-09-17", startMinute: 540 }))).toBe(
      true,
    );
  });

  it("is not a timed entry that ends on its own day, or one whose end reads before its start", () => {
    expect(inAllDayBand(entry({ id: "hearing", startMinute: 540 }))).toBe(false);
    expect(inAllDayBand(entry({ id: "same", endDate: "2026-09-15", startMinute: 540 }))).toBe(
      false,
    );
    expect(inAllDayBand(entry({ id: "muddled", endDate: "2026-09-01", startMinute: 540 }))).toBe(
      false,
    );
  });
});
