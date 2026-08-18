// Turns raw scan facts from the engine container + a firm-level scan policy into a file verdict.
// Mirrors the deleted Rust `combine` function, generalized to a single `flagged` state.
// The precedence order below is the behaviour-preservation core — do not reorder.

import type { RawScanResult, RuleMatch, Tier } from "./scan-port.ts";

export interface ScanPolicy {
  tier: Tier;
  suspiciousScoreFloor: number;
}

export const DEFAULT_SCAN_POLICY: ScanPolicy = { tier: "extended", suspiciousScoreFloor: 75 };

export type FileVerdict =
  | { verdict: "clean"; activeContent: boolean }
  | { verdict: "flagged"; reason: string }
  | { verdict: "unscanned"; reason: "encrypted" | "no-engine" };

// Thrown when a deployed engine reports unavailable — the consumer must retry.
// A deployed engine going dark is a transient fault, not a clean result.
export class ScanFaultError extends Error {}

// What goes in the `scan_detail` column for a verdict that commits: the badge or the reason a reader
// is owed. One home, because it was two and they disagreed — the file path recorded `active-content`
// over bytes that still hold PDF JavaScript or Office macros, and the template path recorded null for
// every clean verdict, dropping the one signal the platform computes about executable content on the
// path where it matters most. A caller that quarantines writes its own reason and never calls this.
export function scanDetailFor(verdict: FileVerdict): string | null {
  if (verdict.verdict === "clean") return verdict.activeContent ? "active-content" : null;
  if (verdict.verdict === "unscanned") return verdict.reason;
  return verdict.reason;
}

export function tierRank(tier: Tier): number {
  return tier === "core" ? 0 : tier === "extended" ? 1 : 2;
}

// A match "counts" (triggers flagged) when it falls within the policy's tier AND
// either it is not suspicious, or its score meets the suspicious score floor.
export function matchCounts(match: RuleMatch, policy: ScanPolicy): boolean {
  if (tierRank(match.tier) > tierRank(policy.tier)) return false;
  return !match.isSuspicious || match.score >= policy.suspiciousScoreFloor;
}

// Precedence (highest to lowest):
// 1. clamd infected   → flagged (signature)
// 2. counting match   → flagged (first ruleId)
// 3. structural       → flagged (heuristic reason)
// 4. encrypted        → unscanned/encrypted
// 5. clam unavailable → unscanned/no-engine (no engine) | throw ScanFaultError (deployed engine fault)
// 6. else             → clean (activeContent = active-content heuristic)
export function computeVerdict(raw: RawScanResult, policy: ScanPolicy): FileVerdict {
  // 1. ClamAV signature hit — highest precedence.
  if (raw.clam.state === "infected") {
    return { verdict: "flagged", reason: raw.clam.signature };
  }

  // 2. First YARA rule match that counts under this policy.
  const countingMatch = raw.matches.find((m) => matchCounts(m, policy));
  if (countingMatch !== undefined) {
    return { verdict: "flagged", reason: countingMatch.ruleId };
  }

  // 3. Structural heuristic (decompression bomb, archive nesting, etc.).
  if (raw.heuristic.kind === "structural") {
    return { verdict: "flagged", reason: raw.heuristic.reason };
  }

  // 4. Encrypted — can't scan, honest unscanned result.
  if (raw.heuristic.kind === "encrypted") {
    return { verdict: "unscanned", reason: "encrypted" };
  }

  // 5. Engine unavailable — distinguish "no engine deployed" from "engine faulted".
  if (raw.clam.state === "unavailable") {
    if (raw.engineVersion === null) {
      // Honest launch adapter: no engine configured, not a fault.
      return { verdict: "unscanned", reason: "no-engine" };
    }
    // A deployed engine went dark — transient fault, consumer must retry.
    // Never return clean when a real engine is unreachable.
    throw new ScanFaultError(
      "Scan engine reported unavailable despite being deployed; retry the scan.",
    );
  }

  // 6. All checks passed — clean, optionally with an active-content flag.
  return { verdict: "clean", activeContent: raw.heuristic.kind === "active-content" };
}
