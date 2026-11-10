/*
 * A WALL-CLOCK TIME as a reader reads it — "9:30 AM" in en-US, "09:30" where the clock is 24-hour.
 *
 * A wall-clock time is the hour a record was written down for, with no day and no zone attached:
 * the "09:30" a hearing is set for. It is not a moment, so it is never read through the viewer's
 * zone the way `formatTimeOfDay` reads an instant; it is formatted from its own parts on a UTC
 * `Date`, which is the same pinning `formatDate` uses for a civil day and for the same reason — the
 * hour printed is the hour that was handed in, in every office.
 *
 * Input is the stored shape, `HH:MM`. Anything else is shown as exactly what arrived, because a
 * blank or a cheerful "12:00 AM" would hide the defect that printing the data makes obvious.
 */

/** How a wall-clock time is rendered. */
export interface WallClockOptions {
  /** BCP 47 locale; the runtime's own when omitted. */
  locale?: string;
}

const STORED_SHAPE = /^(\d{2}):(\d{2})$/;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

export function formatWallClockTime(time: string, options: WallClockOptions = {}): string {
  const match = STORED_SHAPE.exec(time);
  if (match === null) return time;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour >= HOURS_PER_DAY || minute >= MINUTES_PER_HOUR) return time;
  return new Intl.DateTimeFormat(options.locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2023, 0, 1, hour, minute)));
}
