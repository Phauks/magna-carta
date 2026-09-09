import { describe, expect, it } from "vitest";
import { choiceMatches, matchingChoices } from "$lib/components/choice-picker.ts";

/*
 * The narrowing behind the product's one closed-choice field. It is a function rather than a filter
 * written into the component because what a person types for a country is as likely to be "44" or
 * "United Kingdom" as "GB", and that rule is worth stating once and testing once.
 */

const COUNTRIES = [
  { value: "US", label: "+1 US", aside: "United States", keywords: ["United States", "US", "1"] },
  {
    value: "GB",
    label: "+44 GB",
    aside: "United Kingdom",
    keywords: ["United Kingdom", "GB", "44"],
  },
];

describe("a closed choice narrows to what was typed", () => {
  it("offers everything while nothing has been typed", () => {
    expect(matchingChoices(COUNTRIES, "")).toHaveLength(2);
    expect(matchingChoices(COUNTRIES, "   ")).toHaveLength(2);
  });

  it("answers to the name, the code and the dial code alike", () => {
    expect(matchingChoices(COUNTRIES, "kingdom").map((choice) => choice.value)).toEqual(["GB"]);
    expect(matchingChoices(COUNTRIES, "gb").map((choice) => choice.value)).toEqual(["GB"]);
    expect(matchingChoices(COUNTRIES, "44").map((choice) => choice.value)).toEqual(["GB"]);
  });

  it("matches the label itself without being told to", () => {
    expect(choiceMatches({ value: "call", label: "Call" }, "ca")).toBe(true);
    expect(choiceMatches({ value: "call", label: "Call" }, "text")).toBe(false);
  });
});
