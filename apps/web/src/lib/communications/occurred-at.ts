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

/** The minutes in a day, which is what a call that ran past midnight is measured against. */
const MINUTES_PER_DAY = 24 * 60;

/** A `time` input's value as minutes since midnight, or null where it is not one. */
function clockMinutes(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * How long a call ran, from the two clock times a person typed.
 *
 * AN END BEFORE A START IS A CALL THAT RAN PAST MIDNIGHT, not a mistake. 23:58 to 00:03 is five
 * minutes, and it is the one case where reading the numbers straight gives a negative answer; the
 * alternative — asking for the end DATE as well — would put a fourth field on the row to serve the
 * handful of calls a firm takes at midnight.
 */
export function minutesBetweenClockTimes(start: string, end: string): number | null {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null) return null;
  return to >= from ? to - from : to + MINUTES_PER_DAY - from;
}

/**
 * The instant a call ENDED, from the day it started, the clock time it started at, and the clock
 * time it ended at.
 *
 * AN END BEFORE A START IS THE NEXT DAY, on the same reasoning `minutesBetweenClockTimes` gives:
 * 23:58 to 00:03 is five minutes past midnight, and asking for the end date as a fourth field would
 * serve the handful of calls a firm takes at midnight at the cost of every call it does not.
 */
export function endInstantFromLocalParts(date: string, start: string, end: string): string {
  const day = date.trim();
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (day === "" || from === null || to === null) return "";
  const started = new Date(`${day}T${start.trim()}`);
  if (Number.isNaN(started.getTime())) return "";
  const spanned = to >= from ? to - from : to + MINUTES_PER_DAY - from;
  return new Date(started.getTime() + spanned * 60_000).toISOString();
}

/** The clock time a call of this length ended at, from the one it started at. */
export function clockTimeAfter(start: string, minutes: number): string {
  const from = clockMinutes(start);
  if (from === null || !Number.isFinite(minutes) || minutes < 0) return "";
  const at = (from + Math.round(minutes)) % MINUTES_PER_DAY;
  return `${pad(Math.floor(at / 60))}:${pad(at % 60)}`;
}
