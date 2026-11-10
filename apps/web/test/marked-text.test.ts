import { describe, expect, it } from "vitest";
import { markedRuns, type TextRun } from "$lib/search/marked-text.ts";

// The cutting of a result's text into the runs a screen draws. The server found the words; what
// is pinned here is that the text is always shown whole, whatever the marks say.

function joined(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

function markedWords(runs: readonly TextRun[]): string[] {
  return runs.filter((run) => run.marked).map((run) => run.text);
}

const LINE = "The easement runs through the Hargrove well house.";

describe("a result's text cut at the reader's words", () => {
  it("cuts the text at each mark and keeps what is between them", () => {
    const runs = markedRuns(LINE, [
      { start: 4, end: 12 },
      { start: 30, end: 38 },
    ]);
    expect(runs).toEqual([
      { text: "The ", marked: false },
      { text: "easement", marked: true },
      { text: " runs through the ", marked: false },
      { text: "Hargrove", marked: true },
      { text: " well house.", marked: false },
    ]);
    expect(joined(runs)).toBe(LINE);
  });

  it("draws the text plain where there are no marks, or none arrived", () => {
    expect(markedRuns(LINE, [])).toEqual([{ text: LINE, marked: false }]);
    expect(markedRuns(LINE, undefined)).toEqual([{ text: LINE, marked: false }]);
    expect(markedRuns(LINE, null)).toEqual([{ text: LINE, marked: false }]);
  });

  it("marks a text that is one matched word from end to end", () => {
    expect(markedRuns("easement", [{ start: 0, end: 8 }])).toEqual([
      { text: "easement", marked: true },
    ]);
  });

  it("shows the whole text whatever the marks say", () => {
    const hostile = [
      { start: 4, end: 12 },
      // Overlaps the one before: only what is left of it is marked.
      { start: 8, end: 16 },
      // Backwards, empty, fractional and past the end.
      { start: 20, end: 18 },
      { start: 22, end: 22 },
      { start: 1.5, end: 3 },
      { start: 45, end: 900 },
    ];
    const runs = markedRuns(LINE, hostile);
    expect(joined(runs)).toBe(LINE);
    expect(markedWords(runs)).toEqual(["easement", " run", "ouse."]);
  });

  it("answers no runs for an empty text", () => {
    expect(markedRuns("", [{ start: 0, end: 4 }])).toEqual([]);
  });
});
