// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import {
  joinReviewDocumentText,
  type ReviewDocumentSidecar,
} from "@magna-carta/discovery/processing";
import { reviewDocumentPassages } from "../src/search/review-document-passages.ts";

// Recovering a review document's passages from the two objects the discovery pipeline already wrote,
// instead of re-parsing an opposing party's bytes a second time. What has to hold is that a passage
// comes back on the page it was actually on — a search hit that names the wrong page of a production
// is worse than no hit, because somebody cites it.

function sidecar(
  pages: readonly { pageIndex: number; provenance: string; hasText: boolean }[],
): ReviewDocumentSidecar {
  return {
    reviewDocumentId: "reviewDocument_test00000000000001",
    reviewSetId: "reviewSet_test000000000000000001",
    discoveryLoadId: "discoveryLoad_test0000000000000001",
    formatIdentified: "pdf",
    pageCount: pages.length,
    documentDate: null,
    documentDateSource: null,
    extractionRoute: ["discovery-engine"],
    pages,
    textFingerprint: null,
    extractedAt: "2026-08-19T00:00:00.000Z",
  };
}

describe("reviewDocumentPassages", () => {
  it("gives each block back the page it was extracted from", () => {
    const text = joinReviewDocumentText(["first page words", "second page words"]);
    const result = reviewDocumentPassages(
      text,
      sidecar([
        { pageIndex: 0, provenance: "native", hasText: true },
        { pageIndex: 1, provenance: "native", hasText: true },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages).toEqual([
      { chunkId: "page-0", text: "first page words", page: 1 },
      { chunkId: "page-1", text: "second page words", page: 2 },
    ]);
  });

  it("skips the blank pages the extractor skipped and keeps the surviving pages' own numbers", () => {
    // A four-page document whose second and third pages produced nothing. The extractor wrote two
    // blocks and recorded four pages, so the passages must be pages 1 and 4 — not pages 1 and 2.
    // Counting positions instead of reading the page index is exactly the mis-attribution this
    // pairing exists to prevent.
    const text = joinReviewDocumentText(["cover sheet", "signature block"]);
    const result = reviewDocumentPassages(
      text,
      sidecar([
        { pageIndex: 0, provenance: "native", hasText: true },
        { pageIndex: 1, provenance: "native", hasText: false },
        { pageIndex: 2, provenance: "ocr", hasText: false },
        { pageIndex: 3, provenance: "ocr", hasText: true },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages.map((passage) => passage.page)).toEqual([1, 4]);
    expect(result.passages.map((passage) => passage.chunkId)).toEqual(["page-0", "page-3"]);
  });

  it("REFUSES rather than guessing when the two objects disagree about how many pages have text", () => {
    // Two objects written by different runs. Pairing them positionally anyway would put the second
    // page's words on the first page's number and never say so.
    const text = joinReviewDocumentText(["one", "two", "three"]);
    const result = reviewDocumentPassages(
      text,
      sidecar([
        { pageIndex: 0, provenance: "native", hasText: true },
        { pageIndex: 1, provenance: "native", hasText: true },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("3");
    expect(result.reason).toContain("2");
  });

  it("treats a document that produced nothing as no passages rather than one empty one", () => {
    const result = reviewDocumentPassages(
      "",
      sidecar([{ pageIndex: 0, provenance: "ocr", hasText: false }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages).toEqual([]);
  });

  it("refuses text that the metadata accounts for no page of", () => {
    const result = reviewDocumentPassages(
      "words nothing claims",
      sidecar([{ pageIndex: 0, provenance: "ocr", hasText: false }]),
    );
    expect(result.ok).toBe(false);
  });

  it("keeps a page whose own text contains blank lines as ONE passage", () => {
    // The reason the separator is a form feed rather than a blank line: a document's own text is full
    // of blank lines, and splitting on one would shatter a single page into several passages carrying
    // the same page number.
    const page = "PARAGRAPH ONE\n\nPARAGRAPH TWO\n\nPARAGRAPH THREE";
    const result = reviewDocumentPassages(
      joinReviewDocumentText([page]),
      sidecar([{ pageIndex: 0, provenance: "native", hasText: true }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]?.text).toBe(page);
  });
});
