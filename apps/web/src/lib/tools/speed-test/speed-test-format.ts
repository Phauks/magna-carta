/*
 * Turning engine numbers into the ledger voice. An absent measurement is an em dash, never a
 * zero: zero is a claim the connection carried nothing, and we did not measure that.
 */
const ABSENT = "—";

/** Bits per second → the largest unit that keeps the number readable. */
export function formatBandwidth(bitsPerSecond: number | undefined): string {
  if (bitsPerSecond === undefined || !Number.isFinite(bitsPerSecond)) return ABSENT;
  if (bitsPerSecond >= 1e9) return `${(bitsPerSecond / 1e9).toFixed(2)} Gbps`;
  const megabits = bitsPerSecond / 1e6;
  return megabits >= 100 ? `${Math.round(megabits)} Mbps` : `${megabits.toFixed(1)} Mbps`;
}

export function formatMilliseconds(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return ABSENT;
  return `${milliseconds.toFixed(1)} ms`;
}

/** A 0–1 ratio (packet loss) as a percentage; a whole percentage keeps no decimal. */
export function formatRatio(ratio: number | undefined): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return ABSENT;
  const percentage = ratio * 100;
  return Number.isInteger(percentage) ? `${percentage}%` : `${percentage.toFixed(1)}%`;
}
