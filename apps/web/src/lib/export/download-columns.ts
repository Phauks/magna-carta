/*
 * The download register's columns — what a download says about itself.
 *
 * The grid is the product's one table, so nothing about sorting, filtering, hiding, reordering,
 * pinning, resizing or totalling is decided here. This file says only WHAT the columns are.
 *
 * WHY THIS SCREEN NEEDED A TABLE AT ALL. The register used to hold one kind of thing — an export the
 * platform made — and a fixed list of seven columns was enough for it. It now holds every download:
 * a file taken from a matter, a bundle, a converted file, a discovery production's manifest, an
 * export. Those answer different questions, and no one fixed arrangement serves them all. Somebody
 * hunting last Tuesday's spreadsheet wants the name and the day; somebody asking what they pulled
 * off a matter before a hearing wants the type and the source. So the columns are declared and the
 * READER chooses — which is the platform's standard answer, not a special case for this screen.
 *
 * TYPE AND STANDING BOTH DECLARE THEIR VOCABULARIES rather than reading them off the rows in hand.
 * A member with no conversions loaded this week can still have made one, and a set filter that
 * dropped "Converted File" because none was on screen would be telling them the register cannot
 * hold one. The grid takes a declared vocabulary, counts each value honestly (zero included), and
 * lists anything else after it.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { formatInstant } from "@magna-carta/design-system/formatters";
import type { ShelfItem, ShelfItemProducer, ShelfItemState } from "./download-shelf.ts";

/** Column ids, spelled in full, so a test and a stored layout name the same thing as the code. */
export const DOWNLOAD_COLUMN_IDENTIFIERS = {
  title: "title",
  producer: "producer",
  standing: "standing",
  requestedFormat: "requestedFormat",
  downloadedFormats: "downloadedFormats",
  byteSize: "byteSize",
  createdAt: "createdAt",
  expiresAt: "expiresAt",
  actions: "actions",
} as const;

/** The register opens on what was taken most recently, which is what somebody came back for. */
export const DOWNLOAD_REGISTER_INITIAL_SORT = {
  columnId: DOWNLOAD_COLUMN_IDENTIFIERS.createdAt,
  direction: "descending",
} as const;

/** What each producer is called on the screen. The register's whole vocabulary, declared. */
export const PRODUCER_LABELS: Record<ShelfItemProducer, string> = {
  export: "Export",
  bundle: "File Bundle",
  conversion: "Converted File",
  file: "Matter File",
  discovery: "Discovery",
};

export const PRODUCER_CHOICES: readonly string[] = Object.values(PRODUCER_LABELS);

/*
 * WHAT A ROW'S STANDING MEANS, which is the column this register could not do without.
 *
 * Now that the row outlives the bytes, "is this still here" stopped being answerable from the other
 * columns. Four words, and each is a different answer to "can I have it again":
 *
 *   Available — the bytes are there, take it.
 *   Preparing — the work was asked for and is still running; it will become available.
 *   On the matter — a file that was never the register's to hold. Still downloadable, through the
 *     matter, and only for as long as that matter is yours: the register is not a way around it.
 *   Record only — it happened and there is nothing to come back to, either because the bytes were
 *     streamed and never kept or because the window has closed.
 */
export function downloadStanding(item: ShelfItem): string {
  if (item.kind === "reference") return "On the matter";
  if (item.kind === "record") return "Record only";
  if (item.state === "ready") return "Available";
  if (item.state === "building") return "Preparing";
  return "Record only";
}

export const STANDING_CHOICES: readonly string[] = [
  "Available",
  "Preparing",
  "On the matter",
  "Record only",
];

/** Whether this row can be taken again at all — what the Download control is offered from. */
export function isTakeable(item: ShelfItem): boolean {
  if (item.kind === "record") return false;
  if (item.kind === "reference") return item.subjectFileId !== null;
  return item.state === "ready";
}

const formatFormats = (formats: readonly string[]): string =>
  formats.length === 0 ? "" : formats.map((entry) => entry.toUpperCase()).join(", ");

/*
 * Bytes as the reader reads them. Deliberately not the file manager's formatter: that one is about
 * files on a matter and this column is often empty — a snapshot has no size until somebody renders
 * it, and a record never had one — so an empty cell has to read as "not a number we have" rather
 * than as zero.
 */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit] ?? "KB"}`;
}

const STATE_IS_TERMINAL: Record<ShelfItemState, boolean> = {
  building: false,
  ready: false,
  failed: true,
  expired: true,
};

export function downloadRegisterColumns(): readonly GridColumn<ShelfItem>[] {
  return [
    {
      // The anchor: whatever else is hidden, the reader can always see WHAT it was. A register whose
      // first column can be turned off is a list of dates.
      id: DOWNLOAD_COLUMN_IDENTIFIERS.title,
      label: "Name",
      type: "text",
      anchored: true,
      value: (item) => item.title,
    },
    {
      id: DOWNLOAD_COLUMN_IDENTIFIERS.producer,
      label: "Type",
      type: "text",
      filter: "set",
      filterValues: PRODUCER_CHOICES,
      value: (item) => PRODUCER_LABELS[item.producer] ?? item.producer,
    },
    {
      id: DOWNLOAD_COLUMN_IDENTIFIERS.standing,
      label: "Standing",
      type: "text",
      filter: "set",
      filterValues: STANDING_CHOICES,
      value: downloadStanding,
    },
    {
      id: DOWNLOAD_COLUMN_IDENTIFIERS.createdAt,
      label: "Taken",
      type: "date",
      value: (item) => new Date(item.createdAt),
      text: (item) => formatInstant(item.createdAt),
    },
    {
      id: DOWNLOAD_COLUMN_IDENTIFIERS.downloadedFormats,
      label: "Downloaded",
      type: "text",
      // A blank cell is the real answer for an item nobody has fetched yet, which is why this
      // column is worth having at all: it is the difference between a shelf and a pile.
      value: (item) => formatFormats(item.downloadedFormats),
    },
    {
      id: DOWNLOAD_COLUMN_IDENTIFIERS.requestedFormat,
      label: "Format",
      type: "text",
      // Only an export was ever made FOR a format, so this is empty on most rows and starts hidden.
      hidden: true,
      value: (item) => (item.requestedFormat === null ? "" : item.requestedFormat.toUpperCase()),
    },
    {
      id: DOWNLOAD_COLUMN_IDENTIFIERS.byteSize,
      label: "Size",
      type: "number",
      hidden: true,
      value: (item) => item.byteSize,
      text: (item) => formatBytes(item.byteSize),
    },
    {
      id: DOWNLOAD_COLUMN_IDENTIFIERS.expiresAt,
      label: "Available Until",
      type: "date",
      hidden: true,
      // Null where there is nothing of the register's to expire — a matter file, or a record. The
      // cell is empty rather than reading as an item that never goes away, which would be a promise
      // about somebody else's object.
      value: (item) => (item.expiresAt === null ? null : new Date(item.expiresAt)),
      text: (item) =>
        item.expiresAt === null
          ? ""
          : STATE_IS_TERMINAL[item.state]
            ? "Gone"
            : formatInstant(item.expiresAt),
    },
    {
      // What can be DONE with the row, stuck to the trailing edge so it stays in reach however far
      // the reader has scrolled the register sideways. It holds no value of its own, so it neither
      // sorts nor filters: the surface renders its controls from the cell snippet.
      id: DOWNLOAD_COLUMN_IDENTIFIERS.actions,
      label: "Actions",
      type: "text",
      filter: "none",
      align: "end",
      pinnedEnd: true,
      value: () => null,
      text: () => "",
    },
  ];
}
