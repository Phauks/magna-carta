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
      },
      traversal: {
        edgeClassBudgets: { control: 1, family: 1 },
        closureCap: 500,
        truncated: true,
        entitiesReached: 500,
        unexploredFrontierSize: 137,
        unexpandedReachedCount: 12,
      },
      candidates: null,
      actorUserId: "user_one",
      createdAt: "2026-08-30T12:00:00.000Z",
      ...overrides,
    },
    statement: [
      "Searched on 30 August 2026 by user_one, trigger comprehensive.",
      "Party — name and identifier similarity at over_inclusive strictness, over 1 subject party.",
      "Nothing surfaced.",
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
  it("carries every statement line, in order, unedited", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date("2026-08-30T15:00:00.000Z") });
    const search = sheet.sections.find((section) => section.id === "search");
    expect(search?.kind).toBe("text");
    if (search?.kind !== "text") throw new Error("the search section must be prose");
    expect(search.text.split("\n")).toEqual([
      "Searched on 30 August 2026 by user_one, trigger comprehensive.",
      "Party — name and identifier similarity at over_inclusive strictness, over 1 subject party.",
      "Nothing surfaced.",
    ]);
  });
});

describe("a source that could not run", () => {
  it("reads as not searched, never as searched and empty", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    expect(fieldValue(sheet, "Content")).toBe("Not searched");
    expect(fieldValue(sheet, "Party")).toBe("Searched");
  });
});

describe("a bounded search", () => {
  it("states that the walk was truncated and by how much", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    expect(fieldValue(sheet, "Traversal Truncated")).toBe("Yes");
    expect(fieldValue(sheet, "Entities Reached")).toBe("500");
    expect(fieldValue(sheet, "Reachable And Not Searched")).toBe("137");
    expect(fieldValue(sheet, "Matched But Not Expanded")).toBe("12");
  });

  it("keeps a record that predates a field as its own answer", () => {
    // A check written before the candidate record existed says nothing about it. That is not the
    // same fact as a run whose cap never bit, so the report simply omits the fields rather than
    // printing a reassuring zero.
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    expect(fieldValue(sheet, "Candidate Cap")).toBeUndefined();
  });

  it("says which roles a comparison covered, and keeps every-role distinct from a list", () => {
    const sheet = checkReportSheet(result(), { printedAt: new Date() });
    expect(fieldValue(sheet, "Name Roles Compared")).toBe("Every role the corpus holds");
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
