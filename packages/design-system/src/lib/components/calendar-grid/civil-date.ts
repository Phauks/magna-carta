/*
 * Civil-date arithmetic for the CalendarGrid family.
 *
 * Everything here works on `@internationalized/date` CalendarDate — the platform's civil date —
 * and never on a `Date`. A `Date` is an instant, and an instant has to be read in some zone
 * before it is a day; a calendar cell is a day before anything else, and the grid must show the
 * 14th as the 14th to a reader in any zone. Where the browser's `Intl` formatter is used for the
 * words a day is written in, the civil parts are placed on a UTC `Date` and formatted in UTC, so
 * the day it names is the day it was given.
 */
import {
  CalendarDate,
  endOfMonth,
  getDayOfWeek,
  isSameDay,
  parseDate,
  startOfMonth,
} from "@internationalized/date";
import type { CalendarGridEntry } from "./types.ts";

/** A civil day as the grid is handed it: `YYYY-MM-DD`. */
export type CivilDate = string;

/** Which day a week begins on: 0 for Sunday (the default), 1 for Monday. */
export type CalendarGridWeekStart = 0 | 1;

/** How many days a week holds — the one number the grid's shape is built on. */
export const DAYS_IN_WEEK = 7;

/** Parse a `YYYY-MM-DD` civil day. Throws, as the underlying parser does, on anything else. */
export function parseCivilDate(value: CivilDate): CalendarDate {
  return parseDate(value);
}

/**
 * Parse a civil day a caller handed over, answering null instead of throwing when it is not one.
 * The grid uses this for its entries, so one malformed row costs that row rather than the screen.
 */
export function readCivilDate(value: CivilDate | undefined): CalendarDate | null {
  if (value === undefined) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

/** Format a civil day back to `YYYY-MM-DD`. */
export function formatCivilDate(date: CalendarDate): CivilDate {
  return date.toString();
}

/** Whether two civil days, either as `YYYY-MM-DD` strings or as dates, are the same day. */
export function isSameCivilDay(
  left: CivilDate | CalendarDate,
  right: CivilDate | CalendarDate,
): boolean {
  const leftDate = typeof left === "string" ? readCivilDate(left) : left;
  const rightDate = typeof right === "string" ? readCivilDate(right) : right;
  if (leftDate === null || rightDate === null) return false;
  return isSameDay(leftDate, rightDate);
}

/**
 * The day of the week, 0 for Sunday through 6 for Saturday, independent of any locale. The week
 * start is passed explicitly so the answer cannot vary with the runtime's locale data.
 */
export function dayOfWeek(date: CalendarDate): number {
  return getDayOfWeek(date, "en-US", "sun");
}

/** The days from `start` to `end` inclusive, in order. Empty when `end` is before `start`. */
export function eachDay(start: CalendarDate, end: CalendarDate): CalendarDate[] {
  const days: CalendarDate[] = [];
  let cursor = start;
  while (cursor.compare(end) <= 0) {
    days.push(cursor);
    cursor = cursor.add({ days: 1 });
  }
  return days;
}

/** The first day of the week that contains `date`, for the given week start. */
export function startOfCivilWeek(
  date: CalendarDate,
  weekStartsOn: CalendarGridWeekStart,
): CalendarDate {
  const offset = (dayOfWeek(date) - weekStartsOn + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  return date.subtract({ days: offset });
}

/** The seven days of the week that contains `date`, starting on the given week start. */
export function daysOfWeek(
  date: CalendarDate,
  weekStartsOn: CalendarGridWeekStart = 0,
): CalendarDate[] {
  const start = startOfCivilWeek(date, weekStartsOn);
  return eachDay(start, start.add({ days: DAYS_IN_WEEK - 1 }));
}

/**
 * The weeks a month spans, each a full seven days: the first week begins on the week start at or
 * before the first of the month, and the last ends on the day before the next week start at or
 * after the month's end. The leading and trailing days belong to the neighbouring months, which is
 * what lets every row of a month grid be a whole week.
 */
export function weeksOfMonth(
  date: CalendarDate,
  weekStartsOn: CalendarGridWeekStart = 0,
): CalendarDate[][] {
  const first = startOfCivilWeek(startOfMonth(date), weekStartsOn);
  const last = startOfCivilWeek(endOfMonth(date), weekStartsOn).add({ days: DAYS_IN_WEEK - 1 });
  const weeks: CalendarDate[][] = [];
  let cursor = first;
  while (cursor.compare(last) <= 0) {
    weeks.push(eachDay(cursor, cursor.add({ days: DAYS_IN_WEEK - 1 })));
    cursor = cursor.add({ days: DAYS_IN_WEEK });
  }
  return weeks;
}

/** An entry on one particular day, with where that day falls in the entry's span. */
export interface PlacedEntry {
  entry: CalendarGridEntry;
  /** True when the entry covers more than one day. */
  span: boolean;
  /** True on the first day of a span. */
  spanStart: boolean;
  /** True on the last day of a span. */
  spanEnd: boolean;
}

/**
 * Put every entry on every day it covers, keyed by `YYYY-MM-DD`, in the order the entries were
 * handed over. A span paints on each of its days and is marked on its first and last; an end
 * before the start is read as a point. With `from`/`to` given, only the days inside that range
 * are placed, so a span reaching past the visible grid costs only its visible days. An entry
 * whose date does not parse is left out rather than failing the grid.
 */
export function placeEntries(
  entries: readonly CalendarGridEntry[],
  from?: CalendarDate,
  to?: CalendarDate,
): Map<CivilDate, PlacedEntry[]> {
  const byDay = new Map<CivilDate, PlacedEntry[]>();
  for (const entry of entries) {
    const start = readCivilDate(entry.date);
    if (start === null) continue;
    const declaredEnd = readCivilDate(entry.endDate);
    const end = declaredEnd !== null && declaredEnd.compare(start) > 0 ? declaredEnd : start;
    const span = end.compare(start) > 0;
    const first = from !== undefined && from.compare(start) > 0 ? from : start;
    const last = to !== undefined && to.compare(end) < 0 ? to : end;
    for (const day of eachDay(first, last)) {
      const key = formatCivilDate(day);
      const placed = byDay.get(key) ?? [];
      placed.push({
        entry,
        span,
        spanStart: span && isSameDay(day, start),
        spanEnd: span && isSameDay(day, end),
      });
      byDay.set(key, placed);
    }
  }
  return byDay;
}

/**
 * The civil parts on a UTC `Date`, for `Intl` alone. Formatted with `timeZone: "UTC"` this names
 * exactly the day it was built from; formatted any other way it would be an instant again.
 */
function toUtcDate(date: CalendarDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** The day written out in full — "Tuesday, September 15, 2026" in en-US. */
export function formatCivilDateLong(date: CalendarDate, locale?: string): string {
  return formatterFor(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(toUtcDate(date));
}

/**
 * The short weekday names in week order — "Sun … Sat", or "Mon … Sun" for a Monday start.
 * Built from a known week (2023-01-01 was a Sunday) so the names come from `Intl` and nothing here
 * spells a weekday.
 */
export function weekdayNames(
  weekStartsOn: CalendarGridWeekStart = 0,
  locale?: string,
  width: "short" | "long" = "short",
): string[] {
  const knownSunday = new CalendarDate(2023, 1, 1);
  const formatter = formatterFor(locale, { weekday: width });
  return Array.from({ length: DAYS_IN_WEEK }, (_unused, index) =>
    formatter.format(toUtcDate(knownSunday.add({ days: (weekStartsOn + index) % DAYS_IN_WEEK }))),
  );
}
