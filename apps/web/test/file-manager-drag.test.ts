import { describe, expect, it } from "vitest";
import {
  MATTER_ROOT_DROP_KEY,
  canLandIn,
  destinationFolderIdOf,
  dragDescription,
  dropKeyOfFolder,
  landableKeys,
} from "../src/lib/file-manager/file-drag.ts";
import {
  MatterFileIndex,
  fileKey,
  folderKey,
  type FileManagerRow,
} from "../src/lib/file-manager/file-rows.ts";
import type { FolderSummary } from "../src/lib/file-manager/folder-api.ts";
import type { MatterFile } from "../src/lib/file-manager/matter-file-api.ts";

/*
 * Where a dragged row may land. These are the refusals a reader never sees stated in words — the
 * pointer simply says no — so they are worth pinning here rather than trusting to a gesture nobody
 * can replay. The one that matters most is a folder into its own descendant: it detaches the branch
 * from the matter, nothing downstream notices, and the documents inside it are reachable from
 * nowhere.
 */

const folder = (id: string, parentFolderId: string | null, name: string): FolderSummary => ({
  id,
  parentFolderId,
  name,
});

const file = (id: string, folderId: string | null): MatterFile => ({
  id,
  matterId: "matter",
  folderId,
  name: `${id}.pdf`,
  documentTypeId: "type",
  currentVersionId: "version",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  versionNumber: 1,
  sizeBytes: 100,
  sniffedContentType: "application/pdf",
  scanVerdict: "clean",
  status: "clean",
  quarantineReason: null,
  sourceModifiedAt: null,
  uploadedBy: null,
  uploadedByName: null,
});

const FOLDERS = [
  folder("discovery", null, "Discovery"),
  folder("depositions", "discovery", "Depositions"),
  folder("north", "depositions", "North Elevation"),
  folder("correspondence", null, "Correspondence"),
];

const FILES = [
  file("pleading", null),
  file("transcript", "depositions"),
  file("letter", "correspondence"),
];

const index = new MatterFileIndex(FOLDERS, FILES);

const rows = new Map<string, FileManagerRow>([
  ...FOLDERS.map(
    (entry) =>
      [folderKey(entry.id), { kind: "folder", key: folderKey(entry.id), folder: entry }] as const,
  ),
  ...FILES.map(
    (entry) => [fileKey(entry.id), { kind: "file", key: fileKey(entry.id), file: entry }] as const,
  ),
]);

const rowOf = (key: string): FileManagerRow | null => rows.get(key) ?? null;
const rowFor = (key: string): FileManagerRow => {
  const row = rowOf(key);
  if (row === null) throw new Error(`no row named ${key}`);
  return row;
};

describe("naming a destination", () => {
  it("gives the matter root a key of its own, because it is not a row", () => {
    expect(dropKeyOfFolder(null)).toBe(MATTER_ROOT_DROP_KEY);
    expect(destinationFolderIdOf(MATTER_ROOT_DROP_KEY)).toBeNull();
  });

  it("round-trips a folder through the same key the list uses for its row", () => {
    expect(dropKeyOfFolder("discovery")).toBe(folderKey("discovery"));
    expect(destinationFolderIdOf(folderKey("discovery"))).toBe("discovery");
  });

  it("answers that a FILE is not a destination, which is not the same as the root", () => {
    // Collapsing the two would let a file row accept a drop and send it to the matter root.
    expect(destinationFolderIdOf(fileKey("pleading"))).toBeUndefined();
  });
});

describe("whether a row can be moved into a folder", () => {
  it("refuses a folder into itself", () => {
    expect(canLandIn(index, rowFor(folderKey("discovery")), "discovery")).toBe(false);
  });

  it("refuses a folder into its own descendant, at any depth", () => {
    expect(canLandIn(index, rowFor(folderKey("discovery")), "depositions")).toBe(false);
    expect(canLandIn(index, rowFor(folderKey("discovery")), "north")).toBe(false);
  });

  it("refuses anything into the folder it is already in", () => {
    expect(canLandIn(index, rowFor(fileKey("transcript")), "depositions")).toBe(false);
    expect(canLandIn(index, rowFor(fileKey("pleading")), null)).toBe(false);
    expect(canLandIn(index, rowFor(folderKey("depositions")), "discovery")).toBe(false);
  });

  it("allows a real move, out to the root included", () => {
    expect(canLandIn(index, rowFor(fileKey("transcript")), "correspondence")).toBe(true);
    expect(canLandIn(index, rowFor(fileKey("transcript")), null)).toBe(true);
    expect(canLandIn(index, rowFor(folderKey("north")), null)).toBe(true);
    expect(canLandIn(index, rowFor(folderKey("depositions")), "correspondence")).toBe(true);
  });
});

describe("what a selection can put down on one destination", () => {
  it("carries only the rows that can land, and leaves the rest where they are", () => {
    const dragged = [fileKey("transcript"), fileKey("letter"), fileKey("pleading")];
    // The letter already sits in Correspondence; the other two do not.
    expect(landableKeys(index, dragged, folderKey("correspondence"), rowOf)).toEqual([
      fileKey("transcript"),
      fileKey("pleading"),
    ]);
  });

  it("refuses the whole gesture when the destination is not a folder", () => {
    expect(landableKeys(index, [fileKey("transcript")], fileKey("pleading"), rowOf)).toEqual([]);
  });

  it("refuses a row this surface can no longer place", () => {
    // A deleted file, a changelog entry, a row inside an archive: none of them is a thing that moves.
    expect(landableKeys(index, ["file:gone"], folderKey("correspondence"), rowOf)).toEqual([]);
  });

  it("keeps the order the selection was gathered in", () => {
    const dragged = [fileKey("pleading"), folderKey("north"), fileKey("transcript")];
    expect(landableKeys(index, dragged, folderKey("correspondence"), rowOf)).toEqual(dragged);
  });
});

describe("what the drag image says", () => {
  it("names the kind when a selection is all of one, and items when it is mixed", () => {
    expect(dragDescription([fileKey("a"), fileKey("b")])).toBe("2 files");
    expect(dragDescription([folderKey("a")])).toBe("1 folder");
    expect(dragDescription([folderKey("a"), fileKey("b"), fileKey("c")])).toBe("3 items");
  });
});
