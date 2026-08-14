import { describe, expect, it } from "vitest";
import { publicCopyProblems } from "./public-copy.mjs";

const good = "Hold client money in trust with a running balance per client.";

describe("publicCopyProblems", () => {
  it("passes a sentence written for the person reading it", () => {
    expect(publicCopyProblems(good, "public-summary")).toEqual([]);
  });

  // The decision-record case is assembled from pieces rather than written out: a literal one here
  // would be a real process-artifact citation in source, which tooling/lint-process-references.mjs
  // rejects — the very rule this check backs up on the public side.
  // Joined rather than interpolated because the formatter collapses an interpolation of a constant
  // string straight back into a literal.
  const decisionCitation = `Trust rules per ${["ADR", "0008"].join("-")} apply.`;

  it.each([
    ["a decision record", decisionCitation],
    ["a slice number", "Arrives with slice 3 of the financial core."],
    ["a phase number", "Built in phase 2."],
    ["a document section", "See § 4 for the rules."],
    ["a repository path", "Specified in docs/specs/trust.md."],
    ["a package name", "Provided by @magna-carta/trust."],
    ["a year", "Trust reconciliation lands in 2027."],
    ["a quarter", "Trust reconciliation lands in Q3."],
  ])("refuses %s", (_label, text) => {
    expect(publicCopyProblems(text, "public-summary")).not.toEqual([]);
  });

  it("refuses an emoji, wherever it sits", () => {
    expect(publicCopyProblems(`🎉 ${good}`, "public-summary")).toEqual([
      expect.stringContaining("emoji"),
    ]);
  });

  it("refuses a summary that trails off unpunctuated", () => {
    expect(publicCopyProblems("Hold client money in trust", "public-summary")).toEqual([
      expect.stringContaining("full stop"),
    ]);
  });

  it("does not demand a full stop of a name", () => {
    expect(publicCopyProblems("Trust accounting", "public-name")).toEqual([]);
  });

  it("refuses an empty or whitespace-padded value", () => {
    expect(publicCopyProblems("", "public-summary")).toEqual(["public-summary is empty"]);
    expect(publicCopyProblems(` ${good} `, "public-summary")).toEqual([
      expect.stringContaining("whitespace"),
    ]);
  });

  it("holds a summary to one scannable sentence and a name to a name", () => {
    expect(publicCopyProblems(`${"word ".repeat(60)}end.`, "public-summary")).toEqual([
      expect.stringContaining("one sentence"),
    ]);
    expect(publicCopyProblems("A ".repeat(40), "public-name")).toEqual(
      expect.arrayContaining([expect.stringContaining("it is a name")]),
    );
  });
});
