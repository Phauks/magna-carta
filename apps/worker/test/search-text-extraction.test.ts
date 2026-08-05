import { describe, expect, it } from "vitest";
import pdfFixtures from "virtual:pdf-core-fixtures";
import type { Bindings } from "../src/app.ts";
import { resolveTextExtractionPort } from "../src/search/text-extraction.ts";

// The composite text-extraction port. The recognition engine cannot run under the test pool, so it is
// stood in for by a fake that behaves the way the real container does — most importantly, it reports a
// page that already carries a text layer as skipped, with no lines. That behaviour is the whole reason
// extraction has to be composite: a recognition-only port hands back nothing for a born-digital
// document, and the pipeline records the most common document in a law firm as unreadable.

function fixture(name: string): Uint8Array {
  const encoded = pdfFixtures[name];
  if (encoded === undefined) throw new Error(`no such pdf-core fixture: ${name}`);
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

const BORN_DIGITAL = fixture("born_digital.pdf");
const SCAN_ONLY = fixture("scan_only.pdf");
const MIXED = fixture("mixed_text_and_scan.pdf");

interface RecognizedPage {
  readonly pageIndex: number;
  readonly lines: readonly { readonly text: string }[];
}

// A stand-in for the recognition container: it answers with the pages it is given and records how many
// times it was called, so a test can assert that a document with no scanned page never reaches it.
function fakeRecognition(pages: readonly RecognizedPage[]): {
  service: Pick<Fetcher, "fetch">;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    service: {
      fetch: async () => {
        calls++;
        return Response.json({ pages });
      },
    },
  };
}

function respondingWith(status: number, body: unknown = {}): Pick<Fetcher, "fetch"> {
  return { fetch: async () => Response.json(body, { status }) };
}

function portOver(service: Pick<Fetcher, "fetch"> | undefined) {
  return resolveTextExtractionPort({ OCR_SERVICE: service } as unknown as Bindings);
}

const asPdf = { contentType: "application/pdf" };

