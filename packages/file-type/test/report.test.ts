import { describe, expect, it } from "vitest";
import type { RawIdentifyResult } from "../src/raw.ts";
import { buildFileTypeReport } from "../src/report.ts";

function raw(over: Partial<RawIdentifyResult>): RawIdentifyResult {
  return { label: "pdf", score: 0.99, group: "document", magikaVersion: "1.0", modelVersion: "x", ...over };
}

describe("buildFileTypeReport", () => {
  it("reports a match when the extension is canonical for the content", () => {
    const report = buildFileTypeReport(raw({ label: "pdf" }), "report.pdf");
    expect(report.detected).toBe("pdf");
    expect(report.detectedLabel).toBe("PDF document");
    expect(report.extensionMatch).toBe("match");
    expect(report.recommendedExtensions).toEqual(["pdf"]);
  });

  it("accepts an alternate canonical extension (jpg for a JPEG)", () => {
    const report = buildFileTypeReport(raw({ label: "jpeg", group: "image" }), "photo.jpeg");
    expect(report.extensionMatch).toBe("match");
  });

  it("flags a mismatch when the extension lies about the content", () => {
    const report = buildFileTypeReport(raw({ label: "jpeg", group: "image" }), "contract.pdf");
    expect(report.extensionMatch).toBe("mismatch");
    expect(report.recommendedExtensions).toEqual(["jpg", "jpeg"]);
    expect(report.note).toContain("JPEG image");
  });

  it("recommends an extension when the filename has none", () => {
    const report = buildFileTypeReport(raw({ label: "png", group: "image" }), "scan");
    expect(report.extensionMatch).toBe("no-extension");
    expect(report.recommendedExtensions).toEqual(["png"]);
    expect(report.note).toContain("png");
  });

  it("is unverifiable when Magika returns no usable type", () => {
    const report = buildFileTypeReport(raw({ label: "unknown", group: "unknown", score: 0.2 }), "x.pdf");
    expect(report.detected).toBeNull();
    expect(report.extensionMatch).toBe("unverifiable");
    expect(report.recommendedExtensions).toEqual([]);
  });

  it("is unverifiable when detected but no canonical extension is known (macho)", () => {
    // macho has extensions: [] in labels.ts — detected type is known, but there is nothing to
    // compare the claimed extension against, so extensionMatch must be "unverifiable", not "mismatch".
    const report = buildFileTypeReport(raw({ label: "macho", group: "executable" }), "tool.bin");
    expect(report.extensionMatch).toBe("unverifiable");
    expect(report.detected).toBe("macho");
    expect(report.recommendedExtensions).toEqual([]);
  });

  it("carries the confidence score through", () => {
    expect(buildFileTypeReport(raw({ score: 0.87 }), "a.pdf").confidence).toBe(0.87);
  });
});
