import { describe, expect, it } from "vitest";
import { canonicalExtensions, humanLabel } from "../src/labels.ts";

describe("labels", () => {
  it("maps a known label to a human label and canonical extensions", () => {
    expect(humanLabel("pdf")).toBe("PDF document");
    expect(canonicalExtensions("pdf")).toEqual(["pdf"]);
  });

  it("maps a Word document and its OOXML extension", () => {
    expect(humanLabel("docx")).toBe("Word document (OOXML)");
    expect(canonicalExtensions("docx")).toEqual(["docx"]);
  });

  it("maps a JPEG to both common extensions", () => {
    expect(canonicalExtensions("jpeg")).toEqual(["jpg", "jpeg"]);
  });

  it("falls back to the raw label and no extensions when unmapped", () => {
    expect(humanLabel("zorp")).toBe("zorp");
    expect(canonicalExtensions("zorp")).toEqual([]);
  });
});
