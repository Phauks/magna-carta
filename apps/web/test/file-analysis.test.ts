/*
 * The type-mismatch finding, asserted as the rule states it: the icon beside a name draws what the
 * name CLAIMS, so this finding is the only place a name that lies about its bytes is said. It is
 * graded in the design system's own file-type vocabulary, at the level of kind, so a list kept here
 * cannot drift from the mapping the icon and the File Type column read.
 */
import { describe, expect, it } from "vitest";
import { issuesOnFile } from "../src/lib/file-manager/file-analysis.ts";
import type { MatterFile } from "../src/lib/file-manager/matter-file-api.ts";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function file(overrides: Partial<MatterFile> = {}): MatterFile {
  return {
    id: "file_01",
    matterId: "matter_01",
    folderId: null,
    name: "Motion.docx",
    documentTypeId: null,
    currentVersionId: "fileVersion_01",
    createdAt: "2026-03-02T10:00:00.000Z",
    updatedAt: "2026-03-02T10:00:00.000Z",
    versionNumber: 1,
    sizeBytes: 4096,
    sniffedContentType: DOCX,
    scanVerdict: "clean",
    status: "clean",
    quarantineReason: null,
    sourceModifiedAt: null,
    uploadedBy: null,
    uploadedByName: null,
    ...overrides,
  };
}

describe("the type-mismatch finding", () => {
  it("is silent where the name and the bytes agree", () => {
    expect(issuesOnFile(file())).toEqual([]);
    expect(issuesOnFile(file({ name: "Exhibit.jpg", sniffedContentType: "image/jpeg" }))).toEqual(
      [],
    );
  });

  it("fires where a recognized extension names a different kind from the bytes", () => {
    expect(issuesOnFile(file({ name: "Motion.pdf" }))).toEqual(["mismatch"]);
    expect(
      issuesOnFile(file({ name: "Invoice.pdf", sniffedContentType: "application/x-msdownload" })),
    ).toEqual(["mismatch"]);
  });

  it("fires where the extension is one nobody recognizes, because that is still a claim", () => {
    // A Word document renamed to end in ".do": the icon draws the blank sheet the name earns, and
    // this is where the row says the bytes are a Word document.
    expect(issuesOnFile(file({ name: "Motion.do" }))).toEqual(["mismatch"]);
  });

  it("grades by kind, so the same kind in a different format is not a lie", () => {
    // A docx sniffed as the legacy Word type is still a Word document; telling doc from docx is
    // the badge's job, not this finding's.
    expect(
      issuesOnFile(file({ name: "Motion.docx", sniffedContentType: "application/msword" })),
    ).toEqual([]);
    expect(issuesOnFile(file({ name: "Photo.jpg", sniffedContentType: "image/png" }))).toEqual([]);
  });

  it("stays silent where the name makes no claim", () => {
    expect(issuesOnFile(file({ name: "Motion" }))).toEqual([]);
    expect(issuesOnFile(file({ name: ".gitignore" }))).toEqual([]);
  });

  it("stays silent where the bytes gave no reading", () => {
    // No sniff at all; a container the sniffer cannot see inside; a type the vocabulary has no
    // kind for. None of these is a reading the name can contradict.
    expect(issuesOnFile(file({ name: "Notes.txt", sniffedContentType: null }))).toEqual([]);
    expect(
      issuesOnFile(file({ name: "Retainer.doc", sniffedContentType: "application/x-cfb" })),
    ).toEqual([]);
    expect(
      issuesOnFile(file({ name: "Motion.do", sniffedContentType: "application/octet-stream" })),
    ).toEqual([]);
  });

  it("ranks the mismatch after a signature match and before the warnings", () => {
    expect(
      issuesOnFile(file({ name: "Motion.do", scanVerdict: "flagged", status: "quarantined" })),
    ).toEqual(["signature", "mismatch"]);
    expect(issuesOnFile(file({ name: "Motion.do", scanVerdict: "unscanned" }))).toEqual([
      "mismatch",
      "unscanned",
    ]);
  });
});
