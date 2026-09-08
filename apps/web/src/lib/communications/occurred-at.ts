/*
 * Turning the browser's date and time values into the instant the platform stores, and back.
 *
 * TWO FIELDS, NOT ONE (owner ruling, 2026-09-08). A `datetime-local` input is one control holding
 * two answers, and which half a keystroke lands in is decided by where the caret happens to be; a
 * person recording yesterday's call wants to change the date and nothing else. So the date and the
 * time are separate fields, and this module is what joins them.
 *
 * Both hold a WALL CLOCK with no zone — "2026-09-07" and "14:30" — and the log stores an instant.
 * The conversion is the browser's own zone in both directions, which is the only honest default: the
 * person typing it is saying what their own clock said.
 */

/**
 * How far ahead of now a logged instant may sit before it is refused.
 *
 * A minute, so a client clock that is slightly fast is not an error. Anything past it is a typo —
 * a slip in the year or the month — and a row dated forward sits above everything real in a log
 * ordered most-recent-first until the date arrives.
 */
export const MOST_RECENT_FIRST_TOLERANCE_MINUTES = 1;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The instant's calendar date in the reader's own zone, as a `date` input's value. */
export function localDateValue(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${String(parsed.getFullYear())}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/** The instant's clock time in the reader's own zone, as a `time` input's value. */
export function localTimeValue(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/**
 * A date and a time as one instant, or the empty string where either half is missing or unreadable.
 *
 * The empty string rather than a throw or a null: the fields are typed into a character at a time,
 * so half-entered is the ordinary state rather than an error, and the form says what is missing.
 */
export function instantFromLocalParts(date: string, time: string): string {
  const day = date.trim();
  const clock = time.trim();
  if (day === "" || clock === "") return "";
  const parsed = new Date(`${day}T${clock}`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
