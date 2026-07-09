/*
 * How an unmeasured value reads in a value slot. It was an em dash (which said nothing twice, once
 * the page gained a sentence for absence), then nothing (which read as broken). `N/A` shows a field
 * waiting for data. Where a SENTENCE belongs, the page says "Not measured yet." instead — see
 * NOT_MEASURED_YET below. Nothing may ever replace this with a zero: a measured zero is a result.
 */
export const ABSENT = "N/A";

/*
 * How an untaken measurement reads, in prose. The em dash above says the same thing where a number
 * belongs; this says it where a sentence belongs. Both live here so the page never invents a fifth
 * way to say "we have not measured this."
 */
export const NOT_MEASURED_YET = "Not measured yet.";

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
