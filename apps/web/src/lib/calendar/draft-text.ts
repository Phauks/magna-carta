/*
 * The three small readings every calendar draft makes of typed text, in one place.
 *
 * Each draft module (event, deadline, firm event, continuance) turns what a person typed into what
 * the request carries, and each form turns a civil-date string back into what the date picker
 * holds. Four copies of "trim, and empty means null" had already appeared, with the same regular
 * expression beside two of them; a fifth would be the one that drifted.
 */
import { parseDate, type CalendarDate } from "@internationalized/date";

/** A wall-clock time as the forms accept it: HH:MM on a twenty-four-hour clock. */
export const WALL_CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether typed text reads as a time of day. */
export function isWallClockTime(text: string): boolean {
  return WALL_CLOCK_TIME.test(text);
}

/** Typed text as the request carries it: trimmed, and empty means nothing was said. */
export function optionalText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** A civil date as the picker holds it, or undefined while the field is empty or half-entered. */
export function civilDateValue(text: string | null): CalendarDate | undefined {
  if (text === null) return undefined;
  try {
    return parseDate(text);
  } catch {
    return undefined;
  }
}
