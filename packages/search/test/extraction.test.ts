import { describe, expect, it } from "vitest";
import {
  EXTRACTION_ENGINES,
  extracted,
  extractedFromPages,
  extractionAdapterError,
  extractionEngineNotImplemented,
  passagesFromPages,
  unextractable,
  type ExtractionEngine,
} from "../src/extraction.ts";

// The assembly point takes the route as an argument; which engines are in it is a separate concern
// from how pages are merged, so these cases pin one route and vary the pages.
const ROUTE: readonly ExtractionEngine[] = ["discovery-engine"];

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

  it("carries the engine's own diagnosis beside the disposition, when there is one", () => {
    // Two separate facts. `reason` is what the pipeline does about it; `code` is what a corpus report
    // has to be able to say. A firm telling a court "we could not read this, and it was an encrypted
    // Word document" is saying the second one.
    expect(unextractable("the document's content is encrypted", "encrypted")).toEqual({
      ok: false,
      reason: "unextractable",
      detail: "the document's content is encrypted",
      code: "encrypted",
    });
  });
});

describe("the extraction route", () => {
  it("names each engine once, in the order they ran", () => {
    // A mixed document sends several pages through recognition and a conversion re-reads through the
    // engine that asked for it; "recognition, recognition" says nothing "recognition" does not.
    const result = extractedFromPages(
      [{ pageIndex: 0, provenance: "ocr", lines: [{ text: "A SCAN" }] }],
      ["office-conversion", "discovery-engine", "recognition", "recognition"],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route).toEqual(["office-conversion", "discovery-engine", "recognition"]);
  });

  it("is never empty on a success — text that exists came from somewhere", () => {
    const result = extractedFromPages(
      [{ pageIndex: 0, provenance: "native", lines: [{ text: "readable" }] }],
      ROUTE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route.length).toBeGreaterThan(0);
    for (const engine of result.route) expect(EXTRACTION_ENGINES).toContain(engine);
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
    const result = extractedFromPages(
      [
        { pageIndex: 0, provenance: "native", lines: [{ text: "the born-digital contract" }] },
        { pageIndex: 1, provenance: "ocr", lines: [{ text: "THE APPENDED SCAN" }] },
      ],
      ROUTE,
    );
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
    const result = extractedFromPages(
      [
        { pageIndex: 2, provenance: "ocr", lines: [{ text: "third" }] },
        { pageIndex: 0, provenance: "native", lines: [{ text: "first" }] },
        { pageIndex: 1, provenance: "ocr", lines: [{ text: "second" }] },
      ],
      ROUTE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages.map((passage) => passage.page)).toEqual([1, 2, 3]);
    expect(result.pages.map((page) => page.pageIndex)).toEqual([0, 1, 2]);
  });

  it("keeps a page that yielded nothing in the provenance record, without a passage", () => {
    // "Page 2 went to recognition and came back empty" must stay answerable. Dropping the page
    // entirely would make it indistinguishable from a page nothing ever looked at.
    const result = extractedFromPages(
      [
        { pageIndex: 0, provenance: "native", lines: [{ text: "readable" }] },
        { pageIndex: 1, provenance: "ocr", lines: [] },
      ],
      ROUTE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages).toHaveLength(1);
    expect(result.pages).toEqual([
      { pageIndex: 0, provenance: "native", hasText: true },
      { pageIndex: 1, provenance: "ocr", hasText: false },
    ]);
  });

  // A `chunkId` is `page-<index>`, so a repeated index would hand the index two passages sharing one
  // chunk id and leave the provenance list with two answers for one page. A container retry, a page
  // split across two result records, or an engine bug is enough to produce it.
  describe("a page index reported more than once", () => {
    it("keeps exactly one page per index", () => {
      const result = extractedFromPages(
        [
          { pageIndex: 7, provenance: "ocr", lines: [{ text: "first reading" }] },
          { pageIndex: 7, provenance: "ocr", lines: [{ text: "second reading" }] },
        ],
        ROUTE,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.passages).toHaveLength(1);
      expect(result.pages).toHaveLength(1);
      expect(new Set(result.passages.map((passage) => passage.chunkId)).size).toBe(1);
    });

    it("prefers the reading that has text, so one page cannot be both hasText true and false", () => {
      const result = extractedFromPages(
        [
          { pageIndex: 7, provenance: "ocr", lines: [] },
          { pageIndex: 7, provenance: "ocr", lines: [{ text: "the page does have text" }] },
        ],
        ROUTE,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pages).toEqual([{ pageIndex: 7, provenance: "ocr", hasText: true }]);
      expect(result.passages[0]?.text).toBe("the page does have text");
    });

    it("prefers native over ocr on a tie, since the text layer is the exact characters", () => {
      const result = extractedFromPages(
        [
          { pageIndex: 3, provenance: "ocr", lines: [{ text: "recognized reading" }] },
          { pageIndex: 3, provenance: "native", lines: [{ text: "the exact text" }] },
        ],
        ROUTE,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pages).toEqual([{ pageIndex: 3, provenance: "native", hasText: true }]);
      expect(result.passages[0]?.text).toBe("the exact text");
    });

    it("is order-independent, so the two halves may finish in either order", () => {
      const pages = [
        { pageIndex: 3, provenance: "native" as const, lines: [{ text: "the exact text" }] },
        { pageIndex: 3, provenance: "ocr" as const, lines: [{ text: "recognized reading" }] },
      ];
      const forward = extractedFromPages(pages, ROUTE);
      const reversed = extractedFromPages([...pages].toReversed(), ROUTE);
      expect(forward).toEqual(reversed);
    });
  });

  it("drops a negative page index rather than turning it into page 0", () => {
    const result = extractedFromPages(
      [
        { pageIndex: -1, provenance: "ocr", lines: [{ text: "nowhere" }] },
        { pageIndex: 0, provenance: "native", lines: [{ text: "page one" }] },
      ],
      ROUTE,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toEqual([{ pageIndex: 0, provenance: "native", hasText: true }]);
    expect(result.passages.map((passage) => passage.page)).toEqual([1]);
  });
});
