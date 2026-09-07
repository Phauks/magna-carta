/*
 * Turning the browser's datetime-local value into the instant the platform stores, and back.
 *
 * A `datetime-local` input holds a WALL CLOCK with no zone — "2026-09-07T14:30" — and the log stores
 * an instant. The conversion is the browser's own zone in both directions, which is the only honest
 * default: the person typing it is saying what their own clock said.
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

/** The instant as a `datetime-local` value in the reader's own zone. */
export function localInputValue(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return "";
  return (
    `${String(parsed.getFullYear())}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
    `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}

/** A `datetime-local` value as an instant, or the empty string where it is half-entered. */
export function instantFromLocalInput(value: string): string {
  if (value.trim() === "") return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
