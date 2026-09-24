import { describe, expect, it } from "vitest";
import {
  administrativeAreaFor,
  administrativeAreasFor,
  countriesWithAdministrativeAreas,
} from "../src/administrative-areas.ts";

describe("administrativeAreasFor", () => {
  it("gives a country's areas as the code a record stores and the name a reader sees", () => {
    const states = administrativeAreasFor("US");
    expect(states).toContainEqual({ code: "CA", name: "California" });
    expect(states).toContainEqual({ code: "NV", name: "Nevada" });
  });

  it("gives an empty list — not a guess — where a country publishes none", () => {
    expect(administrativeAreasFor("GB")).toEqual([]);
    expect(administrativeAreasFor("ZZ")).toEqual([]);
    expect(administrativeAreasFor(undefined)).toEqual([]);
  });

  it("collapses code and name where a country publishes no separate code", () => {
    // Ireland lists its counties by name; there is no abbreviation to store instead.
    const counties = administrativeAreasFor("IE");
    expect(counties.length).toBeGreaterThan(0);
    for (const county of counties) expect(county.code).toBe(county.name);
    expect(counties.map((county) => county.name)).toContain("Co. Carlow");
  });

  it("carries the countries whose region field is genuinely a closed-ish list", () => {
    for (const country of ["US", "CA", "AU", "JP", "IN", "BR", "MX", "IT", "ES"]) {
      expect(administrativeAreasFor(country).length, `${country} has no areas`).toBeGreaterThan(0);
    }
  });

  it("takes the country case-insensitively", () => {
    expect(administrativeAreasFor("us").length).toBe(administrativeAreasFor("US").length);
  });
});

describe("administrativeAreaFor", () => {
  it("finds an area by the value a record stores, whatever case it was stored in", () => {
    expect(administrativeAreaFor("US", "CA")).toEqual({ code: "CA", name: "California" });
    expect(administrativeAreaFor("US", "ca")).toEqual({ code: "CA", name: "California" });
    expect(administrativeAreaFor("US", " nv ")).toEqual({ code: "NV", name: "Nevada" });
  });

  it("returns undefined for a value no list carries, rather than inventing one", () => {
    // An address in a place the corpus does not list is still an address; the caller keeps the text.
    expect(administrativeAreaFor("US", "Kernow")).toBeUndefined();
    expect(administrativeAreaFor("US", "")).toBeUndefined();
    expect(administrativeAreaFor("GB", "Devon")).toBeUndefined();
  });
});

describe("the corpus itself", () => {
  it("lists a meaningful minority of countries, and says nothing about the rest", () => {
    const listed = countriesWithAdministrativeAreas();
    expect(listed.length).toBeGreaterThan(40);
    expect(listed.length).toBeLessThan(120);
  });

  it("never publishes an empty area list, which would be indistinguishable from no list", () => {
    for (const country of countriesWithAdministrativeAreas()) {
      expect(administrativeAreasFor(country).length, country).toBeGreaterThan(0);
    }
  });
});
