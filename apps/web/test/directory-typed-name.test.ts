import { describe, expect, it } from "vitest";
import { personNameFromTyped } from "../src/lib/directory/typed-name.ts";

/*
 * What a name typed into a picker seeds the New Person window with. A seed, never a record: the
 * split is the common Western-order reading, every part stays editable, and a one-word name leaves
 * the family name for the person to give rather than inventing one.
 */
describe("a typed name as a seed for the person window", () => {
  it("takes the last word as the family name and the rest as the given name", () => {
    expect(personNameFromTyped("Rosalind Chase")).toEqual({ given: "Rosalind", family: "Chase" });
    expect(personNameFromTyped("Mary Anne  Chase ")).toEqual({
      given: "Mary Anne",
      family: "Chase",
    });
  });

  it("seeds only the given name from one word, so the window still asks for the family name", () => {
    expect(personNameFromTyped("Rosalind")).toEqual({ given: "Rosalind", family: "" });
  });

  it("seeds nothing from nothing", () => {
    expect(personNameFromTyped("   ")).toEqual({ given: "", family: "" });
  });
});
