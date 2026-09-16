/*
 * A timed entry that runs past midnight, cut into the piece it occupies on each day it covers.
 * Asserted without a browser, because what a Tuesday column shows during a Monday-to-Wednesday
 * trial is a question a reader would argue about.
 */
import { describe, expect, it } from "vitest";
import { CalendarDate } from "@internationalized/date";
import { segmentsForDay } from "../src/lib/components/calendar-grid/day-segments.ts";
import type { CalendarGridEntry } from "../src/lib/components/calendar-grid/types.ts";

function entry(overrides: Partial<CalendarGridEntry> & { id: string }): CalendarGridEntry {
  return { date: "2026-09-14", label: "Trial", tone: "neutral", ...overrides };
}

const MONDAY = new CalendarDate(2026, 9, 14);
const TUESDAY = new CalendarDate(2026, 9, 15);
const WEDNESDAY = new CalendarDate(2026, 9, 16);
const THURSDAY = new CalendarDate(2026, 9, 17);

/** Monday 09:00 to Wednesday 17:00 — the three-day trial the whole module is about. */
const TRIAL = entry({
  id: "trial",
  date: "2026-09-14",
  endDate: "2026-09-16",
  startMinute: 9 * 60,
  endMinute: 17 * 60,
});

describe("a trial that runs three days", () => {
  it("runs from its start hour to midnight on the first day", () => {
    const [segment] = segmentsForDay([TRIAL], MONDAY);
    expect(segment?.entry.startMinute).toBe(9 * 60);
    expect(segment?.entry.endMinute).toBe(24 * 60);
    expect(segment?.continuesBefore).toBe(false);
    expect(segment?.continuesAfter).toBe(true);
  });

  it("is the WHOLE column on a day in the middle", () => {
    const [segment] = segmentsForDay([TRIAL], TUESDAY);
    expect(segment?.entry.startMinute).toBe(0);
    expect(segment?.entry.endMinute).toBe(24 * 60);
    expect(segment?.continuesBefore).toBe(true);
    expect(segment?.continuesAfter).toBe(true);
  });

  it("runs from midnight to its end hour on the last day", () => {
    const [segment] = segmentsForDay([TRIAL], WEDNESDAY);
    expect(segment?.entry.startMinute).toBe(0);
    expect(segment?.entry.endMinute).toBe(17 * 60);
    expect(segment?.continuesBefore).toBe(true);
    expect(segment?.continuesAfter).toBe(false);
  });

  it("is absent on a day the trial does not reach", () => {
    expect(segmentsForDay([TRIAL], THURSDAY)).toEqual([]);
    expect(segmentsForDay([TRIAL], new CalendarDate(2026, 9, 13))).toEqual([]);
  });

  it("gives every piece its own id, so a grid keyed on it renders all three", () => {
    const ids = [MONDAY, TUESDAY, WEDNESDAY].flatMap((day) =>
      segmentsForDay([TRIAL], day).map((segment) => segment.entry.id),
    );
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toContain("trial");
  });

  it("puts each piece on the day it was cut for", () => {
    expect(segmentsForDay([TRIAL], TUESDAY)[0]?.entry.date).toBe("2026-09-15");
  });
});

describe("what never reaches the hours", () => {
  it("skips an entry with no hour, which belongs in the band above them", () => {
    const filing = entry({ id: "filing", endDate: "2026-09-16" });
    expect(segmentsForDay([filing], TUESDAY)).toEqual([]);
  });

  it("skips an entry whose date does not read as one", () => {
    expect(
      segmentsForDay([entry({ id: "bad", date: "not a day", startMinute: 60 })], TUESDAY),
    ).toEqual([]);
  });
});

describe("an entry that is one day", () => {
  it("is handed through exactly as it came, not cut", () => {
    const hearing = entry({
      id: "hearing",
      date: "2026-09-15",
      startMinute: 9 * 60 + 30,
      endMinute: 11 * 60,
    });
    const [segment] = segmentsForDay([hearing], TUESDAY);
    expect(segment?.entry).toBe(hearing);
    expect(segment?.continuesBefore).toBe(false);
    expect(segment?.continuesAfter).toBe(false);
  });

  it("reads an end BEFORE the start as a point on the start day", () => {
    const muddled = entry({
      id: "muddled",
      date: "2026-09-15",
      endDate: "2026-09-13",
      startMinute: 9 * 60,
    });
    expect(segmentsForDay([muddled], TUESDAY)).toHaveLength(1);
    expect(segmentsForDay([muddled], new CalendarDate(2026, 9, 13))).toEqual([]);
  });

  it("leaves the last day a point where the record stated no end", () => {
    const open = entry({ id: "open", date: "2026-09-14", endDate: "2026-09-15", startMinute: 600 });
    expect(segmentsForDay([open], TUESDAY)[0]?.entry.endMinute).toBeUndefined();
  });
});
