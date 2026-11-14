/*
 * The conflicts report is the artifact a firm hands a court, so what it must never do is more
 * important than what it says. Three properties, all of them the difference between a defensible
 * procedure and a claim the firm cannot stand behind:
 *
 *   - It prints the engine's own account of the search, unedited and in order.
 *   - A source that could not run reads "Not searched" and never as a source that found nothing.
 *   - A truncated walk is stated as truncated, with how much was reachable and not searched.
 *
 * Plus the one that a gate can only half-see: nothing on the paper asserts a fact about the matter.
 */
import { describe, expect, it } from "vitest";
import type { CheckWithHits } from "../src/lib/conflicts/conflicts-api.ts";
import { checkReportSheet, reportedParty } from "../src/lib/conflicts/conflicts-report.ts";
import { reportExportDocument } from "../src/lib/conflicts/report-download.ts";
import { sourceVocabulary } from "../src/lib/conflicts/conflicts-vocabulary.ts";

function result(overrides: Partial<CheckWithHits["check"]> = {}): CheckWithHits {
  return {
    check: {
      id: "conflictsCheck_one",
      trigger: "comprehensive",
      matterId: "matter_one",
      subjectEntityIds: ["directoryPerson_one"],
      scope: { party: "searched", graph: "searched", content: "unavailable" },
      strictness: "over_inclusive",
      depth: 1,
      floorRaised: false,
      matching: {
        nameKeys: ["normalized_display"],
        phoneticSchemes: ["double_metaphone_primary"],
        nameRoles: null,
        trigramMatching: true,
      },
      traversal: {
        followedToClosure: true,
        longestPathLength: 4,
        edgeClassBudgets: {},
        closureCap: 10_000,
        truncated: true,
        entitiesReached: 10_000,
        unexploredFrontierSize: 137,
        unexpandedReachedCount: 12,
      },
      candidates: null,
      actorUserId: "user_one",
      createdAt: "2026-08-30T12:00:00.000Z",
      ...overrides,
    },
    report: [
      {
        key: "searched",
        heading: "Searched",
        lines: ["30 August 2026 (UTC) by a member, as a comprehensive check."],
        attention: false,
      },
      {
        key: "names",
        heading: "Names and identifiers",
        lines: ["1 party's names and identifiers compared under Widest name matching."],
        attention: false,
      },
      { key: "results", heading: "Results", lines: ["0 results."], attention: false },
    ],
    hits: [],
  };
}

function fieldValue(sheet: ReturnType<typeof checkReportSheet>, label: string): string | undefined {
  for (const section of sheet.sections) {
    if (section.kind !== "fields") continue;
    const field = section.fields.find((candidate) => candidate.label === label);
    if (field !== undefined) return field.value;
  }
  return undefined;
}

describe("the report prints the engine's own account", () => {
  it("prints each part of the account as its own section, in order, unedited", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date("2026-08-30T15:00:00.000Z") });
    const parts = sheet.sections.filter((section) => section.id.startsWith("search-"));
    expect(parts.map((section) => section.title)).toEqual([
      "Searched",
      "Names and identifiers",
      "Results",
    ]);
    const names = parts[1];
    if (names?.kind !== "text") throw new Error("each part of the account must be prose");
    expect(names.text).toBe("1 party's names and identifiers compared under Widest name matching.");
  });
});

describe("a source that could not run", () => {
  it("reads as not searched, never as searched and empty", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    expect(fieldValue(sheet, sourceVocabulary("content").label)).toBe("Not searched");
    expect(fieldValue(sheet, sourceVocabulary("party").label)).toBe("Searched");
  });
});

