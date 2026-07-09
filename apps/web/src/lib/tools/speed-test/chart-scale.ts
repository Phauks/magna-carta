/*
 * The only arithmetic a single-series chart needs. An empty or all-zero series yields a domain of
 * 1 rather than 0: a zero domain divides by zero and collapses every mark onto the baseline.
 */

/** Round a series' maximum up to a readable ceiling (1, 2, or 5 x a power of ten). */
export function niceMax(values: readonly number[]): number {
  const largest = values.reduce((carry, value) => (value > carry ? value : carry), 0);
  if (largest <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(largest));
  const normalized = largest / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** A clamped linear map from [0, domainMax] onto [0, rangeMax]. */
export function scaleLinear(domainMax: number, rangeMax: number): (value: number) => number {
  const safeDomain = domainMax > 0 ? domainMax : 1;
  return (value) => {
    const scaled = (value / safeDomain) * rangeMax;
    if (scaled < 0) return 0;
    return scaled > rangeMax ? rangeMax : scaled;
  };
}
