import { describe, expect, it } from "vitest";
import type { FileId, FileVersionId, FolderId } from "@magna-carta/identifiers/types";
import type { FolderNode, MatterCleanFile } from "../src/queries.ts";
import { resolveZipSelection } from "../src/zip-composition.ts";

// Pure selection -> version-pinned entries + folder-tree paths. No I/O: the resolver only ever sees
// already-clean files, so a pending/quarantined/deleted version cannot enter the archive by
// construction (the caller's reads are status-gated).

const folder = (id: string, name: string, parent: string | null): FolderNode => ({
  id: id as FolderId,
  parentFolderId: parent as FolderId | null,
  name,
});

const file = (
  id: string,
  name: string,
  folderId: string | null,
  size: number,
): MatterCleanFile => ({
  fileId: id as FileId,
  folderId: folderId as FolderId | null,
  name,
  versionId: `${id}-v` as FileVersionId,
  r2Key: `files/${id}/${id}-v`,
  sizeBytes: size,
});

describe("resolveZipSelection", () => {
  it("bundles the whole matter for an empty selection, with folder-tree paths", () => {
    const folders = [
      folder("folder_a", "Pleadings", null),
      folder("folder_b", "Drafts", "folder_a"),
    ];
    const files = [
      file("file_root", "cover.pdf", null, 10),
      file("file_a", "complaint.pdf", "folder_a", 20),
      file("file_b", "draft.docx", "folder_b", 30),
    ];
    const resolved = resolveZipSelection({}, folders, files);
    expect(resolved.fileCount).toBe(3);
    expect(resolved.totalBytes).toBe(60);
    expect(resolved.entries.map((entry) => entry.path).sort()).toEqual([
      "Pleadings/Drafts/draft.docx",
      "Pleadings/complaint.pdf",
      "cover.pdf",
    ]);
  });

  it("includes a selected folder and every descendant file", () => {
    const folders = [
      folder("folder_a", "Pleadings", null),
      folder("folder_b", "Drafts", "folder_a"),
    ];
    const files = [
      file("file_root", "cover.pdf", null, 10),
      file("file_a", "complaint.pdf", "folder_a", 20),
      file("file_b", "draft.docx", "folder_b", 30),
    ];
    const resolved = resolveZipSelection({ folderIds: ["folder_a" as FolderId] }, folders, files);
    expect(resolved.entries.map((entry) => entry.path).sort()).toEqual([
      "Pleadings/Drafts/draft.docx",
      "Pleadings/complaint.pdf",
    ]);
  });

  it("includes files named directly", () => {
    const files = [
      file("file_root", "cover.pdf", null, 10),
      file("file_a", "complaint.pdf", null, 20),
    ];
    const resolved = resolveZipSelection({ fileIds: ["file_a" as FileId] }, [], files);
    expect(resolved.entries.map((entry) => entry.path)).toEqual(["complaint.pdf"]);
    expect(resolved.entries[0]?.versionId).toBe("file_a-v");
  });

  it("disambiguates duplicate names within the same folder", () => {
    const files = [file("file_1", "report.pdf", null, 10), file("file_2", "report.pdf", null, 20)];
    const resolved = resolveZipSelection({}, [], files);
    expect(resolved.entries.map((entry) => entry.path).sort()).toEqual([
      "report (1).pdf",
      "report.pdf",
    ]);
  });
});
