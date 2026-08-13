import { expect, test } from "vitest";
import {
  describeCheck,
  describeCheckInstant,
  type ReportedCheck,
  type ReportedSource,
} from "../src/report-text.ts";

// The report sentence is the surface where "reports what it searched" becomes literal English, so the
// assertions here are about the WORDS, not only the structure: a rendering that reads as a clearance
// is the failure this module exists to prevent, and it would type-check perfectly.

const CHECK: ReportedCheck = {
  createdAt: "2026-08-13T15:04:05.000Z",
  trigger: "comprehensive",
  actorUserId: "user_attorney",
  strictness: "over_inclusive",
  depth: 1,
  floorRaised: false,
  subjectEntityCount: 4,
  expandedEntityCount: 43,
  skippedIdentifierTypes: ["dob", "ssn_last_four"],
};

const FULL_SOURCES: readonly ReportedSource[] = [
  { source: "party", availability: "searched", reason: null },
  { source: "graph", availability: "searched", reason: null },
  { source: "imputation", availability: "searched", reason: null },
  { source: "content", availability: "unavailable", reason: "no corpus exists" },
  { source: "prior_firm_history", availability: "unavailable", reason: "no data is recorded" },
];

test("a zero-hit check ends by saying the search ended, and says nothing about the matter", () => {
  const statements = describeCheck(CHECK, [], FULL_SOURCES);
  expect(statements.at(-1)).toBe("Nothing surfaced.");

  const whole = statements.join(" ").toLowerCase();
  // Not a clearance, in any of the shapes a reader could take as one. The list is the same one the
  // source scan holds, restated here because this asserts the COMPOSED sentence rather than a literal
  // — two harmless fragments joining into a clearance would pass the scan and fail here.
  // prettier-ignore
  const banned = ["conflict-free", "conflict free", "no conflicts", "clear of conflicts", "conflicts cleared", "check passed", "all clear", "no conflict found"]; // conflicts-vocabulary:allow — the banned list itself
  for (const phrase of banned) expect(whole, phrase).not.toContain(phrase);
});

test("the statement says what ran, with what settings, over how many entities", () => {
  const statements = describeCheck(CHECK, [], FULL_SOURCES);
  expect(statements[0]).toBe(
    "Searched on 13 August 2026 (UTC) by user_attorney, trigger comprehensive.",
  );
  expect(statements).toContainEqual(
    "Party — name and identifier similarity at over_inclusive strictness, over 4 subject parties.",
  );
  expect(statements).toContainEqual(
    "Graph — 43 entities reached from the subject parties, at a 1-hop traversal budget.",
  );
  expect(statements).toContainEqual(
    "Imputation — identity join between the matter's parties and the firm's own members. Never a name match.",
  );
});

test("what did not run is stated with its reason, never omitted", () => {
  const statements = describeCheck(CHECK, [], FULL_SOURCES);
  const notSearched = statements.find((line) => line.startsWith("Not searched:"));
  expect(notSearched).toBe(
    "Not searched: content (no corpus exists), prior-firm history (no data is recorded).",
  );
});

test("identifier types that cannot be probed on their own are named", () => {
  const statements = describeCheck(CHECK, [], FULL_SOURCES);
  expect(statements).toContainEqual(
    "Not probed as standalone identifiers (the corpus cannot index them on their own): dob, ssn_last_four.",
  );
});

test("a floor raise is stated, because a narrower request was asked for and refused", () => {
  const statements = describeCheck({ ...CHECK, floorRaised: true }, [], FULL_SOURCES);
  expect(statements).toContainEqual(
    "The requested scope fell below the firm's floor and was raised to it before the search ran.",
  );
});

test("a zero traversal budget says so rather than implying a graph was walked", () => {
  const statements = describeCheck({ ...CHECK, depth: 0 }, [], FULL_SOURCES);
  expect(statements).toContainEqual(
    "Graph — traversal budget 0, so no related entity was reached beyond the 4 subject parties themselves.",
  );
});

test("a source that did not run produces no line claiming it ran", () => {
  const statements = describeCheck(
    CHECK,
    [],
    [
      { source: "party", availability: "searched", reason: null },
      { source: "graph", availability: "unavailable", reason: "the graph class was not in scope" },
    ],
  );
  expect(statements.some((line) => line.startsWith("Graph — "))).toBe(false);
  expect(statements).toContainEqual("Not searched: graph (the graph class was not in scope).");
});

test("hits are counted and grouped by tier, and the count is a fact about the search", () => {
  const statements = describeCheck(
    CHECK,
    [{ evidenceTier: 1 }, { evidenceTier: 4 }, { evidenceTier: 4 }],
    FULL_SOURCES,
  );
  expect(statements.at(-1)).toBe("3 candidates surfaced for review (tier 1: 1, tier 4: 2).");
});

test("one hit reads in the singular", () => {
  const statements = describeCheck(CHECK, [{ evidenceTier: 2 }], FULL_SOURCES);
  expect(statements.at(-1)).toBe("1 candidate surfaced for review (tier 2: 1).");
});

test("a check with no acting member on the row does not attribute the run to anyone", () => {
  const statements = describeCheck({ ...CHECK, actorUserId: null }, [], FULL_SOURCES);
  expect(statements[0]).toBe(
    "Searched on 13 August 2026 (UTC) with no acting member recorded, trigger comprehensive.",
  );
});

test("the instant is rendered in UTC and said to be, so every reader cites the same date", () => {
  expect(describeCheckInstant("2026-08-13T15:04:05.000Z")).toBe("13 August 2026 (UTC)");
  expect(describeCheckInstant("2026-01-01T00:00:00.000Z")).toBe("1 January 2026 (UTC)");
});

test("a timestamp the formatter cannot read is passed through rather than guessed at", () => {
  expect(describeCheckInstant("not a timestamp")).toBe("not a timestamp");
  expect(describeCheckInstant("2026-13-01T00:00:00.000Z")).toBe("2026-13-01T00:00:00.000Z");
});

test("describeCheck is pure — the same facts produce the same sentences", () => {
  expect(describeCheck(CHECK, [], FULL_SOURCES)).toEqual(describeCheck(CHECK, [], FULL_SOURCES));
});
