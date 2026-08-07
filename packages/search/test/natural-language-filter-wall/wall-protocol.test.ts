import { describe, expect, it } from "vitest";
import { matterOfFeedObjectKey, matterScopedFilter } from "./filter-construction.ts";
import {
  filterIgnoringEngine,
  malformedFilterDroppingEngine,
  queryTextCachingEngine,
  referenceIndexOver,
  unknownFieldDroppingEngine,
  validateFilterAgainstDeclaredSchema,
} from "./reference-engine.ts";
import {
  PROBE_MATCH_THRESHOLD,
  PROBE_MAX_RESULTS,
  outOfScopeHits,
  runCrossMatterExclusionProbe,
  runFailOpenProbe,
} from "./protocol.ts";
import { generateSyntheticCorpus } from "./synthetic-corpus.ts";

// What these tests prove — and the line they do not cross. Passing here proves (1) the probe protocol
// is faithful to its stated request shapes, (2) the synthetic corpus makes cross-matter leakage
// observable, and (3) the probes DETECT every failure shape they exist to find, demonstrated against
// deliberately broken engine variants. Passing here proves NOTHING about the live managed service —
// its filter semantics are the open question the live run answers by replaying this same protocol
// through a real-binding adapter. The retrieval route stays gated until that run has passed.

// Full design scale (1,000 documents per large matter, 1,000 adversarial queries) for the probes whose
// numbers the experiment record quotes; a smaller corpus for the sensitivity checks, where the point
// is detection, not scale.
const FULL_SCALE = generateSyntheticCorpus();
const FULL_SCALE_INDEX = referenceIndexOver(FULL_SCALE.documents);
const SMALL = generateSyntheticCorpus({ documentsPerLargeMatter: 40 });
const SMALL_INDEX = referenceIndexOver(SMALL.documents);

