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

  // The clock form is whole minutes by construction, so a fractional minute rounds rather than
  // producing a seconds field the firm never bills in.
  const wholeMinutes = Math.round(Math.abs(minutes));
  const sign = minutes < 0 ? "-" : "";
  const hours = Math.floor(wholeMinutes / MINUTES_PER_HOUR);
  const remainingMinutes = String(wholeMinutes % MINUTES_PER_HOUR).padStart(2, "0");
  const clock = `${sign}${String(hours)}:${remainingMinutes}`;

  return { decimal, clock, text: `${decimal} (${clock})` };
}
