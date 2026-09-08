/*
 * WHAT A WALL-CLOCK TIME IS — the hour and minute somebody wrote on a record, on a twenty-four-hour
 * clock, with no date and no zone attached to it.
 *
 * `HH:MM`, 00:00 through 23:59. A wall-clock time is not a moment: "nine in the morning" is a moment
 * only once a date and a zone are named beside it, which is what `instantForCivilDateTime` in
 * time-zone.ts is for. Storing one alone is right where the record is genuinely about the clock a
 * person read — a hearing set for 09:00 stays at 09:00 when the clocks change, because that is what
 * the notice says.
 *
 * The pattern lived in six files before this one, and it is the interesting half of the shape: a
 * looser `\d{2}:\d{2}` accepts 29:74, and a validator that accepts an hour that does not exist writes
 * a row every surface downstream has to defend itself against.
 */

/** A wall-clock time: `HH:MM` on a twenty-four-hour clock. */
export type WallClockTime = string;

/**
 * The one wall-clock shape in the platform. Hours 00-23, minutes 00-59, and nothing else.
 *
 * No flags — see the note on `CIVIL_DATE_PATTERN`: the OpenAPI emitter writes a regex's flags into
 * the JSON Schema `pattern`, and a flagged one reaches every client generator unusable.
 */
export const WALL_CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether a value is a wall-clock time. The pattern is total here — there is no rollover to catch. */
export function isWallClockTime(value: unknown): value is WallClockTime {
  return typeof value === "string" && WALL_CLOCK_TIME_PATTERN.test(value);
}
