/*
 * How a recorded instant reads on a surface — the platform's one answer, used everywhere a stored
 * moment is shown to a person.
 *
 * Two rules govern this file and neither is negotiable:
 *
 *   1. A timestamp renders in the VIEWER'S LOCAL time. Instants are stored UTC; a person reading a
 *      history is asking when something happened to them, in the hours their own day is measured
 *      in, so the conversion happens here at render rather than anywhere upstream.
 *   2. NEVER elapsed time. "Just now", "2 hours ago" and their family are banned outright: they
 *      decay while the reader looks at them, they cannot be compared between two rows, and a
 *      record is a record. State the actual instant.
 *
 * Locale and time zone are options with the viewer's own as the default, so a firm-level display
 * setting can drive them later without any surface changing.
 *
 * This is the display of a moment in time. A DATE-ONLY value — a work date, a due date — is a
 * different question with a different answer (it is pinned to UTC so a calendar day never shifts
 * under the viewer's zone), and it lives beside this one in civil-date.ts.
 */

/**
 * An instant, in any of the forms a caller is likely to hold one: a `Date`, the UTC ISO string an
 * API returns, or epoch milliseconds.
 */
export type Instant = Date | string | number;

export interface InstantOptions {
  /** BCP-47 locale. Defaults to the runtime's own, which is what a viewer's browser reports. */
  locale?: string;
  /**
   * IANA time zone. Defaults to the viewer's own zone — that default is the point of the rule, so
   * pass this only where a caller genuinely needs a fixed zone (a deterministic test, a printed
   * sheet that must read the same everywhere).
   */
  timeZone?: string;
  /**
   * How fine the time of day reads. The minute is the default because that is the resolution a
   * record is about; `"second"` is for the handful of surfaces where the seconds are the subject —
   * a running clock, a capture that took twelve seconds — and it is a closed set rather than a
   * `timeStyle` passthrough so a caller cannot reintroduce a fourth way to print a moment.
   */
  precision?: "minute" | "second";
}

/** Parse an instant into a `Date`, or `null` when the value is not a readable instant. */
export function readInstant(at: Instant): Date | null {
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The instant as a reader sees it: an absolute date and time of day, in local time.
 *
 * An unreadable value renders as the raw text it arrived as. Showing what the data actually says
 * makes a bad instant visible as the defect it is, where a silent blank or a cheerful "Invalid
 * Date" would hide it.
 */
export function formatInstant(at: Instant, options: InstantOptions = {}): string {
  const date = readInstant(at);
  if (date === null) return String(at);
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: "medium",
    timeStyle: options.precision === "second" ? "medium" : "short",
    timeZone: options.timeZone,
  }).format(date);
}

/** How much of a date is written out. A closed set, so a caller cannot invent a sixth wording. */
export type InstantDateLength = "medium" | "long" | "full";

const DATE_PARTS: Readonly<Record<InstantDateLength, Intl.DateTimeFormatOptions>> = Object.freeze({
  /** "Sep 4, 2026" — a ledger row, a details pane. */
  medium: { year: "numeric", month: "short", day: "numeric" },
  /** "September 4, 2026" — a sentence, a printed sheet. */
  long: { year: "numeric", month: "long", day: "numeric" },
  /** "Friday, September 4, 2026" — a screen that greets somebody with their own day. */
  full: { weekday: "long", year: "numeric", month: "long", day: "numeric" },
});

/**
 * THE DATE HALF of an instant, in the viewer's own zone.
 *
 * Not the same function as `formatDate` in civil-date.ts, and the difference is the point: that one
 * takes a day the firm wrote down and pins it to UTC so it never moves; this one takes a MOMENT and
 * says which day it fell on where the reader is. A cost incurred on the 4th is the 4th everywhere;
 * a file uploaded at 23:40 in Boston was uploaded on a different day in Reno, and both are true.
 */
export function formatInstantDate(
  at: Instant,
  options: InstantOptions & { length?: InstantDateLength } = {},
): string {
  const date = readInstant(at);
  if (date === null) return String(at);
  return new Intl.DateTimeFormat(options.locale, {
    ...DATE_PARTS[options.length ?? "medium"],
    timeZone: options.timeZone,
  }).format(date);
}

/**
 * THE CLOCK HALF of an instant, in the viewer's own zone — "2:40 PM", or "2:40 PM PDT".
 *
 * For a surface where the day is already established and the time is the fact being added: an
 * upload batch's rows under a heading that names the day, a download tray of things that arrived
 * this session. Five surfaces wrote their own before this existed, in three different shapes.
 *
 * `zoneName` is for a stamp that leaves this machine — an exported sheet is read by somebody whose
 * clock is not the reader's, and a bare time of day on it is not a time to them.
 */
export function formatTimeOfDay(
  at: Instant,
  options: InstantOptions & { zoneName?: boolean } = {},
): string {
  const date = readInstant(at);
  if (date === null) return String(at);
  // The parts are built rather than spread from a ternary because `timeStyle` and the individual
  // hour/minute fields are mutually exclusive in Intl — supplying both throws, and a formatter that
  // throws on one option combination is a runtime failure nothing typechecks.
  const parts: Intl.DateTimeFormatOptions = { timeZone: options.timeZone };
  parts.hour = "numeric";
  parts.minute = "2-digit";
  if (options.precision === "second") parts.second = "2-digit";
  if (options.zoneName === true) parts.timeZoneName = "short";
  return new Intl.DateTimeFormat(options.locale, parts).format(date);
}

/**
 * The machine-readable form for a `<time datetime="…">` attribute — the UTC instant, so assistive
 * technology and any copy-out reads the same moment the display does. `undefined` where the value
 * is not a readable instant, which leaves the attribute off rather than writing a lie.
 */
export function instantAttribute(at: Instant): string | undefined {
  const date = readInstant(at);
  return date === null ? undefined : date.toISOString();
}
