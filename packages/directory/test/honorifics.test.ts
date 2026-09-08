import { describe, expect, it } from "vitest";
import { honorificSuggestions, NAME_PREFIXES, NAME_SUFFIXES } from "../src/honorifics.ts";

// These lists are SUGGESTIONS over a free-text column, so there is nothing here to validate against
// and no round trip to prove. What is worth pinning is the two properties a suggestion list has to
// have to be worth offering at all — it says each thing once, and it says it in the form that will
// be written on the letter — plus the fact that nothing in the module narrows what may be stored.

describe("the honorific suggestions", () => {
  it("offers each form once, in both lists", () => {
    for (const list of [NAME_PREFIXES, NAME_SUFFIXES]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("offers no entry that is another one differently cased or spaced", () => {
    // A list carrying both "Jr." and "JR." would be the drift the control exists to prevent,
    // offered by the control itself.
    for (const list of [NAME_PREFIXES, NAME_SUFFIXES]) {
      const normalized = list.map((entry) => entry.toLowerCase().replaceAll(/\s+/g, ""));
      expect(new Set(normalized).size).toBe(normalized.length);
    }
  });

  it("writes every entry as it goes on the letter, with no stray whitespace", () => {
    for (const entry of [...NAME_PREFIXES, ...NAME_SUFFIXES]) {
      expect(entry).toBe(entry.trim());
      expect(entry).not.toBe("");
    }
  });

  it("carries the forms a legal practice actually writes", () => {
    // The two the platform would be embarrassing without: the judicial address, and the one that
    // follows the name of every lawyer the firm corresponds with.
    expect(NAME_PREFIXES).toContain("Hon.");
    expect(NAME_SUFFIXES).toContain("Esq.");
    // The generational suffixes are why a suffix is on a legal record at all — they are what tells
    // a father's matter from a son's.
    expect(NAME_SUFFIXES).toContain("Jr.");
    expect(NAME_SUFFIXES).toContain("III");
  });

  it("answers each part with its own list and nothing else", () => {
    expect(honorificSuggestions("prefix")).toBe(NAME_PREFIXES);
    expect(honorificSuggestions("suffix")).toBe(NAME_SUFFIXES);
  });
});
