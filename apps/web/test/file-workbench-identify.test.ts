/*
 * The workbench's browser-side identification: what the bytes read as, and how that is compared
 * against the name. The rule under test throughout is that it never produces a FALSE MISMATCH — the
 * mismatch warning is only worth anything if a person can trust it, so a reading that is merely
 * imprecise contradicts nothing.
 */
import { describe, expect, it } from "vitest";
import { identifyFromPrefix, toMagicBytes } from "../src/lib/tools/file-workbench/identify.ts";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

const PDF = ascii("%PDF-1.7\n%âãÏÓ\n");
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
const EXECUTABLE = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00);

/** A ZIP whose first part names `word/`, which is what makes an OOXML container a Word document. */
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...ascii("....word/document.xml")]);

describe("identifying a file from its first bytes", () => {
  it("reads a PDF and agrees with a .pdf name", () => {
    const { report } = identifyFromPrefix(PDF, "Deposition.pdf");
    expect(report.detected).toBe("pdf");
    expect(report.extensionMatch).toBe("match");
  });

  it("reads the OOXML part names inside a ZIP to tell Word from a plain archive", () => {
    expect(identifyFromPrefix(DOCX, "Agreement.docx").report.detected).toBe("docx");
    expect(
      identifyFromPrefix(bytes(0x50, 0x4b, 0x03, 0x04, 0, 0), "photos.zip").report.detected,
    ).toBe("zip");
  });

  it("says an executable named as a PDF disagrees, and names what the bytes are", () => {
    const { report } = identifyFromPrefix(EXECUTABLE, "invoice_march.pdf.exe");
    expect(report.detected).toBe("pe");
    // The claim is the LAST extension, and it happens to be right here — the double extension is
    // the social engineering, not a byte-level mismatch.
    expect(report.extensionMatch).toBe("match");

    const disguised = identifyFromPrefix(EXECUTABLE, "invoice_march.pdf");
    expect(disguised.report.extensionMatch).toBe("mismatch");
    expect(disguised.report.note).toContain("Windows executable");
  });

  it("never calls a text file a mismatch, because a prefix cannot tell text formats apart", () => {
    for (const name of ["ledger.csv", "notes.md", "config.yaml", "page.html"]) {
      const { report } = identifyFromPrefix(ascii("date,description,amount\n"), name);
      expect(report.extensionMatch, `${name} must not read as a mismatch`).toBe("unverifiable");
    }
  });

  it("reads an RFC 5322 message as email rather than as plain text", () => {
    const { report } = identifyFromPrefix(
      ascii("Return-Path: <a@example.test>\r\nSubject: Re: Deadline\r\n"),
      "Re Deadline.eml",
    );
    expect(report.detected).toBe("email");
    expect(report.extensionMatch).toBe("match");
  });

  it("reports no reading at all rather than guessing at unrecognized binary", () => {
    const { report } = identifyFromPrefix(bytes(0xab, 0x00, 0xff, 0x13), "mystery.bin");
    expect(report.detected).toBeNull();
    expect(report.extensionMatch).toBe("unverifiable");
  });

  it("shows the leading bytes, which are the evidence for whatever it claims", () => {
    expect(toMagicBytes(PNG, 4)).toBe("89 50 4E 47");
  });

  it("says so when a name carries no extension at all", () => {
    expect(identifyFromPrefix(PDF, "deposition").report.extensionMatch).toBe("no-extension");
  });
});
