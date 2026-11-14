/*
 * The check page's Status and Results sections, as data.
 *
 * The owner's rulings of 2026-11-09: the per-place log is part of the report, live while a run is in
 * flight and kept afterwards; each result says why it surfaced and how it was reached; results are
 * narrowed by chips; and the review is a state chosen from the result, in short words. Each of those
 * is a mapping over plain values, pinned here without a browser.
 */
import { describe, expect, it } from "vitest";
import type {
  CheckWithHits,
  HitDetail,
  ReportSection,
  RunSummary,
} from "../src/lib/conflicts/conflicts-api.ts";
import {
  placeSettingsText,
  statusCaption,
  statusPlaces,
} from "../src/lib/conflicts/check-status.ts";
import {
  NO_FILTER,
  foundThroughText,
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
    askedScope: {
      sources: ["party", "graph", "imputation"],
      strictness: "balanced",
      trigramMatching: true,
      places: { messaging: [], tasks: [], magnus: false },
    },
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
    foundIn: null,
    createdAt: "2026-11-09T10:00:05.000Z",
    disposition: null,
    previouslyAnswered: null,
    ...overrides,
  };
}

function section(key: ReportSection["key"], ...lines: string[]): ReportSection {
  return { key, heading: key, lines, attention: false };
}

function record(hits: HitDetail[], report: ReportSection[]): CheckWithHits {
  return { check: {} as CheckWithHits["check"], report, hits };
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

  it("keeps the rows once the run settles, the Directory now holding the engine's own sections", () => {
    const report = [
      section("searched", "Searched the Directory."),
      section("results", "0 results."),
    ];
    const places = statusPlaces(
      run({ status: "completed", stage: null, hitCount: 0 }),
      record([], report),
    );
    expect(places[0]?.state).toBe("done");
    expect(places[0]?.summary).toBe("0 results");
    expect(places[0]?.sections).toEqual(report);
    expect(places[0]?.lines).toEqual([]);
    expect(statusCaption(places)).toBe("1 of 1 location finished, 4 not searched");
  });

  it("searches Messaging, Tasks and Magnus when asked, after the Directory, and files each sentence under its place", () => {
    const asked = { messaging: ["calls", "email"], tasks: ["open"], magnus: true } as const;
    const askedScope = {
      sources: ["party"],
      strictness: "balanced",
      trigramMatching: true,
      places: { messaging: [...asked.messaging], tasks: [...asked.tasks], magnus: true },
    };
    const waiting = statusPlaces(run({ askedScope }), null);
    expect(waiting.map((place) => place.state)).toEqual([
      "searching",
      "not-searched",
      "waiting",
      "waiting",
      "waiting",
    ]);
    const searching = statusPlaces(
      run({ askedScope, stage: "places", progress: { placeResults: 2 } }),
      null,
    );
    expect(searching[2]?.state).toBe("searching");
    expect(searching[0]?.lines.some((line) => line.startsWith("Searching calls"))).toBe(false);

    const report = [
      section("names", "Names compared."),
      section("messaging", "Calls and email, filed on a matter or not, searched."),
      section("tasks", "Titles and descriptions of tasks on open matters, searched."),
      section("magnus", "Every conversation, including those saved to General, searched."),
      section("results", "2 results surfaced for review (tier 1: 1, tier 2: 1)."),
    ];
    const call = hit({
      id: "call",
      sourceClass: "content",
      foundIn: {
        kind: "call",
        id: "communication_1",
        matterId: null,
        matterNumber: null,
        at: null,
      },
    });
    const done = statusPlaces(
      run({ askedScope, status: "completed", stage: null, hitCount: 2 }),
      record([hit(), call], report),
    );
    expect(done[0]?.sections).toEqual([report[0], report[4]]);
    expect(done[0]?.summary).toBe("1 result");
    expect(done[2]?.lines).toEqual(report[1]?.lines);
    expect(done[2]?.summary).toBe("1 result");
    expect(done[3]?.lines).toEqual(report[2]?.lines);
    expect(done[4]?.summary).toBe("0 results");
    expect(statusCaption(done)).toBe("4 of 4 locations finished, 1 not searched");
    expect(placeSettingsText("messaging", askedScope.places)).toBe("Calls, Email");
    expect(placeSettingsText("tasks", askedScope.places)).toBe("Open");
    expect(placeSettingsText("files", askedScope.places)).toBeNull();
  });

  it("files a file result under Files, and reads an unreachable file index as not searched", () => {
    const askedScope = {
      sources: ["party"],
      strictness: "balanced",
      trigramMatching: true,
      places: {
        messaging: [],
        tasks: [],
        magnus: false,
        files: ["open", "archived"] as ("open" | "archived")[],
      },
    };
    expect(placeSettingsText("files", askedScope.places)).toBe("Open, Archived");
    const report = [
      section(
        "files",
        "The text of files on open matters, plus files deleted from any matter across 3 of 3 matters, searched.",
      ),
    ];
    const file = hit({
      sourceClass: "content",
      foundIn: {
        kind: "file",
        id: "file_1",
        matterId: "matter_1",
        matterNumber: "2026-0001",
        at: null,
      },
    });
    expect(whereText(file)).toBe("File on 2026-0001");
    const searched = statusPlaces(
      run({ askedScope, status: "completed", stage: null, hitCount: 1 }),
      {
        check: { scope: { files: "searched" } } as unknown as CheckWithHits["check"],
        report,
        hits: [file],
      },
    );
    expect(searched[1]?.state).toBe("done");
    expect(searched[1]?.summary).toBe("1 result");
    expect(searched[1]?.lines).toEqual(report[0]?.lines);
    const dormant = statusPlaces(
      run({ askedScope, status: "completed", stage: null, hitCount: 0 }),
      {
        check: { scope: { files: "unavailable" } } as unknown as CheckWithHits["check"],
        report: [],
        hits: [],
      },
    );
    expect(dormant[1]?.state).toBe("not-searched");
    expect(dormant[1]?.lines).toEqual([
      "No file text was searched. File indexing is off for this firm, or the file index couldn't be reached. An administrator can turn it on in Settings, under Search and Indexing.",
    ]);
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

  it("says which record a result was found in, and where it is filed, never its text", () => {
    const email = hit({
      sourceClass: "content",
      matchedFields: ['"Dana Whitfield" is named in the subject'],
      foundIn: {
        kind: "email",
        id: "emailMessage_1",
        matterId: "matter_1",
        matterNumber: "2026-0001",
        at: "2026-03-01T10:00:00.000Z",
      },
    });
    expect(foundThroughText(email)).toBe("Email");
    expect(whereText(email)).toBe("Email on 2026-0001");
    const conversation = hit({
      sourceClass: "content",
      foundIn: {
        kind: "magnus_conversation",
        id: "magnusConversation_1",
        matterId: null,
        matterNumber: null,
        at: null,
      },
    });
    expect(whereText(conversation)).toBe("Magnus conversation saved to General");
    expect(foundThroughText(hit())).toBe("Names and identifiers");
    const ids = filterResults([hit({ id: "directory" }), email], {
      ...NO_FILTER,
      sources: new Set(["Email"]),
    }).map((entry) => entry.id);
    expect(ids).toEqual([email.id]);
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
    expect(ids({ ...NO_FILTER, sources: new Set(["Names and identifiers"]) })).toEqual(["a"]);
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
