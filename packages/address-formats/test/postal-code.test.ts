import { describe, expect, it } from "vitest";
import { POSTAL_CODE_FORMATS } from "../src/data-postal.generated.ts";
import {
  countriesWithPostalCodeFormat,
  postalCodeFormatFor,
  postalCodeNoteFor,
  validatePostalCode,
} from "../src/postal-code.ts";

describe("validatePostalCode", () => {
  it("accepts an empty value, because nothing in an address is ever required", () => {
    expect(validatePostalCode("US", "")).toEqual({ kind: "ok" });
    expect(validatePostalCode("US", "   ")).toEqual({ kind: "ok" });
  });

  it("answers no-pattern rather than failing when the country is absent or unknown", () => {
    expect(validatePostalCode(undefined, "95014")).toEqual({ kind: "no-pattern" });
    expect(validatePostalCode("", "95014")).toEqual({ kind: "no-pattern" });
    expect(validatePostalCode("ZZ", "95014")).toEqual({ kind: "no-pattern" });
  });

  it("answers no-pattern for a country that operates no postal-code system", () => {
    // Ireland has one and Hong Kong does not; the corpus carries the distinction, so a form shows
    // a rule for the first and says nothing for the second.
    expect(validatePostalCode("HK", "whatever")).toEqual({ kind: "no-pattern" });
  });

  it("accepts a well-formed code and reports a malformed one with examples to show", () => {
    expect(validatePostalCode("US", "95014")).toEqual({ kind: "ok" });
    expect(validatePostalCode("US", "22162-1010")).toEqual({ kind: "ok" });

    const verdict = validatePostalCode("US", "9501");
    expect(verdict.kind).toBe("malformed");
    if (verdict.kind === "malformed") expect(verdict.examples).toContain("95014");
  });

  it("ANCHORS the pattern, so a valid code buried in other text is still malformed", () => {
    // The corpus publishes every pattern unanchored. Testing one raw would make this string pass.
    expect(validatePostalCode("US", "not a postcode 95014 at all").kind).toBe("malformed");
    expect(validatePostalCode("US", "95014xyz").kind).toBe("malformed");
  });

  it("folds case, because no postal-code system is case-sensitive", () => {
    expect(validatePostalCode("GB", "SW1A 1AA")).toEqual({ kind: "ok" });
    expect(validatePostalCode("GB", "sw1a 1aa")).toEqual({ kind: "ok" });
  });

  it("handles the alphanumeric systems the American shape would reject", () => {
    expect(validatePostalCode("GB", "EC1Y 8SY")).toEqual({ kind: "ok" });
    expect(validatePostalCode("IE", "A65 F4E2")).toEqual({ kind: "ok" }); // Eircode
    expect(validatePostalCode("CA", "K1A 0B1")).toEqual({ kind: "ok" });
    expect(validatePostalCode("NL", "1012 JS")).toEqual({ kind: "ok" });
  });

  it("trims before matching, so a pasted value with stray spaces is not a refusal", () => {
    expect(validatePostalCode("US", "  95014  ")).toEqual({ kind: "ok" });
  });

  it("takes the country case-insensitively", () => {
    expect(validatePostalCode("us", "95014")).toEqual({ kind: "ok" });
  });
});

describe("postalCodeFormatFor", () => {
  it("returns the published pattern and examples, or undefined", () => {
    expect(postalCodeFormatFor("US")?.examples).toContain("95014");
    expect(postalCodeFormatFor("HK")).toBeUndefined();
    expect(postalCodeFormatFor(undefined)).toBeUndefined();
  });
});

describe("the corpus itself", () => {
  it("publishes a format for the countries a firm actually meets", () => {
    for (const country of ["US", "GB", "IE", "CA", "AU", "DE", "FR", "JP", "IN", "BR"]) {
      expect(POSTAL_CODE_FORMATS[country], `${country} has no format`).toBeDefined();
    }
    expect(countriesWithPostalCodeFormat().length).toBeGreaterThan(150);
  });

  it("holds every published example against its own pattern, anchored and case-folded", () => {
    // The same invariant scripts/build-data.mts enforces at build time, asserted here so a corpus
    // edited by hand cannot pass the test battery either.
    const failures: string[] = [];
    for (const [country, format] of Object.entries(POSTAL_CODE_FORMATS)) {
      for (const example of format.examples) {
        if (validatePostalCode(country, example).kind !== "ok") {
          failures.push(`${country}: ${example}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("compiles every pattern without catastrophic backtracking", () => {
    // A pattern that backtracks exponentially would hang the address form on a typo, so the shape of
    // every published pattern is probed with a long non-matching string rather than trusted.
    const started = Date.now();
    for (const country of Object.keys(POSTAL_CODE_FORMATS)) {
      validatePostalCode(country, `${"A".repeat(40)}!`);
    }
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("postalCodeNoteFor", () => {
  it("says nothing when there is nothing to say", () => {
    expect(postalCodeNoteFor("US", "")).toBeNull(); // nothing is required
    expect(postalCodeNoteFor("US", "95014")).toBeNull(); // well-formed
    expect(postalCodeNoteFor("HK", "anything")).toBeNull(); // no published format
    expect(postalCodeNoteFor(undefined, "95014")).toBeNull(); // no country chosen yet
  });

  it("names real examples rather than printing a pattern", () => {
    const note = postalCodeNoteFor("US", "9501");
    expect(note).toContain("95014");
    expect(note).not.toContain("\\d");
  });
});
