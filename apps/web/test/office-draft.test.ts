import { describe, expect, it } from "vitest";
import {
  emptyOfficeDraft,
  officeAddressesRequest,
  officeDraftFrom,
  officeDraftShortfalls,
  officeDraftsEqual,
  officeFieldsRequest,
} from "$lib/offices/office-draft.ts";
import type { OfficeDetail } from "$lib/offices/offices-api.ts";

/*
 * The office record's draft: what the window's fields hold, what stops a save, and the two requests
 * a save becomes. Tested here because the window itself only renders it.
 */

const HENDERSON: OfficeDetail = {
  id: "location_henderson",
  name: "Henderson",
  status: "active",
  jurisdiction: "US-NV",
  timeZone: "America/Los_Angeles",
  numberCode: "HND",
  email: "henderson@example.com",
  addressBlock: "1 Main St\nHenderson, NV 89002",
  footer: null,
  remitTo: "PO Box 9",
  addresses: [
    {
      kind: "physical",
      street: "1 Main St",
      streetTwo: null,
      dependentLocality: null,
      city: "Henderson",
      region: "NV",
      postal: "89002",
      sortingCode: null,
      country: "US",
      phone: "+17025550148x4102",
    },
  ],
  members: [],
  firmDefault: false,
  letterheadLogo: null,
  letterheadSource: "none",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("a draft from a record", () => {
  it("puts every stored fact back into the field it was typed in", () => {
    const draft = officeDraftFrom(HENDERSON);
    expect(draft.name).toBe("Henderson");
    expect(draft.email).toBe("henderson@example.com");
    expect(draft.remitTo).toBe("PO Box 9");
    expect(draft.physical.parts).toMatchObject({
      country: "US",
      street: "1 Main St",
      city: "Henderson",
    });
    // The stored international number back in the national grouping, its extension split off.
    expect(draft.physical.phoneRegion).toBe("US");
    expect(draft.physical.phoneNumber).toBe("(702) 555-0148");
    expect(draft.physical.phoneExtension).toBe("4102");
    // No mailing address recorded means the post goes to the street address.
    expect(draft.separateMailingAddress).toBe(false);
  });

  it("round-trips: the draft of a record asks for the same facts the record holds", () => {
    const draft = officeDraftFrom(HENDERSON);
    expect(officeFieldsRequest(draft)).toEqual({
      name: "Henderson",
      jurisdiction: "US-NV",
      timeZone: "America/Los_Angeles",
      numberCode: "HND",
      email: "henderson@example.com",
      addressBlock: "1 Main St\nHenderson, NV 89002",
      footer: null,
      remitTo: "PO Box 9",
    });
    expect(officeAddressesRequest(draft)).toEqual([HENDERSON.addresses[0]]);
    expect(officeDraftsEqual(draft, officeDraftFrom(HENDERSON))).toBe(true);
  });
});

describe("what stops a save", () => {
  it("is the name alone, on an empty draft", () => {
    expect(officeDraftShortfalls(emptyOfficeDraft())).toEqual(["Name the office."]);
  });

  it("refuses an email that is not one address, and a number that is not a number", () => {
    const draft = { ...emptyOfficeDraft(), name: "Reno", email: "nope" };
    expect(officeDraftShortfalls(draft)).toEqual([
      "The email is one address, such as reno@example.com.",
    ]);
    const badPhone = {
      ...emptyOfficeDraft(),
      name: "Reno",
      physical: { ...emptyOfficeDraft().physical, phoneNumber: "12" },
    };
    expect(officeDraftShortfalls(badPhone)[0]).toMatch(/^Street address telephone: /u);
  });

  it("checks the mailing address's telephone only where the post goes somewhere else", () => {
    const base = emptyOfficeDraft();
    const draft = {
      ...base,
      name: "Reno",
      mailing: { ...base.mailing, phoneNumber: "12" },
    };
    expect(officeDraftShortfalls(draft)).toEqual([]);
    expect(officeDraftShortfalls({ ...draft, separateMailingAddress: true })[0]).toMatch(
      /^Mailing address telephone: /u,
    );
  });
});

describe("the address set a save replaces the office's with", () => {
  it("sends nothing for an address with nothing in it, and the mailing one only when separate", () => {
    const base = emptyOfficeDraft();
    expect(officeAddressesRequest({ ...base, name: "Reno" })).toEqual([]);
    const withMailing = {
      ...base,
      name: "Reno",
      mailing: { ...base.mailing, parts: { country: "US", street: "PO Box 1" } },
    };
    expect(officeAddressesRequest(withMailing)).toEqual([]);
    expect(officeAddressesRequest({ ...withMailing, separateMailingAddress: true })).toEqual([
      {
        kind: "mailing",
        street: "PO Box 1",
        streetTwo: null,
        dependentLocality: null,
        city: null,
        region: null,
        postal: null,
        sortingCode: null,
        country: "US",
        phone: null,
      },
    ]);
  });

  it("stores the telephone in the international form, with the extension after an x", () => {
    const base = emptyOfficeDraft();
    const draft = {
      ...base,
      name: "Reno",
      physical: {
        parts: { country: "US", street: "1 Main St" },
        phoneRegion: "US",
        phoneNumber: "(775) 555-0148",
        phoneExtension: "12",
      },
    };
    expect(officeAddressesRequest(draft)[0]?.phone).toBe("+17755550148x12");
  });
});
