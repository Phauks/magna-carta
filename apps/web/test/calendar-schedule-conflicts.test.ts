/*
 * What a proposed setting would collide with. Every question a reader would argue about — whether
 * back-to-back is a conflict, whether a vacated hearing still competes for a Tuesday, what an
 * all-day filing collides with — answered without a browser.
 */
import { describe, expect, it } from "vitest";
import type { CalendarEntry } from "$lib/calendar/calendar-entries.ts";
import {
  conflictSentence,
  conflictedDays,
  scheduleConflicts,
} from "$lib/calendar/schedule-conflicts.ts";

function entry(overrides: Partial<CalendarEntry> & { id: string }): CalendarEntry {
  return {
    date: "2026-01-06",
    label: "Hearing",
    tone: "neutral",
    kind: "event",
    sourceKeys: [],
    recordId: overrides.id,
    matterId: null,
    link: null,
    settled: false,
    ...overrides,
  } as CalendarEntry;
}

/** Nine to ten on the sixth. */
const MORNING = { date: "2026-01-06", startMinute: 540, endMinute: 600 };

describe("what a proposed setting collides with", () => {
  it("is nothing when the calendar is clear", () => {
    expect(scheduleConflicts([MORNING], [])).toEqual([]);
  });

  it("is nothing when the other record is on another day", () => {
    const other = entry({ id: "a", date: "2026-01-07", startMinute: 540, endMinute: 600 });
    expect(scheduleConflicts([MORNING], [other])).toEqual([]);
  });

  it("finds a record whose hours overlap on the same day", () => {
    const other = entry({ id: "a", startMinute: 570, endMinute: 630 });
    expect(scheduleConflicts([MORNING], [other]).map((held) => held.entry.id)).toEqual(["a"]);
  });

  it("does not call back-to-back a conflict", () => {
    // Ending at ten and starting at ten is a full morning, not a collision.
    const after = entry({ id: "a", startMinute: 600, endMinute: 660 });
    const before = entry({ id: "b", startMinute: 480, endMinute: 540 });
    expect(scheduleConflicts([MORNING], [after, before])).toEqual([]);
  });

  it("collides with an all-day record on the same day, and it with anything", () => {
    // A filing due that day and a hearing that day are both true of the day.
    const allDay = entry({ id: "a" });
    expect(scheduleConflicts([MORNING], [allDay]).map((held) => held.entry.id)).toEqual(["a"]);
    const timed = entry({ id: "b", startMinute: 900, endMinute: 960 });
    expect(
      scheduleConflicts([{ date: "2026-01-06" }], [timed]).map((held) => held.entry.id),
    ).toEqual(["b"]);
  });

  it("treats a record with no end as a point, competing only with what is running then", () => {
    const point = entry({ id: "a", startMinute: 570 });
    expect(scheduleConflicts([MORNING], [point]).map((held) => held.entry.id)).toEqual(["a"]);
    const later = entry({ id: "b", startMinute: 660 });
    expect(scheduleConflicts([MORNING], [later])).toEqual([]);
  });

  it("leaves a settled record out: a vacated hearing competes for nobody's Tuesday", () => {
    const vacated = entry({ id: "a", startMinute: 540, endMinute: 600, settled: true });
    expect(scheduleConflicts([MORNING], [vacated])).toEqual([]);
  });

  it("leaves the record being edited out, so a setting never conflicts with itself", () => {
    const itself = entry({ id: "a", startMinute: 540, endMinute: 600 });
    expect(scheduleConflicts([MORNING], [itself], { ignoreRecordId: "a" })).toEqual([]);
  });

  it("reads down the calendar rather than in the order the reads landed", () => {
    const later = entry({ id: "late", date: "2026-02-03", startMinute: 540, endMinute: 600 });
    const earlier = entry({ id: "early", date: "2026-01-06", startMinute: 540, endMinute: 600 });
    const conflicts = scheduleConflicts(
      [{ date: "2026-02-03", startMinute: 540, endMinute: 600 }, MORNING],
      [later, earlier],
    );
    expect(conflicts.map((held) => held.date)).toEqual(["2026-01-06", "2026-02-03"]);
  });
});

describe("a recurring setting's conflicts", () => {
  const weekly = [
    { date: "2026-01-06", startMinute: 540, endMinute: 600 },
    { date: "2026-01-13", startMinute: 540, endMinute: 600 },
    { date: "2026-01-20", startMinute: 540, endMinute: 600 },
  ];

  it("counts every occurrence, not just the first", () => {
    // The whole reason this exists: nobody scrolls a year to check a weekly setting by eye.
    const busy = [
      entry({ id: "a", date: "2026-01-13", startMinute: 540, endMinute: 600 }),
      entry({ id: "b", date: "2026-01-20", startMinute: 570, endMinute: 630 }),
    ];
    expect(scheduleConflicts(weekly, busy).map((held) => held.date)).toEqual([
      "2026-01-13",
      "2026-01-20",
    ]);
  });

  it("counts DAYS rather than collisions, which is the question a person asks", () => {
    const crowded = [
      entry({ id: "a", date: "2026-01-13", startMinute: 540, endMinute: 600 }),
      entry({ id: "b", date: "2026-01-13", startMinute: 550, endMinute: 610 }),
    ];
    const conflicts = scheduleConflicts(weekly, crowded);
    expect(conflicts).toHaveLength(2);
    expect(conflictedDays(conflicts)).toBe(1);
  });
});

describe("what the form says about them", () => {
  it("says nothing when there is nothing to say", () => {
    expect(conflictSentence([], 12)).toBeNull();
  });

  it("names the hour for a one-off", () => {
    const one = scheduleConflicts(
      [MORNING],
      [entry({ id: "a", startMinute: 540, endMinute: 600 })],
    );
    expect(conflictSentence(one, 1)).toBe(
      "Something else is already on this calendar at that hour.",
    );
  });

  it("counts dates out of the series for a repeating one", () => {
    const busy = [
      entry({ id: "a", date: "2026-01-13", startMinute: 540, endMinute: 600 }),
      entry({ id: "b", date: "2026-01-20", startMinute: 540, endMinute: 600 }),
    ];
    const conflicts = scheduleConflicts(
      [
        { date: "2026-01-06", startMinute: 540, endMinute: 600 },
        { date: "2026-01-13", startMinute: 540, endMinute: 600 },
        { date: "2026-01-20", startMinute: 540, endMinute: 600 },
      ],
      busy,
    );
    expect(conflictSentence(conflicts, 3)).toBe(
      "2 of the 3 dates already have something on the calendar at that hour.",
    );
  });
});
