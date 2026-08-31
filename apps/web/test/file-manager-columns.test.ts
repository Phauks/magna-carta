import { describe, expect, it } from "vitest";
import { statusEntry } from "@magna-carta/design-system/status-register";
import {
  browseColumns,
  fileExtension,
  safetyKeyOf,
  FILE_COLUMN_IDENTIFIERS,
} from "../src/lib/file-manager/file-columns.ts";
import {
  MatterFileIndex,
  fileKey,
  type FileManagerRow,
} from "../src/lib/file-manager/file-rows.ts";
import type { MatterFile } from "../src/lib/file-manager/matter-file-api.ts";

/*
 * What the Safety column is allowed to say, and what the File Type column shows.
 *
 * These two carry settled rulings that are easy to undo by accident. Safety's value set is exactly
 * the status register's safety words, and the grading order is the order the facts overrule each
 * other. File Type is always the EXTENSION, never a category word we invented for it — that ruling
 * has been re-issued more than once because a category reads friendlier and is wrong.
 */

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
  ...over,
});

const rowFor = (each: MatterFile): FileManagerRow => ({
  kind: "file",
  key: fileKey(each.id),
  file: each,
});

describe("safetyKeyOf", () => {
  it("grades a rejected file an error whatever else is true of it", () => {
    expect(safetyKeyOf(file({ id: "1", status: "quarantined", currentVersionId: null }))).toBe(
      "error",
    );
    expect(safetyKeyOf(file({ id: "2", scanVerdict: "flagged" }))).toBe("error");
  });

  it("has nothing to grade while no version is committed", () => {
    expect(safetyKeyOf(file({ id: "1", status: "pending", currentVersionId: null }))).toBe(
      "warning",
    );
  });

  it("states the plain fact when nothing has scanned the file", () => {
    // Never graded a Warning: "Not scanned" is the unscanned file's own word.
    expect(safetyKeyOf(file({ id: "1", scanVerdict: "unscanned" }))).toBe("not-scanned");
    expect(safetyKeyOf(file({ id: "2", scanVerdict: null }))).toBe("not-scanned");
  });

  it("puts a clean file with no document type in the info band", () => {
    expect(safetyKeyOf(file({ id: "1", documentTypeId: null }))).toBe("info");
  });

  it("gives a clean, typed file the bare mark and no word", () => {
    expect(safetyKeyOf(file({ id: "1" }))).toBe("clean");
    expect(statusEntry(safetyKeyOf(file({ id: "1" }))).presentation).toBe("mark");
  });

  it("says nothing outside the register's safety vocabulary", () => {
    const every = [
      file({ id: "1" }),
      file({ id: "2", documentTypeId: null }),
      file({ id: "3", scanVerdict: "unscanned" }),
      file({ id: "4", status: "pending", currentVersionId: null }),
      file({ id: "5", status: "quarantined", currentVersionId: null }),
    ].map((each) => statusEntry(safetyKeyOf(each)).label);
    expect(new Set(every)).toEqual(new Set(["Clean", "Info", "Not scanned", "Warning", "Error"]));
  });
});

describe("fileExtension", () => {
  it("is the extension, never a category word", () => {
    expect(fileExtension(file({ id: "1", name: "Motion.docx" }))).toBe("docx");
    expect(fileExtension(file({ id: "2", name: "Site.MP4" }))).toBe("mp4");
    // .doc and .docx are different internals and the extension tells them apart on its own.
    expect(fileExtension(file({ id: "3", name: "Old.doc" }))).toBe("doc");
  });

  it("falls back to what the sniffed type implies, and to blank rather than a stand-in word", () => {
    expect(
      fileExtension(file({ id: "1", name: "scan", sniffedContentType: "application/pdf" })),
    ).toBe("pdf");
    expect(fileExtension(file({ id: "2", name: "scan", sniffedContentType: null }))).toBe("");
  });
});

describe("browseColumns", () => {
  const context = {
    index: new MatterFileIndex([], []),
    hideExtensions: false,
    documentTypeName: (documentTypeId: string | null) =>
      documentTypeId === null ? "" : "Pleading",
    createdBy: () => "",
  };

  it("names the date columns in full", () => {
    const labels = browseColumns(context).map((column) => column.label);
    expect(labels).toContain("Date Modified");
    expect(labels).toContain("Date Created");
    expect(labels).not.toContain("Modified");
    expect(labels).not.toContain("Created");
  });

  it("calls the author column Created By, because an upload is an act of creation", () => {
    const labels = browseColumns(context).map((column) => column.label);
    expect(labels).toContain("Created By");
    expect(labels).not.toContain("Uploaded By");
  });

  it("renders a version as a bare number", () => {
    const column = browseColumns(context).find(
      (each) => each.id === FILE_COLUMN_IDENTIFIERS.version,
    );
    expect(column?.text?.(rowFor(file({ id: "1", versionNumber: 12 })))).toBe("12");
  });

  it("leaves an unset document type blank rather than naming it", () => {
    const column = browseColumns(context).find(
      (each) => each.id === FILE_COLUMN_IDENTIFIERS.documentType,
    );
    expect(column?.value(rowFor(file({ id: "1", documentTypeId: null })))).toBe("");
  });

  it("gives every column one of the one filter mechanism's controls", () => {
    // No column carries a filter of its own: each names which shared control fits its values.
    for (const column of browseColumns(context)) {
      expect(["text", "set", "range", "dateRange"]).toContain(column.filter);
    }
  });

  it("keeps Location off in a folder listing and Name always on", () => {
    const columns = browseColumns(context);
    expect(columns.find((each) => each.id === FILE_COLUMN_IDENTIFIERS.location)?.hidden).toBe(true);
    expect(columns.find((each) => each.id === FILE_COLUMN_IDENTIFIERS.name)?.anchored).toBe(true);
  });
});