describe("fixture self-checks — leakage is observable before any probe verdict is trusted", () => {
  it("ranks a document's own verbatim passage as the single best unfiltered hit", async () => {
    const document = FULL_SCALE.documentsOfMatter(FULL_SCALE.matterB)[500];
    expect(document).toBeDefined();
    if (document === undefined) return;
    const result = await FULL_SCALE_INDEX.search({
      query: document.verbatimPassage,
      maxNumResults: PROBE_MAX_RESULTS,
      matchThreshold: PROBE_MATCH_THRESHOLD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hits[0]?.objectKey).toBe(document.objectKey);
    // The permissive request shape fills the result list — scope is decided by the filter, not by
    // ranking cutoffs.
    expect(result.hits.length).toBe(PROBE_MAX_RESULTS);
  });

  it("surfaces documents from BOTH large matters for the shared nonsense token when unfiltered", async () => {
    // A window wider than the probe's fifty: every planted document ties at the same score, and the
    // stable ranking would fill fifty slots with one matter's insertions. This check is about the
    // corpus (the token is genuinely cross-matter), not about the probe's pinned request shape.
    const result = await FULL_SCALE_INDEX.search({
      query: FULL_SCALE.sharedNonsenseToken,
      maxNumResults: 200,
      matchThreshold: PROBE_MATCH_THRESHOLD,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const matters = new Set(result.hits.map((hit) => matterOfFeedObjectKey(hit.objectKey)));
    expect(matters.has(FULL_SCALE.matterA)).toBe(true);
    expect(matters.has(FULL_SCALE.matterB)).toBe(true);
  });
});

describe("the cross-matter exclusion probe", () => {
  it("passes against the reference semantics at full scale: 1,000 adversarial queries, zero out-of-scope hits", async () => {
    const verdict = await runCrossMatterExclusionProbe(FULL_SCALE_INDEX, FULL_SCALE);
    expect(verdict.queriesRun).toBe(1000);
    expect(verdict.engineErrors).toEqual([]);
    expect(verdict.offendingHits).toEqual([]);
    expect(verdict.hitsExamined).toBeGreaterThan(0);
    expect(verdict.pass).toBe(true);
  });

  it("sends exactly the pinned request shape: the two-key filter, fifty results, threshold zero", async () => {
    await runCrossMatterExclusionProbe(SMALL_INDEX, SMALL);
    const request = SMALL_INDEX.lastRequest;
    expect(request?.maxNumResults).toBe(50);
    expect(request?.matchThreshold).toBe(0);
    expect(JSON.stringify(request?.filters)).toBe(
      JSON.stringify(matterScopedFilter(SMALL.matterA)),
    );
  });

  it("detects a filter that is accepted and silently ignored — every leaked hit named", async () => {
    const verdict = await runCrossMatterExclusionProbe(filterIgnoringEngine(SMALL_INDEX), SMALL);
    expect(verdict.pass).toBe(false);
    expect(verdict.offendingHits.length).toBeGreaterThan(0);
    // The adversarial query construction guarantees the leak is the excluded matter's own document.
    expect(verdict.offendingHits.some((hit) => hit.resolvedMatter === SMALL.matterB)).toBe(true);
  });

  it("treats an engine error on a well-formed filter as a failed (inconclusive) run, never a pass", async () => {
    const erroringEngine = {
      search: () => Promise.resolve({ ok: false as const, error: "engine unavailable" }),
    };
    const verdict = await runCrossMatterExclusionProbe(erroringEngine, SMALL);
    expect(verdict.pass).toBe(false);
    expect(verdict.engineErrors.length).toBe(SMALL.documentsOfMatter(SMALL.matterB).length);
  });

  it("detects a response cache keyed on query text alone bleeding hits across matter scopes", async () => {
    const cachingEngine = queryTextCachingEngine(SMALL_INDEX);
    const document = SMALL.documentsOfMatter(SMALL.matterB)[0];
    expect(document).toBeDefined();
    if (document === undefined) return;
    const request = {
      query: document.verbatimPassage,
      maxNumResults: PROBE_MAX_RESULTS,
      matchThreshold: PROBE_MATCH_THRESHOLD,
    };
    // Ask under matter B first (its own document legitimately hits), then the identical text under
    // matter A: the cache replays B's response, and scope attribution catches it.
    const first = await cachingEngine.search({
      ...request,
      filters: matterScopedFilter(SMALL.matterB),
    });
    expect(first.ok && first.hits.length > 0).toBe(true);
    const second = await cachingEngine.search({
      ...request,
      filters: matterScopedFilter(SMALL.matterA),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const leaked = outOfScopeHits(second.hits, request.query, SMALL.matterA);
    expect(leaked.length).toBeGreaterThan(0);
  });
});

describe("the fail-open probe", () => {
  it("passes against the reference semantics: nonexistent value returns nothing, unknown field and malformed filter error", async () => {
    const verdict = await runFailOpenProbe(FULL_SCALE_INDEX, FULL_SCALE);
    expect(verdict.queriesRunPerCase).toBe(1000);
    expect(verdict.nonexistentValue.behavior).toBe("returned-zero-hits");
    expect(verdict.unknownField.behavior).toBe("errored");
    expect(verdict.malformedFilter.behavior).toBe("errored");
    expect(verdict.pass).toBe(true);
  });

  it("detects an unknown field being silently dropped instead of rejected", async () => {
    const verdict = await runFailOpenProbe(unknownFieldDroppingEngine(SMALL_INDEX), SMALL);
    expect(verdict.unknownField.behavior).toBe("accepted-and-ignored");
    expect(verdict.unknownField.pass).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("detects a malformed filter being discarded instead of rejected", async () => {
    const verdict = await runFailOpenProbe(malformedFilterDroppingEngine(SMALL_INDEX), SMALL);
    expect(verdict.malformedFilter.behavior).toBe("accepted-and-ignored");
    expect(verdict.malformedFilter.pass).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("detects the fully filter-blind engine on every rejection case at once", async () => {
    const verdict = await runFailOpenProbe(filterIgnoringEngine(SMALL_INDEX), SMALL);
    expect(verdict.nonexistentValue.pass).toBe(false);
    expect(verdict.unknownField.pass).toBe(false);
    expect(verdict.malformedFilter.pass).toBe(false);
    expect(verdict.pass).toBe(false);
  });
});

describe("the filter validator — the executable statement of the semantics the live service must exhibit", () => {
  it("accepts the matter-scoped filter and an absent filter", () => {
    expect(validateFilterAgainstDeclaredSchema(matterScopedFilter(SMALL.matterA)).ok).toBe(true);
    expect(validateFilterAgainstDeclaredSchema(undefined).ok).toBe(true);
  });

  it("rejects unknown fields, non-equality conditions, and non-object shapes", () => {
    expect(validateFilterAgainstDeclaredSchema({ practice_group: { $eq: "x" } }).ok).toBe(false);
    expect(validateFilterAgainstDeclaredSchema({ matter: "bare-string" }).ok).toBe(false);
    expect(validateFilterAgainstDeclaredSchema({ matter: { $in: ["a", "b"] } }).ok).toBe(false);
    expect(validateFilterAgainstDeclaredSchema({ matter: { $eq: 7 } }).ok).toBe(false);
    expect(validateFilterAgainstDeclaredSchema("matter=a").ok).toBe(false);
    expect(validateFilterAgainstDeclaredSchema([{ matter: { $eq: "a" } }]).ok).toBe(false);
  });
});
