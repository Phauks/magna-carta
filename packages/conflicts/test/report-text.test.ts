import { expect, test } from "vitest";
import {
  describeCheck,
  describeCheckInstant,
  type ReportSection,
  type ReportSectionKey,
  type ReportedCheck,
  type ReportedSource,
} from "../src/report-text.ts";

// The report is the surface where "reports what it searched" becomes literal English, so the
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
  { source: "content", availability: "unavailable", reason: "Nothing indexes it yet." },
  { source: "prior_firm_history", availability: "unavailable", reason: "Nothing is recorded." },
];

function part(
  sections: readonly ReportSection[],
  key: ReportSectionKey,
): ReportSection | undefined {
  return sections.find((section) => section.key === key);
}

function allLines(sections: readonly ReportSection[]): string[] {
  return sections.flatMap((section) => section.lines);
}

const CLOSURE = {
  followedToClosure: true,
  longestPathLength: 3,
  edgeClassBudgets: {},
  closureCap: 10_000,
  truncated: false,
  entitiesReached: null,
  unexploredFrontierSize: null,
  unexpandedReachedCount: null,
} as const;

test("a zero-hit check ends by saying the search ended, and says nothing about the matter", () => {
  const sections = describeCheck(CHECK, [], FULL_SOURCES);
  expect(sections.at(-1)?.key).toBe("results");
  expect(sections.at(-1)?.lines.at(-1)).toBe("0 results.");

  const whole = allLines(sections).join(" ").toLowerCase();
  // Not a clearance, in any of the shapes a reader could take as one. The list is the same one the
  // source scan holds, restated here because this asserts the COMPOSED sentence rather than a literal
  // — two harmless fragments joining into a clearance would pass the scan and fail here.
  // prettier-ignore
  const banned = ["conflict-free", "conflict free", "no conflicts", "clear of conflicts", "conflicts cleared", "check passed", "all clear", "no conflict found"]; // conflicts-vocabulary:allow — the banned list itself
  for (const phrase of banned) expect(whole, phrase).not.toContain(phrase);
});

test("no line a reader sees carries a dash", () => {
  const sections = describeCheck(
    { ...CHECK, floorRaised: true, trigramMatching: false },
    [{ evidenceTier: 2 }],
    FULL_SOURCES,
  );
  for (const line of allLines(sections)) expect(line).not.toMatch(/[–—]/u);
  for (const section of sections) expect(section.heading).not.toMatch(/[–—]/u);
});

test("the account is in sections, in reading order", () => {
  expect(describeCheck(CHECK, [], FULL_SOURCES).map((section) => section.key)).toEqual([
    "searched",
    "names",
    "relationships",
    "employees",
    "not_searched",
    "results",
  ]);
});

test("the account says what ran, with what settings, over how many entities", () => {
  const sections = describeCheck(CHECK, [], FULL_SOURCES);
  expect(part(sections, "searched")?.lines).toEqual([
    "13 August 2026 (UTC) by Avery Attorney, as a comprehensive check.",
  ]);
  expect(part(sections, "names")?.lines).toEqual([
    "4 parties' names and identifiers compared under Widest name matching.",
  ]);
  expect(part(sections, "relationships")?.lines).toContain(
    "43 entities reached from the parties, following relationships up to 1 step.",
  );
  expect(part(sections, "employees")?.lines).toEqual([
    "The firm's members compared with the matter's parties, or with every entity reached when no matter is named. By identity only, never by name.",
  ]);
});

test("one party reads in the singular", () => {
  const sections = describeCheck(
    { ...CHECK, strictness: "balanced", subjectEntityCount: 1 },
    [],
    FULL_SOURCES,
  );
  expect(part(sections, "names")?.lines[0]).toBe(
    "1 party's names and identifiers compared under Standard name matching.",
  );
});

test("trigram matching turned off is said beside the names it narrowed", () => {
  const sections = describeCheck(
    { ...CHECK, strictness: "balanced", trigramMatching: false },
    [],
    FULL_SOURCES,
  );
  expect(part(sections, "names")?.lines).toContain(
    "Trigram matching was off, so names that share only a few letters with a party's were not looked for.",
  );
  expect(part(describeCheck(CHECK, [], FULL_SOURCES), "names")?.lines).toHaveLength(1);
});

test("what did not run is stated with its reason, never omitted, and is marked for attention", () => {
  const notSearched = part(describeCheck(CHECK, [], FULL_SOURCES), "not_searched");
  expect(notSearched?.attention).toBe(true);
  expect(notSearched?.lines).toContain("Documents and messages. Nothing indexes it yet.");
  expect(notSearched?.lines).toContain("Prior-firm history. Nothing is recorded.");
});

test("identifier types that cannot be looked up on their own are named in a reader's words", () => {
  const notSearched = part(describeCheck(CHECK, [], FULL_SOURCES), "not_searched");
  expect(notSearched?.lines).toContain(
    "Date of birth and Last four of SSN. These are only compared beside a name, never looked up on their own.",
  );
});

