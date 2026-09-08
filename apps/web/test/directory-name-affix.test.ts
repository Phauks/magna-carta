/*
 * A name's prefix and its suffixes.
 *
 * Two facts are being pinned. The first is that a person may hold SEVERAL suffixes and that the one
 * stored column holds all of them — "Jr." and "Esq." are two different facts about one person, and
 * a field that held one of them lost the other. The second is that the same suffix spelled two ways
 * is one suffix: a record that accepted both would put "Jr., JR" on the firm's correspondence.
 */
import { describe, expect, it } from "vitest";
import {
  isSameAffix,
  NAME_PREFIXES,
  NAME_SUFFIXES,
  storedSuffix,
  suffixesFrom,
} from "../src/lib/directory/name-affix.ts";

describe("the stored column and the suffixes it holds", () => {
  it("holds several, comma-separated, the way they are written on an envelope", () => {
    expect(storedSuffix(["Jr.", "Esq."])).toBe("Jr., Esq.");
    expect(suffixesFrom("Jr., Esq.")).toEqual(["Jr.", "Esq."]);
  });

  it("survives the round trip, whatever the spacing was", () => {
    expect(suffixesFrom("Jr.,Esq. ,  Ph.D.")).toEqual(["Jr.", "Esq.", "Ph.D."]);
    expect(storedSuffix(suffixesFrom("Jr.,Esq."))).toBe("Jr., Esq.");
  });

  // No suffixes is the absence of a value, not an empty one: the column is nullable and an empty
  // string there would read back as a suffix nobody entered.
  it("stores nothing at all where there are none", () => {
    expect(storedSuffix([])).toBeNull();
    expect(storedSuffix(["  ", ""])).toBeNull();
    expect(suffixesFrom(null)).toEqual([]);
    expect(suffixesFrom("")).toEqual([]);
  });
});

describe("the same affix spelled differently", () => {
  it("is one affix, whatever the case and the punctuation", () => {
    expect(isSameAffix("Jr.", "JR")).toBe(true);
    expect(isSameAffix("Ph.D.", "phd")).toBe(true);
    expect(isSameAffix("Mr.", "mr")).toBe(true);
  });

  it("is not the same affix merely because it starts the same way", () => {
    expect(isSameAffix("Jr.", "Sr.")).toBe(false);
    expect(isSameAffix("II", "III")).toBe(false);
    expect(isSameAffix("M.D.", "J.D.")).toBe(false);
  });
});

describe("what the fields offer", () => {
  // The lists are what a firm writes every week, spelled one way so its letters do not vary. Neither
  // is closed — anything typed joins the record — so what matters here is that they hold no
  // duplicate spelling of a value they already carry.
  it("offers each spelling once", () => {
    for (const offered of [NAME_PREFIXES, NAME_SUFFIXES]) {
      const collisions = offered.filter((entry, index) =>
        offered.some((other, otherIndex) => otherIndex < index && isSameAffix(entry, other)),
      );
      expect(collisions).toEqual([]);
    }
  });
});
