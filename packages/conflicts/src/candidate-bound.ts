import { MAX_BATCH_STATEMENTS } from "@magna-carta/data-access/effect-batch";
import type { EvidenceTier } from "./types.ts";

// THE BOUND ON WHAT ONE CHECK WRITES, AND WHY IT IS THE PLATFORM'S AND NOT THE FIRM'S.
//
// The walk's ceiling bounds how many entities a run reaches. It cannot bound the work, because the
// candidates a run produces scale with the closure TIMES the corpus: each reached entity is asked of
// the whole Directory, and the trigram channel answers with a large and corpus-proportional fraction
// of it. The measured shape is in the load profile
// (`conflictsCandidateBounds` in packages/fixtures/src/load-profile/conflicts-measurements.ts).
// A ceiling on the walk is therefore a ceiling on one factor of a product, which is not a ceiling.
//
// A firm used to set this number. The owner removed that on 2026-09-11
// (docs/conventions/conflicts-rulings.md, E2): where a search stops is not a firm's choice. What
// remains is the one bound nobody can lift — every hit of a check rides one atomic batch with the
// check row, and a batch has a stated ceiling (`MAX_BATCH_STATEMENTS`). A run that produced more
// candidates than one transaction can carry would fail outright and record nothing, which is strictly
// worse than a bounded answer that says it is bounded. So the ceiling below is derived from the
// platform's own, is not a setting anywhere, and is recorded on every check row so a reader can see
// what bound was in force.
//
// WHAT THIS IS NOT. It is not a threshold, and this package still has none. A threshold asks what a
// candidate's evidence IS and removes it on that answer, at every volume, forever — which is the
// mechanism that turns a missed conflict into an invisible one. This asks only how many candidates one
// run produced, refuses nothing at all below the ceiling, and when it does refuse it records the count
// and the tiers and says in words that the search is incomplete.

// Statements a check's batch carries beside its BOUNDED hits: the idempotency record, the check row,
// the run's settlement, the audit row, the notification, and the imputation hits — which are bounded
// by the matter's own party list rather than by this ceiling, since an identity join finding a firm
// member who genuinely IS a party is the strongest thing this engine produces and is never refused.
// Sized well past the route's bound on subject parties so even a matter staffed entirely by the firm's
// own members leaves room; its only job is to keep the two bounds from colliding.
const CHECK_BATCH_OVERHEAD_STATEMENTS = 500;

export const CANDIDATE_WRITE_CEILING = MAX_BATCH_STATEMENTS - CHECK_BATCH_OVERHEAD_STATEMENTS;
//
// WHAT GETS REFUSED, WHEN SOMETHING MUST BE. Strongest evidence is kept. The cap decides HOW MANY, and
// evidence strength decides WHICH — because the alternative is refusing in whatever order the matcher
// happened to iterate, which would discard an exact-identifier match to make room for a name that
// shares three consecutive characters. The refusal is reported per tier precisely so that a run which
// had to refuse anything above tier 4 is visibly alarming rather than quietly the same as one that
// refused only trigram overlap.
//
// A CO-PARTY HIT IS NEVER REFUSED. It is a match landing on another of the check's OWN subject parties
// — the opposing party turning out to be the client's parent company — so refusing one would drop a
// positional conflict between two parties of the matter being checked. Subject parties bypass the
// closure cap in expansion.ts for the same reason, and the bypass has the same consequence here: a
// co-party set larger than the cap starts the run already over it, every ordinary candidate is
// refused, and the record says exactly that.

export interface BoundableHit {
  readonly entityId: string;
  readonly coParty: boolean;
  readonly tier: number;
}

// How many candidates were refused at one evidence tier. Present only for tiers that actually lost
// something: a tier that lost nothing is not a fact worth a line, where a tier that lost anything is.
export interface RefusedTierCount {
  readonly tier: EvidenceTier;
  readonly count: number;
}

// WHAT THE RUN DID NOT WRITE. Present only when the cap refused something, and then carried onto the
// check row, the posture read, and the report sentence — a bounded search must never be readable as a
// complete one, exactly as a truncated traversal must not.
export interface CandidateTruncation {
  // Everything the channels surfaced, before the bound.
  readonly candidatesSurfaced: number;
  // What the check actually recorded as hits.
  readonly candidatesWritten: number;
  readonly candidatesRefused: number;
  // The refused set broken down by evidence tier, strongest first. All tier 4 is the expected shape;
  // anything else means the run was so far over the bound that real evidence fell off it.
  readonly refusedByTier: readonly RefusedTierCount[];
  readonly candidateCap: number;
}

export interface CandidateBoundResult<Hit extends BoundableHit> {
  readonly hits: readonly Hit[];
  // Null when every surfaced candidate was written.
  readonly truncation: CandidateTruncation | null;
}

// Strongest first: tier ascending, then entity id, then the order the matcher produced them. Every
// tie-break is on stored data or on a stable position, so one corpus always yields one written set.
function strongestFirst<Hit extends BoundableHit>(
  left: { hit: Hit; index: number },
  right: { hit: Hit; index: number },
): number {
  return (
    left.hit.tier - right.hit.tier ||
    left.hit.entityId.localeCompare(right.hit.entityId) ||
    left.index - right.index
  );
}

function isEvidenceTier(tier: number): tier is EvidenceTier {
  return tier === 1 || tier === 2 || tier === 3 || tier === 4;
}

export function boundCandidateHits<Hit extends BoundableHit>(
  hits: readonly Hit[],
  candidateCap: number,
): CandidateBoundResult<Hit> {
  // Below the bound nothing is chosen, nothing is reordered, and nothing is recorded — the ordinary
  // check is byte-for-byte the check it was before the bound existed.
  if (hits.length <= candidateCap) return { hits, truncation: null };

  const positioned = hits.map((hit, index) => ({ hit, index }));
  const exempt = positioned.filter((entry) => entry.hit.coParty);
  const boundable = positioned.filter((entry) => !entry.hit.coParty).toSorted(strongestFirst);

  const room = Math.max(0, candidateCap - exempt.length);
  const kept = [...exempt, ...boundable.slice(0, room)].toSorted(
    (left, right) => left.index - right.index,
  );
  const refused = boundable.slice(room);

  const refusedCounts = new Map<EvidenceTier, number>();
  for (const entry of refused) {
    // A tier this build does not recognize is counted at the weakest rather than dropped from the
    // total: the refusal count and the per-tier breakdown have to add up, or the record understates
    // what was not written.
    const tier = isEvidenceTier(entry.hit.tier) ? entry.hit.tier : 4;
    refusedCounts.set(tier, (refusedCounts.get(tier) ?? 0) + 1);
  }

  return {
    hits: kept.map((entry) => entry.hit),
    truncation: {
      candidatesSurfaced: hits.length,
      candidatesWritten: kept.length,
      candidatesRefused: refused.length,
      refusedByTier: [...refusedCounts]
        .toSorted(([left], [right]) => left - right)
        .map(([tier, count]) => ({ tier, count })),
      candidateCap,
    },
  };
}
