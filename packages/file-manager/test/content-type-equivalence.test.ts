import { describe, expect, it } from "vitest";
import { contentTypesAgree, normalizeContentType } from "../src/content-type-equivalence.ts";

// The gate's declared-vs-sniffed comparison. A magic-byte sniffer names the CONTAINER, so the test is
// "do these two describe the same bytes", not "are these two strings equal" — while an actual
// contradiction must still be a contradiction.

describe("normalizeContentType", () => {
  it("lower-cases, trims, and drops parameters", () => {
    expect(normalizeContentType("  Application/PDF  ")).toBe("application/pdf");
    expect(normalizeContentType("text/plain; charset=UTF-8")).toBe("text/plain");
  });

  it("maps an absent or empty value to null", () => {
    expect(normalizeContentType(null)).toBeNull();
    expect(normalizeContentType("   ")).toBeNull();
    expect(normalizeContentType("; charset=utf-8")).toBeNull();
  });
});

describe("contentTypesAgree — the legacy Office family", () => {
  // Every pre-2007 Office document is a compound file, and the sniffer can say nothing finer than
  // application/x-cfb. Strict equality quarantined every one of these.
  it.each([
    ["application/msword"],
    ["application/vnd.ms-excel"],
    ["application/vnd.ms-powerpoint"],
    ["application/vnd.ms-outlook"],
    ["application/vnd.ms-project"],
    ["application/x-ole-storage"],
  ])("accepts %s declared against a sniffed application/x-cfb", (declared) => {
    expect(contentTypesAgree("application/x-cfb", declared)).toBe(true);
  });

  it("accepts the declared type whatever its letter case", () => {
    expect(contentTypesAgree("application/x-cfb", "Application/MSWord")).toBe(true);
  });

  it("still refuses a compound file declared as something that is not one", () => {
    expect(contentTypesAgree("application/x-cfb", "application/pdf")).toBe(false);
    expect(contentTypesAgree("application/x-cfb", "image/png")).toBe(false);
    expect(contentTypesAgree("application/x-cfb", "text/plain")).toBe(false);
  });
});

describe("contentTypesAgree — the zip container family", () => {
  it("accepts a modern Office document that sniffed only as the bare archive", () => {
    expect(
      contentTypesAgree(
        "application/zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("accepts the reverse: a specific sniff against a generic application/zip declaration", () => {
    expect(
      contentTypesAgree(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/zip",
      ),
    ).toBe(true);
  });

  it("accepts a macro-enabled document whose registered spelling carries a capital letter", () => {
    // The sniffer lower-cases what it reads out of the archive's content-types part; the browser
    // sends the registered spelling. Only case separates them.
    expect(
      contentTypesAgree(
        "application/vnd.ms-word.document.macroenabled.12",
        "application/vnd.ms-word.document.macroEnabled.12",
      ),
    ).toBe(true);
  });

  it("accepts an OpenDocument file that sniffed as the bare archive", () => {
    expect(contentTypesAgree("application/zip", "application/vnd.oasis.opendocument.text")).toBe(
      true,
    );
  });

  it("refuses a zip declared as a format that is not a zip container", () => {
    expect(contentTypesAgree("application/zip", "application/pdf")).toBe(false);
    expect(contentTypesAgree("application/zip", "application/msword")).toBe(false);
  });
});

describe("contentTypesAgree — unknown pairs fail closed", () => {
  it("refuses a genuine mismatch", () => {
    expect(contentTypesAgree("application/pdf", "text/plain")).toBe(false);
    expect(contentTypesAgree("application/x-msdownload", "application/pdf")).toBe(false);
    expect(
      contentTypesAgree(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
      ),
    ).toBe(false);
  });

  it("accepts an exact match", () => {
    expect(contentTypesAgree("application/pdf", "application/pdf")).toBe(true);
  });

  it("treats an absent side as nothing to contradict", () => {
    expect(contentTypesAgree(null, "application/pdf")).toBe(true);
    expect(contentTypesAgree("application/pdf", null)).toBe(true);
    expect(contentTypesAgree(null, null)).toBe(true);
  });
});