test("a floor raise is stated, because a narrower request was asked for and refused", () => {
  const sections = describeCheck({ ...CHECK, floorRaised: true }, [], FULL_SOURCES);
  expect(part(sections, "searched")?.lines).toContain(
    "The search asked for was narrower than the firm's minimum, so it was widened to the minimum before it ran.",
  );
});

test("a zero traversal budget says so rather than implying a graph was walked", () => {
  const sections = describeCheck({ ...CHECK, depth: 0 }, [], FULL_SOURCES);
  expect(part(sections, "relationships")?.lines).toContain(
    "No relationship was followed, so only the 4 parties themselves were searched.",
  );
});

test("a source that did not run produces no section claiming it ran", () => {
  const sections = describeCheck(
    CHECK,
    [],
    [
      { source: "party", availability: "searched", reason: null },
      { source: "graph", availability: "unavailable", reason: "It was not asked for." },
    ],
  );
  expect(part(sections, "relationships")).toBeUndefined();
  expect(part(sections, "not_searched")?.lines).toContain("Relationships. It was not asked for.");
});

test("hits are counted and grouped by tier, and the count is a fact about the search", () => {
  const sections = describeCheck(
    CHECK,
    [{ evidenceTier: 1 }, { evidenceTier: 4 }, { evidenceTier: 4 }],
    FULL_SOURCES,
  );
  expect(part(sections, "results")?.lines).toEqual([
    "3 results surfaced for review (tier 1: 1, tier 4: 2).",
  ]);
  expect(part(sections, "results")?.attention).toBe(false);
});

test("one hit reads in the singular", () => {
  const sections = describeCheck(CHECK, [{ evidenceTier: 2 }], FULL_SOURCES);
  expect(part(sections, "results")?.lines).toEqual(["1 result surfaced for review (tier 2: 1)."]);
});

