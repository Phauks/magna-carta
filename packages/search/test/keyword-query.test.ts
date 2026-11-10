import { describe, expect, it } from "vitest";
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
    expect(keywordQueryText("O'Brien ")).toBe('+"o brien"');
    expect(keywordQueryText("2026-0142")).toBe('+"2026 0142"*');
  });

  it("lowercases, because a pattern is compared with words as the index holds them", () => {
    expect(keywordQueryText("EASE")).toBe("+body:/ease.*/");
  });

  it("cuts a word where an accent arrives as a character of its own", () => {
    // The n, then a combining tilde that has no composed form to fold into.
    expect(keywordQueryText("x̃y ")).toBe('+"x y"');
    // Where a composed form exists the letter stays whole.
    expect(keywordQueryText("Peña ")).toBe('+"peña"');
  });

  it("never lets the reader's text act as query syntax", () => {
    expect(keywordQueryText("trust OR estate ")).toBe('+"trust" +"or" +"estate"');
    expect(keywordQueryText("-secret +body:/x.*/ ")).toBe('+"secret" +"body x"');
    expect(keywordQueryText('fence" neighbour ')).toBe('+"fence" +"neighbour"');
    expect(keywordQueryText("a\\b ")).toBe('+"a b"');
  });

  it("asks nothing when there is nothing to ask", () => {
    expect(keywordQueryText("")).toBeNull();
    expect(keywordQueryText("  ... ")).toBeNull();
  });

  it("asks nothing for a word longer than the index holds", () => {
    expect(keywordQueryText(`fence ${"a".repeat(41)} `)).toBeNull();
    expect(keywordQueryText(`${"a".repeat(40)} `)).toBe(`+"${"a".repeat(40)}"`);
  });
});
