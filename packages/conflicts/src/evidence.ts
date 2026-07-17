import type { EvidenceTier, MatchEvidence } from "./types.ts";

// Rank a candidate by WHAT KIND of thing matched, not by how probable the match is. A conflicts
// check surfaces candidates for a human to adjudicate; it does not decide. So the ordinal orders the
// reviewer's queue and nothing more — no tier is a threshold, and a candidate with no recorded signal
// still lands at tier 4 rather than disappearing. Suppressing a weak match would convert a missed
// conflict into an invisible one, which is the failure this system exists to prevent.
export function assignTier(evidence: MatchEvidence): EvidenceTier {
  if (evidence.identifierTypes.length > 0) return 1;
  if (evidence.exactNormalizedName) return 2;
  if (evidence.phoneticMatch) return 3;
  return 4;
}

// The human-readable explanation stored on every hit. A reviewer adjudicates on this, and an auditor
// reads it years later, so it lists every channel that fired rather than only the tier-setting one.
export function describeEvidence(evidence: MatchEvidence): string[] {
  const parts: string[] = [];
  for (const identifierType of evidence.identifierTypes) {
    parts.push(`exact identifier match: ${identifierType}`);
  }
  if (evidence.exactNormalizedName) parts.push("exact normalized name match");
  if (evidence.phoneticMatch) parts.push("phonetic code match");
  if (evidence.trigramMatch) parts.push("trigram overlap");
  return parts;
}
