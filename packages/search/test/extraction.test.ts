import { describe, expect, it } from "vitest";
import {
  extracted,
  extractedFromPages,
  extractionAdapterError,
  extractionEngineNotImplemented,
  passagesFromPages,
  unextractable,
} from "../src/extraction.ts";

describe("text extraction outcomes", () => {
  it("keeps the three failure reasons distinct — the pipeline routes each one differently", () => {
    expect(extractionEngineNotImplemented()).toEqual({
      ok: false,
      reason: "engine-not-implemented",
    });
    expect(unextractable("no text layer")).toEqual({
      ok: false,
      reason: "unextractable",
      detail: "no text layer",
    });
    expect(extractionAdapterError("container unreachable")).toEqual({
      ok: false,
      reason: "adapter-error",
      detail: "container unreachable",
    });
  });

  it("reports success as a value, never a throw", () => {
    const result = extracted([{ chunkId: "page-0", text: "hello" }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.passages).toHaveLength(1);
  });
});

describe("passagesFromPages", () => {
  it("makes one passage per page, joining its lines and numbering the page from one", () => {
    const passages = passagesFromPages([
      { pageIndex: 0, lines: [{ text: "the seller shall" }, { text: "indemnify the buyer" }] },
      { pageIndex: 1, lines: [{ text: "environmental liability" }] },
    ]);
    expect(passages).toEqual([
      { chunkId: "page-0", text: "the seller shall\nindemnify the buyer", page: 1 },
      { chunkId: "page-1", text: "environmental liability", page: 2 },
    ]);
  });

  it("drops a page with no readable text rather than indexing an empty passage", () => {
    const passages = passagesFromPages([
      { pageIndex: 0, lines: [] },
      { pageIndex: 1, lines: [{ text: "   " }] },
      { pageIndex: 2, lines: [{ text: "real text" }] },
    ]);
    expect(passages.map((passage) => passage.chunkId)).toEqual(["page-2"]);
  });

  it("yields nothing at all for a document with no recognizable text", () => {
    expect(passagesFromPages([{ pageIndex: 0, lines: [{ text: "" }] }])).toEqual([]);
  });
});

describe("extractedFromPages", () => {
  it("records where each page's text came from, page by page", () => {
    const result = extractedFromPages([
      { pageIndex: 0, provenance: "native", lines: [{ text: "the born-digital contract" }] },
      { pageIndex: 1, provenance: "ocr", lines: [{ text: "THE APPENDED SCAN" }] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toEqual([
      { pageIndex: 0, provenance: "native", hasText: true },
      { pageIndex: 1, provenance: "ocr", hasText: true },
    ]);
    expect(result.passages.map((passage) => passage.text)).toEqual([
      "the born-digital contract",
      "THE APPENDED SCAN",
    ]);
  });

  it("orders pages by page index however the routes returned them", () => {
    // The two halves finish independently — the native pages are read in one pass and the recognized
    // ones come back from a service — so the caller has no reason to hand them over in order.
    const result = extractedFromPages([
      { pageIndex: 2, provenance: "ocr", lines: [{ text: "third" }] },
      { pageIndex: 0, provenance: "native", lines: [{ text: "first" }] },
      { pageIndex: 1, provenance: "ocr", lines: [{ text: "second" }] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages.map((passage) => passage.page)).toEqual([1, 2, 3]);
    expect(result.pages.map((page) => page.pageIndex)).toEqual([0, 1, 2]);
  });

  it("keeps a page that yielded nothing in the provenance record, without a passage", () => {
    // "Page 2 went to recognition and came back empty" must stay answerable. Dropping the page
    // entirely would make it indistinguishable from a page nothing ever looked at.
    const result = extractedFromPages([
      { pageIndex: 0, provenance: "native", lines: [{ text: "readable" }] },
      { pageIndex: 1, provenance: "ocr", lines: [] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages).toHaveLength(1);
    expect(result.pages).toEqual([
      { pageIndex: 0, provenance: "native", hasText: true },
      { pageIndex: 1, provenance: "ocr", hasText: false },
    ]);
  });
});
