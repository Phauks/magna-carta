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
    timeStyle: "short",
    timeZone: options.timeZone,
  }).format(date);
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
