/*
 * The honorific line (src/lib/names/honorific-line.ts) — pure data, node, no browser.
 *
 * WHAT THIS EXISTS TO PIN is the owner's report of 2026-09-18: "the dropdown says it allows for
 * multiple selections, but once I select one, I cannot select another until it is removed." The
 * control holds several honorifics on a primitive that holds one, and the defect was that a
 * SETTLED line was being read as a search: after picking "Hon.", the part after the last comma was
 * "Hon.", the list narrowed to that single row, and every other suggestion was unreachable. So the
 * cases below walk the sequence a person actually performs — pick, look again, pick again — rather
 * than testing the helpers one at a time.
 */
import { describe, expect, it } from "vitest";
import {
  isHeld,
  lineWithPick,
  settledLine,
  suggestionsMatching,
  tokensOf,
  typedPart,
} from "../src/lib/names/honorific-line.ts";

const SUGGESTIONS = ["Mr.", "Ms.", "Mx.", "Dr.", "Hon.", "Prof."];

describe("reading the line", () => {
  it("reads the tokens a written line carries, whatever the spacing", () => {
    expect(tokensOf("Hon., Dr.")).toEqual(["Hon.", "Dr."]);
    expect(tokensOf("  Hon.  ,Dr. ")).toEqual(["Hon.", "Dr."]);
    expect(tokensOf("")).toEqual([]);
    // A trailing separator is somebody mid-sentence, not an empty honorific.
    expect(tokensOf("Hon., ")).toEqual(["Hon."]);
  });

  it("holds an entry once however it is spelled for case", () => {
    expect(isHeld(["Hon."], "hon.")).toBe(true);
    expect(isHeld(["Hon."], "Dr.")).toBe(false);
  });
});

describe("what the list narrows against", () => {
  // The fix, stated at its narrowest: a line at rest is typing nothing.
  it("narrows nothing while the line is settled", () => {
    expect(typedPart("Hon.", false)).toBe("");
    expect(suggestionsMatching(SUGGESTIONS, typedPart("Hon.", false))).toEqual(SUGGESTIONS);
  });

  it("narrows against the part after the last comma while somebody types", () => {
    expect(typedPart("Hon., Dr", true)).toBe("Dr");
    expect(suggestionsMatching(SUGGESTIONS, typedPart("Hon., Dr", true))).toEqual(["Dr."]);
  });

  it("offers everything when the typing has only just started a new part", () => {
    expect(typedPart("Hon., ", true)).toBe("");
    expect(suggestionsMatching(SUGGESTIONS, typedPart("Hon., ", true))).toEqual(SUGGESTIONS);
  });
});

describe("picking from the list", () => {
  // THE REPORTED DEFECT, walked end to end. Before the fix the second step's list held only "Hon.",
  // so the third step could not happen at all.
  it("takes a second pick after a first, and a third after that", () => {
    let line = lineWithPick("", typedPart("", false), "Hon.");
    expect(line).toBe("Hon.");

    // The line is settled now, so the list is offering everything again.
    expect(suggestionsMatching(SUGGESTIONS, typedPart(line, false))).toEqual(SUGGESTIONS);

    line = lineWithPick(line, typedPart(line, false), "Dr.");
    expect(line).toBe("Hon., Dr.");

    line = lineWithPick(line, typedPart(line, false), "Prof.");
    expect(line).toBe("Hon., Dr., Prof.");
  });

  it("takes a held entry back off when it is chosen again", () => {
    expect(lineWithPick("Hon., Dr.", "", "Hon.")).toBe("Dr.");
    expect(lineWithPick("Hon., Dr.", "", "hon.")).toBe("Dr.");
    expect(lineWithPick("Hon.", "", "Hon.")).toBe("");
  });

  // A pick answers the half-word somebody was reaching for; leaving it beside the entry would
  // store "Ho, Hon." as somebody's prefix.
  it("replaces the part being typed rather than keeping it beside the pick", () => {
    expect(lineWithPick("Ho", "Ho", "Hon.")).toBe("Hon.");
    expect(lineWithPick("Dr., Ho", "Ho", "Hon.")).toBe("Dr., Hon.");
  });

  // Generational before degrees is a convention and not a universal one, so the person's own order
  // stands: a pick lands at the end of what is already there.
  it("appends at the end, never reordering what is already held", () => {
    expect(lineWithPick("Esq., III", "", "Ph.D.")).toBe("Esq., III, Ph.D.");
  });

  // The field is free text, so a typed entry the list never offered is a legitimate answer and
  // survives being picked around.
  it("keeps a typed entry the list does not know", () => {
    expect(lineWithPick("Sheikha", "", "Dr.")).toBe("Sheikha, Dr.");
    expect(settledLine("Sheikha, ")).toBe("Sheikha");
  });
});
