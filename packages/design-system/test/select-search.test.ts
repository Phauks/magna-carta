import { describe, expect, it } from "vitest";
import { matchesSearch } from "../src/lib/components/select/select-search.svelte.ts";

describe("what a typed query keeps in a long Select list", () => {
  it("matches anywhere in the label, not only at the start", () => {
    expect(matchesSearch("Commercial Litigation", "lit")).toBe(true);
  });

  it("ignores case and accents", () => {
    expect(matchesSearch("École Juridique", "ecole")).toBe(true);
    expect(matchesSearch("Corporate", "CORP")).toBe(true);
  });

  it("keeps every row while nothing is typed", () => {
    expect(matchesSearch("Anything", "   ")).toBe(true);
  });

  it("drops a row that does not contain the query", () => {
    expect(matchesSearch("Family Law", "estate")).toBe(false);
  });
});
