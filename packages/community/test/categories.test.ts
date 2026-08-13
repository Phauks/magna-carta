import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  FORBIDDEN_CATCH_ALL_CATEGORY_WORDS,
  isCategory,
} from "../src/categories.ts";

// The taxonomy is the board's primary confidentiality control, and its load-bearing property is an
// ABSENCE — there is nowhere for a practice-advice question to go. An absence is exactly the kind
// of thing a later change removes without noticing, so it is asserted rather than remembered.

describe("the category taxonomy", () => {
  it("has no catch-all category, which is what leaves a practice-advice question nowhere to go", () => {
    for (const category of CATEGORIES) {
      for (const word of FORBIDDEN_CATCH_ALL_CATEGORY_WORDS) {
        expect(
          category.split("_").includes(word) || category === word,
          `"${category}" reads as a catch-all category. The identity model shows real names because ` +
            `every category is a product area, and the content detector accepts false positives ` +
            `because the traffic is product questions. One catch-all invalidates both.`,
        ).toBe(false);
      }
    }
  });

  it("has no jurisdiction category", () => {
    // A jurisdiction plus a practice area plus a question is an inference path to a client, and it
    // is the shape a "Nevada guardianship" category would invite.
    const jurisdictionWords = ["state", "county", "federal", "nevada", "california", "texas", "uk"];
    for (const category of CATEGORIES) {
      for (const word of jurisdictionWords) {
        expect(category.includes(word), `"${category}" names a jurisdiction`).toBe(false);
      }
    }
  });

  it("labels every category exactly once, with no orphan label", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual([...CATEGORIES].sort());
  });

  it("has no duplicate keys", () => {
    expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
  });

  it("recognises its own members and nothing else", () => {
    expect(isCategory("trust_and_reconciliation")).toBe(true);
    expect(isCategory("general")).toBe(false);
    expect(isCategory("")).toBe(false);
  });
});
