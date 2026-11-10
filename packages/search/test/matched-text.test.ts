import { describe, expect, it } from "vitest";
import {
  EXCERPT_CHARACTERS,
  FILE_WORD_RULES,
  RECORD_WORD_RULES,
  markCharacters,
  markWords,
  mergeTextMarks,
  recordExcerpt,
  type MatchedText,
} from "../src/matched-text.ts";

// The runs a matched text marks, as the words a reader would see marked.
function marked(matched: MatchedText): string[] {
  return matched.marks.map((mark) => matched.text.slice(mark.start, mark.end));
}

const NOTE =
  "Called the surveyor on Tuesday about the north line. He will walk the parcel next week and " +
  "send the plat. Separately, the clerk confirmed the hearing stays on calendar. On the main " +
  "question the surveyor confirms the easement line runs through the Hargrove well house, not " +
  "beside it, which is what the 1987 agreement describes. He will put that in writing.";

describe("where a reader's words are in a record's text", () => {
  it("marks each word that answered, whole", () => {
    const matched = markWords(
      RECORD_WORD_RULES,
      "The easement runs past the Hargrove well.",
      "hargrove easement ",
    );
    expect(marked(matched)).toEqual(["easement", "Hargrove"]);
  });

  it("marks a word found by its start as the whole word on the page", () => {
    expect(marked(markWords(RECORD_WORD_RULES, "A perpetual easement.", "ease"))).toEqual([
      "easement",
    ]);
    // A finished word is a whole word, so the start of another is not marked.
    expect(marked(markWords(RECORD_WORD_RULES, "A perpetual easement.", "ease "))).toEqual([]);
  });

  it("marks a quoted run as one run, and only in that order", () => {
    const text = "A perpetual easement, not an easement perpetual in name only.";
    expect(marked(markWords(RECORD_WORD_RULES, text, '"perpetual easement"'))).toEqual([
      "perpetual easement",
    ]);
  });

  it("ignores capitals and accents, as the index does", () => {
    const text = "Deposition of María Peña, taken in Zürich.";
    expect(marked(markWords(RECORD_WORD_RULES, text, "pena ZURICH maria "))).toEqual([
      "María",
      "Peña",
      "Zürich",
    ]);
    // The accent written as a character of its own stays inside its word.
    const apart = "Affidavit of José Núñez.";
    expect(marked(markWords(RECORD_WORD_RULES, apart, "nunez "))).toEqual(["Núñez"]);
  });

  it("reads a word with punctuation inside it as the run of its pieces", () => {
    expect(
      marked(markWords(RECORD_WORD_RULES, "Counsel for Mr. O'Brien appeared.", "o'brien ")),
    ).toEqual(["O'Brien"]);
    expect(marked(markWords(RECORD_WORD_RULES, "See matter 2026-0142.", "2026-0142 "))).toEqual([
      "2026-0142",
    ]);
  });

  it("marks nothing for text with no letter or digit in it", () => {
    expect(markWords(RECORD_WORD_RULES, "An easement.", "?!").marks).toEqual([]);
  });

  it("composes the text first under rules whose index composes, and marks the composed text", () => {
    const matched = markWords(FILE_WORD_RULES, "Affidavit of José.", "jose ");
    expect(matched.text).toBe("Affidavit of José.");
    expect(marked(matched)).toEqual(["José"]);
  });
});

describe("what a result shows of a record's text", () => {
  it("shows a short text as it is, lines and all", () => {
    const short = "Left a message.\nShe will call back about the easement.";
    const shown = recordExcerpt(short, "easement");
    expect(shown.text).toBe(short);
    expect(marked(shown)).toEqual(["easement"]);
  });

  it("quotes a long text at the stretch the words are in, not at its opening", () => {
    const shown = recordExcerpt(NOTE, "hargrove easement");
    expect(shown.text).toContain("the easement line runs through the Hargrove well house");
    expect(shown.text.startsWith("…")).toBe(true);
    expect(shown.text).not.toContain("Called the surveyor on Tuesday");
    expect(shown.text.length).toBeLessThanOrEqual(EXCERPT_CHARACTERS + 2);
    expect(marked(shown)).toEqual(["easement", "Hargrove"]);
  });

  it("shows the opening, unmarked, where the words are not in the text", () => {
    // A call found by the caller's name holds that name beside what was said, not in it.
    const shown = recordExcerpt(NOTE, "okafor");
    expect(shown.text.startsWith("Called the surveyor on Tuesday")).toBe(true);
    expect(shown.text.endsWith("…")).toBe(true);
    expect(shown.text.length).toBeLessThanOrEqual(EXCERPT_CHARACTERS + 1);
    expect(shown.marks).toEqual([]);
  });

  it("cuts a long text with no space in it where it stands", () => {
    const shown = recordExcerpt("x".repeat(500), "nothing");
    expect(shown.text).toBe(`${"x".repeat(EXCERPT_CHARACTERS)}…`);
  });
});

describe("where a reader's text is in a name matched as characters", () => {
  it("marks what was typed wherever it falls, not word by word", () => {
    const name = "Invoice 2026-0142-A.pdf";
    const marks = markCharacters(name, " 0142 ");
    expect(marks.map((mark) => name.slice(mark.start, mark.end))).toEqual(["0142"]);
  });

  it("compares unaccented capitals alone, as a name match does", () => {
    const name = "Easement EASEMENT easement";
    expect(markCharacters(name, "Easement")).toHaveLength(3);
    // An accented letter is the letter typed or it is not.
    expect(markCharacters("Peña", "pena")).toEqual([]);
    expect(markCharacters("PEÑA", "peÑa")).toHaveLength(1);
  });

  it("marks nothing for an empty question", () => {
    expect(markCharacters("Anything", "   ")).toEqual([]);
  });
});

describe("marks a screen can walk once", () => {
  it("sorts them and joins the ones that touch or overlap", () => {
    expect(
      mergeTextMarks([
        { start: 10, end: 14 },
        { start: 0, end: 4 },
        { start: 3, end: 6 },
        { start: 14, end: 18 },
        { start: 20, end: 20 },
      ]),
    ).toEqual([
      { start: 0, end: 6 },
      { start: 10, end: 18 },
    ]);
  });
});
