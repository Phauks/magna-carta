/*
 * The file surface's presentation logic, pinned. The server returns folders FLAT, so the tree and
 * the breadcrumb path are composed on the client — and the interesting cases are the ones the happy
 * path never shows: a folder whose parent is missing, and a parent cycle. The server forbids a cycle
 * on write, but a client that trusted that and recursed would hang the tab rather than degrade, so
 * both walks are pinned as terminating.
 */
import { describe, expect, it } from "vitest";
import type { FileSummary, FolderSummary } from "@magna-carta/api-client";
import {
  buildFolderTree,
  fileStatusPresentation,
  folderAncestry,
  formatFileSize,
  hasReadableContent,
} from "../src/lib/files/file-presentation.ts";

function folder(id: string, name: string, parentFolderId: string | null = null): FolderSummary {
  return { id, name, parentFolderId };
}

function file(overrides: Partial<FileSummary> = {}): FileSummary {
  return {
    id: "file_1",
    matterId: "mat_1",
    folderId: null,
    name: "Complaint.pdf",
    documentTypeId: null,
    currentVersionId: "fver_1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    versionNumber: 1,
    sizeBytes: 2048,
    sniffedContentType: "application/pdf",
    scanVerdict: "clean",
    status: "clean",
    quarantineReason: null,
    ...overrides,
  };
}

describe("formatFileSize", () => {
  it("reads whole bytes below a kilobyte and scales to the natural unit above it", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("renders an unknown size as a dash rather than a zero", () => {
    // A pending upload has no size yet; "0 B" would be a claim, a dash is the absence.
    expect(formatFileSize(null)).toBe("—");
  });
});

describe("buildFolderTree", () => {
  it("nests children under their parent, each level sorted by name", () => {
    const tree = buildFolderTree([
      folder("fld_pleadings", "Pleadings"),
      folder("fld_motions", "Motions", "fld_pleadings"),
      folder("fld_answers", "Answers", "fld_pleadings"),
      folder("fld_discovery", "Discovery"),
    ]);

    expect(tree.map((node) => node.label)).toEqual(["Discovery", "Pleadings"]);
    const pleadings = tree.find((node) => node.label === "Pleadings");
    expect(pleadings?.children?.map((node) => node.label)).toEqual(["Answers", "Motions"]);
  });

  it("leaves a childless folder without a children array, so the tree draws no twisty", () => {
    const tree = buildFolderTree([folder("fld_solo", "Correspondence")]);
    expect(tree[0]?.children).toBeUndefined();
  });

  it("re-seats a folder whose parent is absent at the root rather than dropping it", () => {
    // A folder the member cannot navigate to is worse than one shown a level too high.
    const tree = buildFolderTree([folder("fld_orphan", "Orphan", "fld_missing")]);
    expect(tree.map((node) => node.label)).toEqual(["Orphan"]);
  });

  it("terminates on a parent cycle instead of recursing forever", () => {
    const tree = buildFolderTree([folder("fld_a", "A", "fld_b"), folder("fld_b", "B", "fld_a")]);
    // Neither can be a root by its own parent link, so the cycle yields no roots — and, crucially,
    // the call returns at all.
    expect(Array.isArray(tree)).toBe(true);
  });

  it("treats a folder that is its own parent as a root", () => {
    const tree = buildFolderTree([folder("fld_self", "Self", "fld_self")]);
    expect(tree.map((node) => node.label)).toEqual(["Self"]);
  });
});

describe("folderAncestry", () => {
  const folders = [
    folder("fld_pleadings", "Pleadings"),
    folder("fld_motions", "Motions", "fld_pleadings"),
    folder("fld_sealed", "Sealed", "fld_motions"),
  ];

  it("returns the path root-first, ending at the folder itself", () => {
    expect(folderAncestry(folders, "fld_sealed").map((entry) => entry.name)).toEqual([
      "Pleadings",
      "Motions",
      "Sealed",
    ]);
  });

  it("has no path at the root", () => {
    expect(folderAncestry(folders, null)).toEqual([]);
  });

  it("has no path for a folder it has never heard of", () => {
    expect(folderAncestry(folders, "fld_unknown")).toEqual([]);
  });

  it("terminates on a cycle", () => {
    const cyclic = [folder("fld_a", "A", "fld_b"), folder("fld_b", "B", "fld_a")];
    expect(folderAncestry(cyclic, "fld_a").map((entry) => entry.name)).toEqual(["B", "A"]);
  });
});

describe("fileStatusPresentation", () => {
  it("gives the ordinary clean file no chip at all", () => {
    expect(fileStatusPresentation(file())).toBeNull();
  });

  it("marks an in-flight file as processing", () => {
    const presentation = fileStatusPresentation(
      file({ status: "pending", currentVersionId: null }),
    );
    expect(presentation).toEqual({ label: "Processing", variant: "info", detail: null });
  });

  it("marks a quarantined file as rejected and carries its reason", () => {
    // The whole point of listing a quarantined row: it must say so where the member dropped it.
    const presentation = fileStatusPresentation(
      file({ status: "quarantined", currentVersionId: null, quarantineReason: "EICAR test file" }),
    );
    expect(presentation).toEqual({
      label: "Rejected",
      variant: "danger",
      detail: "EICAR test file",
    });
  });
});

describe("hasReadableContent", () => {
  it("is true only for a clean file with a committed version", () => {
    expect(hasReadableContent(file())).toBe(true);
  });

  it("is false for a quarantined file, which has no current version to reach", () => {
    expect(hasReadableContent(file({ status: "quarantined", currentVersionId: null }))).toBe(false);
  });

  it("is false for a pending file, whose bytes have not committed", () => {
    expect(hasReadableContent(file({ status: "pending", currentVersionId: null }))).toBe(false);
  });

  it("is false for a clean row that somehow carries no version pointer", () => {
    expect(hasReadableContent(file({ currentVersionId: null }))).toBe(false);
  });
});
