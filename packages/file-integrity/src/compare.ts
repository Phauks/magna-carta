import type { BaselineComparison } from "./types.ts";

// Compare a freshly recomputed SHA-256 against the digest recorded at ingest. A null/empty baseline
// (e.g. an oversize file committed unscanned, whose content_sha256 was never set) is reported as
// no-baseline rather than a false mismatch — the caller states plainly that no baseline exists.
export function compareToBaseline(
  computedSha256: string,
  baselineSha256: string | null,
): BaselineComparison {
  if (baselineSha256 === null || baselineSha256 === "") return "no-baseline";
  return computedSha256.toLowerCase() === baselineSha256.toLowerCase() ? "match" : "mismatch";
}
