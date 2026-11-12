import { describe, expect, it } from "vitest";
import {
  editorHref,
  editorKindOf,
  openDestinationOf,
  textContentTypeOf,
  viewerHref,
  viewerKindOf,
  type EditableFileFacts,
} from "../src/lib/documents/editable-documents.ts";

/*
 * What the one Open gesture does, decided from what a file IS. The ruling it holds: a
 * word-processing document opens the browser editor, a plain-text document opens the text editor,
 * everything else opens its preview — and a file whose bytes the platform is withholding opens the
 * preview whatever its format, so a blank editor is never the answer.
 */

const clean = (over: Partial<EditableFileFacts & { id: string }> = {}) => ({
  id: "file_01",
  name: "Complaint.docx",
  sniffedContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  currentVersionId: "fileVersion_01",
  status: "clean" as const,
  scanVerdict: "clean" as const,
  ...over,
});

describe("editorKindOf", () => {
  it("sends word-processing formats to the office editor, by content type or by name", () => {
    expect(editorKindOf(clean())).toBe("office");
    expect(editorKindOf({ name: "letter.doc", sniffedContentType: "application/msword" })).toBe(
      "office",
    );
    expect(editorKindOf({ name: "letter.odt", sniffedContentType: null })).toBe("office");
    expect(editorKindOf({ name: "letter.rtf", sniffedContentType: null })).toBe("office");
  });

  it("sends plain-text and code formats to the text editor, known by their extension", () => {
    // Plain text has no magic bytes, so the gate sniffs nothing and the name decides.
    expect(editorKindOf({ name: "notes.txt", sniffedContentType: null })).toBe("text");
    expect(editorKindOf({ name: "README.md", sniffedContentType: null })).toBe("text");
    expect(editorKindOf({ name: "run.log", sniffedContentType: null })).toBe("text");
    expect(editorKindOf({ name: "config.json", sniffedContentType: null })).toBe("text");
    expect(editorKindOf({ name: "page.html", sniffedContentType: "text/html" })).toBe("text");
  });

  it("sends spreadsheets, presentations and drawings to the office editor too", () => {
    expect(editorKindOf({ name: "budget.xlsx", sniffedContentType: null })).toBe("office");
    expect(
      editorKindOf({
        name: "deck.pptx",
        sniffedContentType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    ).toBe("office");
    expect(editorKindOf({ name: "figures.csv", sniffedContentType: "text/csv" })).toBe("office");
    expect(editorKindOf({ name: "plan.vsdx", sniffedContentType: null })).toBe("office");
  });

  it("reaches the editor by extension for a legacy office format the gate has no signature for", () => {
    // The gate sniffs nothing it can place for a WordPerfect or Lotus file; the register's own
    // extension list is what says the editor opens it.
    expect(editorKindOf({ name: "brief.wpd", sniffedContentType: null })).toBe("office");
    expect(editorKindOf({ name: "ledger.123", sniffedContentType: null })).toBe("office");
    expect(editorKindOf({ name: "Keynote deck.key", sniffedContentType: null })).toBe("office");
  });

  it("names no editor for everything else, the portable document included", () => {
    expect(editorKindOf({ name: "scan.pdf", sniffedContentType: "application/pdf" })).toBeNull();
    expect(editorKindOf({ name: "photo.jpg", sniffedContentType: "image/jpeg" })).toBeNull();
    expect(editorKindOf({ name: "bundle.zip", sniffedContentType: "application/zip" })).toBeNull();
    expect(editorKindOf({ name: "mystery", sniffedContentType: null })).toBeNull();
  });

  it("lets the sniffed content type overrule a misleading name", () => {
    expect(editorKindOf({ name: "notes.txt", sniffedContentType: "application/pdf" })).toBeNull();
  });
});

describe("viewerKindOf", () => {
  it("names the reader for a portable document, by content type or by name", () => {
    expect(viewerKindOf({ name: "scan.pdf", sniffedContentType: "application/pdf" })).toBe("pdf");
    expect(viewerKindOf({ name: "scan.pdf", sniffedContentType: null })).toBe("pdf");
  });

  it("names the player for a recording, by content type or by name", () => {
    expect(viewerKindOf({ name: "deposition.mp4", sniffedContentType: "video/mp4" })).toBe("video");
    expect(viewerKindOf({ name: "clip.mov", sniffedContentType: null })).toBe("video");
    expect(viewerKindOf({ name: "clip.webm", sniffedContentType: "video/webm" })).toBe("video");
    expect(viewerKindOf({ name: "voicemail.mp3", sniffedContentType: "audio/mpeg" })).toBe("audio");
    expect(viewerKindOf({ name: "interview.m4a", sniffedContentType: null })).toBe("audio");
  });

  it("names no reader for a format the editors already take, or for anything else", () => {
    expect(viewerKindOf({ name: "brief.docx", sniffedContentType: null })).toBeNull();
    expect(viewerKindOf({ name: "notes.txt", sniffedContentType: null })).toBeNull();
    expect(viewerKindOf({ name: "photo.jpg", sniffedContentType: "image/jpeg" })).toBeNull();
  });
});

describe("openDestinationOf", () => {
  it("opens the editor for a clean, committed, editable document", () => {
    expect(openDestinationOf(clean())).toEqual({
      kind: "editor",
      editor: "office",
      href: "/documents/file_01/edit",
    });
    expect(openDestinationOf(clean({ name: "notes.md", sniffedContentType: null }))).toEqual({
      kind: "editor",
      editor: "text",
      href: "/documents/file_01/edit",
    });
  });

  it("previews a document whose bytes are withheld, whatever its format", () => {
    expect(openDestinationOf(clean({ currentVersionId: null, status: "pending" }))).toEqual({
      kind: "preview",
    });
    expect(openDestinationOf(clean({ status: "quarantined" }))).toEqual({ kind: "preview" });
    expect(openDestinationOf(clean({ scanVerdict: "flagged" }))).toEqual({ kind: "preview" });
  });

  it("opens the reader for a clean, committed portable document", () => {
    expect(
      openDestinationOf(clean({ name: "scan.pdf", sniffedContentType: "application/pdf" })),
    ).toEqual({ kind: "viewer", viewer: "pdf", href: "/documents/file_01/view" });
  });

  it("opens the player for a clean, committed recording", () => {
    expect(
      openDestinationOf(clean({ name: "deposition.mp4", sniffedContentType: "video/mp4" })),
    ).toEqual({ kind: "viewer", viewer: "video", href: "/documents/file_01/watch" });
  });

  it("previews a recording a re-scan flagged, like any other withheld file", () => {
    expect(
      openDestinationOf(
        clean({ name: "deposition.mp4", sniffedContentType: "video/mp4", scanVerdict: "flagged" }),
      ),
    ).toEqual({ kind: "preview" });
  });

  it("previews a portable document whose bytes are withheld, like any other", () => {
    const withheld = { name: "scan.pdf", sniffedContentType: "application/pdf" };
    expect(openDestinationOf(clean({ ...withheld, scanVerdict: "flagged" }))).toEqual({
      kind: "preview",
    });
    expect(openDestinationOf(clean({ ...withheld, status: "pending" }))).toEqual({
      kind: "preview",
    });
  });

  it("previews a document with neither an editor nor a reader", () => {
    expect(openDestinationOf(clean({ name: "photo.jpg", sniffedContentType: null }))).toEqual({
      kind: "preview",
    });
    expect(openDestinationOf(clean({ name: "bundle.zip", sniffedContentType: null }))).toEqual({
      kind: "preview",
    });
  });
});

describe("editorHref and viewerHref", () => {
  it("are one address per document each, with the identifier escaped", () => {
    expect(editorHref("file_01")).toBe("/documents/file_01/edit");
    expect(editorHref("a b")).toBe("/documents/a%20b/edit");
    expect(viewerHref("file_01")).toBe("/documents/file_01/view");
    expect(viewerHref("file_01", "video")).toBe("/documents/file_01/watch");
    expect(viewerHref("file_01", "audio")).toBe("/documents/file_01/watch");
  });

  it("never send a document to the same address twice, so the promise each makes is distinct", () => {
    expect(editorHref("file_01")).not.toBe(viewerHref("file_01"));
  });
});

describe("textContentTypeOf", () => {
  it("follows the name, and falls back to plain text", () => {
    expect(textContentTypeOf("notes.md")).toBe("text/markdown");
    expect(textContentTypeOf("notes.txt")).toBe("text/plain");
    expect(textContentTypeOf("run.log")).toBe("text/plain");
    expect(textContentTypeOf("data.json")).toBe("application/json");
    expect(textContentTypeOf("page.html")).toBe("text/html");
  });
});
