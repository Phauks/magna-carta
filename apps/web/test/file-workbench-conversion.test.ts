/*
 * What the workbench offers to convert a file into. The bridge between two vocabularies (a
 * @magna-carta/file-type label and a @magna-carta/conversion FormatId) and the intersection that
 * keeps a bulk conversion from offering a format half the selection cannot reach.
 */
import { describe, expect, it } from "vitest";
import {
  conversionTargetsFor,
  formatIdForLabel,
  sharedConversionTargets,
} from "../src/lib/tools/file-workbench/conversion-targets.ts";
import { digestMatches } from "../src/lib/tools/file-workbench/digest.ts";

describe("bridging the two names for a format", () => {
  it("passes through the labels the two vocabularies already agree on", () => {
    expect(formatIdForLabel("pdf")).toBe("pdf");
    expect(formatIdForLabel("docx")).toBe("docx");
  });

  it("maps the handful that differ", () => {
    expect(formatIdForLabel("email")).toBe("eml");
  });

  it("answers null for a label the conversion graph does not hold", () => {
    expect(formatIdForLabel("pe")).toBeNull();
    expect(formatIdForLabel(null)).toBeNull();
  });
});

describe("what one file can become", () => {
  it("offers PDF from a Word document", () => {
    expect(conversionTargetsFor("docx").map((format) => format.id)).toContain("pdf");
  });

  it("offers nothing from a file the graph cannot convert", () => {
    expect(conversionTargetsFor("pe")).toEqual([]);
  });

  /*
   * A target is a FILE TYPE, not a treatment of one. The graph carries a text-layered PDF as its
   * own node because pathfinding needs a target that differs from its source, but what comes out
   * is a PDF either way — and offering both asks a reader to choose how much of their document
   * survives, when the answer is always "as much as possible".
   */
  it("offers one PDF, not a PDF and a variant of a PDF", () => {
    const pdfLike = conversionTargetsFor("docx").filter(
      (format) => format.mediaType === "application/pdf",
    );
    expect(pdfLike.map((format) => format.label)).toEqual(["PDF"]);
  });

  it("does not offer to convert a file into its own file type", () => {
    // A PDF with a recognized text layer is still a PDF, so the graph's only edge out of `pdf`
    // is not a conversion. Text Recognition is where a text layer is asked for.
    expect(conversionTargetsFor("pdf")).toEqual([]);
  });

  it("keeps the node named for the type over the one named for the treatment", () => {
    // The collapse is by media type and extension, so it holds for any variant node added later.
    for (const label of ["docx", "png", "eml"]) {
      const seen = new Set(
        conversionTargetsFor(label).map(
          (format) => `${format.mediaType} ${[...format.extensions].sort().join(",")}`,
        ),
      );
      expect(seen.size).toBe(conversionTargetsFor(label).length);
    }
  });
});

describe("what a whole selection can become", () => {
  it("offers only what every selected file can reach", () => {
    const shared = sharedConversionTargets(["png", "jpeg"]).map((format) => format.id);
    const images = conversionTargetsFor("png").map((format) => format.id);
    expect(shared.every((id) => images.includes(id))).toBe(true);
    expect(shared).toContain("pdf");
  });

  it("offers nothing once a file that converts to nothing joins the selection", () => {
    expect(sharedConversionTargets(["png", "pe"])).toEqual([]);
  });

  it("offers nothing for an empty selection rather than everything", () => {
    expect(sharedConversionTargets([])).toEqual([]);
  });
});

describe("comparing a digest somebody sent you", () => {
  it("ignores case and surrounding space, which is not a real difference", () => {
    expect(digestMatches("  9F2C1D8B  ", "9f2c1d8b")).toBe(true);
    expect(digestMatches("9f2c1d8c", "9f2c1d8b")).toBe(false);
  });
});
