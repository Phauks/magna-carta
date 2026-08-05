import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, extractPdfText, type ExtractedPdfPage } from "../src/index.js";

// The fixtures live with the engine that reads them (crates/pdf-core/tests/fixtures), so this edge is
// exercised against exactly the bytes the Rust tests assert on rather than a second copy that could
// drift from them.
function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../../../crates/pdf-core/tests/fixtures/${name}`, import.meta.url)),
    ),
  );
}

function pageText(page: ExtractedPdfPage): string {
  return page.lines.map((line) => line.text).join("\n");
}

describe("extractPdfText", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("reads a born-digital document's own text and asks for no recognition", async () => {
    const { pages } = await extractPdfText(fixture("born_digital.pdf"));
    expect(pages.map((page) => page.pageIndex)).toEqual([0, 1]);
    expect(pages.every((page) => !page.needsRecognition)).toBe(true);
    expect(pageText(pages[0]!)).toContain("The seller shall indemnify the buyer");
    expect(pageText(pages[1]!)).toContain("Schedule B: excluded liabilities");
  });

  it("reports a scan as needing recognition rather than as a document with no text", async () => {
    const { pages } = await extractPdfText(fixture("scan_only.pdf"));
    expect(pages).toHaveLength(1);
    expect(pages[0]!.needsRecognition).toBe(true);
    expect(pages[0]!.lines).toEqual([]);
    expect(pages[0]!.rasterCoverage).toBeGreaterThan(0.9);
  });

  it("routes a mixed document page by page, keeping a stamped scan on the recognition side", async () => {
    const { pages } = await extractPdfText(fixture("mixed_text_and_scan.pdf"));
    expect(pages.map((page) => page.needsRecognition)).toEqual([false, true, true]);
    expect(pageText(pages[0]!)).toContain("This agreement is made between");
    // The Bates stamp on page 2 is real, extractable text and is emphatically not the page's content,
    // so the page still needs recognizing. Both are true at once.
    expect(pageText(pages[2]!)).toBe("EXHIBIT 000123");
  });

  it("refuses bytes that are not a PDF rather than reporting an empty document", async () => {
    await expect(extractPdfText(new TextEncoder().encode("this is not a pdf"))).rejects.toThrow();
  });
});
