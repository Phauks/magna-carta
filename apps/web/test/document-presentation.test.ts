/*
 * The Documents surface's display decisions, pinned. The cases that matter are the ones where a
 * wrong answer misleads rather than merely looks odd: a document with no committed bytes must never
 * read as offerable, a rejected one must carry its reason, and the sizes/timestamps that have no
 * value must read as absent rather than as zero or as "Invalid Date".
 */
import { describe, expect, it } from "vitest";
import type { DocumentSummary } from "../src/lib/documents/document-api.ts";
import {
  documentStatusPresentation,
  documentsNewestFirst,
  formatDocumentSize,
  formatDocumentTimestamp,
  hasReadableContent,
  problemGuidance,
} from "../src/lib/documents/document-presentation.ts";

function document(overrides: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: "file_01",
    matterId: "matter_01",
    folderId: null,
    name: "Complaint.docx",
    currentVersionId: "fileVersion_01",
    createdAt: "2026-03-02T10:00:00.000Z",
    updatedAt: "2026-03-02T10:00:00.000Z",
    versionNumber: 1,
    sizeBytes: 4096,
    sniffedContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    status: "clean",
    quarantineReason: null,
    ...overrides,
  };
}

describe("formatDocumentSize", () => {
  it("reads whole bytes below a kilobyte", () => {
    expect(formatDocumentSize(512)).toBe("512 B");
  });

  it("climbs to the natural unit", () => {
    expect(formatDocumentSize(4096)).toBe("4.0 KB");
    expect(formatDocumentSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatDocumentSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });

  it("reads an absent size as absent, never as zero", () => {
    expect(formatDocumentSize(null)).toBe("—");
    expect(formatDocumentSize(0)).toBe("0 B");
  });
});

describe("formatDocumentTimestamp", () => {
  it("reads an absent timestamp as absent", () => {
    expect(formatDocumentTimestamp(null)).toBe("—");
    expect(formatDocumentTimestamp("")).toBe("—");
  });

  it("returns an unparseable value unchanged rather than as Invalid Date", () => {
    expect(formatDocumentTimestamp("whenever")).toBe("whenever");
  });

  it("formats a real timestamp", () => {
    expect(formatDocumentTimestamp("2026-03-02T10:00:00.000Z")).not.toBe("—");
    expect(formatDocumentTimestamp("2026-03-02T10:00:00.000Z")).not.toContain("Invalid");
  });
});

describe("documentStatusPresentation", () => {
  it("gives the ordinary clean document no chip", () => {
    expect(documentStatusPresentation(document())).toBeNull();
  });

  it("marks a document still being checked as processing", () => {
    expect(documentStatusPresentation(document({ status: "pending" }))).toEqual({
      label: "Processing",
      variant: "info",
      detail: null,
    });
  });

  it("marks a rejected document, carrying the reason the scanner gave", () => {
    expect(
      documentStatusPresentation(
        document({ status: "quarantined", quarantineReason: "scan-flagged" }),
      ),
    ).toEqual({ label: "Rejected", variant: "danger", detail: "scan-flagged" });
  });
});

describe("hasReadableContent", () => {
  it("is true only for a clean document that has a committed version", () => {
    expect(hasReadableContent(document())).toBe(true);
  });

  it("is false while the bytes are still being checked", () => {
    expect(hasReadableContent(document({ status: "pending", currentVersionId: null }))).toBe(false);
  });

  it("is false for a rejected document even if a version pointer somehow survives", () => {
    expect(hasReadableContent(document({ status: "quarantined" }))).toBe(false);
  });

  it("is false for a clean document whose version pointer is absent", () => {
    expect(hasReadableContent(document({ currentVersionId: null }))).toBe(false);
  });
});

describe("problemGuidance", () => {
  it("prefers the server's own wording where it sent one", () => {
    expect(problemGuidance({ status: 403, detail: "You need documents:assemble." }).message).toBe(
      "You need documents:assemble.",
    );
  });

  it("supplies wording where the server sent none", () => {
    expect(problemGuidance({ status: 403 }).message).not.toBe("");
  });

  it("treats every server fault as the case that carries an Error ID to quote", () => {
    expect(problemGuidance({ status: 500 }).tone).toBe("danger");
    expect(problemGuidance({ status: 503 }).tone).toBe("danger");
  });

  it("reads a missing session as information, not as a failure to fix", () => {
    expect(problemGuidance({ status: 401 }).tone).toBe("info");
  });
});

describe("documentsNewestFirst", () => {
  it("orders by creation, newest first", () => {
    const older = document({ id: "file_01", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = document({ id: "file_02", createdAt: "2026-06-01T00:00:00.000Z" });
    expect(documentsNewestFirst([older, newer]).map((row) => row.id)).toEqual([
      "file_02",
      "file_01",
    ]);
  });

  it("breaks a tie deterministically, so two reads never disagree on the order", () => {
    const first = document({ id: "file_a", createdAt: "2026-01-01T00:00:00.000Z" });
    const second = document({ id: "file_b", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(documentsNewestFirst([first, second]).map((row) => row.id)).toEqual([
      "file_b",
      "file_a",
    ]);
    expect(documentsNewestFirst([second, first]).map((row) => row.id)).toEqual([
      "file_b",
      "file_a",
    ]);
  });

  it("does not mutate what it was given", () => {
    const rows = [
      document({ id: "file_01", createdAt: "2026-01-01T00:00:00.000Z" }),
      document({ id: "file_02", createdAt: "2026-06-01T00:00:00.000Z" }),
    ];
    documentsNewestFirst(rows);
    expect(rows.map((row) => row.id)).toEqual(["file_01", "file_02"]);
  });
});
