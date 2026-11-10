/*
 * The check page's Status and Results sections, as data.
 *
 * The owner's rulings of 2026-11-09: the per-place log is part of the report, live while a run is in
 * flight and kept afterwards; each result says why it surfaced and how it was reached; results are
 * narrowed by chips; and the review is a state chosen from the result, in short words. Each of those
 * is a mapping over plain values, pinned here without a browser.
 */
import { describe, expect, it } from "vitest";
import type { CheckWithHits, HitDetail, RunSummary } from "../src/lib/conflicts/conflicts-api.ts";
import { statusCaption, statusPlaces } from "../src/lib/conflicts/check-status.ts";
import {
  NO_FILTER,
  filterResults,
  resultCountText,
  reviewText,
  STRENGTH_LABELS,
  whereText,
  whyText,
} from "../src/lib/conflicts/check-results.ts";

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "conflictsCheck_run",
    ordinal: 1,
    status: "running",
    stage: "walking",
    progress: { sourcesSearched: 2, subjectParties: 3, entitiesReached: 41 },
    trigger: "preliminary",
    triggerSource: "manual",
    requestedByUserId: "user_one",
    createdAt: "2026-11-09T10:00:00.000Z",
    startedAt: "2026-11-09T10:00:01.000Z",
    finishedAt: null,
    failure: null,
    cancelledByUserId: null,
    askedScope: { sources: ["party", "graph", "imputation"], strictness: "balanced" },
    hitCount: null,
    subjectParties: [],
    ...overrides,
  };
}

function hit(overrides: Partial<HitDetail> = {}): HitDetail {
  return {
    id: "conflictsHit_one",
    entityId: "person_one",
    party: { kind: "person", displayName: "Dana Whitfield" },
    sourceClass: "party",
    evidenceTier: 2,
    matchedFields: ["same normalized name"],
    graphPath: [],
    coParty: false,
    createdAt: "2026-11-09T10:00:05.000Z",
    disposition: null,
    previouslyAnswered: null,
    ...overrides,
  };
}

function record(hits: HitDetail[], statement: string[]): CheckWithHits {
  return { check: {} as CheckWithHits["check"], statement, hits };
}

describe("the status section", () => {
  it("lists every place, the Directory searching and the rest not searched, while a run is in flight", () => {
    const places = statusPlaces(run(), null);
    expect(places.map((place) => place.label)).toEqual([
      "Directory",
      "Files",
      "Messaging",
      "Tasks",
      "Magnus",
    ]);
    expect(places[0]?.state).toBe("searching");
    // The live log: every stage reached so far, with what it has counted.
    expect(places[0]?.lines).toEqual([
      "Resolving what to search: 2 sources, 3 parties",
      "Following relationships: 41 entities reached",
    ]);
    expect(places.slice(1).every((place) => place.state === "not-searched")).toBe(true);
  });

  it("keeps the rows once the run settles, now holding the engine's own sentences", () => {
    const statement = ["Searched the Directory.", "0 results."];
    const places = statusPlaces(
      run({ status: "completed", stage: null, hitCount: 0 }),
      record([], statement),
    );
    expect(places[0]?.state).toBe("done");
    expect(places[0]?.summary).toBe("0 results");
    expect(places[0]?.lines).toEqual(statement);
    expect(statusCaption(places)).toBe("1 of 1 location finished, 4 not searched");
  });

  it("marks a cancelled run's place as cancelled, never as failed", () => {
    const places = statusPlaces(run({ status: "cancelled", stage: null }), null);
    expect(places[0]?.state).toBe("stopped");
  });
});

describe("the results section", () => {
  it("says why a result surfaced and how it was reached", () => {
    expect(whyText(hit())).toBe("Matched on same normalized name");
    expect(whereText(hit())).toBe("Found directly in the Directory");
    expect(whereText(hit({ coParty: true }))).toBe("Also a party on this check");
    expect(whereText(hit({ sourceClass: "imputation" }))).toBe("One of the firm's own people");
    expect(
      whereText(
        hit({
          sourceClass: "graph",
          graphPath: [
            {
              edgeId: "edge_1",
              edgeType: "parent_company",
              fromEntityId: "a",
              toEntityId: "b",
              expiredAtCheck: true,
            },
          ],
        }),
      ),
    ).toContain("(a relationship had ended)");
  });

  it("names strength in words, strongest first, and never a tier number", () => {
    expect(Object.values(STRENGTH_LABELS)).toEqual(["Exact", "Same name", "Might be", "Weak"]);
    const sorted = filterResults(
      [hit({ id: "weak", evidenceTier: 4 }), hit({ id: "exact", evidenceTier: 1 })],
      NO_FILTER,
    );
    expect(sorted.map((entry) => entry.id)).toEqual(["exact", "weak"]);
  });

  it("narrows by text, source, strength and review, and an empty facet narrows nothing", () => {
    const hits = [
      hit({ id: "a", evidenceTier: 1, sourceClass: "party" }),
      hit({
        id: "b",
        evidenceTier: 3,
        sourceClass: "graph",
        party: { kind: "organization", displayName: "Harbor Logistics LLC" },
      }),
    ];
    const ids = (filter: Parameters<typeof filterResults>[1]) =>
      filterResults(hits, filter).map((entry) => entry.id);
    expect(ids(NO_FILTER)).toEqual(["a", "b"]);
    expect(ids({ ...NO_FILTER, text: "harbor" })).toEqual(["b"]);
    expect(ids({ ...NO_FILTER, sources: new Set(["party"]) })).toEqual(["a"]);
    expect(ids({ ...NO_FILTER, strengths: new Set([3]) })).toEqual(["b"]);
    expect(ids({ ...NO_FILTER, reviews: new Set(["cleared"]) })).toEqual([]);
  });

  it("reads the review in short words, and says so when nobody has reviewed it", () => {
    expect(reviewText(hit())).toBe("Not reviewed");
    expect(
      reviewText(
        hit({
          disposition: {
            id: "d",
            kind: "wall_erected",
            rationale: "Screened",
            reviewerUserId: "user_one",
            waiver: null,
            shortfalls: [],
            createdAt: "2026-11-09T11:00:00.000Z",
          },
        }),
      ),
    ).toBe("Walled off");
  });

  it("counts results in the owner's word", () => {
    expect(resultCountText(0)).toBe("0 results");
    expect(resultCountText(1)).toBe("1 result");
  });
});
