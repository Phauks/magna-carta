import { describe, expect, it } from "vitest";
import {
  askableTerm,
  escapeLikeTerm,
  likePattern,
  LIKE_ESCAPE_CLAUSE,
} from "../src/like-search.ts";

/*
 * The escaping rule, which is the whole reason this module exists. Each case below is a real shape
 * of text a firm types into a search box — a percentage in a filename, an underscore in a matter
 * title — and each one, unescaped, would silently widen the match instead of narrowing it.
 */
describe("escapeLikeTerm", () => {
  it("neutralizes the two wildcards a reader may type", () => {
    expect(escapeLikeTerm("100%_final")).toBe("100\\%\\_final");
  });

  it("neutralizes a backslash, so a reader cannot escape the escape", () => {
    expect(escapeLikeTerm("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary text exactly as typed", () => {
    // No case folding, no accent stripping, no stemming: the match rule stays guessable.
    expect(escapeLikeTerm("O'Brien & Sons, L.L.P.")).toBe("O'Brien & Sons, L.L.P.");
    expect(escapeLikeTerm("Ashförd")).toBe("Ashförd");
  });
});

describe("likePattern", () => {
  it("wraps the escaped term as a contains-match", () => {
    expect(likePattern("Vance")).toBe("%Vance%");
  });

  it("adds no wildcard a reader did not get", () => {
    // The `%` between the two words is the reader's own character and must match literally; only
    // the outer pair are wildcards.
    expect(likePattern("50% split")).toBe("%50\\% split%");
  });

  it("declares an escape clause for callers to interpolate", () => {
    // A `LIKE ?` with no ESCAPE clause treats these backslashes as text to match, which would make
    // the pattern strictly worse than not escaping at all.
    expect(LIKE_ESCAPE_CLAUSE).toBe("ESCAPE '\\'");
  });
});

describe("askableTerm", () => {
  it("answers undefined for the two shapes of non-question", () => {
    expect(askableTerm(undefined)).toBeUndefined();
    expect(askableTerm("")).toBeUndefined();
    expect(askableTerm("   ")).toBeUndefined();
  });

  it("trims a real term", () => {
    expect(askableTerm("  Vance  ")).toBe("Vance");
  });
});
