import { describe, expect, it } from "vitest";
import { keywordExcerpt } from "../src/keyword-excerpt.ts";

const DEED =
  "This indenture is made the third day of March. The grantor, June Hargrove, conveys to the " +
  "District a perpetual easement twenty feet in width along the northern boundary of the parcel, " +
  "for the laying and upkeep of a water main. The grantee shall restore the surface after any work.";

describe("the sentence a file result quotes", () => {
  it("quotes the stretch where the words are, entered a little before the first", () => {
    const excerpt = keywordExcerpt(DEED, "easement");
    expect(excerpt).toContain("a perpetual easement twenty feet in width");
    expect(excerpt?.startsWith("…")).toBe(true);
    expect(excerpt?.endsWith("…")).toBe(true);
    // Whole words at both ends.
    expect(excerpt).toMatch(/^…\S/u);
    expect(DEED).toContain(excerpt?.slice(1, -1) ?? "missing");
  });

  it("marks no cut where the passage begins or ends inside the excerpt", () => {
    expect(keywordExcerpt("A short page about an easement.", "easement")).toBe(
      "A short page about an easement.",
    );
  });

  it("finds a word by the start of it when it is the word still being typed", () => {
    expect(keywordExcerpt(DEED, "ease")).toContain("easement");
    // A finished word is a whole word.
    expect(keywordExcerpt(DEED, "ease ")).toBeNull();
  });

  it("finds a quoted run only in that order", () => {
    expect(keywordExcerpt(DEED, '"perpetual easement"')).toContain("perpetual easement");
    expect(keywordExcerpt(DEED, '"easement perpetual"')).toBeNull();
  });

  it("ignores capitals and accents, as the index does", () => {
    const page = "Deposition of María Peña, taken in Zürich before the résumé was produced.";
    expect(keywordExcerpt(page, "pena")).toBe(page);
    expect(keywordExcerpt(page, "PEÑA zurich")).toBe(page);
    // The accent as a character of its own, in the passage and in the question.
    expect(keywordExcerpt("Affidavit of José Núñez.", "núñez")).toBe("Affidavit of José Núñez.");
    expect(keywordExcerpt(page, "Peña")).toBe(page);
  });

  it("quotes the stretch that holds the most of the question, not the first word found", () => {
    const filler = "The easement is discussed generally here. ".repeat(12);
    const page = `${filler}Hargrove granted the easement to the District in 1987. ${filler}`;
    const excerpt = keywordExcerpt(page, "hargrove easement district");
    expect(excerpt).toContain("Hargrove granted the easement to the District");
  });

  it("reads a word with punctuation inside it as the run of its pieces", () => {
    expect(keywordExcerpt("Counsel for Mr. O'Brien appeared.", "o'brien")).toBe(
      "Counsel for Mr. O'Brien appeared.",
    );
  });

  it("makes one line of text laid out over several", () => {
    expect(keywordExcerpt("The grantor\n\n  conveys\tan easement.", "easement")).toBe(
      "The grantor conveys an easement.",
    );
  });

  it("stays an excerpt however long the passage is", () => {
    const excerpt = keywordExcerpt(
      `${"word ".repeat(5000)}easement ${"word ".repeat(5000)}`,
      "easement",
    );
    expect(excerpt?.length).toBeLessThanOrEqual(202);
    expect(excerpt).toContain("easement");
  });

  it("cuts text written without spaces where it stands, and never through a character", () => {
    // Marks that are neither letters nor spaces between the characters, so the word stands alone.
    const page = `${"\u{20000}\u3001".repeat(300)}easement${"\u3001\u{20000}".repeat(300)}`;
    const excerpt = keywordExcerpt(page, "easement");
    expect(excerpt).toContain("easement");
    // No lone half of a character survives the cut.
    const loneHalf = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneHalf.test(excerpt ?? "")).toBe(false);
  });

  it("answers nothing when the words are not in the passage, or there are no words", () => {
    expect(keywordExcerpt(DEED, "indemnify")).toBeNull();
    expect(keywordExcerpt(DEED, " ... ")).toBeNull();
    expect(keywordExcerpt("", "easement")).toBeNull();
  });
});
