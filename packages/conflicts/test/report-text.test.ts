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
  actorDisplayName: "Avery Attorney",
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
  expect(statements.at(-1)).toBe("0 results.");

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
    "Searched on 13 August 2026 (UTC) by Avery Attorney, as a comprehensive check.",
  );
  expect(statements).toContainEqual(
    "Party — name and identifier similarity at over_inclusive strictness, over 4 subject parties.",
  );
  expect(statements).toContainEqual(
    "Graph — 43 entities reached from the subject parties, at a 1-hop traversal budget.",
  );
  expect(statements).toContainEqual(
    "Firm employees — identity join between the firm's own members and the matter's parties, or every entity reached where no matter is named. Never a name match.",
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
  expect(statements.at(-1)).toBe("3 results surfaced for review (tier 1: 1, tier 4: 2).");
});

test("one hit reads in the singular", () => {
  const statements = describeCheck(CHECK, [{ evidenceTier: 2 }], FULL_SOURCES);
  expect(statements.at(-1)).toBe("1 result surfaced for review (tier 2: 1).");
});

test("a check with no acting member on the row does not attribute the run to anyone", () => {
  const statements = describeCheck({ ...CHECK, actorUserId: null }, [], FULL_SOURCES);
  expect(statements[0]).toBe(
    "Searched on 13 August 2026 (UTC) with no acting member recorded, as a comprehensive check.",
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

test("a truncated traversal is stated as an incomplete search, never as a completed one", () => {
  const statements = describeCheck(
    {
      ...CHECK,
      traversal: {
        followedToClosure: false,
        longestPathLength: null,
        edgeClassBudgets: { control: 1, family: 1, representation: 1 },
        closureCap: 500,
        truncated: true,
        entitiesReached: 500,
        unexploredFrontierSize: 137,
        unexpandedReachedCount: 42,
      },
    },
    [],
    FULL_SOURCES,
  );
  const truncation = statements.find((statement) => statement.includes("TRUNCATED"));
  expect(truncation).toBeDefined();
  // The three facts that make the bound defensible: where it stopped, what it refused, and that what
  // lies past the entities it did reach is unknown.
  expect(truncation).toContain("500 entities reached against a cap of 500");
  expect(truncation).toContain("137 further entities were reachable and not searched");
  expect(truncation).toContain("42 reached entities were matched but not expanded");
  expect(truncation).toContain("incomplete");
  // "0 results." is still the last line — the search ended and found nothing, and that remains
  // a fact about the search. It is the truncation sentence above it that stops it reading as a sweep
  // of the whole graph.
  expect(statements.at(-1)).toBe("0 results.");
});

test("a completed traversal states its budgets and claims no truncation", () => {
  const statements = describeCheck(
    {
      ...CHECK,
      traversal: {
        followedToClosure: false,
        longestPathLength: null,
        edgeClassBudgets: { control: 1, family: 2, representation: 1 },
        closureCap: 500,
        truncated: false,
        entitiesReached: null,
        unexploredFrontierSize: null,
        unexpandedReachedCount: null,
      },
    },
    [],
    FULL_SOURCES,
  );
  const budgets = statements.find((statement) => statement.startsWith("Traversal budgets"));
  expect(budgets).toContain("control 1 hop, family 2 hops, representation 1 hop");
  expect(budgets).toContain("corporate family traversed transitively");
  expect(budgets).toContain("Ended relationships were traversed");
  expect(statements.some((statement) => statement.includes("TRUNCATED"))).toBe(false);
});

test("a walk to closure says so, says how deep it ran, and claims no truncation", () => {
  const statements = describeCheck(
    {
      ...CHECK,
      depth: 3,
      traversal: {
        followedToClosure: true,
        longestPathLength: 3,
        edgeClassBudgets: {},
        closureCap: 10_000,
        truncated: false,
        entitiesReached: null,
        unexploredFrontierSize: null,
        unexpandedReachedCount: null,
      },
    },
    [],
    FULL_SOURCES,
  );
  expect(statements).toContainEqual(
    "Graph — 43 entities reached from the subject parties; the longest chain followed ran 3 relationships.",
  );
  const traversal = statements.find((statement) => statement.startsWith("Traversal — "));
  expect(traversal).toContain("followed to closure");
  expect(traversal).toContain("Ended relationships were traversed");
  // No budget line: there was no budget, and a sentence naming one would be describing a search
  // that did not run.
  expect(statements.some((statement) => statement.startsWith("Traversal budgets"))).toBe(false);
  expect(statements.some((statement) => statement.includes("TRUNCATED"))).toBe(false);
});

test("a walk stopped by the platform's ceiling names the ceiling, never a cap the firm set", () => {
  const statements = describeCheck(
    {
      ...CHECK,
      traversal: {
        followedToClosure: true,
        longestPathLength: 6,
        edgeClassBudgets: {},
        closureCap: 10_000,
        truncated: true,
        entitiesReached: 10_000,
        unexploredFrontierSize: 137,
        unexpandedReachedCount: 42,
      },
    },
    [],
    FULL_SOURCES,
  );
  const truncation = statements.find((statement) => statement.includes("TRUNCATED"));
  expect(truncation).toContain("10000 entities reached against the platform's ceiling of 10000");
  expect(truncation).toContain("137 further entities were reachable and not searched");
  expect(truncation).toContain("incomplete");
});

test("a check row that records no traversal says nothing about the walk, rather than implying it finished", () => {
  // Null is a third state: not "completed", not "truncated", but "the row does not say". A row
  // written before the traversal record existed must not be read as a complete sweep of the graph.
  const statements = describeCheck(CHECK, [], FULL_SOURCES);
  expect(statements.some((statement) => statement.startsWith("Traversal budgets"))).toBe(false);
  expect(statements.some((statement) => statement.includes("TRUNCATED"))).toBe(false);
});

test("a truncated candidate set is stated in words, with the refusal broken out by tier", () => {
  const statements = describeCheck(
    {
      ...CHECK,
      candidates: {
        candidateCap: 5000,
        truncated: true,
        candidatesSurfaced: 211_199,
        candidatesWritten: 5000,
        candidatesRefused: 206_199,
        refusedByTier: [
          { tier: 3, count: 12 },
          { tier: 4, count: 206_187 },
        ],
      },
    },
    [{ evidenceTier: 4 }],
    FULL_SOURCES,
  );
  const truncation = statements.find((line) => line.includes("THE CANDIDATE SET WAS TRUNCATED"));
  expect(truncation).toBeDefined();
  expect(truncation).toContain("211199 candidates surfaced and 5000 were recorded");
  // The bound is named as what it is — the most one record can carry — never as a cap somebody set.
  expect(truncation).toContain("the bound in force was 5000, the most one record can carry");
  // The per-tier breakdown is the whole point: a run that refused only trigram overlap and one that
  // lost a phonetic match are not the same event, and one number would render them identically.
  expect(truncation).toContain("tier 3: 12");
  expect(truncation).toContain("tier 4: 206187");
});

test("a run whose cap refused everything never ends with 0 results", () => {
  // "0 results." is a fact about the machine writing everything it found. A run that found
  // plenty and recorded none did not do that, and appending the sentence would state the opposite of
  // what happened — the exact shape of a search reported as more complete than it was.
  const statements = describeCheck(
    {
      ...CHECK,
      candidates: {
        candidateCap: 0,
        truncated: true,
        candidatesSurfaced: 9,
        candidatesWritten: 0,
        candidatesRefused: 9,
        refusedByTier: [{ tier: 4, count: 9 }],
      },
    },
    [],
    FULL_SOURCES,
  );
  expect(statements).not.toContain("0 results.");
  expect(statements.some((line) => line.includes("THE CANDIDATE SET WAS TRUNCATED"))).toBe(true);
});

test("a check whose row carries no candidate record says nothing about the bound", () => {
  // A row written before the record existed does not say what the run was allowed to write, and the
  // report treats that as the row not saying — never as a run that wrote everything.
  const statements = describeCheck(CHECK, [{ evidenceTier: 4 }], FULL_SOURCES);
  expect(statements.some((line) => line.includes("CANDIDATE SET"))).toBe(false);
});

test("a bounded run says its candidates were RECORDED, not that they were everything that surfaced", () => {
  // On an unbounded run the two words name the same number. On a bounded one they do not, and the
  // closing sentence is the last thing a reader sees — leaving it saying "surfaced" would let a
  // written count be read as everything the channels found.
  const bounded = describeCheck(
    {
      ...CHECK,
      candidates: {
        candidateCap: 2,
        truncated: true,
        candidatesSurfaced: 40,
        candidatesWritten: 2,
        candidatesRefused: 38,
        refusedByTier: [{ tier: 4, count: 38 }],
      },
    },
    [{ evidenceTier: 4 }, { evidenceTier: 4 }],
    FULL_SOURCES,
  );
  expect(bounded.at(-1)).toBe("2 results recorded for review (tier 4: 2).");

  const unbounded = describeCheck(CHECK, [{ evidenceTier: 4 }], FULL_SOURCES);
  expect(unbounded.at(-1)).toBe("1 result surfaced for review (tier 4: 1).");
});

test("the statement names the member, never their handle", () => {
  const unnamed = describeCheck({ ...CHECK, actorDisplayName: null }, [], FULL_SOURCES);
  expect(unnamed[0]).toBe(
    "Searched on 13 August 2026 (UTC) by a member the firm's roster does not name, as a comprehensive check.",
  );
  expect(unnamed.join("\n")).not.toContain("user_attorney");
});