test("a check with no acting member on the row does not attribute the run to anyone", () => {
  const sections = describeCheck({ ...CHECK, actorUserId: null }, [], FULL_SOURCES);
  expect(part(sections, "searched")?.lines[0]).toBe(
    "13 August 2026 (UTC) with no acting member recorded, as a comprehensive check.",
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

test("describeCheck is pure: the same facts produce the same account", () => {
  expect(describeCheck(CHECK, [], FULL_SOURCES)).toEqual(describeCheck(CHECK, [], FULL_SOURCES));
});

test("a truncated traversal is stated as an incomplete search, never as a completed one", () => {
  const sections = describeCheck(
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
  const relationships = part(sections, "relationships");
  expect(relationships?.attention).toBe(true);
  const truncation = relationships?.lines.find((line) => line.includes("incomplete"));
  expect(truncation).toBeDefined();
  // The three facts that make the bound defensible: where it stopped, what it refused, and that what
  // lies past the entities it did reach is unknown.
  expect(truncation).toContain("It reached 500 entities, against a cap of 500.");
  expect(truncation).toContain("137 further entities were reachable and not searched.");
  expect(truncation).toContain("42 entities were matched but not followed further");
  // "0 results." is still the last line: the search ended and found nothing, and that remains a
  // fact about the search. The incomplete walk above it stops it reading as a sweep of the graph.
  expect(part(sections, "results")?.lines.at(-1)).toBe("0 results.");
});

test("a completed traversal states its budgets and claims no truncation", () => {
  const sections = describeCheck(
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
  const relationships = part(sections, "relationships");
  const budgets = relationships?.lines.find((line) => line.startsWith("Steps allowed"));
  expect(budgets).toContain("control 1 step, family 2 steps, representation 1 step");
  expect(budgets).toContain("Corporate families were followed all the way.");
  expect(budgets).toContain("Ended relationships are followed too");
  expect(relationships?.attention).toBe(false);
});

test("a walk to closure says so, says how deep it ran, and claims no truncation", () => {
  const sections = describeCheck({ ...CHECK, depth: 3, traversal: CLOSURE }, [], FULL_SOURCES);
  const relationships = part(sections, "relationships");
  expect(relationships?.lines).toEqual([
    "43 entities reached from the parties. The longest chain followed was 3 relationships.",
    "Every relationship is followed to the end of its chain, whatever its kind. Ended relationships are followed too, and marked on the path that went through them.",
  ]);
  expect(relationships?.attention).toBe(false);
});

test("a walk that led nowhere says no relationship led away", () => {
  const sections = describeCheck(
    { ...CHECK, expandedEntityCount: 1, traversal: { ...CLOSURE, longestPathLength: 0 } },
    [],
    FULL_SOURCES,
  );
  expect(part(sections, "relationships")?.lines[0]).toBe(
    "1 entity reached from the parties. No recorded relationship led away from them.",
  );
});

test("a walk stopped by the platform's ceiling names the ceiling, never a cap the firm set", () => {
  const sections = describeCheck(
    {
      ...CHECK,
      traversal: {
        ...CLOSURE,
        longestPathLength: 6,
        truncated: true,
        entitiesReached: 10_000,
        unexploredFrontierSize: 137,
        unexpandedReachedCount: 42,
      },
    },
    [],
    FULL_SOURCES,
  );
  const truncation = part(sections, "relationships")?.lines.find((line) =>
    line.includes("incomplete"),
  );
  expect(truncation).toContain(
    "It reached 10000 entities, against the platform's ceiling of 10000.",
  );
  expect(truncation).toContain("137 further entities were reachable and not searched.");
});

test("a check row that records no traversal says nothing about the walk, rather than implying it finished", () => {
  // Null is a third state: not "completed", not "truncated", but "the row does not say". A row
  // written before the traversal record existed must not be read as a complete sweep of the graph.
  const relationships = part(describeCheck(CHECK, [], FULL_SOURCES), "relationships");
  expect(relationships?.lines).toHaveLength(1);
  expect(relationships?.attention).toBe(false);
});

test("a truncated candidate set is stated in words, with the refusal broken out by tier", () => {
  const sections = describeCheck(
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
  const results = part(sections, "results");
  expect(results?.attention).toBe(true);
  const truncation = results?.lines.find((line) => line.startsWith("The results are incomplete."));
  expect(truncation).toBeDefined();
  expect(truncation).toContain("211199 candidates were found and 5000 recorded.");
  // The bound is named as what it is, the most one record can carry, never as a cap somebody set.
  expect(truncation).toContain("The most one record can carry is 5000.");
  // The per-tier breakdown is the whole point: a run that refused only trigram overlap and one that
  // lost a phonetic match are not the same event, and one number would render them identically.
  expect(truncation).toContain("tier 3: 12");
  expect(truncation).toContain("tier 4: 206187");
});

test("a run whose cap refused everything never ends with 0 results", () => {
  // "0 results." is a fact about the machine writing everything it found. A run that found plenty
  // and recorded none did not do that, and appending the sentence would state the opposite of what
  // happened: the exact shape of a search reported as more complete than it was.
  const sections = describeCheck(
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
  const results = part(sections, "results");
  expect(results?.lines).not.toContain("0 results.");
  expect(results?.lines.some((line) => line.startsWith("The results are incomplete."))).toBe(true);
});

test("a check whose row carries no candidate record says nothing about the bound", () => {
  // A row written before the record existed does not say what the run was allowed to write, and the
  // report treats that as the row not saying, never as a run that wrote everything.
  const results = part(describeCheck(CHECK, [{ evidenceTier: 4 }], FULL_SOURCES), "results");
  expect(results?.lines.some((line) => line.includes("incomplete"))).toBe(false);
});

test("a bounded run says its candidates were RECORDED, not that they were everything that surfaced", () => {
  // On an unbounded run the two words name the same number. On a bounded one they do not, and the
  // closing sentence is the last thing a reader sees: leaving it saying "surfaced" would let a
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
  expect(part(bounded, "results")?.lines.at(-1)).toBe("2 results recorded for review (tier 4: 2).");

  const unbounded = describeCheck(CHECK, [{ evidenceTier: 4 }], FULL_SOURCES);
  expect(part(unbounded, "results")?.lines.at(-1)).toBe(
    "1 result surfaced for review (tier 4: 1).",
  );
});

test("the account names the member, never their handle", () => {
  const unnamed = describeCheck({ ...CHECK, actorDisplayName: null }, [], FULL_SOURCES);
  expect(part(unnamed, "searched")?.lines[0]).toBe(
    "13 August 2026 (UTC) by a member the firm's roster does not name, as a comprehensive check.",
  );
  expect(allLines(unnamed).join("\n")).not.toContain("user_attorney");
});

test("the places beyond the Directory each get a section of their own", () => {
  const sections = describeCheck(
    {
      ...CHECK,
      places: {
        messaging: ["calls", "email"],
        tasks: ["open", "archived"],
        magnus: true,
        nameFloor: null,
        namesAtCeiling: 1,
        nameResultCeiling: 200,
        resultsFound: 3,
        resultsRefused: 0,
      },
    },
    [],
    FULL_SOURCES,
  );
  expect(part(sections, "messaging")?.lines).toEqual([
    "Calls and email, filed on a matter or not, searched for 4 parties by linked record, phone number, email address and whole name.",
    "Email is searched by its senders, recipients and subject. Its body is not.",
  ]);
  expect(part(sections, "tasks")?.lines).toEqual([
    "Titles and descriptions of tasks on open matters, and tasks on no matter, plus archived tasks, searched for 4 parties by whole name.",
  ]);
  expect(part(sections, "magnus")?.lines).toEqual([
    "Every conversation, including those saved to General, searched for 4 parties by whole name.",
  ]);
  // A ceiling that limited what was kept is said beside the results it limited.
  const results = part(sections, "results");
  expect(results?.attention).toBe(true);
  expect(results?.lines).toContain(
    "1 name was found in more records of one place than a check keeps. Only the first 200 records for it were recorded.",
  );
});
