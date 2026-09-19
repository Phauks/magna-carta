/*
 * The arithmetic behind a time grid: which hours it draws, and which column an entry sits in.
 *
 * WHERE on the axis a timed entry lands, how tall it is, and how it shares the column with whatever
 * runs alongside it are time-placement.ts's answers. This module answers the frame: the hour range,
 * the rows, the columns, and which column a thing is in.
 *
 * Kept out of the component for the reason every other answer in this family is: the questions a
 * reader would argue about — does a 7am deposition widen the day, does an entry with no time fall
 * out of the grid, what happens to an entry naming a lane that is not there — are answered here,
 * in functions a test reads without a browser.
 *
 * MINUTES, NEVER CLOCKS. A Day places an entry by `startMinute`, a number of minutes past midnight
 * in the entry's own row. It never parses the formatted `time` string: which zone that string is
 * in, and whether it names one, are facts about the domain the grid does not have, and reading a
 * number back out of somebody else's formatting is how a 12-hour clock lands at midnight.
 */
import { readCivilDate } from "./civil-date.ts";
import type { CalendarGridEntry, CalendarGridLane } from "./types.ts";

/** How many minutes an hour holds — the one number the day axis is built on. */
export const MINUTES_IN_HOUR = 60;
/** How many hours a day holds. */
export const HOURS_IN_DAY = 24;

/**
 * The hours a Day opens on when nothing pulls it wider: the working day. A firm looks at its own
 * business hours far more often than at midnight, and a grid that opened on all twenty-four spends
 * two thirds of its height on hours nothing happens in.
 */
export const DEFAULT_FIRST_HOUR = 7;
export const DEFAULT_LAST_HOUR = 19;

/** The lane key a Day uses when the caller named no lanes: one column, and nothing to head it. */
export const SINGLE_LANE_KEY = "";

/**
 * Whether an entry belongs in the BAND ABOVE THE HOURS rather than on the axis: it has no hour, or
 * it runs past the day it starts on.
 *
 * A thing with no hour is what all day means, and has always gone there. A thing that RUNS ACROSS
 * DAYS goes there too now (owner, 2026-09-18: "multi-day events actually render in the whole
 * calendar, rather than in the all-day area above"). It used to be cut into a piece per day and
 * laid on the axis — the start hour to midnight, then a whole column, then midnight to the end —
 * which drew a three-day trial as three full columns and, where the day drew only working hours,
 * as blocks reaching above and below the grid. A span is a fact about DAYS, and the band is where
 * a fact about days is read; its hours ride along on the chip as text.
 *
 * An end before the start is a point, as `placeEntries` already reads it, so it stays on the axis.
 */
export function inAllDayBand(entry: CalendarGridEntry): boolean {
  if (entry.startMinute === undefined) return true;
  const start = readCivilDate(entry.date);
  const end = readCivilDate(entry.endDate);
  return start !== null && end !== null && end.compare(start) > 0;
}

/** The hours a day draws, first to last inclusive. */
export interface DayHours {
  readonly first: number;
  readonly last: number;
}

/**
 * The hours the day has to draw: the working day, widened by anything outside it.
 *
 * An entry is never dropped for being early or late — a deposition at 7am and a filing accepted at
 * 11pm are exactly the rows a day grid exists to show — so the range grows to hold every timed
 * entry it was given, and only ever grows.
 */
export function dayHours(
  entries: readonly CalendarGridEntry[],
  first: number = DEFAULT_FIRST_HOUR,
  last: number = DEFAULT_LAST_HOUR,
): DayHours {
  let firstHour = clampHour(first);
  let lastHour = clampHour(last);
  if (lastHour < firstHour) lastHour = firstHour;
  for (const entry of entries) {
    const start = entry.startMinute;
    // What the band holds never widens the axis: a span's start hour is not an hour on this day.
    if (start === undefined || inAllDayBand(entry)) continue;
    firstHour = Math.min(firstHour, hourOf(start));
    // An entry that ends exactly on the hour does not need that hour's row: a meeting to 17:00 is
    // over at 17:00, and widening for it would leave an empty row under every tidy afternoon.
    const end = entry.endMinute ?? start;
    lastHour = Math.max(lastHour, hourOf(Math.max(start, end - 1)));
  }
  return { first: firstHour, last: lastHour };
}

/** The hours of a range, in order, as minute-of-day values at the top of each hour. */
export function hourSlots(hours: DayHours): number[] {
  const slots: number[] = [];
  for (let hour = hours.first; hour <= hours.last; hour += 1) {
    slots.push(hour * MINUTES_IN_HOUR);
  }
  return slots;
}

/**
 * The lanes a Day draws. A caller that named none gets one unnamed column, which is what makes the
 * Day usable as a plain day view — the matter's section, the panel that shows the day being booked
 * — without inventing a lane nobody asked for.
 */
export function dayLanes(lanes: readonly CalendarGridLane[] | undefined): CalendarGridLane[] {
  if (lanes === undefined || lanes.length === 0) {
    return [{ key: SINGLE_LANE_KEY, label: "" }];
  }
  return [...lanes];
}

/**
 * Which lane an entry belongs to, resolved against the lanes actually drawn. An entry naming a
 * lane that is not on the grid falls into the first one rather than off the grid: a row the reader
 * can see in the wrong column is a smaller wrong than a row that vanished.
 */
export function laneOf(entry: CalendarGridEntry, lanes: readonly CalendarGridLane[]): string {
  const first = lanes[0]?.key ?? SINGLE_LANE_KEY;
  if (entry.lane === undefined) return first;
  return lanes.some((lane) => lane.key === entry.lane) ? entry.lane : first;
}

/** A day's entries, split per lane into the band above the hours and the ones the hours hold. */
export interface DayPlacement {
  /** By lane key: the entries with no time, and the ones that run across days (`inAllDayBand`). */
  readonly allDay: ReadonlyMap<string, CalendarGridEntry[]>;
  /** By lane key: the entries that have an hour, in the order handed over. */
  readonly timed: ReadonlyMap<string, CalendarGridEntry[]>;
}

/**
 * Split a day's entries by the lane they belong to, and within a lane by whether they have an hour.
 *
 * WHERE a timed entry lands on the axis is time-placement.ts's answer, not this module's: an entry
 * is a block from its start to its end, and the block's position and its share of the column are
 * arithmetic over the whole lane rather than a bucket per hour. This function answers only which
 * column a thing is in and whether the hours hold it at all.
 */
export function placeDayEntries(
  entries: readonly CalendarGridEntry[],
  lanes: readonly CalendarGridLane[],
): DayPlacement {
  const allDay = new Map<string, CalendarGridEntry[]>();
  const timed = new Map<string, CalendarGridEntry[]>();
  for (const lane of lanes) {
    allDay.set(lane.key, []);
    timed.set(lane.key, []);
  }
  for (const entry of entries) {
    const key = laneOf(entry, lanes);
    const into = inAllDayBand(entry) ? allDay : timed;
    into.get(key)?.push(entry);
  }
  return { allDay, timed };
}

/** The hour a minute-of-day falls in, clamped to a real hour. */
export function hourOf(minute: number): number {
  return clampHour(Math.floor(minute / MINUTES_IN_HOUR));
}

function clampHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  return Math.min(Math.max(Math.trunc(hour), 0), HOURS_IN_DAY - 1);
}

/**
 * How many minutes past midnight a wall clock reads, or null where it is not one.
 *
 * Offered to callers because every one of them holds an `HH:MM` and would otherwise each write the
 * same four lines; the grid itself never calls it, because the grid is handed minutes.
 */
export function wallClockMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * MINUTES_IN_HOUR + minute;
}
