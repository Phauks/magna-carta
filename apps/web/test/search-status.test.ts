/*
 * The Search and Indexing page's reading of what the firm's indexes hold: which standing a set of
 * counts earns, and the rows and columns of the table of indexed places.
 *
 * Pinned because the page states facts about a firm's data and each of these is a way it could
 * state a wrong one:
 *
 *   - a place whose index does not hold exactly its records is Behind, in either direction, and
 *     one behind place makes the record index behind as a whole;
 *   - the file contents index says it is turned off, or not connected, BEFORE it says anything
 *     about how many files it holds, because either makes the count a statement about the past;
 *   - a figure for what is not indexed is never negative;
 *   - the table lists every record place the server declared, in the server's order, then the
 *     firm's files, and names who reads each.
 */
import { STATUS_VOCABULARIES, statusEntry } from "@magna-carta/design-system/status-register";
import { describe, expect, it } from "vitest";
import {
  FILE_CONTENTS_PLACE_KEY,
  fileContentsStanding,
  rebuildOffer,
  recordIndexStanding,
  recordPlaceStanding,
  recordsIndexed,
  searchablePlaceColumns,
  searchablePlaceRows,
  searchByMeaningStanding,
  searchReadersText,
  withRebuildRequested,
  type SearchStatus,
} from "$lib/settings/search-status.ts";

function status(overrides: Partial<SearchStatus> = {}): SearchStatus {
  return {
    checkedAt: "2026-11-10T14:12:00.000Z",
    records: {
      places: [
        {
          key: "notes",
          label: "Notes",
          matchedFields: ["the note's text"],
          readBy: ["matter-search"],
          indexed: 12,
          expected: 12,
        },
        {
          key: "communications",
          label: "Messaging",
          matchedFields: ["what was said", "the caller's name"],
          readBy: ["matter-search", "conflicts-check"],
          indexed: 40,
          expected: 40,
        },
      ],
      rebuild: { requestedAt: null, finishedAt: null, outstanding: false },
    },
    fileContents: {
      turnedOn: true,
      serviceConnected: true,
      filesBelonging: 100,
      filesIndexed: 100,
      lastIndexedAt: "2026-11-10T09:00:00.000Z",
      dailyCatchUpLimit: 1000,
    },
    searchByMeaning: { turnedOn: false, serviceConnected: false },
    ...overrides,
  };
}

function withFiles(fileContents: Partial<SearchStatus["fileContents"]>): SearchStatus {
  const base = status();
  return { ...base, fileContents: { ...base.fileContents, ...fileContents } };
}

describe("a record place's standing", () => {
  it("is up to date only when the index holds exactly the records", () => {
    expect(recordPlaceStanding({ indexed: 12, expected: 12 })).toBe("index-up-to-date");
    expect(recordPlaceStanding({ indexed: 0, expected: 0 })).toBe("index-up-to-date");
  });

  it("is behind when the index is short, and when it holds a row its records no longer do", () => {
    expect(recordPlaceStanding({ indexed: 11, expected: 12 })).toBe("index-behind");
    expect(recordPlaceStanding({ indexed: 13, expected: 12 })).toBe("index-behind");
  });

  it("makes the whole record index behind when one place is", () => {
    expect(recordIndexStanding(status())).toBe("index-up-to-date");
    const behind = status();
    const [notes, messaging] = behind.records.places;
    expect(
      recordIndexStanding({
        ...behind,
        records: {
          ...behind.records,
          places: [notes, { ...messaging, expected: 41 }] as SearchStatus["records"]["places"],
        },
      }),
    ).toBe("index-behind");
  });

  it("adds up what the record index holds across every place", () => {
    expect(recordsIndexed(status())).toBe(52);
  });
});

describe("what the page offers about a rebuild", () => {
  function behind(rebuild: Partial<SearchStatus["records"]["rebuild"]> = {}): SearchStatus {
    const base = status();
    const [notes, messaging] = base.records.places;
    return {
      ...base,
      records: {
        places: [notes, { ...messaging, expected: 41 }] as SearchStatus["records"]["places"],
        rebuild: { ...base.records.rebuild, ...rebuild },
      },
    };
  }

  it("offers nothing while every place is up to date and nothing is outstanding", () => {
    expect(rebuildOffer(status())).toBe("none");
  });

  it("offers a rebuild while a place is behind and nobody has asked", () => {
    expect(rebuildOffer(behind())).toBe("offered");
  });

  it("says one was asked for while it is outstanding, whether or not a place still reads behind", () => {
    const asked = { requestedAt: "2026-11-10T14:20:00.000Z", outstanding: true };
    expect(rebuildOffer(behind(asked))).toBe("asked-for");
    const base = status();
    expect(
      rebuildOffer({
        ...base,
        records: { ...base.records, rebuild: { ...base.records.rebuild, ...asked } },
      }),
    ).toBe("asked-for");
  });

  it("offers again once a rebuild has finished and a place is behind", () => {
    expect(
      rebuildOffer(
        behind({
          requestedAt: "2026-11-10T14:20:00.000Z",
          finishedAt: "2026-11-10T14:22:00.000Z",
          outstanding: false,
        }),
      ),
    ).toBe("offered");
  });

  it("marks a recorded request as outstanding and leaves every count as it was", () => {
    const before = behind({ finishedAt: "2026-11-09T08:00:00.000Z" });
    const after = withRebuildRequested(before, "2026-11-10T14:20:00.000Z");
    expect(after.records.rebuild).toEqual({
      requestedAt: "2026-11-10T14:20:00.000Z",
      finishedAt: "2026-11-09T08:00:00.000Z",
      outstanding: true,
    });
    expect(after.records.places).toEqual(before.records.places);
    expect(after.fileContents).toEqual(before.fileContents);
  });
});

