/*
 * The per-country address format table.
 *
 * What is being pinned is the claim the component makes: an address form is not a universal shape
 * with local labels. A form that asks every country for "State" and "ZIP Code" produces addresses
 * that do not deliver, and it teaches the person entering them to put the wrong thing in the wrong
 * box — which no later correction undoes, because nobody can tell afterwards which box was wrong.
 *
 * The rendering is asserted in the stories (src/stories/address-fields.stories.svelte); these are
 * the answers the table gives, which is where a wrong country entry actually lives.
 */
import { describe, expect, it } from "vitest";
import {
  addressFieldsFor,
  addressFormatFor,
  countriesWithKnownFormat,
  INTERNATIONAL_FORMAT,
} from "../src/lib/components/address-fields/address-format.ts";

/** The label a country's form puts on one field, or undefined where it has no such box. */
function labelOf(country: string, key: string): string | undefined {
  return addressFormatFor(country)
    .lines.flat()
    .find((field) => field.key === key)?.label;
}

describe("a country's own words", () => {
  it("names the postal code as each country names it", () => {
    expect(labelOf("US", "postal")).toBe("ZIP Code");
    expect(labelOf("GB", "postal")).toBe("Postcode");
    expect(labelOf("IE", "postal")).toBe("Eircode");
    expect(labelOf("DE", "postal")).toBe("Postleitzahl");
    expect(labelOf("IN", "postal")).toBe("PIN Code");
    expect(labelOf("BR", "postal")).toBe("CEP");
  });

  it("names the administrative area as each country names it, where it has one", () => {
    expect(labelOf("US", "region")).toBe("State");
    expect(labelOf("CA", "region")).toBe("Province");
    expect(labelOf("JP", "region")).toBe("Prefecture");
    expect(labelOf("GB", "region")).toBe("County");
  });
});

describe("a country that does not have a field", () => {
  // A German or Dutch address form asking for a state is asking for a thing that does not exist,
  // and whatever goes in that box is wrong.
  it("does not ask for one", () => {
    expect(addressFieldsFor("DE")).not.toContain("region");
    expect(addressFieldsFor("NL")).not.toContain("region");
  });

  it("asks for the ones it does have", () => {
    expect(addressFieldsFor("FR")).toContain("sortingCode");
    expect(addressFieldsFor("BR")).toContain("dependentLocality");
    expect(addressFieldsFor("US")).not.toContain("sortingCode");
  });
});

describe("the order a country reads its address in", () => {
  // Japan reads from the largest unit down; most of Europe puts the code before the town on one
  // line; the English-speaking world puts the town first and the code last. Order is not decoration:
  // a person filling a form fills it in the order it is written.
  it("puts the postal code first in Japan and last in the United States", () => {
    const japanese = addressFieldsFor("JP");
    const american = addressFieldsFor("US");

    expect(japanese[0]).toBe("postal");
    expect(american.indexOf("postal")).toBe(american.length - 1);
  });

  it("puts the code before the town in Germany and after it in the United Kingdom", () => {
    const german = addressFieldsFor("DE");
    const british = addressFieldsFor("GB");

    expect(german.indexOf("postal")).toBeLessThan(german.indexOf("city"));
    expect(british.indexOf("postal")).toBeGreaterThan(british.indexOf("city"));
  });
});

describe("a country the table has never heard of", () => {
  it("takes the international form rather than the American one", () => {
    expect(addressFormatFor("ZZ")).toBe(INTERNATIONAL_FORMAT);
    expect(addressFormatFor(null)).toBe(INTERNATIONAL_FORMAT);
    expect(addressFormatFor(undefined)).toBe(INTERNATIONAL_FORMAT);
    expect(labelOf("ZZ", "region")).toBe("Region");
    expect(labelOf("ZZ", "postal")).toBe("Postal Code");
  });

  // The code is stored uppercase and typed however it is typed; a lowercase one must not silently
  // fall through to the default and re-label a form somebody is halfway through.
  it("is not what a lowercase code is", () => {
    expect(addressFormatFor("ie")).toBe(addressFormatFor("IE"));
    expect(addressFormatFor(" us ")).toBe(addressFormatFor("US"));
  });
});

describe("every format the table holds", () => {
  it("asks for at least a street and a locality, and never twice for one field", () => {
    for (const country of countriesWithKnownFormat()) {
      const fields = addressFieldsFor(country);

      expect(fields, country).toContain("street");
      expect(fields, country).toContain("city");
      expect(new Set(fields).size, country).toBe(fields.length);
    }
  });

  it("labels every box, because an unlabelled one cannot be filled in correctly", () => {
    for (const country of countriesWithKnownFormat()) {
      for (const field of addressFormatFor(country).lines.flat()) {
        expect(field.label.trim(), `${country}.${field.key}`).not.toBe("");
      }
    }
  });
});