describe("composite text extraction", () => {
  it("extracts a born-digital PDF's full text natively, without calling recognition at all", async () => {
    // The bug this closes. Recognition skips a page that already has a text layer, so a
    // recognition-only port returned no lines for any page of this document and the pipeline recorded
    // it unextractable. The fake below is set up to answer exactly that way, and the document extracts
    // in full regardless — because it never gets asked.
    const engine = fakeRecognition([
      { pageIndex: 0, lines: [] },
      { pageIndex: 1, lines: [] },
    ]);
    const result = await portOver(engine.service).extract({ bytes: BORN_DIGITAL, ...asPdf });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(engine.calls()).toBe(0);
    expect(result.passages).toHaveLength(2);
    expect(result.passages[0]!.text).toContain("The seller shall indemnify the buyer");
    expect(result.passages[0]!.text).toContain("arising before the closing date.");
    expect(result.passages[1]!.text).toContain("Schedule B: excluded liabilities");
    expect(result.pages).toEqual([
      { pageIndex: 0, provenance: "native", hasText: true },
      { pageIndex: 1, provenance: "native", hasText: true },
    ]);
  });

  it("still sends a pure scan to recognition and records it as recognized", async () => {
    const engine = fakeRecognition([{ pageIndex: 0, lines: [{ text: "INVOICE 4471" }] }]);
    const result = await portOver(engine.service).extract({ bytes: SCAN_ONLY, ...asPdf });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(engine.calls()).toBe(1);
    expect(result.passages).toEqual([{ chunkId: "page-0", text: "INVOICE 4471", page: 1 }]);
    expect(result.pages).toEqual([{ pageIndex: 0, provenance: "ocr", hasText: true }]);
  });

  it("extracts a mixed document from both routes, page by page, with provenance on each", async () => {
    // A scan appended to a born-digital contract. Page 0 is text; page 1 is a scan; page 2 is a scan
    // carrying a Bates stamp — real, extractable text that is emphatically not the page's content.
    // A whole-document route would lose the contract or lose the scans; this loses neither.
    const engine = fakeRecognition([
      { pageIndex: 0, lines: [] },
      { pageIndex: 1, lines: [{ text: "NOTICE OF DEPOSITION" }] },
      { pageIndex: 2, lines: [{ text: "SCHEDULE OF EXHIBITS" }] },
    ]);
    const result = await portOver(engine.service).extract({ bytes: MIXED, ...asPdf });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toEqual([
      { pageIndex: 0, provenance: "native", hasText: true },
      { pageIndex: 1, provenance: "ocr", hasText: true },
      { pageIndex: 2, provenance: "ocr", hasText: true },
    ]);
    expect(result.passages.map((passage) => passage.page)).toEqual([1, 2, 3]);
    expect(result.passages[0]!.text).toContain("This agreement is made between");
    expect(result.passages[1]!.text).toBe("NOTICE OF DEPOSITION");
    expect(result.passages[2]!.text).toBe("SCHEDULE OF EXHIBITS");
  });

  it("ignores recognition's answer for a page the native route already read", async () => {
    // The engine is told the whole document and decides per page with the same function the native
    // half used. If it ever answered for a page that had a text layer, taking that answer would put
    // the page in the index twice — once as written and once as read off a picture of it.
    const engine = fakeRecognition([
      { pageIndex: 0, lines: [{ text: "A SECOND READING OF PAGE ONE" }] },
      { pageIndex: 1, lines: [{ text: "NOTICE OF DEPOSITION" }] },
      { pageIndex: 2, lines: [{ text: "SCHEDULE OF EXHIBITS" }] },
    ]);
    const result = await portOver(engine.service).extract({ bytes: MIXED, ...asPdf });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages[0]!.text).not.toContain("A SECOND READING");
    expect(result.pages[0]!.provenance).toBe("native");
  });

  it("indexes the pages it did read when recognition terminally refuses the rest", async () => {
    // Half a document is worth more than none of it, but only when the missing half is missing for
    // good: an engine that rejects the bytes will reject them the same way on every retry.
    const result = await portOver(respondingWith(422)).extract({ bytes: MIXED, ...asPdf });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0]!.text).toContain("This agreement is made between");
    expect(result.pages).toEqual([{ pageIndex: 0, provenance: "native", hasText: true }]);
  });

  it("reports a transient recognition failure as transient even with native text in hand", async () => {
    // The opposite case. Publishing the native half now would leave a permanently half-read document
    // in the corpus, because the job is terminal once it succeeds. Retrying gets the whole thing.
    const result = await portOver(respondingWith(503)).extract({ bytes: MIXED, ...asPdf });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
  });

  it("hands a non-PDF straight to recognition, since there is no text layer to read", async () => {
    const engine = fakeRecognition([{ pageIndex: 0, lines: [{ text: "A PHOTOGRAPHED LETTER" }] }]);
    const result = await portOver(engine.service).extract({
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      contentType: "image/png",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(engine.calls()).toBe(1);
    expect(result.pages).toEqual([{ pageIndex: 0, provenance: "ocr", hasText: true }]);
  });

  it("reports a document that truly yields nothing as unextractable, never as an empty index entry", async () => {
    // An empty index entry asserts "this document contains no text", which is the one answer a
    // discovery search must never give wrongly.
    const engine = fakeRecognition([{ pageIndex: 0, lines: [] }]);
    const result = await portOver(engine.service).extract({ bytes: SCAN_ONLY, ...asPdf });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unextractable");
  });
});

describe("composite text extraction with no recognition engine bound", () => {
  it("still extracts a born-digital document — that half needs no engine", async () => {
    const result = await portOver(undefined).extract({ bytes: BORN_DIGITAL, ...asPdf });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passages).toHaveLength(2);
    expect(result.pages.every((page) => page.provenance === "native")).toBe(true);
  });

  it("parks a document with a scanned page rather than recording it unreadable", async () => {
    // engine-not-implemented is not a failure: the job is deferred, the backlog stays enumerable, and
    // replaying after the engine is deployed drains it.
    for (const bytes of [SCAN_ONLY, MIXED]) {
      const result = await portOver(undefined).extract({ bytes, ...asPdf });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("engine-not-implemented");
    }
  });
});
