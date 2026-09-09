import { describe, expect, it } from "vitest";
import {
  contactDraftRefusal,
  contactDraftStarted,
  contactRequestsFrom,
  contactRowFromDraft,
  contactRowsFrom,
  emptyContactDraft,
  type AddressDraft,
} from "../src/lib/directory/contact-draft.ts";
import type { DirectoryContactPointState } from "../src/lib/directory/directory-api.ts";

const quiet: DirectoryContactPointState = {
  permitted: true,
  preferred: false,
  note: null,
  verificationStatus: "unverified",
  verifiedAt: null,
  verificationDetail: null,
};

describe("the kind decides the fields and checks them", () => {
  it("refuses an email without a domain, by the shared sentence", () => {
    expect(contactDraftRefusal({ kind: "email", address: "m.okafor@example", use: "work" })).toBe(
      "A mailbox and a domain, as name@firm.com.",
    );
    expect(
      contactDraftRefusal({ kind: "email", address: "m.okafor@example.com", use: "work" }),
    ).toBeNull();
  });

  it("refuses digits that are not a number in the chosen country", () => {
    const short = {
      kind: "telephone",
      region: "US",
      number: "312 555",
      extension: "",
      use: "mobile",
    } as const;
    expect(contactDraftRefusal(short)).toBe("Not a number in United States.");
    expect(contactDraftRefusal({ ...short, number: "(312) 555-0148" })).toBeNull();
  });

  // ONE LINE OF IT IS ENOUGH, and which line is the country's business rather than this rule's: an
  // address a firm holds half of is still the address it holds, and refusing it sends it into a
  // free-text note where no envelope and no duplicate check can reach it.
  it("refuses an address with no line at all, and takes one with any", () => {
    const blank = emptyContactDraft("address") as AddressDraft;
    expect(contactDraftRefusal(blank)).toBe("At least one line of the address.");
    expect(contactDraftStarted(blank)).toBe(false);
    // Any line will do, and which one is the country's business rather than this rule's: a
    // Brazilian address is its neighbourhood, an Irish one can be a townland and an Eircode.
    expect(contactDraftRefusal({ ...blank, dependentLocality: "Copacabana" })).toBeNull();
    expect(contactDraftRefusal({ ...blank, postal: "D02 XY45" })).toBeNull();
  });
});

describe("what is sent", () => {
  it("sends the number in the international form with its region, fax as its own system", () => {
    const requests = contactRequestsFrom([
      { kind: "email", address: " m.okafor@example.com ", use: "work" },
      {
        kind: "telephone",
        region: "US",
        number: "(312) 555-0148",
        extension: " 12 ",
        use: "mobile",
      },
      { kind: "fax", region: "GB", number: "020 7946 0000", extension: "", use: "work" },
      {
        ...(emptyContactDraft("address") as AddressDraft),
        street: "1 N State St",
        city: "Chicago",
        region: "IL",
        postal: "60602",
        country: "US",
      },
    ]);
    expect(requests.emails).toEqual([{ address: "m.okafor@example.com", contactUse: "work" }]);
    expect(requests.phones).toEqual([
      {
        number: "+13125550148",
        contactSystem: "voice",
        contactUse: "mobile",
        extension: "12",
        countryRegionCode: "US",
      },
      {
        number: "+442079460000",
        contactSystem: "fax",
        contactUse: "work",
        extension: null,
        countryRegionCode: "GB",
      },
    ]);
    expect(requests.addresses[0]).toMatchObject({
      street: "1 N State St",
      streetTwo: null,
      city: "Chicago",
      addressUse: "business",
    });
  });
});

describe("one line per way to reach them", () => {
  it("lists a record's points across the kinds, formatted, with the use beside the value", () => {
    const rows = contactRowsFrom({
      emails: [
        {
          id: "e",
          address: "m.okafor@example.com",
          contactUse: "work",
          isPrimary: true,
          state: { ...quiet, preferred: true },
        },
      ],
      phones: [
        {
          id: "p",
          number: "+13125550148",
          contactSystem: "voice",
          contactUse: "mobile",
          countryCallingCode: "1",
          nationalNumber: "3125550148",
          extension: null,
          countryRegionCode: "US",
          isPrimary: false,
          state: quiet,
        },
        {
          id: "f",
          number: "+13125550190",
          contactSystem: "fax",
          contactUse: "work",
          countryCallingCode: "1",
          nationalNumber: "3125550190",
          extension: null,
          countryRegionCode: "US",
          isPrimary: false,
          state: quiet,
        },
      ],
      addresses: [],
    });
    expect(rows.map((row) => [row.kind, row.value, row.use])).toEqual([
      ["email", "m.okafor@example.com", "Work"],
      ["telephone", "(312) 555-0148", "Mobile"],
      ["fax", "(312) 555-0190", "Work fax"],
    ]);
    expect(rows[0]?.state.preferred).toBe(true);
  });

  it("lists a draft the same way, so the dialog's list reads as the pane's", () => {
    expect(
      contactRowFromDraft(
        { kind: "telephone", region: "US", number: "3125550148", extension: "", use: "mobile" },
        "d",
      ),
    ).toMatchObject({
      kind: "telephone",
      value: "(312) 555-0148",
      use: "Mobile",
    });
  });
});
