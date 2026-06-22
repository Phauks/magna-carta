// k-anonymity suppression for cross-firm usage reporting: a metric computed from fewer than k
// distinct firms (or users) could re-identify a tiny firm, so it is dropped. The caller logs the
// suppressed count — a suppressed cell is never silently hidden.
export const DEFAULT_SUPPRESSION_THRESHOLD = 5;

export function suppressSmallCells<T extends { distinctCount: number }>(
  cells: readonly T[],
  k: number = DEFAULT_SUPPRESSION_THRESHOLD,
): { kept: T[]; suppressed: number } {
  const kept = cells.filter((cell) => cell.distinctCount >= k);
  return { kept: [...kept], suppressed: cells.length - kept.length };
}
