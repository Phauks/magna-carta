/*
 * A timed entry that runs past midnight, cut into the piece it occupies on each day it covers.
 *
 * A TRIAL IS THREE DAYS, NOT MONDAY. The time grids placed a timed entry by `entry.date === key`,
 * which put a Monday-to-Wednesday trial on Monday and nowhere else — so a firm reading its week saw
 * an empty Tuesday it was in fact spending in court (owner, 2026-09-16: "multi-day events are not
 * showcasing through multiple days"). The month never had the fault, because `placeEntries` walks
 * every day of a span; the time grids could not use it, because a span on an HOUR axis is not the
 * same entry repeated — it is a different piece of the day on each of its days.
 *
 * SO EACH DAY GETS ITS OWN PIECE. The first day runs from the start hour to midnight, a day in the
 * middle is the whole column, and the last day runs from midnight to the end hour. That is what a
 * reader means by "in court until Wednesday afternoon", and it is the one reading that makes the
 * Tuesday column say something true.
 *
 * THE PIECE SAYS IT IS A PIECE. `continuesBefore` and `continuesAfter` are what let a chip show that
 * a block reaching the top of the column began yesterday rather than at midnight — without them a
 * three-day trial reads as three unrelated all-nighters. They are the hour axis's twins of the
 * `spanStart` / `spanEnd` the month's own placement already carries.
 *
 * AN ALL-DAY ENTRY NEVER REACHES HERE. It has no `startMinute`, it belongs in the band above the
 * hours, and `placeEntries` already spans it correctly there.
 *
 * CIVIL DAYS, NEVER INSTANTS — the rule the whole grid keeps. The walk counts days; the minutes
 * ride along untouched, so a trial that runs across a daylight-saving change still starts at the
 * hour the notice says.
 */
import type { CalendarDate } from "@internationalized/date";
import { formatCivilDate, readCivilDate } from "./civil-date.ts";
import { HOURS_IN_DAY, MINUTES_IN_HOUR } from "./day-axis.ts";
import type { CalendarGridEntry } from "./types.ts";

/** Minutes in a whole day: where a piece that runs past midnight ends on its own day. */
const MINUTES_IN_DAY = HOURS_IN_DAY * MINUTES_IN_HOUR;

/** One day's piece of an entry, as the hour axis should draw it. */
export interface DaySegment {
  /**
   * The entry as this day sees it: the same record, with `startMinute` and `endMinute` cut to this
   * day's own midnight-to-midnight window. The `id` carries the day, because two pieces of one
   * record are two things to render and a grid keyed on a repeated id would drop all but one.
   */
  readonly entry: CalendarGridEntry;
  /** True where the piece began before this day — the block reaches the top of the column. */
  readonly continuesBefore: boolean;
  /** True where the piece runs past this day — the block reaches the bottom. */
  readonly continuesAfter: boolean;
}

/**
 * The timed entries that touch a day, each cut to that day.
 *
 * An entry with no `startMinute` is skipped: it belongs in the all-day band. An entry whose end
 * date is before its start is read as a point on its start day, which is the same forgiveness
 * `placeEntries` extends.
 */
export function segmentsForDay(
  entries: readonly CalendarGridEntry[],
  day: CalendarDate,
): DaySegment[] {
  const key = formatCivilDate(day);
  const segments: DaySegment[] = [];
  for (const entry of entries) {
    if (entry.startMinute === undefined) continue;
    const start = readCivilDate(entry.date);
    if (start === null) continue;
    const declaredEnd = readCivilDate(entry.endDate);
    const end = declaredEnd !== null && declaredEnd.compare(start) > 0 ? declaredEnd : start;
    if (day.compare(start) < 0 || day.compare(end) > 0) continue;

    const isFirst = day.compare(start) === 0;
    const isLast = day.compare(end) === 0;
    // A single-day entry keeps exactly what it was given; every other piece is cut at a midnight.
    if (isFirst && isLast) {
      segments.push({ entry, continuesBefore: false, continuesAfter: false });
      continue;
    }
    const startMinute = isFirst ? entry.startMinute : 0;
    // The last day ends where the record says; a day before it runs to midnight. An end the record
    // never stated leaves the last day a point at midnight, which is what "no end" already means.
    const endMinute = isLast ? entry.endMinute : MINUTES_IN_DAY;
    segments.push({
      entry: { ...entry, id: `${entry.id}@${key}`, date: key, startMinute, endMinute },
      continuesBefore: !isFirst,
      continuesAfter: !isLast,
    });
  }
  return segments;
}
