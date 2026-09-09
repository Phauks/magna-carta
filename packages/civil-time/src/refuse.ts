/*
 * WHAT HAPPENS WHEN A DATE IS THE WRONG KIND OF DATE — the one thing a type cannot answer here.
 *
 * The civil/instant confusion is the mistake this package's ruling ledger calls the one most worth
 * getting right: a stored instant handed to a function expecting a day is a whole day out, and
 * "2026-09-08T12:00:00.000Z" and "2026-09-08" are both strings.
 *
 * A COMPILE-TIME BRAND WAS THE OBVIOUS ANSWER AND IT IS THE WRONG ONE. A brand is erased at runtime,
 * and the values that actually cause this arrive from a D1 column or a request body — where thirty-
 * two civil-date columns still carry no shape CHECK, so a civil-date column genuinely can hold an
 * instant today (packages/database/test/date-shape-guards.test.ts records every one). A brand would
 * assert the shape the database does not enforce, and it would be wrong in exactly the case that
 * matters: real data that is already wrong. Every call site would take a cast to satisfy it, and a
 * cast is a lie that typechecks.
 *
 * So the check is here, at runtime, where the value actually is. It costs a regex test on a string
 * that was about to be parsed anyway.
 *
 * WHAT THIS REPLACES. Every one of these already failed; they failed uselessly. `civilDateParts`
 * handed back `{ year: 2026, month: 9, day: NaN }` in silence, and everything built on it surfaced
 * as `RangeError: Invalid time value` — a message that names no function, no argument, and no value,
 * on a request carrying a dozen dates. The failure was never the problem; the diagnosis was.
 */
import { CIVIL_DATE_PATTERN } from "./civil-date.ts";
import { CANONICAL_INSTANT_PATTERN } from "./instant.ts";
import { WALL_CLOCK_TIME_PATTERN } from "./wall-clock.ts";

/**
 * A value handed to this package that is not the shape the function takes.
 *
 * A `TypeError` because that is what it is — the wrong kind of value, not a failed computation — and
 * because the alternative is a bare `Error` that every caller's failure surface has to special-case.
 */
export class CivilTimeArgumentError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CivilTimeArgumentError";
  }
}

/** How much of a bad value to print. Long enough to recognise, short enough not to be the message. */
const SHOWN = 40;

function shown(value: unknown): string {
  if (typeof value !== "string") return String(value);
  return value.length <= SHOWN ? `"${value}"` : `"${value.slice(0, SHOWN)}…"`;
}

/**
 * What the value most likely IS, when that is recognisable — the half of the message worth reading.
 *
 * "is not a civil date" sends somebody to check the format. "is an instant" sends them to the line
 * that read the wrong column, which is where the mistake actually is.
 */
function reads(value: unknown): string {
  if (value === null || value === undefined) {
    return (
      "is absent. A day that is genuinely optional is checked for absence by its caller, in " +
      "that caller's own vocabulary, before it reaches here"
    );
  }
  if (typeof value !== "string") return `is a ${typeof value}, not a string`;
  if (CANONICAL_INSTANT_PATTERN.test(value)) {
    return (
      "is a stored INSTANT, not a day. An instant is a day only once somebody names a zone — " +
      "`zonedReading(Date.parse(value), zone).civilDate` is that reading, and it differs from the " +
      "UTC day for roughly a third of every day"
    );
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) {
    return "is a date with a time on it, not a civil date. Take the day, or read it in a zone";
  }
  if (WALL_CLOCK_TIME_PATTERN.test(value)) return "is a wall-clock time, not a day";
  if (value.trim() === "") return "is empty";
  if (CIVIL_DATE_PATTERN.test(value)) {
    return "has the shape of a day but names no day on the calendar (2026-02-30 and its family)";
  }
  return "is not a civil date (YYYY-MM-DD)";
}

/**
 * The value is a civil date, or this throws saying what it is instead.
 *
 * Shape only — deliberately not `isCivilDate`, which also refuses 2026-02-30. A caller doing
 * arithmetic on a rollover date gets a real answer, and a caller that needs the day to exist asks
 * `isCivilDate` at its own boundary, where it can refuse in its own vocabulary. What this stops is
 * the class of value that produces `NaN` and travels.
 */
export function requireCivilDate(value: unknown, where: string, parameter: string): string {
  if (typeof value === "string" && CIVIL_DATE_PATTERN.test(value)) return value;
  throw new CivilTimeArgumentError(`${where}: ${parameter} ${shown(value)} ${reads(value)}.`);
}

/** The value is a wall-clock time, or this throws saying what it is instead. */
export function requireWallClockTime(value: unknown, where: string, parameter: string): string {
  if (typeof value === "string" && WALL_CLOCK_TIME_PATTERN.test(value)) return value;
  throw new CivilTimeArgumentError(
    `${where}: ${parameter} ${shown(value)} is not a wall-clock time (HH:MM, 00:00 to 23:59).`,
  );
}

/** The value is a moment a `Date` can hold, or this throws rather than producing an invalid one. */
export function requireInstant(value: Date | number, where: string, parameter: string): number {
  const milliseconds = typeof value === "number" ? value : value.getTime();
  if (Number.isFinite(milliseconds)) return milliseconds;
  throw new CivilTimeArgumentError(
    `${where}: ${parameter} ${shown(value instanceof Date ? value.toString() : value)} is not a ` +
      "moment. An unparsed date string reaches here as an Invalid Date; parse it where it arrives, " +
      "so the failure names the field rather than the arithmetic.",
  );
}
