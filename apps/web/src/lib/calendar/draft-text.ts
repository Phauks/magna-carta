/*
 * The three small readings every calendar draft makes of typed text, in one place.
 *
 * Each draft module (event, deadline, firm event, continuance) turns what a person typed into what
 * the request carries, and each form turns a civil-date string back into what the date picker
 * holds. Four copies of "trim, and empty means null" had already appeared, with the same regular
 * expression beside two of them; a fifth would be the one that drifted.
 */
import { WALL_CLOCK_TIME_PATTERN } from "@magna-carta/civil-time/wall-clock";

/** A wall-clock time as the forms accept it: HH:MM on a twenty-four-hour clock. */
export const WALL_CLOCK_TIME = WALL_CLOCK_TIME_PATTERN;

export { isWallClockTime } from "$lib/dates";

/** Typed text as the request carries it: trimmed, and empty means nothing was said. */
export function optionalText(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

export { civilDateValue } from "$lib/dates";
