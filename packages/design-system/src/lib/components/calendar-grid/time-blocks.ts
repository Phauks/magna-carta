/*
 * Turning a placed entry into the cell it is rendered in and the style that draws it.
 *
 * A time grid is a real table — hours down the side, calendars or days across the top — and an
 * entry lives in the cell of the hour it STARTS in, because that is where a screen reader reading
 * the table row by row should meet it. What it looks like is another question: a block runs from
 * its start to its end, which is usually further down the table than the cell it sits in. So the
 * cell is the positioning context and the block is placed inside it, overflowing downwards.
 *
 * THE ARITHMETIC IS IN HOURS OF THE ROW, not pixels. Every hour row is one step tall
 * (`--mc-calendar-grid-hour-size`), so a block's offset and height are that step multiplied by a
 * number of hours, and the grid can restyle the step without touching this. Percentages would not
 * do: a block is taller than the cell it is in, and a percentage of that cell is the wrong unit.
 */
import { MINUTES_IN_HOUR, type DayHours } from "./day-axis.ts";
import type { PlacedTimeEntry, TimeSpan } from "./time-placement.ts";

/**
 * Group placed blocks by the minute-of-day at the top of the hour each one starts in, clamped to
 * the hours actually drawn.
 *
 * A block starting before the first hour drawn is pulled into that first row rather than left out:
 * the range already grew to hold every entry it was given, so this only catches one a caller
 * clamped by hand — and it lands where a reader will look for it, at the top of the day.
 */
export function blocksByStartingHour(
  placed: readonly PlacedTimeEntry[],
  hours: DayHours,
  axis: TimeSpan,
): ReadonlyMap<number, PlacedTimeEntry[]> {
  const byHour = new Map<number, PlacedTimeEntry[]>();
  for (const block of placed) {
    const startMinute = axis.from + block.start * (axis.to - axis.from);
    const hour = Math.min(
      Math.max(Math.floor(startMinute / MINUTES_IN_HOUR), hours.first),
      hours.last,
    );
    const slot = hour * MINUTES_IN_HOUR;
    const existing = byHour.get(slot);
    if (existing === undefined) byHour.set(slot, [block]);
    else existing.push(block);
  }
  return byHour;
}

/**
 * The inline style that draws one block inside the cell of the hour it starts in: how far down the
 * cell it begins, how tall it is, and its share of the column across.
 *
 * The offset is measured from the top of THAT CELL, which is why the slot is passed: a 09:30 start
 * is half a step into the nine o'clock cell, wherever that cell happens to be on screen.
 */
export function blockStyle(block: PlacedTimeEntry, slot: number, axis: TimeSpan): string {
  const span = axis.to - axis.from;
  const startMinute = axis.from + block.start * span;
  const offsetHours = (startMinute - slot) / MINUTES_IN_HOUR;
  const sizeHours = (block.size * span) / MINUTES_IN_HOUR;
  return [
    `inset-block-start: calc(var(--mc-calendar-grid-hour-size) * ${round(offsetHours)})`,
    `block-size: calc(var(--mc-calendar-grid-hour-size) * ${round(sizeHours)})`,
    `inset-inline-start: ${round(block.inset * 100)}%`,
    `inline-size: ${round(block.width * 100)}%`,
    `z-index: ${block.depth + 1}`,
  ].join("; ");
}

/** Three decimals: enough for a minute on an hour step, short enough to keep the attribute legible. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
