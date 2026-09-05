/*
 * How long something took, in the two literacies lawyers actually read.
 *
 * A duration renders in BOTH forms wherever it appears — decimal hours and the clock form are the
 * same value said two ways, and a firm reads both. The DECIMAL leads, because it is the figure the
 * arithmetic multiplies and the figure the bill carries; the clock form sits beside it, quieter and
 * smaller. That last part is the surface's typography, which is why this returns the two parts
 * separately rather than one pre-joined string: a cell or a panel renders `decimal` and `clock` into
 * their own elements and dresses them, while `text` exists for the places that can only carry one
 * string — a toast, an accessible name, a printed line.
 *
 * The unit in is MINUTES, because that is what a duration is stored as. Zero is a real duration and
 * renders as one ("0.00", "0:00"), never as a blank or a dash: an entry can legitimately hold no
 * time yet, and an empty cell would read as missing data rather than as none.
 *
 * Reading a duration a person typed is the opposite direction and a different job; the capture
 * grammar in @magna-carta/timekeeping owns it, and it accepts either of these two forms.
 */

const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** Two decimal places is the billing convention: the increment a firm bills in is never finer. */
const DEFAULT_DECIMAL_PLACES = 2;

/** The range `Number.prototype.toFixed` accepts, so a bad option can never throw out of a render. */
const MAXIMUM_DECIMAL_PLACES = 100;

export interface DurationOptions {
  /** Digits after the decimal point on the leading figure. */
  decimalPlaces?: number;
}

export interface FormattedDuration {
  /** Decimal hours — the figure that leads, and the one the arithmetic multiplies. */
  decimal: string;
  /** The clock form, which reads beside the decimal, quieter and smaller. */
  clock: string;
  /** Both forms in one string, for a place that can only carry one: a toast, a printed line. */
  text: string;
}

/**
 * Both renderings of a duration held in minutes.
 *
 * A value that is not a finite number of minutes is not a duration, and is shown as exactly what
 * arrived rather than dressed up as "0.00" — a rendering that quietly reports no time where the
 * data holds something else is worse than a visibly wrong one.
 */
/** How a clock is rendered. */
export interface ClockOptions {
  /** Show the seconds field, for a duration that is still ticking. */
  toTheSecond?: boolean;
}

export function formatDuration(minutes: number, options: DurationOptions = {}): FormattedDuration {
  if (!Number.isFinite(minutes)) {
    const raw = String(minutes);
    return { decimal: raw, clock: raw, text: raw };
  }

  const decimalPlaces = Math.min(
    Math.max(Math.trunc(options.decimalPlaces ?? DEFAULT_DECIMAL_PLACES), 0),
    MAXIMUM_DECIMAL_PLACES,
  );
  const decimal = (minutes / MINUTES_PER_HOUR).toFixed(decimalPlaces);

  // A billed duration is whole minutes by construction, so a fractional minute rounds rather than
  // producing a seconds field the firm never bills in. The MAGNITUDE rounds and the sign is carried
  // separately, which is what the two together have always done: Math.round breaks a .5 tie toward
  // positive infinity, so rounding the signed value would send -90.5 to -1:30 while sending 90.5 to
  // 1:31, and a duration and its negation would differ in size. Carrying the sign here also keeps a
  // magnitude that rounds to nothing reading as "-0:00" rather than losing its sign to negative zero.
  const magnitude = Math.round(Math.abs(minutes));
  const clock = `${minutes < 0 ? "-" : ""}${formatClock(magnitude * SECONDS_PER_MINUTE)}`;

  return { decimal, clock, text: `${decimal} (${clock})` };
}

/**
 * A duration as a CLOCK, from seconds — `H:MM`, or `H:MM:SS` while something is ticking.
 *
 * Seconds rather than minutes because this is the form a running timer wears, and a timer that
 * rounded to the minute would sit still for sixty seconds at a time. It is the same clock
 * `formatDuration` reports, and it is the same function: the timer and the billed figure disagreeing
 * about what "1:30" means is exactly the drift a shared vocabulary exists to prevent, and they did
 * disagree — the sheet's own copy dropped the negative sign this one keeps.
 */
export function formatClock(seconds: number, options: ClockOptions = {}): string {
  if (!Number.isFinite(seconds)) return String(seconds);
  const sign = seconds < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(seconds));
  const hours = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes = String(Math.floor((whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)).padStart(
    2,
    "0",
  );
  if (options.toTheSecond !== true) return `${sign}${String(hours)}:${minutes}`;
  return `${sign}${String(hours)}:${minutes}:${String(whole % SECONDS_PER_MINUTE).padStart(2, "0")}`;
}
