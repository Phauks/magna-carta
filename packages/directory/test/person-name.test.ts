import { describe, expect, it } from "vitest";
import { hasPersonNameParts, renderPersonName, splitNameForReview } from "../src/person-name.ts";

describe("rendering a person's name", () => {
  it("joins the parts in reading order, dropping the ones nobody stated", () => {
    expect(
      renderPersonName({ given: "Adaeze", middle: null, family: "Okafor", suffix: "Esq." }),
    ).toBe("Adaeze Okafor Esq.");
  });

  it("leaves no double space where a middle name is absent or blank", () => {
    expect(renderPersonName({ given: "Marcus", middle: "   ", family: "Reed" })).toBe(
      "Marcus Reed",
    );
  });

  it("carries a prefix and a multi-honorific suffix as written", () => {
    // The line is what goes on the letter, and several honorifics is the ordinary case.
    expect(
      renderPersonName({ prefix: "Hon.", given: "Priya", family: "Raman", suffix: "III, Esq." }),
    ).toBe("Hon. Priya Raman III, Esq.");
  });

  it("says nothing where the record holds nothing", () => {
    expect(renderPersonName({})).toBe("");
    expect(renderPersonName({ given: null, family: "" })).toBe("");
    expect(hasPersonNameParts({ given: null, family: "" })).toBe(false);
    expect(hasPersonNameParts({ family: "Okafor" })).toBe(true);
  });
});

describe("reading a name that was only ever one line", () => {
  // This function GUESSES. Its whole contract is that its answer seeds a form the person is
  // looking at, so what is pinned here is that the guess is the plain one and that it never
  // invents a part the line does not contain.
  it("takes the first word as given and the last as family", () => {
    expect(splitNameForReview("Jane Doe")).toEqual({ given: "Jane", middle: null, family: "Doe" });
  });

  it("puts everything between them in the middle", () => {
    expect(splitNameForReview("Mary Anne van der Berg")).toEqual({
      given: "Mary",
      middle: "Anne van der",
      family: "Berg",
    });
  });

  it("reads a lone word as a given name", () => {
    // A single word is far more often somebody's first name than their surname.
    expect(splitNameForReview("Cher")).toEqual({ given: "Cher" });
  });

  it("never guesses a prefix or a suffix", () => {
    // Recognising "Dr." would mean a list, and a list is wrong for the names it does not carry.
    const read = splitNameForReview("Dr. Alan Grant Jr.");
    expect(read.prefix).toBeUndefined();
    expect(read.suffix).toBeUndefined();
    expect(read.given).toBe("Dr.");
    expect(read.family).toBe("Jr.");
  });

  it("answers nothing for nothing", () => {
    expect(splitNameForReview("   ")).toEqual({});
  });
});
