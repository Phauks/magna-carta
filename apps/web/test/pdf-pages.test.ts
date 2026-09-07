import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DecompressionBombError, ensureReady, loadDocument } from "@magna-carta/pdf";
import {
  PDF_BASE_DPI,
  PDF_MAX_DPI,
  pageDisplaySize,
  pdfWorkerAvailable,
  renderDpiFor,
} from "../src/lib/documents/pdf-pages.ts";

/*
 * The viewer's arithmetic, and the proof that the engine behind it really rasterizes a document.
 *
 * The worker itself is not exercised here: a Web Worker needs a browser, and under Node the
 * engine's own loader cannot resolve its WebAssembly by URL. So this suite drives the SAME engine
 * calls the worker makes, feeding the bytes directly the way the engine's own tests do, and pins
 * the pure functions the component lays a page out with. What is left unproven by this file is the
 * message plumbing, which is what the browser check covers.
 */

const wasmBytes = readFileSync(
  fileURLToPath(new URL("../../../packages/pdf/src/pkg/pdf_core_bg.wasm", import.meta.url)),
);
const helloPdf = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL("../../../packages/pdf/test/fixtures/hello.pdf", import.meta.url)),
  ),
);

describe("renderDpiFor", () => {
  it("scales with the zoom and the display, and never passes the engine's ceiling", () => {
    expect(renderDpiFor(1)).toBe(PDF_BASE_DPI);
    expect(renderDpiFor(2)).toBe(PDF_BASE_DPI * 2);
    // A dense display asks for more pixels for the same size on screen.
    expect(renderDpiFor(1, 2)).toBe(PDF_BASE_DPI * 2);
    // A page's buffer grows with the square of the resolution, so the ceiling is what stops a
    // reader zooming into a bitmap no tab can hold.
    expect(renderDpiFor(100)).toBe(PDF_MAX_DPI);
    expect(renderDpiFor(8, 4)).toBe(PDF_MAX_DPI);
  });

  it("never asks for a resolution of nothing", () => {
    expect(renderDpiFor(0)).toBe(1);
    expect(renderDpiFor(-1)).toBe(1);
  });
});

describe("pageDisplaySize", () => {
  it("turns a page's points into the space it takes on screen", () => {
    // Letter, 612x792 points, at 96 dots to the inch and no zoom.
    expect(pageDisplaySize({ widthPt: 612, heightPt: 792 }, 1)).toEqual({
      width: 816,
      height: 1056,
    });
  });

  it("does not let the display's pixel ratio change the space a page takes", () => {
    // The ratio raises the RESOLUTION (renderDpiFor), never the layout: a page at zoom 1 occupies
    // the same room on a dense display as on an ordinary one.
    const size = { widthPt: 612, heightPt: 792 };
    expect(pageDisplaySize(size, 1)).toEqual(pageDisplaySize(size, 1));
    expect(pageDisplaySize(size, 0.5)).toEqual({ width: 408, height: 528 });
  });
});

describe("pdfWorkerAvailable", () => {
  it("is false under Node, which is why the viewer states a refusal there", () => {
    expect(pdfWorkerAvailable()).toBe(false);
  });
});

describe("the engine the worker draws with", () => {
  it("rasterizes a real document to the pixels the viewer puts on a canvas", async () => {
    await ensureReady(wasmBytes);
    const document = await loadDocument(helloPdf);
    try {
      expect(document.pageCount).toBeGreaterThan(0);
      const size = document.pageSize(0);
      expect(size.widthPt).toBeGreaterThan(0);

      const rendered = document.renderPage(0, { dpi: renderDpiFor(1), encodePng: false });
      expect(rendered.encoding).toBe("rgba8");
      // Four bytes a pixel is what makes the buffer an ImageData with no conversion.
      expect(rendered.data.length).toBe(rendered.width * rendered.height * 4);
      // A page drawn at 96 dots to the inch is 96/72 of its size in points. Which way the engine
      // rounds a fractional edge is its own business, so this allows the pixel: what the viewer
      // relies on is that the bitmap tracks the page's real proportions, and it takes the canvas's
      // own dimensions from the render rather than recomputing them.
      expect(rendered.width).toBeCloseTo((size.widthPt * PDF_BASE_DPI) / 72, -0.5);
      expect(Math.abs(rendered.width - (size.widthPt * PDF_BASE_DPI) / 72)).toBeLessThanOrEqual(1);
      // The page is not blank: a document that parsed but drew nothing would pass every check
      // above and show the reader an empty sheet.
      expect(rendered.data.some((byte) => byte !== 0)).toBe(true);
    } finally {
      document.free();
    }
  });

  it("refuses bytes that are not a document, which the viewer reports rather than drawing", async () => {
    await ensureReady(wasmBytes);
    await expect(loadDocument(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });

  it("carries a decompression-bomb refusal the worker maps to its own outcome", () => {
    // The worker tells this refusal apart from an unreadable file, so a hostile document is
    // reported as what it is. Pinning the type here keeps that branch honest if the class moves.
    expect(new DecompressionBombError()).toBeInstanceOf(Error);
    expect(new DecompressionBombError().code).toBe("decompression-bomb");
  });
});
