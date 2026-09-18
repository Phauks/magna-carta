/*
 * The directory listing's column model, and the two kinds of row it prints.
 *
 * The screen asks one of two questions — list the book, or answer this name — and until 2026-09 it
 * answered them on two different surfaces, so the reader lost their columns the moment they typed.
 * One table answers both now, which is what makes these assertions worth having: the columns hold
 * for a record and for a matter alike, a matter borrows nothing it does not have, and the two kinds
 * of row cannot collide on a key.
 */
import { describe, expect, it } from "vitest";
import type { DirectoryEntityListing } from "../src/lib/directory/directory-api.ts";
import type { MatterSummary } from "../src/lib/matters/matters-api.ts";
import {
  DIRECTORY_LISTING_INITIAL_SORT,
  DIRECTORY_SEARCH_INITIAL_SORT,
  directoryListingColumns,
  isMatterListing,
  listingName,
  listingRowKey,
  matterListingRow,
  MATTER_KIND_LABEL,
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

function matter(overrides: Partial<MatterSummary> = {}): MatterSummary {
  return {
    id: "matter_one",
    title: "Lovelace v. Babbage",
    status: "open",
    matterTypeId: null,
    locationId: null,
    responsibleMemberId: "user_one",
    clientDisplayName: "Ada Lovelace",
    clientEntityId: "directoryPerson_one",
    matterNumber: "2026-0001",
    consultationNumber: null,
    intakeNumber: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function column(id: string, options: { withMatters?: boolean } = {}) {
  return directoryListingColumns(options).find((candidate) => candidate.id === id);
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

  // A capped best-of has no honest column to open on: sorting it would put the best of an
  // arbitrary slice at the top and read as the best of the firm's record.
  it("opens a ranked answer in the order it arrived", () => {
    expect(DIRECTORY_SEARCH_INITIAL_SORT.columnId).toBeNull();
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

  // A column the directory declares is a column the reader sees: the only way to reveal a hidden
  // one is the header's right-click menu, which nothing advertises, so a column that starts hidden
  // is a column that does not exist for anyone who did not write it.
  it("shows every column it declares", () => {
    for (const declared of directoryListingColumns()) {
      expect(declared.hidden, declared.id).toBeUndefined();
    }
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

describe("a matter in the answer", () => {
  it("prints its title, and is a Matter on the Kind column", () => {
    const row = matterListingRow(matter());

    expect(listingName(row)).toBe("Lovelace v. Babbage");
    expect(column("kind")?.value(row)).toBe(MATTER_KIND_LABEL);
  });

  // A matter has no email, no number and no address of its own. Borrowing the client's would put a
  // person's contact detail on a row that is not that person.
  it("leaves every contact column blank rather than borrowing the client's", () => {
    const row = matterListingRow(matter());

    for (const id of ["emailAddress", "phoneNumber", "city", "region", "country"]) {
      expect(column(id)?.value(row), id).toBe("");
    }
    for (const id of ["givenName", "middleName", "familyName", "legalName", "changedAt"]) {
      expect(column(id)?.value(row), id).toBe("");
    }
  });

  it("is added on the day the firm opened the file", () => {
    expect(column("recordedAt")?.value(matterListingRow(matter()))).toBe(
      "2026-05-01T00:00:00.000Z",
    );
  });

  it("carries the number the file is quoted under, and the designation where it has none", () => {
    expect(matterListingRow(matter()).matterNumber).toBe("2026-0001");
    expect(
      matterListingRow(matter({ matterNumber: null, consultationNumber: "C-2026-0007" }))
        .matterNumber,
    ).toBe("C-2026-0007");
    expect(
      matterListingRow(matter({ matterNumber: null, status: "consultation" })).matterNumber,
    ).toBe("Consultation");
  });

  // The Kind filter is a question about what the answer HOLDS. The resting index holds no matters,
  // so offering to narrow to one would say the directory can contain something it cannot.
  it("is offered to the Kind filter only while matters are present", () => {
    expect(column("kind")?.filterValues).toBeUndefined();
    expect(column("kind", { withMatters: true })?.filterValues).toEqual([
      "Person",
      "Organization",
      MATTER_KIND_LABEL,
    ]);
  });

  it("is told from a directory record by its own kind", () => {
    expect(isMatterListing(matterListingRow(matter()))).toBe(true);
    expect(isMatterListing(record())).toBe(false);
  });
});

describe("the row's identity", () => {
  // Two registers in one table: a key that collided would drop one of the colliding rows outright.
  it("is the handle, which cannot collide across the two registers", () => {
    expect(listingRowKey(record())).toBe("directoryPerson_one");
    expect(listingRowKey(matterListingRow(matter()))).toBe("matter_one");
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

  // A matter is always quoted by something, so an untitled one falls back to its number rather than
  // to the directory's "not recorded", which would be an answer about a person.
  it("falls back to a matter's number where it carries no title", () => {
    expect(listingName(matterListingRow(matter({ title: "" })))).toBe("2026-0001");
  });
});
