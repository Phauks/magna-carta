/*
 * Which cell a block is rendered in, and the style that draws it there. The questions a reader
 * would argue about — where a 09:30 start sits inside the nine o'clock cell, what happens to a
 * block that begins before the hours drawn — answered without a browser.
 */
import { describe, expect, it } from "vitest";
import {
  blockStyle,
  blocksByStartingHour,
} from "../src/lib/components/calendar-grid/time-blocks.ts";
import { placeTimeEntries } from "../src/lib/components/calendar-grid/time-placement.ts";
import type { CalendarGridEntry } from "../src/lib/components/calendar-grid/types.ts";

function entry(overrides: Partial<CalendarGridEntry> & { id: string }): CalendarGridEntry {
  return { date: "2026-09-15", label: "Hearing", tone: "neutral", ...overrides };
}

const HOURS = { first: 7, last: 18 };
const AXIS = { from: 7 * 60, to: 19 * 60 };

describe("which cell a block is rendered in", () => {
  it("is the cell of the hour it starts in", () => {
    const placed = placeTimeEntries(
      [entry({ id: "a", startMinute: 9 * 60 + 30, endMinute: 11 * 60 })],
      AXIS,
    );
    const byHour = blocksByStartingHour(placed, HOURS, AXIS);
    expect([...byHour.keys()]).toEqual([9 * 60]);
  });

  it("pulls a block beginning before the hours drawn into the first row rather than dropping it", () => {
    const placed = placeTimeEntries([entry({ id: "a", startMinute: 2 * 60 })], AXIS);
    const byHour = blocksByStartingHour(placed, HOURS, AXIS);
    expect([...byHour.keys()]).toEqual([HOURS.first * 60]);
  });

  it("keeps several blocks that start in one hour together, in placement order", () => {
    const placed = placeTimeEntries(
      [
        entry({ id: "long", startMinute: 10 * 60, endMinute: 12 * 60 }),
        entry({ id: "short", startMinute: 10 * 60, endMinute: 11 * 60 }),
      ],
      AXIS,
    );
    const inTen = blocksByStartingHour(placed, HOURS, AXIS).get(10 * 60);
    expect(inTen?.map((block) => block.entry.id)).toEqual(["long", "short"]);
  });
});

describe("the style that draws a block", () => {
  it("offsets it into its cell by how far past the hour it starts", () => {
    const [placed] = placeTimeEntries(
      [entry({ id: "a", startMinute: 9 * 60 + 30, endMinute: 11 * 60 })],
      AXIS,
    );
    const style = blockStyle(placed!, 9 * 60, AXIS);
    expect(style).toContain("inset-block-start: calc(var(--mc-calendar-grid-hour-size) * 0.5)");
  });

  it("sizes it in hours, so it runs across every row it occupies", () => {
    const [placed] = placeTimeEntries(
      [entry({ id: "a", startMinute: 9 * 60, endMinute: 12 * 60 })],
      AXIS,
    );
    expect(blockStyle(placed!, 9 * 60, AXIS)).toContain(
      "block-size: calc(var(--mc-calendar-grid-hour-size) * 3)",
    );
  });

  it("gives a block that starts on the hour no offset at all", () => {
    const [placed] = placeTimeEntries(
      [entry({ id: "a", startMinute: 14 * 60, endMinute: 15 * 60 })],
      AXIS,
    );
    expect(blockStyle(placed!, 14 * 60, AXIS)).toContain(
      "inset-block-start: calc(var(--mc-calendar-grid-hour-size) * 0)",
    );
  });

  it("states its share of the column across, and its place in the stack", () => {
    const placed = placeTimeEntries(
      [
        entry({ id: "a", startMinute: 10 * 60, endMinute: 11 * 60 }),
        entry({ id: "b", startMinute: 10 * 60, endMinute: 11 * 60 }),
      ],
      AXIS,
      "side-by-side",
    );
    const second = blockStyle(placed[1]!, 10 * 60, AXIS);
    expect(second).toContain("inset-inline-start: 50%");
    expect(second).toContain("inline-size: 50%");
    expect(second).toContain("z-index: 2");
  });
});
