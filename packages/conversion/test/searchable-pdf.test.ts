import { describe, expect, it } from "vitest";
import { detectFormat } from "../src/file.ts";
import { canConvertLocally } from "../src/placement.ts";
import { availableConversions, findPath } from "../src/pathfinding.ts";
import { EDGES, getFormat } from "../src/registry.ts";

// The pdf -> searchable-pdf conversion edge: recognize a scanned PDF and write an invisible text
// layer, run through the OCR engine.
describe("searchable-pdf edge", () => {
  it("registers searchable-pdf as a PDF-media-type format distinct from pdf", () => {
    const format = getFormat("searchable-pdf");
    expect(format).toBeDefined();
    expect(format?.mediaType).toBe("application/pdf");
    // Distinct node id, so a conversion target can differ from its pdf source.
    expect(getFormat("pdf")?.id).not.toBe(format?.id);
  });

  it("resolves pdf -> searchable-pdf as a single OCR hop", () => {
    const path = findPath("pdf", "searchable-pdf");
    expect(path.ok).toBe(true);
    if (path.ok) {
      expect(path.path).toHaveLength(1);
      expect(path.path[0]?.engineId).toBe("ocr");
      expect(path.path[0]?.from).toBe("pdf");
      expect(path.path[0]?.to).toBe("searchable-pdf");
    }
  });

  it("offers searchable-pdf as a conversion target from pdf", () => {
    expect(availableConversions("pdf")).toContain("searchable-pdf");
  });

  it("runs server-only — OCR is not a local (in-browser) engine", () => {
    expect(canConvertLocally("pdf", "searchable-pdf")).toBe(false);
  });

  it("declares exactly one ocr edge in the graph", () => {
    const ocrEdges = EDGES.filter((edge) => edge.engineId === "ocr");
    expect(ocrEdges).toHaveLength(1);
    expect(ocrEdges[0]?.to).toBe("searchable-pdf");
  });

  it("detects a PDF as pdf, not searchable-pdf, despite the shared media type and extension", () => {
    // searchable-pdf shares application/pdf and the .pdf extension with pdf; detection is
    // first-match over FORMATS, so pdf must stay ordered before searchable-pdf. A source detected
    // as searchable-pdf would have no outgoing edges and could not be converted at all — this locks
    // the ordering so a reorder cannot silently break every PDF conversion.
    expect(detectFormat({ name: "scan.pdf", type: "application/pdf" })).toBe("pdf");
    expect(detectFormat({ name: "scan.pdf" })).toBe("pdf");
  });
});
