import { describe, expect, it } from "vitest";
import pdfFixtures from "virtual:pdf-core-fixtures";
import type { Bindings } from "../src/bindings.ts";
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

// A stand-in for the discovery engine Container. It answers `/read` with whatever reading the case
// wants and counts its calls, so a test can assert which engine actually looked at a document.
interface EngineReadingBody {
  readonly outcome: "read" | "needsConversion" | "needsExpansion";
  readonly identification: { readonly format: string; readonly confidence: string };
  readonly passages: readonly { chunkId: string; text: string; page: number }[];
  readonly pageCount?: number | null;
  readonly documentDate?: { value: string; source: string } | null;
  readonly pagesNeedingRecognition: readonly number[];
  readonly textFingerprint?: string | null;
}

function reading(overrides: Partial<EngineReadingBody> = {}): EngineReadingBody {
  return {
    outcome: "read",
    identification: { format: "pdf", confidence: "certain" },
    passages: [],
    pageCount: null,
    documentDate: null,
    pagesNeedingRecognition: [],
    textFingerprint: null,
    ...overrides,
  };
}

function fakeEngine(
  ...answers: readonly (EngineReadingBody | { status: number; code?: string })[]
) {
  let calls = 0;
  return {
    calls: () => calls,
    service: {
      fetch: async () => {
        const answer = answers[Math.min(calls, answers.length - 1)];
        calls++;
        if (answer !== undefined && "status" in answer) {
          return Response.json({ code: answer.code ?? "corrupt" }, { status: answer.status });
        }
        return Response.json(answer);
      },
    } satisfies Pick<Fetcher, "fetch">,
  };
}

