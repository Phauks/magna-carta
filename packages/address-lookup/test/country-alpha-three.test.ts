import { describe, expect, it } from "vitest";
import { countriesWithPostalCodeFormat } from "@magna-carta/address-formats/postal-code";
import { alphaThreeFor, alphaTwoFor } from "../src/country-alpha-three.ts";

describe("alpha-2 to alpha-3", () => {
  it("round-trips every code it knows", () => {
    for (const alphaTwo of ["US", "GB", "IE", "CA", "JP", "DE", "BR", "NA"]) {
      const alphaThree = alphaThreeFor(alphaTwo);
      expect(alphaThree, alphaTwo).toBeDefined();
      expect(alphaTwoFor(alphaThree!)).toBe(alphaTwo);
    }
    expect(alphaThreeFor("us")).toBe("USA");
  });

  it("covers every country the address form publishes a postal format for, bar the reserved codes", () => {
    // The address corpus carries three codes ISO reserves rather than assigns — Ascension Island,
    // Tristan da Cunha and Kosovo — and none of them has an official alpha-3. An address in one of
    // them answers no-coverage from the international service, which is the honest answer.
    const RESERVED_WITHOUT_ALPHA_THREE = new Set(["AC", "TA", "XK"]);
    const missing = countriesWithPostalCodeFormat().filter(
      (alphaTwo) =>
        alphaThreeFor(alphaTwo) === undefined && !RESERVED_WITHOUT_ALPHA_THREE.has(alphaTwo),
    );
    expect(missing).toEqual([]);
  });
});
