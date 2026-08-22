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
  // Exhaustive on purpose rather than a fall-through: a fourth verdict kind should fail to compile
  // here, not silently inherit whatever the last branch happened to return.
  switch (verdict.verdict) {
    case "clean":
      return verdict.activeContent ? "active-content" : null;
    case "unscanned":
      return verdict.reason;
    case "flagged":
      return verdict.reason;
  }
}

// The closed vocabulary a READ surface may report as the reason behind a version's verdict. It is
// deliberately narrower than the `scan_detail` column, which is open text: three of the writers put
// engine-supplied free text in it (a clamd signature name, a YARA rule id, the enrichment suffix the
// content-drift withdrawal composes), and a signature name is a fact the platform does not author,
// does not bound in shape, and has no business handing to an unpermissioned, unaudited listing.
// Everything of that kind collapses to `scan-flagged`; the raw name stays reachable only on the
// audited download refusal and the permissioned scan-diagnosis read, both of which record who asked.
//
// `active-content` is absent on purpose — it is not a reason a file was refused but a badge on a file
// that passed, so it rides the separate boolean coarseScanReason returns.
export const SCAN_REASONS = [
  // Committed with no scan: the bytes were past the inspectable-size cap, could not be decrypted, or
  // no engine was deployed to look at them.
  "oversize",
  "encrypted",
  "no-engine",
  // Structural heuristics — the shapes an archive can take that make scanning it unsafe or endless.
  "decompression-bomb",
  "archive-nesting",
  "archive-entry-count",
  // Gate refusals: the bytes contradicted what the upload declared, or the firm's own upload policy
  // refused them once their real size and sniffed type were known.
  "size-mismatch",
  "type-mismatch",
  "policy-size",
  "policy-type",
  // The custody withdrawal: an already-committed version whose stored bytes stopped matching the hash
  // recorded at commit, or one that carried no hash to check against.
  "content-drift",
  "content-unverifiable",
  // The collapsing token: a named signature, a counting rule match, or any other detail this
  // vocabulary does not author. A client renders "rejected by the malware scan" and nothing narrower.
  "scan-flagged",
] as const;

export type ScanReason = (typeof SCAN_REASONS)[number];

const SCAN_REASON_SET = new Set<string>(SCAN_REASONS);

// The withdrawal path composes its detail as `<reason>: <what the replacement bytes turned out to
// be>`, and that suffix is the engine's own words. The prefix is the part a reader is owed.
const COMPOSED_SCAN_REASON_PREFIXES = ["content-drift", "content-unverifiable"] as const;

// What a read surface reports about a version's scan, derived from the open `scan_detail` column at
// projection time. Pure, and beside scanDetailFor because that function is what writes the column:
// keeping the writer and the narrowing reader in one file is what stops a new detail string being
// added on one side and silently classified as a signature on the other.
export function coarseScanReason(
  scanVerdict: "unscanned" | "clean" | "flagged" | null,
  versionStatus: "clean" | "pending" | "quarantined",
  scanDetail: string | null,
): { readonly scanReason: ScanReason | null; readonly activeContent: boolean } {
  if (scanDetail === null) return { scanReason: null, activeContent: false };
  // The one detail that is a property of a file that PASSED, so it is reported as the badge it is
  // rather than as a reason the file was refused.
  if (scanDetail === "active-content") return { scanReason: null, activeContent: true };
  if (SCAN_REASON_SET.has(scanDetail)) {
    return { scanReason: scanDetail as ScanReason, activeContent: false };
  }
  for (const prefix of COMPOSED_SCAN_REASON_PREFIXES) {
    if (scanDetail.startsWith(`${prefix}:`)) return { scanReason: prefix, activeContent: false };
  }
  // Anything left is text this vocabulary does not author. Report it as a flag only where a flag is
  // what happened; on a row that is neither flagged nor quarantined, an unrecognized detail is not
  // evidence of anything and saying "scan-flagged" would invent an alarm.
  const flagged = scanVerdict === "flagged" || versionStatus === "quarantined";
  return { scanReason: flagged ? "scan-flagged" : null, activeContent: false };
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