function enginePort(
  engine: Pick<Fetcher, "fetch"> | undefined,
  ocr?: Pick<Fetcher, "fetch">,
  convert?: Pick<Fetcher, "fetch">,
) {
  return resolveTextExtractionPort({
    DISCOVERY_SERVICE: engine,
    OCR_SERVICE: ocr,
    CONVERT: convert,
  } as unknown as Bindings);
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

describe("the discovery engine is the native route when it is bound", () => {
  const bytes = new TextEncoder().encode("any document at all");

  it("reads through the engine and records that the engine is what read it", async () => {
    const engine = fakeEngine(
      reading({
        identification: { format: "officeOpenXmlDocument", confidence: "certain" },
        passages: [{ chunkId: "page-0", text: "The seller shall indemnify.", page: 1 }],
        pageCount: 1,
        documentDate: { value: "2026-03-04T00:00:00Z", source: "documentProperties" },
        textFingerprint: "9f2c1a04bb37de55",
      }),
    );
    const result = await enginePort(engine.service).extract({ bytes, contentType: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(engine.calls()).toBe(1);
    // THE ROUTE IS THE POINT. A corpus that recorded only the text could not say which engine read
    // it, and the answer to "how did you read this production" would be a shrug.
    expect(result.route).toEqual(["discovery-engine"]);
    expect(result.facts.formatIdentified).toBe("officeOpenXmlDocument");
    expect(result.facts.pageCount).toBe(1);
    expect(result.facts.documentDate).toBe("2026-03-04T00:00:00Z");
    expect(result.facts.textFingerprint).toBe("9f2c1a04bb37de55");
    expect(result.passages[0]?.text).toBe("The seller shall indemnify.");
  });

  it("never sends a born-digital document to recognition", async () => {
    // The defect this whole port exists to close, restated for the engine route: recognition skips a
    // page that already has a text layer, so a document routed there alone comes back empty.
    const engine = fakeEngine(
      reading({ passages: [{ chunkId: "page-0", text: "born digital", page: 1 }] }),
    );
    const recognition = fakeRecognition([]);
    const result = await enginePort(engine.service, recognition.service).extract({
      bytes,
      contentType: null,
    });

    expect(result.ok).toBe(true);
    expect(recognition.calls()).toBe(0);
  });

  it("sends only the pixel pages on, and says so in the route", async () => {
    const engine = fakeEngine(
      reading({
        passages: [{ chunkId: "page-0", text: "the contract", page: 1 }],
        pagesNeedingRecognition: [1],
        pageCount: 2,
      }),
    );
    const recognition = fakeRecognition([
      { pageIndex: 0, lines: [{ text: "A SECOND READING OF PAGE ONE" }] },
      { pageIndex: 1, lines: [{ text: "THE APPENDED SCAN" }] },
    ]);
    const result = await enginePort(engine.service, recognition.service).extract({
      bytes,
      contentType: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route).toEqual(["discovery-engine", "recognition"]);
    // Page 0 keeps the engine's reading; recognition's answer for it is discarded, or the page would
    // be in the index twice — once as written and once as read off a picture of it.
    expect(result.pages).toEqual([
      { pageIndex: 0, provenance: "native", hasText: true },
      { pageIndex: 1, provenance: "ocr", hasText: true },
    ]);
    expect(result.passages[0]?.text).toBe("the contract");
    expect(result.passages[1]?.text).toBe("THE APPENDED SCAN");
  });

  it("keeps a page recognition never answered for, as a page that came back empty", async () => {
    // A gap in the provenance list would be indistinguishable from a page nothing ever looked at.
    const engine = fakeEngine(reading({ pagesNeedingRecognition: [0, 1], pageCount: 2 }));
    const recognition = fakeRecognition([{ pageIndex: 0, lines: [{ text: "PAGE ONE" }] }]);
    const result = await enginePort(engine.service, recognition.service).extract({
      bytes,
      contentType: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toEqual([
      { pageIndex: 0, provenance: "ocr", hasText: true },
      { pageIndex: 1, provenance: "ocr", hasText: false },
    ]);
  });

  it("parks a scan when the recognizer is not deployed rather than calling it unreadable", async () => {
    const engine = fakeEngine(reading({ pagesNeedingRecognition: [0], pageCount: 1 }));
    const result = await enginePort(engine.service).extract({ bytes, contentType: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("engine-not-implemented");
  });

  it("turns each of the engine's named refusals into a diagnosis the report can print", async () => {
    for (const [code, expected] of [
      ["encrypted", "encrypted"],
      ["passwordProtected", "passwordProtected"],
      ["corrupt", "corrupt"],
      ["unsupportedFormat", "unsupportedFormat"],
      ["limitExceeded", "limitExceeded"],
      ["noTextExtracted", "noTextExtracted"],
    ] as const) {
      const engine = fakeEngine({ status: 422, code });
      const result = await enginePort(engine.service).extract({ bytes, contentType: null });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("unextractable");
      expect(result.code).toBe(expected);
    }
  });

  it("treats a refusal code it does not recognize as transient, never as a named exception", async () => {
    // An unnamed reason means the engine and this worker are at different versions — a deployment
    // fact, not a fact about the document. Recording it under one of the named codes would put a
    // sentence in an exception report that nobody checked.
    const engine = fakeEngine({ status: 422, code: "somethingNewTheEngineLearned" });
    const result = await enginePort(engine.service).extract({ bytes, contentType: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBeUndefined();
  });

  it("says an archive needs expanding rather than that it holds no words", async () => {
    const engine = fakeEngine(
      reading({
        outcome: "needsExpansion",
        identification: { format: "zipArchive", confidence: "certain" },
      }),
    );
    const result = await enginePort(engine.service).extract({ bytes, contentType: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("needsExpansion");
  });

  it("parks a legacy binary while the office container is undeployed", async () => {
    // The route exists and the engine that walks it does not yet. Parked, not failed: a document the
    // platform can read once a Container lands must not be recorded as one it cannot read.
    const engine = fakeEngine(
      reading({
        outcome: "needsConversion",
        identification: { format: "legacyWordDocument", confidence: "certain" },
      }),
    );
    const result = await enginePort(engine.service).extract({ bytes, contentType: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("engine-not-implemented");
  });

  it("converts a legacy binary, reads the CONVERSION, and keeps the legacy format on the record", async () => {
    // The conversion is not the answer, it is a way to reach one: the text still comes out of the
    // memory-safe engine. And the identified format stays the legacy one, because the review document
    // must record what arrived rather than what the platform turned it into on the way to reading it.
    const engine = fakeEngine(
      reading({
        outcome: "needsConversion",
        identification: { format: "legacyWordDocument", confidence: "certain" },
      }),
      reading({
        identification: { format: "officeOpenXmlDocument", confidence: "certain" },
        passages: [{ chunkId: "page-0", text: "a 1997 memorandum", page: 1 }],
        pageCount: 1,
      }),
    );
    const convert: Pick<Fetcher, "fetch"> = {
      fetch: async () =>
        new Response(new TextEncoder().encode("converted package"), {
          headers: { "content-type": "application/octet-stream" },
        }),
    };
    const result = await enginePort(engine.service, undefined, convert).extract({
      bytes,
      contentType: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route).toEqual(["office-conversion", "discovery-engine"]);
    expect(result.facts.formatIdentified).toBe("legacyWordDocument");
    expect(result.passages[0]?.text).toBe("a 1997 memorandum");
  });

  it("reports an engine that did not answer as transient, so the queue retries it", async () => {
    const engine: Pick<Fetcher, "fetch"> = {
      fetch: async () => new Response("upstream", { status: 503 }),
    };
    const result = await enginePort(engine).extract({ bytes, contentType: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
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
