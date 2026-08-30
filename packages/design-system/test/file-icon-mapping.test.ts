/*
 * The file-type vocabulary, asserted as the ruling states it rather than as the module happens to
 * be written: a .doc and a .docx are told apart by their own badges rather than by a shared glyph,
 * a pdf always says pdf, a spreadsheet is green, a program is red, and the kinds whose glyph
 * already says what they are carry no badge at all.
 *
 * What is rendered belongs to the stories, which run in a real browser with axe: which Lucide glyph
 * each kind draws, and the badge's placement and legibility at every size the component offers.
 * What is asserted here is the part no rendering can show — the pure rules that decide the kind,
 * the tone and the badge's word.
 */
import { describe, expect, it } from "vitest";
import {
  extensionOf,
  resolveFileCategory,
  resolveFileIconTone,
  resolveFileTypeBadge,
} from "../src/lib/components/file-icon/file-types.ts";

describe("resolveFileCategory", () => {
  it("prefers the content type, which the server set, over an extension a user typed", () => {
    expect(resolveFileCategory({ contentType: "application/pdf", fileName: "note.txt" })).toBe(
      "pdf",
    );
  });

  it("falls back to the extension when the content type is absent or unrecognized", () => {
    expect(resolveFileCategory({ fileName: "Q3.xlsx" })).toBe("excel");
    expect(
      resolveFileCategory({ contentType: "application/octet-stream", fileName: "a.docx" }),
    ).toBe("word");
  });

  it("recognizes each kind the mapping names", () => {
    expect(resolveFileCategory({ fileName: "Complaint.pdf" })).toBe("pdf");
    expect(resolveFileCategory({ fileName: "Motion.docx" })).toBe("word");
    expect(resolveFileCategory({ fileName: "Retainer-1998.doc" })).toBe("word");
    expect(resolveFileCategory({ fileName: "Ledger.xlsx" })).toBe("excel");
    expect(resolveFileCategory({ fileName: "Exhibit-A.png" })).toBe("image");
    expect(resolveFileCategory({ fileName: "Deposition.mp4" })).toBe("video");
    expect(resolveFileCategory({ fileName: "Voicemail.m4a" })).toBe("audio");
    expect(resolveFileCategory({ fileName: "Production.zip" })).toBe("archive");
    expect(resolveFileCategory({ fileName: "Viewer-Setup.exe" })).toBe("program");
  });

  it("recognizes an executable by every shape one arrives in", () => {
    for (const fileName of ["Setup.exe", "installer.msi", "app.dmg", "build.apk", "tool.jar"]) {
      expect(resolveFileCategory({ fileName })).toBe("program");
    }
    expect(resolveFileCategory({ contentType: "application/x-msdownload" })).toBe("program");
  });

  it("does not read a domain-shaped file name as an executable", () => {
    // "example.com" is a saved page far more often than it is a DOS executable, so `com` is
    // deliberately absent from the extension map.
    expect(resolveFileCategory({ fileName: "example.com" })).toBe("unknown");
  });

  it("never throws on a partial or missing descriptor", () => {
    expect(resolveFileCategory({})).toBe("unknown");
    expect(resolveFileCategory({ fileName: ".gitignore" })).toBe("unknown");
    expect(resolveFileCategory({ fileName: "trailing." })).toBe("unknown");
    expect(resolveFileCategory({ contentType: "   " })).toBe("unknown");
  });
});

describe("extensionOf", () => {
  it("reads the last extension, lowercased, and nothing else", () => {
    expect(extensionOf("Trust-Ledger.XLSX")).toBe("xlsx");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("  Complaint.pdf  ")).toBe("pdf");
  });

  it("treats a dotfile and a trailing dot as having no extension", () => {
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("trailing.")).toBe("");
    expect(extensionOf("no-extension")).toBe("");
  });
});

describe("the badge that rides the glyph", () => {
  it("carries the file's own extension, upper-cased, in the type's tone", () => {
    expect(resolveFileTypeBadge({ fileName: "Complaint.pdf" })).toEqual({
      text: "PDF",
      tone: "danger",
    });
    expect(resolveFileTypeBadge({ fileName: "Motion.docx" })).toEqual({
      text: "DOCX",
      tone: "info",
    });
    expect(resolveFileTypeBadge({ fileName: "Retainer.doc" })).toEqual({
      text: "DOC",
      tone: "info",
    });
    expect(resolveFileTypeBadge({ fileName: "Ledger.xlsx" })).toEqual({
      text: "XLSX",
      tone: "success",
    });
  });

  it("tells the legacy word format apart from the current one", () => {
    // Both draw the same glyph on purpose; the badge is the whole difference between them.
    expect(resolveFileTypeBadge({ fileName: "Retainer.doc" })?.text).toBe("DOC");
    expect(resolveFileTypeBadge({ fileName: "Retainer.docx" })?.text).toBe("DOCX");
  });

  it("badges only the document types a reader confuses", () => {
    for (const fileName of [
      "Exhibit-A.png",
      "Deposition.mp4",
      "Voicemail.m4a",
      "Production.zip",
      "Viewer-Setup.exe",
      "Notes.txt",
      "schema.json",
      "Correspondence.eml",
      "Closing-Deck.pptx",
      "unknown.bin",
    ]) {
      expect(resolveFileTypeBadge({ fileName })).toBeUndefined();
    }
  });

  it("never contradicts the glyph it rides", () => {
    // Typed as a pdf by the server, named as a Word file: both the glyph and the badge say pdf.
    expect(
      resolveFileTypeBadge({ contentType: "application/pdf", fileName: "Motion.docx" }),
    ).toEqual({ text: "PDF", tone: "danger" });
  });

  it("names the format from the content type when there is no file name", () => {
    expect(
      resolveFileTypeBadge({
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=utf-8",
      }),
    ).toEqual({ text: "DOCX", tone: "info" });
    expect(resolveFileTypeBadge({ contentType: "application/msword" })).toEqual({
      text: "DOC",
      tone: "info",
    });
  });

  it("keeps a pdf badged even with nothing but its category, because its glyph is the empty sheet", () => {
    expect(resolveFileTypeBadge({ category: "pdf" })).toEqual({ text: "PDF", tone: "danger" });
  });

  it("would rather show no badge than guess which word or spreadsheet format this is", () => {
    expect(resolveFileTypeBadge({ category: "word" })).toBeUndefined();
    expect(resolveFileTypeBadge({ category: "excel" })).toBeUndefined();
  });

  it("stays within four characters, which is what the badge has room to draw", () => {
    const names = [
      "a.pdf",
      "a.doc",
      "a.docx",
      "a.dot",
      "a.dotx",
      "a.odt",
      "a.rtf",
      "a.xls",
      "a.xlsx",
      "a.xlsm",
      "a.ods",
      "a.csv",
    ];
    for (const fileName of names) {
      const badge = resolveFileTypeBadge({ fileName });
      expect(badge).toBeDefined();
      expect(badge!.text.length).toBeLessThanOrEqual(4);
      expect(badge!.text).toBe(badge!.text.toUpperCase());
    }
  });
});

describe("resolveFileIconTone", () => {
  it("gives the executable the only toned glyph", () => {
    expect(resolveFileIconTone("program")).toBe("danger");
    for (const category of [
      "pdf",
      "word",
      "excel",
      "powerpoint",
      "image",
      "video",
      "audio",
      "archive",
      "text",
      "code",
      "email",
      "unknown",
    ] as const) {
      expect(resolveFileIconTone(category)).toBe("default");
    }
  });
});
