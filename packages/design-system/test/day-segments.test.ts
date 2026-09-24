/*
 * What a day's hour axis holds, and what it leaves to the band above the hours. Asserted without a
 * browser, because what a Tuesday column shows during a Monday-to-Wednesday trial is a question a
 * reader would argue about — and the answer changed on 2026-09-18.
 */
import { describe, expect, it } from "vitest";
import { CalendarDate } from "@internationalized/date";
import { timedEntriesOn } from "../src/lib/components/calendar-grid/day-segments.ts";
import type { CalendarGridEntry } from "../src/lib/components/calendar-grid/types.ts";

function entry(overrides: Partial<CalendarGridEntry> & { id: string }): CalendarGridEntry {
  return { date: "2026-09-14", label: "Trial", tone: "neutral", ...overrides };
}

const MONDAY = new CalendarDate(2026, 9, 14);
const TUESDAY = new CalendarDate(2026, 9, 15);

/** Monday 09:00 to Wednesday 17:00 — the three-day trial the whole module is about. */
const TRIAL = entry({
  id: "trial",
  date: "2026-09-14",
  endDate: "2026-09-16",
  startMinute: 9 * 60,
  endMinute: 17 * 60,
});

describe("a trial that runs three days", () => {
  it("is on no day's axis, its own first day included: it belongs in the band above the hours", () => {
    expect(timedEntriesOn([TRIAL], MONDAY)).toEqual([]);
    expect(timedEntriesOn([TRIAL], TUESDAY)).toEqual([]);
  });
});

describe("what never reaches the hours", () => {
  it("leaves an entry with no hour to the band above them", () => {
    const filing = entry({ id: "filing", date: "2026-09-15" });
    expect(timedEntriesOn([filing], TUESDAY)).toEqual([]);
  });

  it("skips an entry whose date does not read as one", () => {
    expect(
      timedEntriesOn([entry({ id: "bad", date: "not a day", startMinute: 60 })], TUESDAY),
    ).toEqual([]);
  });
});

describe("an entry that is one day", () => {
  it("is handed through exactly as it came, on its own day only", () => {
    const hearing = entry({
      id: "hearing",
      date: "2026-09-15",
      startMinute: 9 * 60 + 30,
      endMinute: 11 * 60,
    });
    expect(timedEntriesOn([hearing], TUESDAY)).toEqual([hearing]);
    expect(timedEntriesOn([hearing], MONDAY)).toEqual([]);
  });

  it("reads an end BEFORE the start as a point on the start day, so it stays on the axis", () => {
    const muddled = entry({
      id: "muddled",
      date: "2026-09-15",
      endDate: "2026-09-13",
      startMinute: 9 * 60,
    });
    expect(timedEntriesOn([muddled], TUESDAY)).toEqual([muddled]);
    expect(timedEntriesOn([muddled], new CalendarDate(2026, 9, 13))).toEqual([]);
  });
});
