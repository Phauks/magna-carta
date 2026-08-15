import { expect, test } from "vitest";
import { boundCandidateHits, type BoundableHit } from "../src/candidate-bound.ts";

// THE SECOND BOUND'S CONTRACT.
//
// The closure cap bounds the walk; this bounds what the walk's matching produced, which is the walk
// times the corpus. Every assertion below is about the same thing said two ways: below the bound the
// run is untouched, and above it the run is narrowed LOUDLY — strongest evidence kept, co-party never
// refused, and a record that adds up to what the channels actually surfaced.

function hit(entityId: string, tier: number, coParty = false): BoundableHit {
  return { entityId, tier, coParty };
}

test("below the cap nothing is chosen, nothing is reordered, and nothing is recorded", () => {
  // The ordinary check must be the check it was before the bound existed — including the ORDER its
  // hits were produced in, which is what the written rows carry.
  const hits = [hit("b", 4), hit("a", 1), hit("c", 3)];
  const bounded = boundCandidateHits(hits, 10);
  expect(bounded.truncation).toBeNull();
  expect(bounded.hits).toBe(hits);
});

test("exactly at the cap is not a truncation", () => {
  const hits = [hit("a", 4), hit("b", 4), hit("c", 4)];
  expect(boundCandidateHits(hits, 3).truncation).toBeNull();
});

test("over the cap keeps the strongest evidence and refuses the weakest", () => {
  // A cap that refused in matcher-iteration order would discard an exact-identifier match to make room
  // for a name that shares three consecutive characters. The cap decides HOW MANY; evidence decides
  // WHICH.
  const hits = [
    hit("trigram-one", 4),
    hit("trigram-two", 4),
    hit("identifier", 1),
    hit("trigram-three", 4),
    hit("phonetic", 3),
  ];
  const bounded = boundCandidateHits(hits, 2);
  expect(bounded.hits.map((entry) => entry.entityId)).toEqual(["identifier", "phonetic"]);
  expect(bounded.truncation).toEqual({
    candidatesSurfaced: 5,
    candidatesWritten: 2,
    candidatesRefused: 3,
    refusedByTier: [{ tier: 4, count: 3 }],
    candidateCap: 2,
  });
});

test("the written set keeps the order the matcher produced, not the order it was chosen in", () => {
  // Choosing by strength and WRITING by strength are different decisions. Only the first is wanted:
  // reordering the rows would make a bounded run's log read differently from an unbounded one for
  // reasons that have nothing to do with what was found.
  const hits = [hit("z-weak", 4), hit("m-strong", 1), hit("a-middle", 3)];
  const bounded = boundCandidateHits(hits, 2);
  expect(bounded.hits.map((entry) => entry.entityId)).toEqual(["m-strong", "a-middle"]);
});

test("a co-party hit is never refused, however far over the cap the run is", () => {
  // A co-party surfacing is a match on another of the check's OWN subject parties — the opposing party
  // turning out to be the client's parent company. Refusing one drops a positional conflict between
  // two parties of the matter being checked, which no bound may ever produce.
  const hits = [
    hit("trigram-one", 4),
    hit("co-party", 4, true),
    hit("trigram-two", 4),
    hit("trigram-three", 4),
  ];
  const bounded = boundCandidateHits(hits, 2);
  expect(bounded.hits.map((entry) => entry.entityId)).toContain("co-party");
  expect(bounded.truncation?.candidatesWritten).toBe(2);
  expect(bounded.truncation?.candidatesRefused).toBe(2);
});

test("a co-party set larger than the cap refuses everything else and says so", () => {
  // Subject parties bypass the closure cap in expansion.ts for the same reason, and the bypass has the
  // same consequence here: the run starts already over the bound, and the record is the honest report
  // of exactly that situation rather than a dropped subject party.
  const hits = [hit("co-a", 4, true), hit("co-b", 4, true), hit("co-c", 4, true), hit("other", 1)];
  const bounded = boundCandidateHits(hits, 2);
  expect(bounded.hits.map((entry) => entry.entityId)).toEqual(["co-a", "co-b", "co-c"]);
  expect(bounded.truncation).toEqual({
    candidatesSurfaced: 4,
    candidatesWritten: 3,
    candidatesRefused: 1,
    refusedByTier: [{ tier: 1, count: 1 }],
    candidateCap: 2,
  });
});

test("the refused breakdown adds up to the refused count, across every tier", () => {
  // The per-tier breakdown is the field a reader scans to tell an ordinary over-broad trigram run from
  // one that lost real evidence, so it can never silently omit a refusal.
  const hits = [
    hit("i", 1),
    hit("ii", 2),
    hit("iii", 3),
    hit("iv-a", 4),
    hit("iv-b", 4),
    hit("iv-c", 4),
  ];
  const bounded = boundCandidateHits(hits, 1);
  expect(bounded.truncation?.refusedByTier).toEqual([
    { tier: 2, count: 1 },
    { tier: 3, count: 1 },
    { tier: 4, count: 3 },
  ]);
  const total = (bounded.truncation?.refusedByTier ?? []).reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  expect(total).toBe(bounded.truncation?.candidatesRefused);
});

test("a cap of zero writes nothing and refuses everything, rather than writing an unbounded set", () => {
  const hits = [hit("a", 1), hit("b", 4)];
  const bounded = boundCandidateHits(hits, 0);
  expect(bounded.hits).toEqual([]);
  expect(bounded.truncation?.candidatesRefused).toBe(2);
});

test("one input always yields one written set", () => {
  // Every tie-break is on stored data or on a stable position, so the same candidates bounded twice
  // must produce the same rows — a log a firm cites has to be reproducible.
  const hits = [hit("b", 4), hit("a", 4), hit("c", 4), hit("d", 4)];
  expect(boundCandidateHits(hits, 2).hits).toEqual(boundCandidateHits(hits, 2).hits);
  expect(boundCandidateHits(hits, 2).hits.map((entry) => entry.entityId)).toEqual(["b", "a"]);
});
