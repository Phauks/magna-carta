import { describe, expect, it } from "vitest";
import type { GridColumn, GridSortDirection } from "@magna-carta/design-system/data-table";
import {
  MatterFileIndex,
  fileKey,
  folderKey,
  orderFolderRowsFirst,
  type FileManagerRow,
} from "../src/lib/file-manager/file-rows.ts";
import { browseColumns, FILE_COLUMN_IDENTIFIERS } from "../src/lib/file-manager/file-columns.ts";
import type { FolderSummary } from "../src/lib/file-manager/folder-api.ts";
import type { MatterFile } from "../src/lib/file-manager/matter-file-api.ts";

/*
 * Folders sort separately from files, in every view that lists the two side by side.
 *
 * The rule is easy to undo by accident, because undoing it looks like a simplification: hand the
 * grid the rows and let one comparator order the lot. So what is pinned here is that the kind
 * boundary survives a DESCENDING sort (the direction that would flip it if it were a sort key),
 * that it holds on a column other than the name (the shape the correction is usually read down to),
 * and that the comparator still decides everything inside each run.
 */

const folder = (id: string, name: string): FolderSummary => ({
  id,
  parentFolderId: null,
  name,
});

const file = (id: string, name: string, sizeBytes: number | null): MatterFile => ({
  id,
  matterId: "matter",
  folderId: null,
  name,
  documentTypeId: "type",
  currentVersionId: "version",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  versionNumber: 1,
  sizeBytes,
  sniffedContentType: "application/pdf",
  scanVerdict: "clean",
  status: "clean",
  quarantineReason: null,
  sourceModifiedAt: null,
  uploadedBy: null,
  uploadedByName: null,
});

const APPLES = folder("apples", "Apples");
const ZEBRAS = folder("zebras", "Zebras");
const BETA = file("beta", "Beta.pdf", 300);
const YANKEE = file("yankee", "Yankee.pdf", 100);
const UNSIZED = file("unsized", "Unsized.pdf", null);

const FOLDERS = [APPLES, ZEBRAS];
const FILES = [BETA, YANKEE, UNSIZED];

const ROWS: FileManagerRow[] = [
  { kind: "file", key: fileKey("beta"), file: BETA },
  { kind: "folder", key: folderKey("zebras"), folder: ZEBRAS },
  { kind: "file", key: fileKey("yankee"), file: YANKEE },
  { kind: "folder", key: folderKey("apples"), folder: APPLES },
];

/*
 * The grid's own comparator lives behind the design system's data-table entry, which loads Svelte
 * components this node-only suite cannot. Its rule is small enough to restate: the column's value,
 * empties last, the row key as the tiebreak. The grid pins the real one in its own suite.
 */
function comparator(
  column: GridColumn<FileManagerRow>,
  direction: GridSortDirection,
): (left: FileManagerRow, right: FileManagerRow) => number {
  const sign = direction === "descending" ? -1 : 1;
  return (left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    if (a == null || a === "") return b == null || b === "" ? 0 : 1;
    if (b == null || b === "") return -1;
    const comparison =
      typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    return comparison === 0 ? left.key.localeCompare(right.key) : comparison * sign;
  };
}

const columns = browseColumns({
  index: new MatterFileIndex(FOLDERS, FILES),
  hideExtensions: false,
  documentTypeName: () => "Correspondence",
  createdBy: () => "Someone",
});

const columnNamed = (id: string): GridColumn<FileManagerRow> =>
  columns.find((column) => column.id === id) as GridColumn<FileManagerRow>;

const nameColumn = columnNamed(FILE_COLUMN_IDENTIFIERS.name);
const sizeColumn = columnNamed(FILE_COLUMN_IDENTIFIERS.size);

const named = (rows: readonly FileManagerRow[]): string[] =>
  rows.map((row) => (row.kind === "folder" ? row.folder.name : row.file.name));

describe("orderFolderRowsFirst", () => {
  it("leads with the folders when the name sorts up", () => {
    expect(named(orderFolderRowsFirst(ROWS, comparator(nameColumn, "ascending")))).toEqual([
      "Apples",
      "Zebras",
      "Beta.pdf",
      "Yankee.pdf",
    ]);
  });

  it("still leads with the folders when the name sorts down", () => {
    // The direction reverses the names WITHIN each run. It is not allowed to lift a file over a
    // folder: the boundary between the two kinds is not a value the sort may flip.
    expect(named(orderFolderRowsFirst(ROWS, comparator(nameColumn, "descending")))).toEqual([
      "Zebras",
      "Apples",
      "Yankee.pdf",
      "Beta.pdf",
    ]);
  });

  it("holds on a column that is not the name, in both directions", () => {
    const sized: FileManagerRow[] = [
      ...ROWS,
      { kind: "file", key: fileKey("unsized"), file: UNSIZED },
    ];
    // Neither folder holds a file, so both size to zero and tie-break on their key.
    expect(named(orderFolderRowsFirst(sized, comparator(sizeColumn, "ascending")))).toEqual([
      "Apples",
      "Zebras",
      "Yankee.pdf",
      "Beta.pdf",
      "Unsized.pdf",
    ]);
    expect(named(orderFolderRowsFirst(sized, comparator(sizeColumn, "descending")))).toEqual([
      "Apples",
      "Zebras",
      "Beta.pdf",
      "Yankee.pdf",
      // A file with no size yet stays last in both directions, as it does in a flat sort.
      "Unsized.pdf",
    ]);
  });

  it("orders a run of one kind exactly as the comparator would", () => {
    const filesOnly = ROWS.filter((row) => row.kind === "file");
    expect(named(orderFolderRowsFirst(filesOnly, comparator(nameColumn, "ascending")))).toEqual([
      "Beta.pdf",
      "Yankee.pdf",
    ]);
    const foldersOnly = ROWS.filter((row) => row.kind === "folder");
    expect(named(orderFolderRowsFirst(foldersOnly, comparator(nameColumn, "descending")))).toEqual([
      "Zebras",
      "Apples",
    ]);
    expect(orderFolderRowsFirst([], comparator(nameColumn, "ascending"))).toEqual([]);
  });

  it("keeps the order it was given when there is no sort column", () => {
    // A null sort column reaches the arrangement as a comparator that answers 0 for every pair.
    // The runs still separate; nothing inside either one moves.
    expect(named(orderFolderRowsFirst(ROWS, () => 0))).toEqual([
      "Zebras",
      "Apples",
      "Beta.pdf",
      "Yankee.pdf",
    ]);
  });

  it("leaves pinning alone: a pinned file is still lifted above the folders", () => {
    // Pinning is the reader's own arranging and the grid applies it AFTER this ordering, over the
    // rows it returns. Restated here with the grid's rule so the two cannot drift apart: the
    // pinned keys lead, in the reader's order, and the rest follow folders-first.
    const ordered = orderFolderRowsFirst(ROWS, comparator(nameColumn, "ascending"));
    const pinned = [fileKey("yankee")];
    const grouped = [
      ...ordered.filter((row) => pinned.includes(row.key)),
      ...ordered.filter((row) => !pinned.includes(row.key)),
    ];
    expect(named(grouped)).toEqual(["Yankee.pdf", "Apples", "Zebras", "Beta.pdf"]);
  });
});
