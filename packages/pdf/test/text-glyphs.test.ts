import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureReady, extractPdfTextGlyphs } from "../src/index.js";

// The positioned edge: each visible glyph with where it was drawn, so a reader can tell which column
// a figure sat in. Built over a one-page PDF written here, so the positions it asserts are the ones
// the content stream states.

/** A one-page Letter PDF drawing each [x, y, text] in 10-point Helvetica. */
function pdfDrawing(cells: readonly (readonly [number, number, string])[]): Uint8Array {
  const content = cells
    .map(([x, y, text]) => `BT /F1 10 Tf ${x} ${y} Td (${text}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("extractPdfTextGlyphs", () => {
  beforeAll(async () => {
    await ensureReady(
      readFileSync(fileURLToPath(new URL("../src/pkg/pdf_core_bg.wasm", import.meta.url))),
    );
  });

  it("places every glyph where the page drew it, with the page's own size", async () => {
    const { pages } = await extractPdfTextGlyphs(
      pdfDrawing([
        [40, 700, "10/03"],
        [100, 700, "DEPOSIT"],
        [400, 700, "500.00"],
      ]),
    );
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page).toMatchObject({
      pageIndex: 0,
      widthPt: 612,
      heightPt: 792,
      needsRecognition: false,
    });
    expect(page.glyphs.map((glyph) => glyph.text).join("")).toBe("10/03DEPOSIT500.00");
    const first = page.glyphs[0]!;
    // A glyph's box starts at its ink, a side bearing past the pen position.
    expect(Math.abs(first.x0 - 40)).toBeLessThan(2);
    expect(first.y0).toBeGreaterThan(690);
    expect(first.y1).toBeLessThan(715);
    const five = page.glyphs.find((glyph, index) => glyph.text === "5" && index > 10)!;
    expect(Math.abs(five.x0 - 400)).toBeLessThan(2);
  });

  it("refuses bytes that are not a PDF", async () => {
    await expect(extractPdfTextGlyphs(new TextEncoder().encode("not a pdf"))).rejects.toThrow();
  });
});
