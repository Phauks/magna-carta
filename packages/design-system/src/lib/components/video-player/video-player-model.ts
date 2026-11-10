/*
 * The arithmetic and the words of the video player, kept out of the component so they are tested
 * without a browser. How a position READS is the shared clock (formatters/duration.ts), always to
 * the second and always with hours, because a recording's moments are quoted aloud and "0:12:41"
 * is said the same way at the start of a deposition and three hours in.
 */
import { formatClock } from "../../formatters/duration.ts";

/** The speeds offered, slowest first. Normal speed is named, the others are multiples. */
export const PLAYBACK_SPEEDS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** How far the skip buttons and their keys move, in seconds. */
export const SKIP_SECONDS = 10;

/**
 * How far one frame step moves. The element does not report a recording's frame rate, so a step is
 * a thirtieth of a second: one frame of the commonest rate, and never more than one frame of any
 * slower one. A reader stepping through a moment lands on every frame either way.
 */
export const FRAME_STEP_SECONDS = 1 / 30;

export function speedLabel(speed: number): string {
  return speed === 1 ? "Normal" : `${String(speed)}×`;
}

/** A position as it reads on screen: `H:MM:SS`, and zero while nothing is known. */
export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return formatClock(0, { toTheSecond: true });
  return formatClock(seconds, { toTheSecond: true });
}

function counted(value: number, singular: string): string {
  return `${String(value)} ${singular}${value === 1 ? "" : "s"}`;
}

/** A position as a screen reader says it: "1 hour 2 minutes 3 seconds", the zero parts left out. */
export function spokenMediaTime(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(counted(hours, "hour"));
  if (minutes > 0) parts.push(counted(minutes, "minute"));
  if (rest > 0 || parts.length === 0) parts.push(counted(rest, "second"));
  return parts.join(" ");
}

/** A target position held inside the recording. */
export function clampPosition(seconds: number, duration: number): number {
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  return Math.min(end, Math.max(0, seconds));
}

/** How much of the recording has loaded, as a fraction: the furthest loaded point over the length. */
export function loadedFraction(
  ranges: readonly { readonly start: number; readonly end: number }[],
  duration: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const furthest = ranges.reduce((most, range) => Math.max(most, range.end), 0);
  return Math.min(1, furthest / duration);
}
