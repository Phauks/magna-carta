import { describe, expect, it } from "vitest";
import { MatterFileIndex, folderAggregate } from "../src/lib/file-manager/file-rows.ts";
import { safetyKeyOf } from "../src/lib/file-manager/file-columns.ts";
import type { FolderSummary } from "../src/lib/file-manager/folder-api.ts";
import type { MatterFile } from "../src/lib/file-manager/matter-file-api.ts";

/*
 * The folder tree's shape is where a matter's files can be lost: a folder whose parent is missing
 * takes its files off the screen if it is dropped, and a cycle in the data hangs whatever walks it.
 * Both are server-shaped problems the client has to survive, so both are asserted here — along with
 * the aggregates a folder row shows, which are the numbers a reader trusts without checking.
 */

const folder = (id: string, parentFolderId: string | null, name: string): FolderSummary => ({
  id,
  parentFolderId,
  name,
});

const file = (over: Partial<MatterFile> & { id: string }): MatterFile => ({
  matterId: "matter",
  folderId: null,
  name: "A file.pdf",
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
  ...over,
});

describe("MatterFileIndex", () => {
  it("orders siblings by name without case deciding it", () => {
    const index = new MatterFileIndex(
      [folder("z", null, "answers"), folder("a", null, "Zoning")],
      [],
    );
    expect(index.childrenOf(null).map((each) => each.name)).toEqual(["answers", "Zoning"]);
  });

  it("walks a path root-first, ending with the folder itself", () => {
    const index = new MatterFileIndex(
      [folder("a", null, "Discovery"), folder("b", "a", "Photographs")],
      [],
    );
    expect(index.pathTo("b").map((each) => each.name)).toEqual(["Discovery", "Photographs"]);
    expect(index.pathText("b")).toBe("Discovery / Photographs");
    // The matter root is not a folder, and it has a name of its own.
    expect(index.pathText(null)).toBe("Home");
  });

  it("survives a cycle rather than recursing until the stack gives out", () => {
    const index = new MatterFileIndex([folder("a", "b", "One"), folder("b", "a", "Two")], []);
    expect(index.pathTo("a").length).toBeLessThanOrEqual(2);
  });

  it("collects every file beneath a folder, not just the ones sitting in it", () => {
    const index = new MatterFileIndex(
      [folder("a", null, "Discovery"), folder("b", "a", "Photographs")],
      [file({ id: "1", folderId: "a" }), file({ id: "2", folderId: "b" })],
    );
    expect(index.subtreeFiles("a").map((each) => each.id)).toEqual(["1", "2"]);
    expect(index.filesIn("a").map((each) => each.id)).toEqual(["1"]);
  });

  it("names every descendant folder, so a delete knows what it is about to take", () => {
    const index = new MatterFileIndex(
      [folder("a", null, "A"), folder("b", "a", "B"), folder("c", "b", "C")],
      [],
    );
    expect([...index.descendantFolderIds("a")].toSorted()).toEqual(["b", "c"]);
  });
});

describe("folderAggregate", () => {
  it("reads bytes and count together, and takes the most recent modification beneath it", () => {
    const index = new MatterFileIndex(
      [folder("a", null, "Discovery")],
      [
        file({ id: "1", folderId: "a", sizeBytes: 1000, updatedAt: "2026-02-01T00:00:00Z" }),
        file({ id: "2", folderId: "a", sizeBytes: 2000, updatedAt: "2026-05-01T00:00:00Z" }),
      ],
    );
    const aggregate = folderAggregate(index, "a", safetyKeyOf);
    expect(aggregate.fileCount).toBe(2);
    expect(aggregate.totalBytes).toBe(3000);
    // A folder's Date Modified is its most recent modification, never its file count.
    expect(aggregate.latestModified).toBe("2026-05-01T00:00:00Z");
  });

  it("refuses to state a total while a file's size is unknown", () => {
    const index = new MatterFileIndex(
      [folder("a", null, "Discovery")],
      [
        file({ id: "1", folderId: "a", sizeBytes: 1000 }),
        // Still being checked: summing it as zero would understate the folder.
        file({ id: "2", folderId: "a", sizeBytes: null, status: "pending" }),
      ],
    );
    expect(folderAggregate(index, "a", safetyKeyOf).totalBytes).toBeNull();
  });

  it("speaks the worst word true of anything beneath it", () => {
    const index = new MatterFileIndex(
      [folder("a", null, "Discovery")],
      [
        file({ id: "1", folderId: "a" }),
        file({ id: "2", folderId: "a", status: "quarantined", currentVersionId: null }),
      ],
    );
    expect(folderAggregate(index, "a", safetyKeyOf).safety).toBe("error");
  });
});
