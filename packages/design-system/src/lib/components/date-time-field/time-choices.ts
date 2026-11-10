/*
 * The arithmetic behind the date-time field's list of times, kept out of the component so it can be
 * tested without a browser.
 *
 * A time here is the stored wall-clock shape, `HH:MM`, and the arithmetic is done in MINUTES OF THE
 * DAY. The list is a convenience, never a constraint: it offers the times on a step (every fifteen
 * minutes by default), and a time that is not on that step — a hearing set for 9:40 — is still a
 * time the field holds. Such a time is put into the list in its place, so the list always shows
 * the answer the field is holding rather than silently highlighting nothing (owner, 2026-11-10:
 * "sometimes non 15 minute intervals will occur, so need to allow for that").
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const STORED_SHAPE = /^(\d{2}):(\d{2})$/;

/** The step the list offers when a caller does not choose one. */
export const DEFAULT_TIME_STEP_MINUTES = 15;

/** One row of the list: the stored time, and how long after `from` it is when there is a `from`. */
export interface TimeChoice {
  time: string;
  minuteOfDay: number;
  /** Minutes after the start the list was measured from, or null where it was not. */
  minutesAfter: number | null;
}

/** The minute of the day a stored time names, or null for anything that is not one. */
export function minuteOfDay(time: string): number | null {
  const match = STORED_SHAPE.exec(time);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour >= 24 || minute >= MINUTES_PER_HOUR) return null;
  return hour * MINUTES_PER_HOUR + minute;
}

/** The stored shape of a minute of the day, wrapping past midnight. */
export function timeOfMinute(minute: number): string {
  const wrapped = ((Math.trunc(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(wrapped / MINUTES_PER_HOUR);
  const rest = wrapped % MINUTES_PER_HOUR;
  return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * The times the list offers.
 *
 * Every `step` minutes across the day; or, where `from` is given (an end time on the same day as
 * its start), only the times after `from`, each carrying how long after it is. The `selected` time
 * is always in the list, in order, whether or not it falls on the step.
 */
export function timeChoices(options: {
  step?: number;
  selected?: string;
  from?: string;
}): TimeChoice[] {
  const step =
    options.step !== undefined && Number.isFinite(options.step) && options.step >= 1
      ? Math.trunc(options.step)
      : DEFAULT_TIME_STEP_MINUTES;
  const from = options.from === undefined ? null : minuteOfDay(options.from);
  const minutes = new Set<number>();
  const first = from === null ? 0 : from + step;
  for (let minute = first; minute < MINUTES_PER_DAY; minute += step) minutes.add(minute);
  const selected = options.selected === undefined ? null : minuteOfDay(options.selected);
  if (selected !== null && (from === null || selected > from)) minutes.add(selected);
  return [...minutes]
    .toSorted((left, right) => left - right)
    .map((minute) => ({
      time: timeOfMinute(minute),
      minuteOfDay: minute,
      minutesAfter: from === null ? null : minute - from,
    }));
}

/** How long a span of minutes is, the way the list says it beside an end time: "45 min", "1 hr 30 min". */
export function spanLabel(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  if (hours === 0) return `${String(rest)} min`;
  if (rest === 0) return `${String(hours)} hr`;
  return `${String(hours)} hr ${String(rest)} min`;
}
