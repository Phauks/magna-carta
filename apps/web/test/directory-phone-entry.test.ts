import { describe, expect, it } from "vitest";
import {
  checkPhoneEntry,
  formatPhoneAsTyped,
  formatStoredPhone,
  phoneCountries,
  phoneCountry,
} from "../src/lib/directory/phone-entry.ts";

describe("a number carries its country", () => {
  it("lists every country the formatter knows, the firm's own first, with its dial code", () => {
    const countries = phoneCountries();
    expect(countries[0]?.region).toBe("US");
    expect(countries[0]?.callingCode).toBe("1");
    expect(phoneCountry("GB")?.callingCode).toBe("44");
    expect(countries.length).toBeGreaterThan(200);
  });

  it("formats the digits as they are typed, in the country's national form", () => {
    expect(formatPhoneAsTyped("US", "312")).toBe("(312)");
    expect(formatPhoneAsTyped("US", "3125550148")).toBe("(312) 555-0148");
    expect(formatPhoneAsTyped("GB", "02079460000")).toBe("020 7946 0000");
  });

  it("sends the international form with the region, and refuses digits that are not a number there", () => {
    expect(checkPhoneEntry("US", "(312) 555-0148")).toEqual({
      ok: true,
      number: "+13125550148",
      region: "US",
    });
    expect(checkPhoneEntry("US", "312 555")).toMatchObject({ ok: false });
    expect(checkPhoneEntry("US", "")).toEqual({ ok: false, reason: "The number." });
  });

  it("shows a stored number nationally at home and internationally abroad, with its extension", () => {
    expect(formatStoredPhone({ number: "+13125550148", countryRegionCode: "US", extension: "12" })).toBe(
      "(312) 555-0148 ext. 12",
    );
    expect(formatStoredPhone({ number: "+442079460000", countryRegionCode: "GB", extension: null })).toBe(
      "+44 20 7946 0000",
    );
    expect(formatStoredPhone({ number: "not a number", countryRegionCode: null, extension: null })).toBe(
      "not a number",
    );
  });
});
