/*
 * The directory index's column model and its kind control.
 *
 * The screen has two shapes on it — the index and the ranked search answer — and the whole point of
 * keeping them apart is that a capped best-of must never be dressed as the firm's record. These
 * assert the index side of that: the name anchors the row, kind is a column rather than a second
 * screen, and "everyone" is the absence of a filter rather than a value the server is asked for.
 */
import { describe, expect, it } from "vitest";
import type { DirectoryEntityListing } from "../src/lib/directory/directory-api.ts";
import {
  DEFAULT_LISTING_KIND,
  DIRECTORY_LISTING_INITIAL_SORT,
  LISTING_KIND_ITEMS,
  directoryListingColumns,
  listingKindLabel,
  listingKindParameter,
  listingName,
} from "../src/lib/directory/directory-listing.ts";
import { UNNAMED_ENTITY } from "../src/lib/directory/entity-presentation.ts";

function record(overrides: Partial<DirectoryEntityListing> = {}): DirectoryEntityListing {
  return {
    entityId: "directoryPerson_one",
    entityKind: "person",
    displayName: "Ada Lovelace",
    legalName: null,
    recordedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
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
    const columns = directoryListingColumns();
    const kind = columns.find((column) => column.id === "kind");

    expect(kind?.filter).toBe("set");
    // The label, not the stored code: a person filters on "Person", never on `person`.
    expect(kind?.value(record())).toBe("Person");
    expect(kind?.value(record({ entityKind: "organization" }))).toBe("Organization");
  });

  it("sorts the added date as a date rather than as text", () => {
    const added = directoryListingColumns().find((column) => column.id === "recordedAt");

    expect(added?.type).toBe("date");
    expect(added?.value(record())).toBe("2026-06-01T00:00:00.000Z");
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

describe("the kind control", () => {
  it("opens on the whole book", () => {
    expect(DEFAULT_LISTING_KIND).toBe("all");
    expect(LISTING_KIND_ITEMS[0]?.value).toBe("all");
    expect(listingKindLabel("all")).toBe("Everyone");
  });

  // "Everyone" is not a value the server understands — it is the absence of the parameter — and
  // sending it as one would narrow the listing to a kind that does not exist.
  it("sends no kind at all for everyone, and the kind itself otherwise", () => {
    expect(listingKindParameter("all")).toBeUndefined();
    expect(listingKindParameter("person")).toBe("person");
    expect(listingKindParameter("organization")).toBe("organization");
  });
});
