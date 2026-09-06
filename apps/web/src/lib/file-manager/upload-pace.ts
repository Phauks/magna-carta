/*
 * How fast an upload is going, and how long is left — from the bytes as they leave.
 *
 * The rate is measured over a short trailing window rather than since the start: a transfer that
 * stalled for a minute and then recovered should read as recovered, and one that started fast on a
 * cached first part should not promise that pace for the rest. The window is long enough that a
 * single burst does not swing the figure, short enough that a change of pace shows within a few
 * seconds. Pure: the queue samples, this module reads the samples.
 *
 * "About" is said out loud. A time remaining is an estimate over a link that will change, and a
 * figure that reads as a promise is worse than none; so it is rounded to a size a reader can hold,
 * and printed with the word that says so.
 */

export interface PaceSample {
  /** Milliseconds, from the same clock as every other sample. */
  readonly at: number;
  /** Bytes sent so far across the whole batch at that instant. */
  readonly bytes: number;
}

/** How far back the rate looks. */
export const PACE_WINDOW_MILLISECONDS = 8_000;

export interface Pace {
  /** Bytes per second over the window, or null before two samples a moment apart exist. */
  readonly bytesPerSecond: number | null;
  /** Seconds to go at that rate, or null when the rate is unknown or nothing is moving. */
  readonly secondsRemaining: number | null;
}

/** Keep the samples the window still needs, with the newest appended. */
export function withSample(
  samples: readonly PaceSample[],
  sample: PaceSample,
  windowMilliseconds = PACE_WINDOW_MILLISECONDS,
): PaceSample[] {
  const kept = samples.filter((held) => sample.at - held.at <= windowMilliseconds);
  // Always keep one sample from before the window's edge, so the rate has a foot to stand on the
  // moment the window fills; a window with only its newest sample has no rate at all.
  const edge = samples.findLast((held) => sample.at - held.at > windowMilliseconds);
  return edge === undefined ? [...kept, sample] : [edge, ...kept, sample];
}

export function paceOf(
  samples: readonly PaceSample[],
  remainingBytes: number,
  windowMilliseconds = PACE_WINDOW_MILLISECONDS,
): Pace {
  const first = samples[0];
  const last = samples.at(-1);
  if (first === undefined || last === undefined || last.at - first.at < 500) {
    return { bytesPerSecond: null, secondsRemaining: null };
  }
  const bytesPerSecond = ((last.bytes - first.bytes) * 1000) / (last.at - first.at);
  if (bytesPerSecond > 0) {
    return { bytesPerSecond, secondsRemaining: remainingBytes / bytesPerSecond };
  }
  // Nothing moved. That is a stall only once the whole window has watched it not move: a link
  // that pauses for a few seconds between parts is not stalled, and saying so would cry wolf.
  return last.at - first.at >= windowMilliseconds
    ? { bytesPerSecond: 0, secondsRemaining: null }
    : { bytesPerSecond: null, secondsRemaining: null };
}

/** "2.4 MB/s", in the units the size column already speaks. */
export function formatRate(bytesPerSecond: number): string {
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bytesPerSecond;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(Math.round(value)) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * "about 40 s left", "about 3 min left", "about 1 h 10 min left" — rounded to what a reader can
 * hold, and never to the second past a minute.
 */
export function formatRemaining(seconds: number): string {
  if (seconds < 5) return "a moment left";
  if (seconds < 60) return `about ${String(Math.ceil(seconds / 5) * 5)} s left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${String(minutes)} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `about ${String(hours)} h left`
    : `about ${String(hours)} h ${String(rest)} min left`;
}

/** The pace as one phrase for a tally line, or "" when there is nothing honest to say yet. */
export function paceText(pace: Pace): string {
  if (pace.bytesPerSecond === null) return "";
  if (pace.bytesPerSecond === 0) return "stalled";
  const rate = formatRate(pace.bytesPerSecond);
  return pace.secondsRemaining === null
    ? rate
    : `${rate} · ${formatRemaining(pace.secondsRemaining)}`;
}