describe("a walk that reached the platform's ceiling", () => {
  it("states that the walk was truncated and by how much", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    expect(fieldValue(sheet, "Traversal Truncated")).toBe("Yes");
    expect(fieldValue(sheet, "Entities Reached")).toBe("10000");
    expect(fieldValue(sheet, "Reachable And Not Searched")).toBe("137");
    expect(fieldValue(sheet, "Matched But Not Expanded")).toBe("12");
  });

  it("says the walk followed every relationship to closure, and how long the longest chain ran", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    expect(fieldValue(sheet, "Relationships")).toBe(
      "All recorded relationships, followed to the end",
    );
    expect(fieldValue(sheet, "Longest Chain Followed")).toBe("4");
    expect(fieldValue(sheet, "The Platform's Ceiling")).toBe("10000");
    expect(fieldValue(sheet, "Per-Class Budgets")).toBeUndefined();
  });

  it("prints an older run under the hop budgets it actually ran with", () => {
    const sheet = checkReportSheet(
      result({
        traversal: {
          followedToClosure: false,
          longestPathLength: null,
          edgeClassBudgets: { control: 1, family: 1 },
          closureCap: 500,
          truncated: false,
          entitiesReached: null,
          unexploredFrontierSize: null,
          unexpandedReachedCount: null,
        },
      }),
      { printedAt: new Date() },
    );
    expect(fieldValue(sheet, "Per-Class Budgets")).toBe("control 1, family 1");
    expect(fieldValue(sheet, "Closure Cap")).toBe("500");
    // The scope section says nothing about closure; "Relationships" further down is the SOURCE of
    // that name, reporting that the graph was searched, which is a different fact.
    const scope = sheet.sections.find((section) => section.id === "scope");
    if (scope?.kind !== "fields") throw new Error("the scope section must be fields");
    expect(scope.fields.map((field) => field.label)).not.toContain("Relationships");
  });

  it("keeps a record that predates a field as its own answer", () => {
    // A check written before the candidate record existed says nothing about it. That is not the
    // same fact as a run whose bound never bit, so the report simply omits the fields rather than
    // printing a reassuring zero.
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    expect(fieldValue(sheet, "Record Bound")).toBeUndefined();
  });

  it("says which roles a comparison covered, and keeps every-role distinct from a list", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    expect(fieldValue(sheet, "Name Roles Compared")).toBe("All roles in the firm's records");
  });
});

describe("how a party reads on paper", () => {
  it("prints the name where one is known", () => {
    expect(
      reportedParty("directoryPerson_one", new Map([["directoryPerson_one", "A. Party"]])),
    ).toBe("A. Party");
  });

  it("prints the stored handle where the name has not been read", () => {
    // On a screen a raw handle is useless and is never shown. On a record of procedure it is the
    // citable thing the log actually holds, and a blank is the one thing this paper cannot contain.
    expect(reportedParty("directoryPerson_one")).toBe("directoryPerson_one");
  });
});

describe("how the paper is referred to", () => {
  it("carries the check's number as its reference, and which run it is", () => {
    const sheet = checkReportSheet(result(), {
      checkNumber: "CC-0007",
      runOrdinal: 2,
      printedAt: new Date(),
    });
    expect(sheet.reference).toBe("CC-0007");
    expect(fieldValue(sheet, "Run")).toBe("Run 2 of this check");
  });

  it("falls back to the run's handle where no number is known, never to a blank", () => {
    expect(checkReportSheet(result(), { printedAt: new Date() }).reference).toBe(
      "conflictsCheck_one",
    );
  });
});

describe("the downloaded report", () => {
  it("is the printed sheet, section for section, with nothing summarized on the way", () => {
    const sheet = checkReportSheet(result(), { checkNumber: "CC-0007", printedAt: new Date() });
    const exported = reportExportDocument(sheet, new Date("2026-09-11T12:00:00.000Z"));
    expect(exported.title).toBe("Conflicts Check Report CC-0007");
    const results = exported.sections.find((section) => section.title === "Results");
    expect(results?.rows.map((row) => row[0])).toEqual(["0 results."]);
    const scope = exported.sections.find((section) => section.title === "Scope In Force");
    expect(scope?.rows).toContainEqual(["Traversal Truncated", "Yes"]);
  });
});

describe("what the paper never says", () => {
  it("draws no conclusion about the matter anywhere on it", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    const printed = JSON.stringify(sheet).toLowerCase();
    // conflicts-vocabulary:allow — the banned sentences are listed here in order to refuse them.
    for (const banned of ["conflict-free", "no conflicts", "all clear", "check passed"]) {
      expect(printed).not.toContain(banned);
    }
    expect(sheet.heading).toBe("Conflicts Check Report");
  });
});
