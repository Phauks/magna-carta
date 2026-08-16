import type { EvidenceTier, MatchEvidence } from "./types.ts";

// Rank a candidate by WHAT KIND of thing matched, not by how probable the match is. A conflicts
// check surfaces candidates for a human to adjudicate; it does not decide. So the ordinal orders the
// reviewer's queue and nothing more — no tier is a threshold, and a candidate with no recorded signal
// still lands at tier 4 rather than disappearing. Suppressing a weak match would convert a missed
// conflict into an invisible one, which is the failure this system exists to prevent.
export function assignTier(evidence: MatchEvidence): EvidenceTier {
  if (evidence.identifierTypes.length > 0) return 1;
  // Tier 2 is "these are the same name". An exact normalized-name match says it, and so does a match
  // key: the key differs from the normalized display only in spellings that carry no information —
  // an ampersand written as a word, a legal form written with dots — so two records agreeing on it
  // are one name written twice, not two names that resemble each other.
  if (evidence.exactNormalizedName || evidence.matchKeyName === true) return 2;
  // Tier 3 is "these might be the same". The bare match key joins the sound-alike channels here
  // rather than at tier 2 because dropping the legal form drops a real distinction: a partnership and
  // a limited company under one name may be one firm re-formed or two separate legal persons, and
  // deciding which is a lawyer's job. Four tiers is the shipped ordinal and stays four — widening the
  // CHECK on a growing append-only table would be a rebuild — so a new signal maps into the existing
  // rungs and names itself in the hit's matched-fields list instead.
  if (evidence.bareMatchKeyName === true || evidence.phoneticMatch) return 3;
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
  if (evidence.matchKeyName === true) parts.push("same name, different spelling of the legal form");
  if (evidence.bareMatchKeyName === true) parts.push("same name, different legal form");
  if (evidence.phoneticMatch) parts.push("phonetic code match");
  if (evidence.trigramMatch) parts.push("trigram overlap");
  return parts;
}
