/*
 * Numbers into the strings the page shows: bandwidth, milliseconds, percentages. Formatting only.
 * How the tool says a value is missing lives in `absence.ts`, and the guards below defer to it.
 * A measured zero is a real reading and formats as itself; only an undefined or non-finite input
 * yields the absence marker.
 */
import { ABSENT_MARKER } from "./absence.ts";

/** Bits per second → the largest unit that keeps the number readable. */
export function formatBandwidth(bitsPerSecond: number | undefined): string {
  if (bitsPerSecond === undefined || !Number.isFinite(bitsPerSecond)) return ABSENT_MARKER;
  if (bitsPerSecond >= 1e9) return `${(bitsPerSecond / 1e9).toFixed(2)} Gbps`;
  const megabits = bitsPerSecond / 1e6;
  return megabits >= 100 ? `${Math.round(megabits)} Mbps` : `${megabits.toFixed(1)} Mbps`;
}

export function formatMilliseconds(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return ABSENT_MARKER;
  return `${milliseconds.toFixed(1)} ms`;
}

/** A 0–1 ratio (packet loss) as a percentage; a whole percentage keeps no decimal. */
export function formatRatio(ratio: number | undefined): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return ABSENT_MARKER;
  const percentage = ratio * 100;
  return Number.isInteger(percentage) ? `${percentage}%` : `${percentage.toFixed(1)}%`;
}
