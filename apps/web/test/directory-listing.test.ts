/*
 * The directory index's column model.
 *
 * The screen has two shapes on it — the index and the ranked search answer — and the whole point of
 * keeping them apart is that a capped best-of must never be dressed as the firm's record. These
 * assert the index side of that: the name anchors the row, kind is a column rather than a second
 * screen, and the columns a reader might want are all declared here whether or not they are shown,
 * because the alternative is a screen change every time somebody wants to sort by family name.
 */
import { describe, expect, it } from "vitest";
import type { DirectoryEntityListing } from "../src/lib/directory/directory-api.ts";
import {
  DIRECTORY_LISTING_INITIAL_SORT,
  directoryListingColumns,
  listingName,
} from "../src/lib/directory/directory-listing.ts";
import { UNNAMED_ENTITY } from "../src/lib/directory/entity-presentation.ts";

function record(overrides: Partial<DirectoryEntityListing> = {}): DirectoryEntityListing {
  return {
    entityId: "directoryPerson_one",
    entityKind: "person",
    displayName: "Ada Lovelace",
    legalName: null,
    givenName: "Ada",
    middleName: null,
    familyName: "Lovelace",
    emailAddress: "ada@example.test",
    phoneNumber: "+1 775 555 0148",
    city: "Reno",
    region: "NV",
    country: "US",
    recordedAt: "2026-06-01T00:00:00.000Z",
    changedAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

function column(id: string) {
  return directoryListingColumns().find((candidate) => candidate.id === id);
}

describe("the column model", () => {
  it("anchors the name and opens in name order", () => {
    const columns = directoryListingColumns();

    expect(columns[0]?.id).toBe("name");
    expect(columns[0]?.anchored).toBe(true);
    expect(DIRECTORY_LISTING_INITIAL_SORT).toEqual({
      columnId: "name",
      direction: "ascending",
    });
  });

  it("carries kind as one column of one listing, never as two screens", () => {
    const kind = column("kind");

    expect(kind?.filter).toBe("set");
    // The label, not the stored code: a person filters on "Person", never on `person`.
    expect(kind?.value(record())).toBe("Person");
    expect(kind?.value(record({ entityKind: "organization" }))).toBe("Organization");
  });

  it("sorts the two dates as dates rather than as text", () => {
    expect(column("recordedAt")?.type).toBe("date");
    expect(column("recordedAt")?.value(record())).toBe("2026-06-01T00:00:00.000Z");
    expect(column("changedAt")?.type).toBe("date");
    expect(column("changedAt")?.value(record())).toBe("2026-06-02T00:00:00.000Z");
  });

  // The reason the model is wider than the table: a reader sorting a book of people by family name
  // needs the column to exist, and a reader who only wants names needs it not to be in the way.
  it("offers the name parts and the default way to reach a record", () => {
    for (const id of [
      "givenName",
      "middleName",
      "familyName",
      "emailAddress",
      "phoneNumber",
      "city",
    ]) {
      expect(column(id), id).toBeDefined();
    }

    expect(column("familyName")?.value(record())).toBe("Lovelace");
    expect(column("emailAddress")?.value(record())).toBe("ada@example.test");
    expect(column("city")?.value(record())).toBe("Reno");
  });

  it("starts the name parts hidden and the reachable columns shown", () => {
    expect(column("familyName")?.hidden).toBe(true);
    expect(column("legalName")?.hidden).toBe(true);
    expect(column("emailAddress")?.hidden).toBeUndefined();
    expect(column("city")?.hidden).toBeUndefined();
  });

  // A record the firm holds nothing for is a blank cell, never the word "null" and never a guess.
  it("renders a fact the firm does not hold as nothing at all", () => {
    const blank = record({ familyName: null, emailAddress: null, city: null, country: null });

    expect(column("familyName")?.value(blank)).toBe("");
    expect(column("emailAddress")?.value(blank)).toBe("");
    expect(column("city")?.value(blank)).toBe("");
    expect(column("country")?.value(blank)).toBe("");
  });

  // The stored value is a two-letter code, which is a filing convention rather than a word anybody
  // reads. What the reader filters on is the country's name.
  it("names the country rather than printing its code", () => {
    expect(column("country")?.filter).toBe("set");
    expect(column("country")?.value(record())).not.toBe("US");
  });
});

describe("the name a row prints", () => {
  it("states the gap where the directory holds no name at all", () => {
    expect(listingName(record({ displayName: null }))).toBe(UNNAMED_ENTITY);
    expect(listingName(record({ displayName: "   " }))).toBe(UNNAMED_ENTITY);
  });

  it("prints the name the firm recorded otherwise", () => {
    expect(listingName(record())).toBe("Ada Lovelace");
  });
});
