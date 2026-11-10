/*
 * What the firm's indexes hold, as the Search and Indexing page shows it: the standing of each of
 * the three indexes, and the one table of indexed places with what each holds.
 *
 * Pure, so the page renders decisions and makes none. Every word a standing wears comes from the
 * status register's `searchIndexStanding` vocabulary; this module only decides WHICH word a set of
 * counts earns, and that is the whole of what is tested here.
 *
 * THE NUMBERS ARE THE SERVER'S. Each is counted from the firm's own database at the moment of the
 * read (`firmSearchStatus.get`), and nothing here adds, estimates or remembers one. The single
 * subtraction is "not indexed", floored at zero: an index that holds a row its records no longer
 * do is behind, and the standing says so, but it is not short by a negative number of records.
 *
 * WHAT THE TABLE LEAVES OUT, and why a reader is told. A discovery review set is its own index,
 * read only from inside that set by a member with access to it, so no firm-wide figure exists for
 * it to show. Names and numbers (a file's name, a party, an invoice number) are matched where they
 * are stored and have no index to report on.
 */
import type { FirmSearchStatusResponse, SearchStatusRecordPlace } from "@magna-carta/api-client";
import type { GridColumn } from "@magna-carta/design-system/data-table";
import {
  STATUS_VOCABULARIES,
  statusEntry,
  type StatusKey,
} from "@magna-carta/design-system/status-register";
import type { SettingDefinition } from "./settings-definitions.ts";

export type SearchStatus = FirmSearchStatusResponse;

type RecordIndexReader = SearchStatusRecordPlace["readBy"][number];

/** What each asker is called on the screens a member already knows it by. */
export const SEARCH_READER_LABELS: Readonly<Record<RecordIndexReader, string>> = {
  "matter-search": "Matter Search",
  "conflicts-check": "Conflicts Check",
};

/** The searches that read the words inside files, in the order the readers are always listed. */
const FILE_CONTENTS_READERS: readonly RecordIndexReader[] = ["matter-search", "conflicts-check"];

/** The row the file contents index takes in the table, beside the record places. */
export const FILE_CONTENTS_PLACE_KEY = "file-contents";

/** Who reads a place, as one line. Empty for a place that is indexed and read by nothing yet. */
export function searchReadersText(readers: readonly RecordIndexReader[]): string {
  return readers.map((reader) => SEARCH_READER_LABELS[reader]).join(", ");
}

/** A count that cannot be negative: what an index is short by, or nothing. */
function shortBy(belonging: number, held: number): number {
  return Math.max(belonging - held, 0);
}

/** One place's standing: an index either holds exactly its records or it is behind them. */
export function recordPlaceStanding(
  place: Pick<SearchStatusRecordPlace, "indexed" | "expected">,
): StatusKey {
  return place.indexed === place.expected ? "index-up-to-date" : "index-behind";
}

/** The record index as a whole: behind if any one place is. */
export function recordIndexStanding(status: SearchStatus): StatusKey {
  return status.records.places.some((place) => recordPlaceStanding(place) === "index-behind")
    ? "index-behind"
    : "index-up-to-date";
}

/**
 * The file contents index. The two reasons nothing is being read come first, because either makes
 * the counts beside it a statement about the past and not about what a search finds now.
 */
export function fileContentsStanding(status: SearchStatus): StatusKey {
  const { turnedOn, serviceConnected, filesBelonging, filesIndexed } = status.fileContents;
  if (!turnedOn) return "index-turned-off";
  if (!serviceConnected) return "index-not-connected";
  return filesIndexed >= filesBelonging ? "index-up-to-date" : "index-partly-indexed";
}

export function searchByMeaningStanding(status: SearchStatus): StatusKey {
  if (!status.searchByMeaning.turnedOn) return "index-turned-off";
  if (!status.searchByMeaning.serviceConnected) return "index-not-connected";
  return "index-turned-on";
}

/**
 * What the page offers about rebuilding the record index.
 *
 * - `asked-for`: a member asked and the rebuild has not finished. Said first, because it is true
 *   whether or not a place still reads behind: the rebuild may be part way through them.
 * - `offered`: a place is behind and nobody has asked, so the page offers the button.
 * - `none`: nothing is behind and nothing is outstanding. The standing says so and there is
 *   nothing to press.
 */
export type RebuildOffer = "none" | "offered" | "asked-for";

export function rebuildOffer(status: SearchStatus): RebuildOffer {
  if (status.records.rebuild.outstanding) return "asked-for";
  return recordIndexStanding(status) === "index-behind" ? "offered" : "none";
}

/**
 * The status as it stands the moment the server has recorded a request: the same counts, with the
 * rebuild now outstanding. The counts are not asked for again, because nothing has changed in them
 * yet and the read behind them is the expensive one.
 */
export function withRebuildRequested(status: SearchStatus, requestedAt: string): SearchStatus {
  return {
    ...status,
    records: {
      ...status.records,
      rebuild: { ...status.records.rebuild, requestedAt, outstanding: true },
    },
  };
}

/** How many records the record index holds across every place. */
export function recordsIndexed(status: SearchStatus): number {
  return status.records.places.reduce((sum, place) => sum + place.indexed, 0);
}

export interface SearchablePlaceRow {
  readonly key: string;
  readonly place: string;
  /** What is matched there, in a reader's words. */
  readonly matched: string;
  readonly readBy: string;
  readonly indexed: number;
  readonly notIndexed: number;
  readonly standing: StatusKey;
}

