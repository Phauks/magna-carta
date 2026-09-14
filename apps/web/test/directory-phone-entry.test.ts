import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkPhoneEntry,
  formatPhoneAfterEdit,
  formatPhoneAsTyped,
  formatStoredPhone,
  phoneCountries,
  phoneCountry,
  phoneCountryFlag,
  phoneNumberPlaceholder,
  rollTypedExtension,
} from "../src/lib/directory/phone-entry.ts";

describe("digits typed past the number's end roll into the extension", () => {
  it("keeps rolling after the first digit, without the person leaving the number field", () => {
    // A number, then the first overflow digit.
    const first = rollTypedExtension("US", "(312) 555-0148", "(312) 555-01484", "", "");
    expect(first).toEqual({ number: "(312) 555-0148", extension: "4", rolled: "4" });
    // The second overflow digit, typed straight after in the same field, which by now holds the
    // number alone. This was the defect: the digit was dropped because the extension was no longer
    // empty, so a direct dial could only be finished by clicking into the extension field.
    const second = rollTypedExtension(
      "US",
      first.number,
      "(312) 555-01481",
      first.extension,
      first.rolled,
    );
    expect(second).toEqual({ number: "(312) 555-0148", extension: "41", rolled: "41" });
    const third = rollTypedExtension(
      "US",
      second.number,
      "(312) 555-01480",
      second.extension,
      second.rolled,
    );
    expect(third).toEqual({ number: "(312) 555-0148", extension: "410", rolled: "410" });
  });

  it("leaves an extension somebody typed by hand alone", () => {
    const next = rollTypedExtension("US", "(312) 555-0148", "(312) 555-01489", "22", "");
    expect(next).toEqual({ number: "(312) 555-0148", extension: "22", rolled: "" });
  });

  it("does not touch the extension while the number is still being typed", () => {
    const next = rollTypedExtension("US", "(312) 555", "(312) 555-0", "", "");
    expect(next).toEqual({ number: "(312) 555-0", extension: "", rolled: "" });
  });
});

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
    expect(
      formatStoredPhone({ number: "+13125550148", countryRegionCode: "US", extension: "12" }),
    ).toBe("(312) 555-0148 ext. 12");
    expect(
      formatStoredPhone({ number: "+442079460000", countryRegionCode: "GB", extension: null }),
    ).toBe("+44 20 7946 0000");
    expect(
      formatStoredPhone({ number: "not a number", countryRegionCode: null, extension: null }),
    ).toBe("not a number");
  });
});

describe("a number can be shortened", () => {
  /*
   * The defect this is here for: backspace over a grouping character deleted a character the
   * formatter put straight back, so the key did nothing and the only way to shorten a number was to
   * clear the field and start over. Reported on the deployed call log, 2026-09-08.
   */
  it("deletes the digit behind a grouping character rather than putting the character back", () => {
    // The field holds "(312)"; backspace leaves "(312", which the formatter would regroup to "(312)".
    expect(formatPhoneAfterEdit("US", "(312)", "(312")).toBe("31");
  });

  it("deletes a digit the ordinary way", () => {
    expect(formatPhoneAfterEdit("US", "(312) 555-0148", "(312) 555-014")).toBe("(312) 555-014");
  });

  it("regroups what is typed when the keystroke added something", () => {
    expect(formatPhoneAfterEdit("US", "(312) 555-014", "(312) 555-0148")).toBe("(312) 555-0148");
    expect(formatPhoneAfterEdit("US", "", "3125550148")).toBe("(312) 555-0148");
  });

  it("empties a field that is being cleared rather than leaving one digit behind", () => {
    expect(formatPhoneAfterEdit("US", "(3", "")).toBe("");
  });
});

describe("a number field shows the grouping its own country uses", () => {
  it("writes the country's national form with every digit as an X", () => {
    expect(phoneNumberPlaceholder("US")).toBe("(XXX) XXX-XXXX");
    expect(phoneNumberPlaceholder("GB")).toMatch(/^[X ]+$/);
  });

  it("names a flag file, and one is shipped for every country the picker offers", () => {
    // The flags are static assets rather than the flag CHARACTERS, which are emoji (golden rule 2)
    // and which Windows draws as two boxed letters. A country in the list with no file behind it
    // would render as a broken image, and there is no way to see that short of opening the list.
    expect(phoneCountryFlag("US")).toBe("/flags/US.svg");
    const shipped = new Set(
      readdirSync(fileURLToPath(new URL("../static/flags", import.meta.url))),
    );
    const missing = phoneCountries()
      .map((country) => country.region)
      .filter((region) => !shipped.has(`${region}.svg`));
    expect(missing).toEqual([]);
  });
});
