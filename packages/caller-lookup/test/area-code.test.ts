import { describe, expect, it } from "vitest";
import { areaCodeRegion } from "../src/area-code.ts";
import { NORTH_AMERICAN_AREA_CODES } from "../src/north-american-area-codes.ts";

describe("areaCodeRegion", () => {
  it("names the state or province, and the zone, an area code was issued for", () => {
    expect(areaCodeRegion({ countryCallingCode: "1", nationalNumber: "7025550142" })).toEqual({
      areaCode: "702",
      region: "Nevada",
      place: null,
      timeZone: "America/Los_Angeles",
    });
    expect(areaCodeRegion({ countryCallingCode: "1", nationalNumber: "4165550100" })?.region).toBe(
      "Ontario",
    );
  });

  it("names the town an exchange was assigned to", () => {
    expect(areaCodeRegion({ countryCallingCode: "1", nationalNumber: "7025580142" })).toEqual({
      areaCode: "702",
      region: "Nevada",
      place: "Henderson, NV",
      timeZone: "America/Los_Angeles",
    });
    expect(areaCodeRegion({ countryCallingCode: "1", nationalNumber: "4162030100" })?.place).toBe(
      "Toronto, ON",
    );
  });

  it("says no zone for an area code that spans two, unless the exchange settles it", () => {
    expect(
      areaCodeRegion({ countryCallingCode: "1", nationalNumber: "7755550142" })?.timeZone,
    ).toBeNull();
    expect(
      areaCodeRegion({ countryCallingCode: "1", nationalNumber: "7752000142" })?.timeZone,
    ).toBe("America/Los_Angeles");
  });

  it("answers null outside North America and for anything that is not a ten-digit number", () => {
    expect(areaCodeRegion({ countryCallingCode: "44", nationalNumber: "7025550142" })).toBeNull();
    expect(areaCodeRegion({ countryCallingCode: "1", nationalNumber: "702555014" })).toBeNull();
    expect(areaCodeRegion({ countryCallingCode: "1", nationalNumber: "1025550142" })).toBeNull();
  });

  it("answers null for a code the table does not hold rather than guessing", () => {
    expect(NORTH_AMERICAN_AREA_CODES.has("999")).toBe(false);
    expect(areaCodeRegion({ countryCallingCode: "1", nationalNumber: "9995550142" })).toBeNull();
  });

  it("holds only three-digit North American codes, with the two source misspellings corrected", () => {
    for (const [code, region] of NORTH_AMERICAN_AREA_CODES) {
      expect(code).toMatch(/^[2-9][0-9]{2}$/);
      expect(region.trim()).toBe(region);
      expect(region).not.toBe("Washington State");
      expect(region).not.toBe("British Colombia");
    }
  });
});