/** A sentence's first letter raised, for a phrase the contract carries mid-sentence. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Every indexed place as a row: the record places in declared order, then the firm's files. */
export function searchablePlaceRows(status: SearchStatus): SearchablePlaceRow[] {
  const records = status.records.places.map((place): SearchablePlaceRow => ({
    key: place.key,
    place: place.label,
    matched: sentenceCase(place.matchedFields.join(", ")),
    readBy: searchReadersText(place.readBy),
    indexed: place.indexed,
    notIndexed: shortBy(place.expected, place.indexed),
    standing: recordPlaceStanding(place),
  }));
  const files: SearchablePlaceRow = {
    key: FILE_CONTENTS_PLACE_KEY,
    place: "Inside Files",
    matched: "The words inside each file",
    readBy: searchReadersText(FILE_CONTENTS_READERS),
    indexed: status.fileContents.filesIndexed,
    notIndexed: shortBy(status.fileContents.filesBelonging, status.fileContents.filesIndexed),
    standing: fileContentsStanding(status),
  };
  return [...records, files];
}

const SECTION_ID = "search-and-indexing";
const INDEXES_PLATE = "What Is Indexed";

/*
 * The four engraved rows of the indexes plate. They are stated facts and never controls, so each
 * is a definition only for the row anatomy it buys: the shared grid, the name and its one line.
 */
export const RECORD_INDEX_DEFINITION: SettingDefinition = {
  id: "search.status.records",
  sectionId: SECTION_ID,
  plateLabel: INDEXES_PLATE,
  label: "Records",
  description:
    "Notes, time, costs, events, calls and texts, tasks and Magnus conversations, indexed as each one is saved.",
  kind: "text",
  defaultValue: "",
  sensitivity: "open",
};

/** Shown beneath Records while a place is behind and nobody has asked for a rebuild. */
export const REBUILD_DEFINITION: SettingDefinition = {
  id: "search.status.rebuild",
  sectionId: SECTION_ID,
  plateLabel: INDEXES_PLATE,
  label: "Rebuild",
  description:
    "Reads the places that are behind again from the firm's records. Nothing the firm holds is changed.",
  kind: "text",
  defaultValue: "",
  sensitivity: "open",
};

/** Shown in its place once a member has asked, until the rebuild has finished. */
export const REBUILD_ASKED_FOR_DEFINITION: SettingDefinition = {
  id: "search.status.rebuild-asked-for",
  sectionId: SECTION_ID,
  plateLabel: INDEXES_PLATE,
  label: "Rebuild Asked For",
  description:
    "It starts within a few minutes and runs in the background. Count again to see where it stands.",
  kind: "text",
  defaultValue: "",
  sensitivity: "open",
};

export const FILE_CONTENTS_INDEX_DEFINITION: SettingDefinition = {
  id: "search.status.file-contents",
  sectionId: SECTION_ID,
  plateLabel: INDEXES_PLATE,
  label: "Inside Files",
  description: "The words inside the firm's files, read after each file is filed.",
  kind: "text",
  defaultValue: "",
  sensitivity: "open",
};

export const SEARCH_BY_MEANING_DEFINITION: SettingDefinition = {
  id: "search.status.search-by-meaning",
  sectionId: SECTION_ID,
  plateLabel: INDEXES_PLATE,
  label: "Search by Meaning",
  description: "Finds a passage by what it means and not only by its words.",
  kind: "text",
  defaultValue: "",
  sensitivity: "open",
};

export const COUNTED_DEFINITION: SettingDefinition = {
  id: "search.status.counted",
  sectionId: SECTION_ID,
  plateLabel: INDEXES_PLATE,
  label: "Counted",
  description: "Every figure here is counted from the firm's own records at this moment.",
  kind: "text",
  defaultValue: "",
  sensitivity: "open",
};

/**
 * What the indexes plate shows while the count is out: the settled anatomy over figures of a
 * plausible width. Counts, not names, so nothing here could be mistaken for a firm's data.
 */
export const SEARCH_STATUS_FIXTURE: SearchStatus = {
  checkedAt: "2026-01-01T12:00:00.000Z",
  records: {
    places: [
      { key: "notes", label: "", matchedFields: [], readBy: [], indexed: 12000, expected: 12000 },
    ],
    rebuild: { requestedAt: null, finishedAt: null, outstanding: false },
  },
  fileContents: {
    turnedOn: true,
    serviceConnected: true,
    filesBelonging: 4800,
    filesIndexed: 4800,
    lastIndexedAt: null,
    dailyCatchUpLimit: 1000,
  },
  searchByMeaning: { turnedOn: false, serviceConnected: false },
};

export const SEARCH_PLACE_STANDING_COLUMN_ID = "standing";

/**
 * The table's columns. The place anchors the row; the standing filter offers the whole vocabulary a
 * place can wear, so a firm with nothing behind today can still ask for what is.
 *
 * What is matched in a place is the row's SECOND LINE and not a column, as a notification
 * category's meaning is: it is a sentence about the row, nobody sorts or filters by it, and as a
 * column it made the table wider than the settings column it sits in.
 */
export function searchablePlaceColumns(): GridColumn<SearchablePlaceRow>[] {
  return [
    { id: "place", label: "Place", anchored: true, value: (row) => row.place },
    { id: "readBy", label: "Read By", filter: "set", value: (row) => row.readBy },
    { id: "indexed", label: "Indexed", type: "number", value: (row) => row.indexed },
    { id: "notIndexed", label: "Not Indexed", type: "number", value: (row) => row.notIndexed },
    {
      id: SEARCH_PLACE_STANDING_COLUMN_ID,
      label: "Standing",
      filter: "set",
      value: (row) => statusEntry(row.standing).label,
      filterValues: STATUS_VOCABULARIES.searchIndexStanding
        .filter((key) => key !== "index-turned-on")
        .map((key) => statusEntry(key).label),
    },
  ];
}
