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
import { formatDate, formatDateRange, formatMonth } from "@magna-carta/design-system/formatters";
import { isCivilDate } from "$lib/dates";
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
import type { CalendarScope, ScopeChoice } from "./calendar-scope.ts";

/**
 * The four views, in the order the switch draws them: widest to narrowest, then the list.
 *
 * DAY IS THE ONE WITH A TIME AXIS. Month and week put a civil DAY in a column; the day puts an
 * HOUR in a row and a CALENDAR in a column, which is the only way a firm reads a Tuesday its six
 * attorneys spend in four places. Its window is one day, because that is what it shows.
 */
export const CALENDAR_VIEWS = ["month", "week", "day", "agenda"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** 0 is Sunday, 1 is Monday: the firm's setting, read by the calendar context. */
export type WeekStart = 0 | 1;

export interface CalendarWindow {
  readonly view: CalendarView;
  /** The civil date the window is anchored on: any day of the month, any day of the week, the first day of the agenda. */
  readonly anchor: string;
  /** Civil dates, inclusive. */
  readonly from: string;
  readonly to: string;
}

/** The locale used for week arithmetic only; the first day of the week is passed explicitly. */
const WEEK_LOCALE = "en-US";
/**
 * How far an agenda reads ahead from its anchor by default: two weeks, inclusive of the anchor. A
 * host that embeds a narrower agenda (today and tomorrow on Home, the next thirty days on a matter
 * overview) passes its own span.
 */
export const AGENDA_SPAN_DAYS = 14;

function firstDayOf(weekStartsOn: WeekStart): "sun" | "mon" {
  return weekStartsOn === 1 ? "mon" : "sun";
}

/*
 * True for a well-formed civil date the calendar can read.
 *
 * Re-exported under this module's own name rather than reimplemented: this was the app's copy of a
 * check that also existed in packages/conflicts, packages/ledger, packages/notes and
 * packages/tasks, and the browser agreeing with the route about what a date is is the whole point.
 */
export { isCivilDate };

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
  agendaDays: number = AGENDA_SPAN_DAYS,
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
    case "day":
      return { view, anchor, from: anchor, to: anchor };
    case "agenda": {
      const last = date.add({ days: Math.max(1, agendaDays) - 1 });
      return { view, anchor, from: anchor, to: last.toString() };
    }
  }
}

/** The anchor one step back or forward: a month, a week, or the agenda's own span. */
export function shiftAnchor(
  view: CalendarView,
  anchor: string,
  direction: -1 | 1,
  agendaDays: number = AGENDA_SPAN_DAYS,
): string {
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
    case "day":
      return date.add({ days: direction }).toString();
    case "agenda":
      return date.add({ days: Math.max(1, agendaDays) * direction }).toString();
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
    return formatMonth(civilDateAsUtc(window.anchor), { locale });
  }
  // A day names itself. The range formatter would print one date twice with a separator between,
  // which reads as a span of no length rather than as the day it is.
  if (window.view === "day") {
    return formatDate(civilDateAsUtc(window.anchor), { locale });
  }
  return formatDateRange(civilDateAsUtc(window.from), civilDateAsUtc(window.to), { locale });
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

/**
 * Where the rest of a capped calendar is: the same span as an agenda, on the screen that owns the
 * scope, so a card's "N more" is one press from the answer. On the firm side the address carries
 * the choice the card was painted under, so the screen opens on the same calendar.
 */
export function restOfCalendarAddress(
  scope: CalendarScope,
  anchor: string,
  choice: ScopeChoice,
  memberChoice: string | null = null,
): string {
  const query = new URLSearchParams({ view: "agenda", date: anchor });
  if (scope.kind === "matter") {
    return `/matters/${encodeURIComponent(scope.matterId)}/calendar?${query.toString()}`;
  }
  if (scope.kind === "resource") {
    query.set("resource", scope.resourceId);
    return `/calendar/rooms?${query.toString()}`;
  }
  query.set("scope", scope.kind === "mine" ? "mine" : scopeAddressValue(choice, memberChoice));
  return `/calendar?${query.toString()}`;
}

/** The `scope` value naming one colleague: `member:<userId>`. */
export const MEMBER_SCOPE_PREFIX = "member:";

/**
 * The `scope` value an address carries for a choice on the firm calendar. A colleague is named by
 * identifier; a member choice with nobody chosen yet reads as everyone, because that is what the
 * grid shows until somebody is picked.
 */
export function scopeAddressValue(choice: ScopeChoice, memberChoice: string | null): string {
  if (choice === "member") {
    return memberChoice === null ? "everyone" : `${MEMBER_SCOPE_PREFIX}${memberChoice}`;
  }
  return choice;
}
