import { describe, expect, it } from "vitest";
import {
  officeAddressLine,
  officeCitation,
  officePhoneText,
  officePlace,
  officeRecordHref,
  officeStatusKey,
} from "$lib/offices/office-vocabulary.ts";
import type { OfficeAddress } from "$lib/offices/offices-api.ts";

/*
 * How an office reads wherever it is named: the one line its address takes, the citation beside its
 * name, and where its record opens.
 */

const STREET: OfficeAddress = {
  kind: "physical",
  street: "1 Main St",
  streetTwo: null,
  dependentLocality: null,
  city: "Reno",
  region: "NV",
  postal: "89501",
  sortingCode: null,
  country: "US",
  phone: "+17755550148",
};

describe("an office's address on one line", () => {
  it("skips empty parts rather than leaving gaps", () => {
    expect(officeAddressLine(STREET)).toBe("1 Main St, Reno, NV 89501");
    expect(officeAddressLine({ ...STREET, region: null, postal: null })).toBe("1 Main St, Reno");
    expect(officeAddressLine(undefined)).toBe("");
  });
});

describe("the citation beside an office's name", () => {
  it("is the place, then the numbering code", () => {
    expect(officeCitation({ addresses: [STREET], numberCode: "RNO" })).toBe("Reno, NV · RNO");
    expect(officeCitation({ addresses: [STREET], numberCode: null })).toBe("Reno, NV");
    expect(officeCitation({ addresses: [], numberCode: "RNO" })).toBe("RNO");
    expect(officeCitation({ addresses: [], numberCode: null })).toBe("");
  });

  it("takes the place from the street address, or the mailing one where that is all there is", () => {
    expect(officePlace({ addresses: [{ ...STREET, kind: "mailing", city: "Sparks" }] })).toBe(
      "Sparks, NV",
    );
  });
});

describe("an office's telephone", () => {
  it("prefers the street address's line and reads it the way a phone shows it", () => {
    expect(officePhoneText({ addresses: [STREET] })).toBe("(775) 555-0148");
    expect(
      officePhoneText({
        addresses: [
          { ...STREET, phone: null },
          { ...STREET, kind: "mailing", phone: "+17755550199" },
        ],
      }),
    ).toBe("(775) 555-0199");
    expect(officePhoneText({ addresses: [] })).toBe("");
  });
});

describe("standing and address", () => {
  it("speaks the status register's own words", () => {
    expect(officeStatusKey("active")).toBe("active");
    expect(officeStatusKey("closed")).toBe("closed");
  });

  it("opens the record on the Offices screen by naming it in the address", () => {
    expect(officeRecordHref("location_abc")).toBe("/settings/offices?office=location_abc");
  });
});
