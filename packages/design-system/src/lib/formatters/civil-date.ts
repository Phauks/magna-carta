/*
 * A CALENDAR DAY, as the reader sees it — a work date, a due date, the day a cost was incurred.
 *
 * This is deliberately not the same question as an instant (formatters/instant.ts), and the
 * difference is the whole reason both exist. An instant is a moment that happened to somebody, so
 * it renders in the VIEWER'S OWN zone. A civil date is a day the firm wrote down; it belongs to no
 * zone, and rendering it in the viewer's would let the same work date read as the 12th in one
 * office and the 11th in another. So it is pinned to UTC, and the day never moves.
 *
 * The short month is what a dense ledger row can carry without wrapping, and it is unambiguous
 * across the locales this product serves in a way a numeric day/month order is not.
 */

/** A civil date in any of the forms a caller is likely to hold one. */
export type CivilDateInput = Date | string | number;

/** How a civil date is named. */
export interface CivilDateOptions {
  /** BCP-47 locale. Defaults to the runtime's own, which is what a viewer's browser reports. */
  locale?: string;
}

/*
 * Every formatter here goes through this one constructor, and every one of them passes
 * `timeZone: "UTC"`. That is the rule of this file rather than a per-function detail: a civil date
 * formatted in any other zone is an instant again, and the day moves.
 */
function civilFormatter(
  locale: string | undefined,
  parts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { ...parts, timeZone: "UTC" });
}

/**
 * A civil date as a `Date` pinned to UTC midnight — the only form `Intl` takes, and the reason the
 * whole file formats in UTC. A `YYYY-MM-DD` string parses as UTC midnight already; anything else is
 * an instant the caller is asserting is a day.
 */
function asUtcDate(value: CivilDateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** A calendar day, pinned to UTC so it reads the same in every office. */
export function formatDate(value: CivilDateInput, options: CivilDateOptions = {}): string {
  return civilFormatter(options.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(asUtcDate(value));
}

/**
 * A calendar day with its weekday — "Fri, Nov 13, 2026" — for a date FIELD at rest, where the
 * weekday is what a reader checks a typed date against ("fri" should land on a Friday).
 */
export function formatDateWithWeekday(
  value: CivilDateInput,
  options: CivilDateOptions = {},
): string {
  return civilFormatter(options.locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(asUtcDate(value));
}

/**
 * A SPAN of calendar days — "Sep 2 – 15, 2026", "Dec 28, 2026 – Jan 3, 2027".
 *
 * The locale's own range formatter, which repeats only what differs between the ends: the month
 * once where both fall in it, the year once where both share it. Written by hand it comes out as
 * two full dates and a dash, which is what a calendar toolbar had before this existed.
 */
export function formatDateRange(
  from: CivilDateInput,
  to: CivilDateInput,
  options: CivilDateOptions = {},
): string {
  return civilFormatter(options.locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).formatRange(asUtcDate(from), asUtcDate(to));
}

/** How wide a month's name is written: "Sep" or "September". */
export type MonthNameWidth = "short" | "long";

/**
 * A month's name alone, with no day and no year — "Sep", "September" — for a control that lists the
 * twelve months of a year it names separately. `month` counts from 1, as a civil date does.
 */
export function formatMonthName(
  month: number,
  options: CivilDateOptions & { width?: MonthNameWidth } = {},
): string {
  return civilFormatter(options.locale, { month: options.width ?? "long" }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}

/** The month a day falls in, named in full with its year — "September 2026". */
export function formatMonth(value: CivilDateInput, options: CivilDateOptions = {}): string {
  return civilFormatter(options.locale, { year: "numeric", month: "long" }).format(
    asUtcDate(value),
  );
}
