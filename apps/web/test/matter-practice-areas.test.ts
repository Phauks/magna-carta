/*
 * The practice areas a firm starts from, pinned.
 *
 * The list itself is a judgement call and not something a test can grade. What a test CAN hold is
 * the three ways this list would quietly go wrong: an area offered twice under two spellings, a
 * numbering code that collides with another area's, and an area the firm has already adopted going
 * on being offered as if it had not — which is how a picker ends up showing "Litigation" above
 * "Litigation" and a firm ends up holding it twice.
 */
import { describe, expect, it } from "vitest";
import {
  matchingPracticeArea,
  unadoptedPracticeAreas,
  STARTING_PRACTICE_AREAS,
} from "../src/lib/matters/practice-areas.ts";

describe("the starting practice areas", () => {
  it("names each area once and codes each one once", () => {
    const names = STARTING_PRACTICE_AREAS.map((area) => area.name);
    const codes = STARTING_PRACTICE_AREAS.map((area) => area.code);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("carries a printable name and a short numbering code for every area", () => {
    for (const area of STARTING_PRACTICE_AREAS) {
      expect(area.name.trim()).toBe(area.name);
      expect(area.name.length).toBeGreaterThan(0);
      expect(area.code).toMatch(/^[A-Z]{2,5}$/);
    }
  });

  it("covers the areas a general practice actually opens files in", () => {
    const names = STARTING_PRACTICE_AREAS.map((area) => area.name);
    for (const expected of [
      "Litigation",
      "Family Law",
      "Criminal Defence",
      "Estate Planning",
      "Real Estate",
      "Immigration",
      "Personal Injury",
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe("what is still on offer", () => {
  it("drops an area the firm already holds, whatever case the firm spelled it in", () => {
    const remaining = unadoptedPracticeAreas(["litigation", "  Family Law  "]).map(
      (area) => area.name,
    );
    expect(remaining).not.toContain("Litigation");
    expect(remaining).not.toContain("Family Law");
    expect(remaining).toContain("Immigration");
  });

  it("offers the whole list to a firm that holds nothing yet", () => {
    expect(unadoptedPracticeAreas([]).length).toBe(STARTING_PRACTICE_AREAS.length);
  });

  it("leaves the firm's OWN inventions alone: they are not this list's business", () => {
    // A firm that has built "Cannabis Licensing" is not told anything about it here. Only the
    // starting list is ever withheld, and only because the firm already has that exact area.
    expect(unadoptedPracticeAreas(["Cannabis Licensing"]).length).toBe(
      STARTING_PRACTICE_AREAS.length,
    );
  });
});

describe("adopting by name", () => {
  it("recognizes a typed name as a starting area, so the code comes with it", () => {
    const matched = matchingPracticeArea("  estate planning ");
    expect(matched?.name).toBe("Estate Planning");
    expect(matched?.code).toBe("EST");
  });

  it("answers null for a name the list does not know, which is then the firm's own", () => {
    expect(matchingPracticeArea("Maritime Salvage")).toBeNull();
  });
});