describe("the file contents index's standing", () => {
  it("says the firm has it turned off before anything else", () => {
    expect(fileContentsStanding(withFiles({ turnedOn: false, serviceConnected: false }))).toBe(
      "index-turned-off",
    );
    expect(fileContentsStanding(withFiles({ turnedOn: false, filesIndexed: 100 }))).toBe(
      "index-turned-off",
    );
  });

  it("says the service is not connected when the firm turned it on and nothing can read", () => {
    expect(fileContentsStanding(withFiles({ serviceConnected: false }))).toBe(
      "index-not-connected",
    );
  });

  it("is up to date when every file that belongs is held, and partly indexed otherwise", () => {
    expect(fileContentsStanding(status())).toBe("index-up-to-date");
    expect(fileContentsStanding(withFiles({ filesBelonging: 0, filesIndexed: 0 }))).toBe(
      "index-up-to-date",
    );
    expect(fileContentsStanding(withFiles({ filesIndexed: 60 }))).toBe("index-partly-indexed");
  });
});

describe("search by meaning's standing", () => {
  it("is turned off, then not connected, then turned on", () => {
    expect(searchByMeaningStanding(status())).toBe("index-turned-off");
    expect(
      searchByMeaningStanding(
        status({ searchByMeaning: { turnedOn: true, serviceConnected: false } }),
      ),
    ).toBe("index-not-connected");
    expect(
      searchByMeaningStanding(
        status({ searchByMeaning: { turnedOn: true, serviceConnected: true } }),
      ),
    ).toBe("index-turned-on");
  });
});

describe("the table of indexed places", () => {
  it("lists the record places in the server's order, then the firm's files", () => {
    const rows = searchablePlaceRows(withFiles({ filesIndexed: 60 }));
    expect(rows.map((row) => row.key)).toEqual([
      "notes",
      "communications",
      FILE_CONTENTS_PLACE_KEY,
    ]);
    expect(rows[1]).toEqual({
      key: "communications",
      place: "Messaging",
      matched: "What was said, the caller's name",
      readBy: "Matter Search, Conflicts Check",
      indexed: 40,
      notIndexed: 0,
      standing: "index-up-to-date",
    });
    expect(rows[2]).toMatchObject({
      place: "Inside Files",
      readBy: "Matter Search, Conflicts Check",
      indexed: 60,
      notIndexed: 40,
      standing: "index-partly-indexed",
    });
  });

  it("never states a negative number of records not indexed", () => {
    const base = status();
    const [notes] = base.records.places;
    const rows = searchablePlaceRows({
      ...base,
      records: {
        ...base.records,
        places: [{ ...notes, indexed: 13 }] as SearchStatus["records"]["places"],
      },
    });
    expect(rows[0]).toMatchObject({ indexed: 13, notIndexed: 0, standing: "index-behind" });
  });

  it("names who reads a place, and nobody for a place nothing reads yet", () => {
    expect(searchReadersText(["matter-search"])).toBe("Matter Search");
    expect(searchReadersText(["conflicts-check", "matter-search"])).toBe(
      "Conflicts Check, Matter Search",
    );
    expect(searchReadersText([])).toBe("");
  });

  it("anchors the row on the place and offers every standing a place can wear as a filter", () => {
    const columns = searchablePlaceColumns();
    expect(columns.map((column) => column.id)).toEqual([
      "place",
      "readBy",
      "indexed",
      "notIndexed",
      "standing",
    ]);
    expect(columns[0]?.anchored).toBe(true);
    const offered = columns.find((column) => column.id === "standing")?.filterValues ?? [];
    // Turned On is search by meaning's word, and that is not a row of this table.
    expect(offered).toEqual(
      STATUS_VOCABULARIES.searchIndexStanding
        .filter((key) => key !== "index-turned-on")
        .map((key) => statusEntry(key).label),
    );
    expect(offered).toContain("Behind");
  });
});
