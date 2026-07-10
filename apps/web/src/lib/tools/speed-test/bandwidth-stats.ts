/*
 * The distribution behind the headline figure.
 *
 * The engine reports bandwidth at the 90th percentile of its samples, not the mean — so a single
 * number hides how consistent the connection was. Median, 95th percentile and peak, shown with the
 * sample count, let a reader judge that for themselves.
 *
 * There is deliberately no 99th percentile: a run yields about thirty download samples, and at that
 * size the 99th percentile is simply the maximum. Reporting it would dress a single observation up
 * as a distribution.
 *
 * Nearest-rank, not interpolation: every value returned is a bandwidth this connection actually
 * achieved, never one it never reached.
 */
export interface BandwidthStats {
  readonly median: number;
  readonly p95: number;
  readonly peak: number;
  readonly samples: number;
}

export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index] ?? null;
}

export function bandwidthStats(points: ReadonlyArray<{ bps: number }>): BandwidthStats | null {
  if (points.length === 0) return null;
  const values = points.map((point) => point.bps);
  const median = percentile(values, 0.5);
  const p95 = percentile(values, 0.95);
  const peak = percentile(values, 1);
  if (median === null || p95 === null || peak === null) return null;
  return { median, p95, peak, samples: values.length };
}
