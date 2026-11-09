import { describe, expect, it } from "vitest";
import {
  ADDRESS_LOOKUP_SENTENCES,
  MINIMUM_ADDRESS_QUERY_LENGTH,
  addressLookupRequestFor,
  groupAside,
  groupHeading,
  withResolvedAddress,
} from "../src/lib/components/address-fields/street-lookup.ts";

describe("addressLookupRequestFor", () => {
  it("asks nothing with nothing typed", () => {
    expect(addressLookupRequestFor("", "US")).toEqual({ kind: "nothing" });
    expect(addressLookupRequestFor("   ", "US")).toEqual({ kind: "nothing" });
  });

  it("asks nothing without a country, because the country decides what can match", () => {
    expect(addressLookupRequestFor("14 Rosewood", undefined)).toEqual({ kind: "nothing" });
    expect(addressLookupRequestFor("14 Rosewood", "")).toEqual({ kind: "nothing" });
  });

  it("holds a question below the floor, because a house number alone matches half a country", () => {
    expect(addressLookupRequestFor("14", "US")).toEqual({ kind: "too-short" });
    expect(addressLookupRequestFor("x".repeat(MINIMUM_ADDRESS_QUERY_LENGTH), "US").kind).toBe(
      "ask",
    );
  });

  it("asks the trimmed text, in the country the address is in", () => {
    expect(addressLookupRequestFor("  14 Rose  ", "US")).toEqual({
      kind: "ask",
      country: "US",
      query: "14 Rose",
    });
  });
});

describe("withResolvedAddress", () => {
  it("replaces every part the choice carries, so an earlier attempt's town cannot survive it", () => {
    const current = { country: "US", street: "14 Rose", city: "Sparks", postal: "89431" };
    expect(
      withResolvedAddress(current, {
        street: "14 Rosewood Dr",
        city: "Reno",
        region: "NV",
        postal: "89501",
        country: "US",
      }),
    ).toEqual({
      country: "US",
      street: "14 Rosewood Dr",
      city: "Reno",
      region: "NV",
      postal: "89501",
    });
  });

  it("leaves alone the unit a service could not know, rather than clearing what the person typed", () => {
    const chosen = withResolvedAddress(
      { country: "US", street: "1042 W Cen", streetTwo: "Apt 4B" },
      { street: "1042 W Center St", city: "Orem", region: "UT", postal: "84057", country: "US" },
    );
    expect(chosen.streetTwo).toBe("Apt 4B");
    expect(chosen.street).toBe("1042 W Center St");
  });

  it("never touches the recipient or the organization line, which no lookup knows", () => {
    const chosen = withResolvedAddress(
      { recipient: "Dana Whitfield", organizationName: "c/o Whitfield LLP", street: "14" },
      { street: "14 Rosewood Dr", country: "US" },
    );
    expect(chosen.recipient).toBe("Dana Whitfield");
    expect(chosen.organizationName).toBe("c/o Whitfield LLP");
  });

  it("takes the country the service says, where it says one", () => {
    expect(withResolvedAddress({ country: "US" }, { street: "1 Rue", country: "CA" }).country).toBe(
      "CA",
    );
  });

  it("treats an empty part from the service as saying nothing", () => {
    expect(withResolvedAddress({ city: "Reno" }, { city: "  " }).city).toBe("Reno");
  });
});

describe("what the list says", () => {
  it("names a group's size, and says so when the service did not", () => {
    const building = {
      identifier: "g",
      label: "1042 W Center St, Orem UT",
      kind: "group" as const,
    };
    expect(groupAside({ ...building, count: 24 })).toBe("24 addresses");
    expect(groupAside({ ...building, count: 1 })).toBe("1 address");
    expect(groupAside(building)).toBe("Several addresses");
    expect(groupHeading(building)).toBe("Addresses at 1042 W Center St, Orem UT");
  });

  it("keeps the four kinds of no-offers apart, and tells a person the address can always be typed", () => {
    const sentences = [
      ADDRESS_LOOKUP_SENTENCES.nothingMatched,
      ADDRESS_LOOKUP_SENTENCES.noCoverage,
      ADDRESS_LOOKUP_SENTENCES.failed,
      ADDRESS_LOOKUP_SENTENCES.expired,
    ];
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const sentence of [
      ADDRESS_LOOKUP_SENTENCES.nothingMatched,
      ADDRESS_LOOKUP_SENTENCES.noCoverage,
      ADDRESS_LOOKUP_SENTENCES.failed,
    ]) {
      expect(sentence).toMatch(/by hand|typed/);
    }
  });
});
