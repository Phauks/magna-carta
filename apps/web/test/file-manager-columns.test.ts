import { describe, expect, it } from "vitest";
import { fileTypeExtension, sortDocuments } from "../src/lib/file-manager/file-columns.ts";
import type { DocumentSummary } from "../src/lib/documents/document-api.ts";

/*
 * The list's sort. Two of these branches matter beyond tidiness: a size that is not known yet must
 * not sort as zero (a still-processing file would land among the empty ones), and Safety must put
 * what needs attention at the top rather than in alphabetical order.
 */

const document = (over: Partial<DocumentSummary>): DocumentSummary => ({
  id: over.name ?? "id",
  matterId: "matter",
  folderId: null,
  name: "A file.pdf",
  currentVersionId: "version",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  versionNumber: 1,
  sizeBytes: 100,
  sniffedContentType: "application/pdf",
  status: "clean",
  quarantineReason: null,
  ...over,
});

describe("sortDocuments", () => {
  it("sorts by name without case deciding it", () => {
    const rows = sortDocuments(
      [document({ name: "zoning.pdf" }), document({ name: "Answer.pdf" })],
      "name",
      1,
    );
    expect(rows.map((row) => row.name)).toEqual(["Answer.pdf", "zoning.pdf"]);
  });

  it("puts an unknown size below every known size, not among the empty files", () => {
    const rows = sortDocuments(
      [document({ name: "known", sizeBytes: 0 }), document({ name: "unknown", sizeBytes: null })],
      "size",
      1,
    );
    expect(rows.map((row) => row.name)).toEqual(["unknown", "known"]);
  });

  it("sorts Safety worst-first, so what needs attention is at the top", () => {
    const rows = sortDocuments(
      [
        document({ name: "clean", status: "clean" }),
        document({ name: "quarantined", status: "quarantined" }),
        document({ name: "pending", status: "pending" }),
      ],
      "safety",
      1,
    );
    expect(rows.map((row) => row.name)).toEqual(["quarantined", "pending", "clean"]);
  });

  it("falls back to the name so an equal column still has a stable order", () => {
    const rows = sortDocuments(
      [document({ name: "b", versionNumber: 1 }), document({ name: "a", versionNumber: 1 })],
      "version",
      1,
    );
    expect(rows.map((row) => row.name)).toEqual(["a", "b"]);
  });
});

describe("fileTypeExtension", () => {
  it("reads the real extension from the name, never a category word", () => {
    expect(
      fileTypeExtension(document({ name: "hearing.mp4", sniffedContentType: "video/mp4" })),
    ).toBe("mp4");
    expect(
      fileTypeExtension(
        document({
          name: "Answer.docx",
          sniffedContentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ),
    ).toBe("docx");
  });

  it("keeps an extension the media-type map does not know", () => {
    expect(
      fileTypeExtension(document({ name: "drawing.dwg", sniffedContentType: "application/acad" })),
    ).toBe("dwg");
  });

  it("falls back to the sniffed type's extension when the name carries none", () => {
    expect(
      fileTypeExtension(document({ name: "scan", sniffedContentType: "application/pdf" })),
    ).toBe("pdf");
  });

  it("reads as blank rather than a placeholder word when nothing is known", () => {
    expect(fileTypeExtension(document({ name: "scan", sniffedContentType: null }))).toBe("");
  });
});
