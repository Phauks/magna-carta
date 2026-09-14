/*
 * Where a timed entry sits on an hour axis, and how it shares its column with whatever runs at the
 * same time. Every question a reader would argue about — what a fifteen-minute call looks like,
 * where an entry with no end goes, what three things at ten o'clock do to each other — is answered
 * here without a browser.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONCURRENCY,
  MINIMUM_BLOCK_MINUTES,
  placeTimeEntries,
  timeSpanOf,
} from "../src/lib/components/calendar-grid/time-placement.ts";
import type { CalendarGridEntry } from "../src/lib/components/calendar-grid/types.ts";

function entry(overrides: Partial<CalendarGridEntry> & { id: string }): CalendarGridEntry {
  return { date: "2026-09-15", label: "Hearing", tone: "neutral", ...overrides };
}

/** A working day, 07:00 to 19:00, as the axis the grid draws. */
const AXIS = { from: 7 * 60, to: 19 * 60 };

describe("timeSpanOf", () => {
  it("is null for an entry with no time, which is what all day means", () => {
    expect(timeSpanOf(entry({ id: "a" }))).toBeNull();
  });

  it("runs from the start to the end where both were recorded", () => {
    expect(timeSpanOf(entry({ id: "a", startMinute: 600, endMinute: 720 }))).toEqual({
      from: 600,
      to: 720,
    });
  });

  it("gives an entry with no end the minimum block rather than no height", () => {
    expect(timeSpanOf(entry({ id: "a", startMinute: 600 }))).toEqual({
      from: 600,
      to: 600 + MINIMUM_BLOCK_MINUTES,
    });
  });

  it("floors a short setting at the minimum, so a fifteen-minute call can hold its own label", () => {
    const span = timeSpanOf(entry({ id: "a", startMinute: 600, endMinute: 615 }));
    expect(span).toEqual({ from: 600, to: 600 + MINIMUM_BLOCK_MINUTES });
  });

  it("reads an end at or before the start as no end at all", () => {
    // A block of zero or negative height is not a smaller truth — it is an entry that vanished.
    expect(timeSpanOf(entry({ id: "a", startMinute: 600, endMinute: 600 }))?.to).toBe(
      600 + MINIMUM_BLOCK_MINUTES,
    );
    expect(timeSpanOf(entry({ id: "a", startMinute: 600, endMinute: 540 }))?.to).toBe(
      600 + MINIMUM_BLOCK_MINUTES,
    );
  });
});

describe("placeTimeEntries", () => {
  it("leaves out what has no time: the all-day band is the Day's, not this module's", () => {
    expect(placeTimeEntries([entry({ id: "a" })], AXIS)).toEqual([]);
  });

  it("places a block by its start and sizes it by its duration", () => {
    const [placed] = placeTimeEntries(
      [entry({ id: "a", startMinute: 10 * 60, endMinute: 13 * 60 })],
      AXIS,
    );
    // Three hours into a twelve-hour axis, running a quarter of it.
    expect(placed?.start).toBeCloseTo(3 / 12);
    expect(placed?.size).toBeCloseTo(3 / 12);
  });

  it("gives one entry the whole column", () => {
    const [placed] = placeTimeEntries([entry({ id: "a", startMinute: 600, endMinute: 660 })], AXIS);
    expect(placed?.inset).toBe(0);
    expect(placed?.width).toBe(1);
  });

  it("divides the column between things that run at the same time", () => {
    const placed = placeTimeEntries(
      [
        entry({ id: "a", startMinute: 600, endMinute: 720 }),
        entry({ id: "b", startMinute: 630, endMinute: 690 }),
      ],
      AXIS,
      "side-by-side",
    );
    expect(placed.map((held) => held.width)).toEqual([0.5, 0.5]);
    expect(placed.map((held) => held.inset)).toEqual([0, 0.5]);
  });

  it("divides a cluster on its own, so a busy morning never narrows a quiet afternoon", () => {
    const placed = placeTimeEntries(
      [
        entry({ id: "morning-a", startMinute: 9 * 60, endMinute: 10 * 60 }),
        entry({ id: "morning-b", startMinute: 9 * 60, endMinute: 10 * 60 }),
        entry({ id: "afternoon", startMinute: 15 * 60, endMinute: 16 * 60 }),
      ],
      AXIS,
      "side-by-side",
    );
    const byId = new Map(placed.map((held) => [held.entry.id, held]));
    expect(byId.get("morning-a")?.width).toBe(0.5);
    expect(byId.get("afternoon")?.width).toBe(1);
  });

  it("keeps a thing that starts when another ends in the same lane", () => {
    // Back-to-back is not concurrent, so the column is never divided for it and a reader's eye
    // tracks straight down one lane.
    const placed = placeTimeEntries(
      [
        entry({ id: "first", startMinute: 9 * 60, endMinute: 10 * 60 }),
        entry({ id: "second", startMinute: 10 * 60, endMinute: 11 * 60 }),
      ],
      AXIS,
      "side-by-side",
    );
    expect(placed.every((held) => held.width === 1)).toBe(true);
  });

  it("steps an overlapping stack in rather than dividing it", () => {
    const placed = placeTimeEntries(
      [
        entry({ id: "a", startMinute: 600, endMinute: 720 }),
        entry({ id: "b", startMinute: 630, endMinute: 690 }),
      ],
      AXIS,
      "overlap",
    );
    expect(placed[0]?.inset).toBe(0);
    expect(placed[0]?.width).toBe(1);
    // The second lies over the first, stepped in, and still runs to the column's far edge.
    expect(placed[1]?.inset).toBeGreaterThan(0);
    expect(placed[1]?.inset! + placed[1]?.width!).toBeCloseTo(1);
    expect(placed[1]?.depth).toBeGreaterThan(placed[0]!.depth);
  });

  it("is side by side unless the reader said otherwise", () => {
    expect(DEFAULT_CONCURRENCY).toBe("side-by-side");
  });

  it("orders a cluster by start and then longest first, so two renders of a day agree", () => {
    const placed = placeTimeEntries(
      [
        entry({ id: "short", startMinute: 600, endMinute: 660 }),
        entry({ id: "long", startMinute: 600, endMinute: 780 }),
      ],
      AXIS,
    );
    expect(placed.map((held) => held.entry.id)).toEqual(["long", "short"]);
  });
});
