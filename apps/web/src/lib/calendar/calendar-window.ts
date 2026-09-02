/*
 * The window a view reads, and the arithmetic that moves it.
 *
 * A view plus an anchor is a civil-date window: the month grid reads the full weeks its month spans
 * (so an entry on the last day of August still paints on the first row of September's grid), the
 * week reads seven days, the agenda reads a fortnight. All of it is on CalendarDate, never on
 * `Date`: a civil date has no zone, so a month that crosses a daylight-saving change has the right
 * number of days and no day shifts under the viewer. The firm read's window cap is respected by
 * construction here, because no view asks for more than six weeks.
 *
 * "Today" is the one fact that needs a zone, and it is the READER'S: the today mark answers where
 * the reader is, and it is resolved once through Intl rather than taken from any row.
 */
import {
  CalendarDate,
  endOfMonth,
  endOfWeek,
  getLocalTimeZone,
  parseDate,
  startOfMonth,
  startOfWeek,
  today as todayIn,
} from "@internationalized/date";

export const CALENDAR_VIEWS = ["month", "week", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** 0 is Sunday, 1 is Monday. The preference seam; Sunday until the preference exists. */
export type WeekStart = 0 | 1;

export interface CalendarWindow {
  readonly view: CalendarView;
  /** The civil date the window is anchored on: any day of the month, any day of the week, the first day of the agenda. */
  readonly anchor: string;
  /** Civil dates, inclusive. */
  readonly from: string;
  readonly to: string;
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The locale used for week arithmetic only; the first day of the week is passed explicitly. */
const WEEK_LOCALE = "en-US";
/** How far an agenda reads ahead from its anchor: two weeks, inclusive of the anchor. */
const AGENDA_SPAN_DAYS = 14;

function firstDayOf(weekStartsOn: WeekStart): "sun" | "mon" {
  return weekStartsOn === 1 ? "mon" : "sun";
}

/** True for a well-formed civil date the calendar can read. */
export function isCivilDate(text: string | null | undefined): text is string {
  if (typeof text !== "string" || !CIVIL_DATE.test(text)) return false;
  try {
    parseDate(text);
    return true;
  } catch {
    return false;
  }
}

/** True for one of the three view names. */
export function isCalendarView(text: string | null | undefined): text is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(text ?? "");
}

/** The reader's civil date today, in their own zone. */
export function todayCivil(timeZone?: string): string {
  return todayIn(timeZone ?? safeLocalTimeZone()).toString();
}

function safeLocalTimeZone(): string {
  try {
    return getLocalTimeZone();
  } catch {
    return "UTC";
  }
}

/** The window a view reads around an anchor. */
export function calendarWindow(
  view: CalendarView,
  anchor: string,
  weekStartsOn: WeekStart = 0,
): CalendarWindow {
  const date = parseDate(anchor);
  switch (view) {
    case "month": {
      const first = startOfWeek(startOfMonth(date), WEEK_LOCALE, firstDayOf(weekStartsOn));
      const last = endOfWeek(endOfMonth(date), WEEK_LOCALE, firstDayOf(weekStartsOn));
      return { view, anchor, from: first.toString(), to: last.toString() };
    }
    case "week": {
      const first = startOfWeek(date, WEEK_LOCALE, firstDayOf(weekStartsOn));
      const last = endOfWeek(date, WEEK_LOCALE, firstDayOf(weekStartsOn));
      return { view, anchor, from: first.toString(), to: last.toString() };
    }
    case "agenda": {
      const last = date.add({ days: AGENDA_SPAN_DAYS - 1 });
      return { view, anchor, from: anchor, to: last.toString() };
    }
  }
}

/** The anchor one step back or forward: a month, a week, or a fortnight. */
export function shiftAnchor(view: CalendarView, anchor: string, direction: -1 | 1): string {
  const date = parseDate(anchor);
  switch (view) {
    case "month": {
      // Step by whole months from the first, so stepping forward from the 31st never lands on a
      // clamped day and stepping back again returns to a different date.
      const first = new CalendarDate(date.year, date.month, 1);
      return first.add({ months: direction }).toString();
    }
    case "week":
      return date.add({ days: 7 * direction }).toString();
    case "agenda":
      return date.add({ days: AGENDA_SPAN_DAYS * direction }).toString();
  }
}

/** A `Date` pinned to UTC midnight of a civil date, for Intl formatting with `timeZone: "UTC"`. */
export function civilDateAsUtc(civilDate: string): Date {
  const parsed = parseDate(civilDate);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

/**
 * The window's own name, as the toolbar reads it between the navigation controls. A span is
 * formatted by the locale's own range formatter, which repeats only what differs between its ends
 * ("Sep 2 to 15" within a month, the year once when both ends share it).
 */
export function windowTitle(window: CalendarWindow, locale?: string): string {
  if (window.view === "month") {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(civilDateAsUtc(window.anchor));
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(civilDateAsUtc(window.from), civilDateAsUtc(window.to));
}

/** Whether a civil date falls inside the window, inclusive at both ends. */
export function windowContains(window: CalendarWindow, civilDate: string): boolean {
  return civilDate >= window.from && civilDate <= window.to;
}

/**
 * Whether a span [start, end] touches the window at all. An entry that starts before the window
 * and ends inside it still paints on the days it covers.
 */
export function windowOverlaps(window: CalendarWindow, start: string, end: string | null): boolean {
  const last = end ?? start;
  return start <= window.to && last >= window.from;
}

/**
 * The anchor a page opens on: the address's `date` where it is a readable civil date, else the
 * fallback. An unreadable date is treated as absent rather than as an error, because a mistyped
 * address is a wrong turn, not a fault.
 */
export function anchorFromAddress(text: string | null, fallback: string): string {
  return isCivilDate(text) ? text : fallback;
}

/** The view a page opens on, on the same rule. */
export function viewFromAddress(text: string | null, fallback: CalendarView): CalendarView {
  return isCalendarView(text) ? text : fallback;
}
