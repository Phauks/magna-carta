import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KEYWORD_LETTER_FOLDS } from "../src/keyword-letter-folds.ts";
import { keywordQueryText } from "../src/keyword-query.ts";

// The query text handed to the keyword engine for a reader's text. The engine's reading of these
// exact shapes is pinned on its own side, in crates/search-core/src/lib.rs.

describe("a reader's text as a question for the words inside files", () => {
  it("requires every word, and reads the last one as the start of a word", () => {
    expect(keywordQueryText("drainage ease")).toBe('+"drainage" +body:/ease.*/');
  });

  it("reads a word as finished once a space follows it", () => {
    expect(keywordQueryText("drainage easement ")).toBe('+"drainage" +"easement"');
  });

  it("keeps a quoted run together, in order", () => {
    expect(keywordQueryText('"drainage easement" fence ')).toBe('+"drainage easement" +"fence"');
  });

  it("reads a word with punctuation inside it as the run of its pieces", () => {
    expect(keywordQueryText("O'Brien ")).toBe('+"O Brien"');
    expect(keywordQueryText("2026-0142")).toBe('+"2026 0142"*');
  });

  it("sends a finished word as it was typed, because the engine folds and lowercases it itself", () => {
    expect(keywordQueryText("Peña ")).toBe('+"Peña"');
    expect(keywordQueryText("EASEMENT ")).toBe('+"EASEMENT"');
  });

  it("lowercases an unfinished word, because a pattern is compared with words as the index holds them", () => {
    expect(keywordQueryText("EASE")).toBe("+body:/ease.*/");
  });

  it("folds an unfinished word the way the index folded the document's", () => {
    expect(keywordQueryText("Peñ")).toBe("+body:/pen.*/");
    expect(keywordQueryText("RÉSU")).toBe("+body:/resu.*/");
    expect(keywordQueryText("Straß")).toBe("+body:/strass.*/");
    expect(keywordQueryText("Søren Łuk")).toBe('+"Søren" +body:/luk.*/');
    // A capital I with a dot is a plain i, and not an i followed by a mark that would cut the word.
    expect(keywordQueryText("İzm")).toBe("+body:/izm.*/");
    // A lowercase letter the engine's table gives a capital is still held in lowercase.
    expect(keywordQueryText("ǧa")).toBe("+body:/ga.*/");
  });

  it("leaves another script's letters as they are, lowercased one at a time", () => {
    // A capital sigma is the same letter wherever it stands, as it is in the index.
    expect(keywordQueryText("ΟΔΟΣ")).toBe("+body:/οδοσ.*/");
    expect(keywordQueryText("Ёж")).toBe("+body:/ёж.*/");
  });

  it("reads a letter and its accent as one letter where a composed form exists", () => {
    expect(keywordQueryText("Peñ")).toBe("+body:/pen.*/");
    expect(keywordQueryText("Peña ")).toBe('+"Peña"');
    // An x and a combining tilde have no composed form, so the word is cut at the accent.
    expect(keywordQueryText("x̃y ")).toBe('+"x y"');
  });

  it("never lets the reader's text act as query syntax", () => {
    expect(keywordQueryText("trust OR estate ")).toBe('+"trust" +"OR" +"estate"');
    expect(keywordQueryText("-secret +body:/x.*/ ")).toBe('+"secret" +"body x"');
    expect(keywordQueryText('fence" neighbour ')).toBe('+"fence" +"neighbour"');
    expect(keywordQueryText("a\\b ")).toBe('+"a b"');
  });

  it("asks for a word whole when its folded form would mean something in a pattern", () => {
    // A parenthesized digit one is a digit to the parser and folds to "(1)".
    expect(keywordQueryText("⑴")).toBe('+"⑴"');
  });

  it("asks nothing when there is nothing to ask", () => {
    expect(keywordQueryText("")).toBeNull();
    expect(keywordQueryText("  ... ")).toBeNull();
  });

  it("asks nothing for a word longer than the index holds, counted as the index holds it", () => {
    expect(keywordQueryText(`fence ${"a".repeat(41)} `)).toBeNull();
    expect(keywordQueryText(`${"a".repeat(40)} `)).toBe(`+"${"a".repeat(40)}"`);
    // Forty accented letters are eighty bytes as typed and forty once folded, so the index holds it.
    expect(keywordQueryText(`${"é".repeat(40)} `)).toBe(`+"${"é".repeat(40)}"`);
    // Twenty-one sharp s are forty-two letters once folded, so it does not.
    expect(keywordQueryText(`${"ß".repeat(21)} `)).toBeNull();
    expect(keywordQueryText("ß".repeat(20))).toBe(`+body:/${"s".repeat(40)}.*/`);
  });
});

describe("the letters the application folds", () => {
  // The engine writes out what its analyzer does to every letter and digit, and a test beside the
  // analyzer holds that file to the analyzer. This holds the application's table to the file, so an
  // unfinished word is folded here exactly as the index folded the document's.
  const engineTable = readFileSync(
    new URL("../../../crates/search-core/tests/fixtures/body-letter-folds.tsv", import.meta.url),
    "utf8",
  );
  const engineFolds = engineTable
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const [codePoint = "", word = ""] = line.split("\t");
      return `${codePoint}\t${word}`;
    });

  it("are the letters the engine folds, to the words the engine folds them to", () => {
    const applicationFolds = KEYWORD_LETTER_FOLDS.flatMap(([word, letters]) =>
      Array.from(
        letters,
        (letter) => `${(letter.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}\t${word}`,
      ),
    );
    expect(engineFolds.length).toBeGreaterThan(1000);
    expect(
      applicationFolds.toSorted(),
      "re-render with `node packages/search/scripts/render-keyword-letter-folds.mts`",
    ).toEqual(engineFolds.toSorted());
  });
});
