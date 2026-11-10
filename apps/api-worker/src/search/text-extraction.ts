import { runConversion } from "@magna-carta/conversion/execute";
import { extractPdfText } from "@magna-carta/pdf";
import pdfWasmModule from "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm";
import {
  extractedFromPages,
  extractionAdapterError,
  extractionEngineNotImplemented,
  unextractable,
  NO_DOCUMENT_FACTS,
  type ExtractedDocumentFacts,
  type ExtractedPage,
  type ExtractionEngine,
  type ExtractionFailureCode,
  type TextExtractionFailure,
  type TextExtractionInput,
  type TextExtractionPort,
  type TextExtractionResult,
} from "@magna-carta/search/extraction";
import { z } from "zod";
import type { Bindings } from "../bindings.ts";
import { resolveEnginePort } from "../conversions/conversion-engine.ts";

// The text-extraction port: document bytes in, indexable passages out, COMPOSITE and decided per page.
//
// WHY COMPOSITE. Recognition deliberately skips a page that already carries a text layer — recognizing a
// born-digital page is slower, worse, and returns a recognizer's reading of a picture of the text rather
// than the text. That is right for a recognizer and fatal for an extractor: routed through recognition
// alone, a born-digital PDF — the most common document a firm holds — comes back with no lines on any
// page and is recorded as having no readable text at all. So the native text layer is read first, in
// pure Rust, and only the pages that have no usable text layer are sent on.
//
// PER PAGE, not per document. A scan appended to a born-digital contract is one document with pages of
// both kinds. Whichever way a whole-document router sent it, half the document would be lost. The page
// is the unit that has a single honest answer, and it is already the unit the index chunks on.
//
// THE SAME GATE ON BOTH SIDES. Which pages need recognizing is decided by the native reader, and the
// recognition container asks the identical function. That matters more than it looks: if the extractor
// and the recognizer disagreed about one page, that page would either be read twice (duplicate text in
// the index) or by neither (a page silently absent from the corpus). One function, one answer.
//
// THREE NATIVE ROUTES, RESOLVED IN THIS ORDER, and the order is the correctness rule rather than a
// preference:
//
//   1. The discovery engine (crates/discovery-core behind containers/discovery), when its service is
//      bound. It reads PDF text layers, OOXML, OpenDocument, RTF, email, and plain text in pure Rust,
//      and it also identifies the format from the BYTES and returns the page count, the document date
//      and the near-duplicate fingerprint in the same pass — facts that cost nothing here and a second
//      run over the whole corpus to recover later.
//   2. The in-Worker WASM PDF reader, when the engine is not bound. Narrower (PDFs only) and kept
//      because a deployment without the engine still has to read the documents it can.
//   3. Recognition, for the pages either of the above reported as pixels, and never for a page that
//      already had words.
//
// The office container is a FOURTH route and is not native: a 1997 binary office file has no
// memory-safe reader, so it is converted to its modern package by the consented, network-isolated
// office engine and then read by route 1, which is what keeps the parser that touches an opposing
// party's bytes pure Rust even for a format nothing pure-Rust can parse.

// The engine's per-page recognition facts, validated at the trust boundary before anything downstream
// reads them — the same discipline the /api/v1/ocr route applies to the same response. Only the fields
// the index needs are declared; the engine may report more (word boxes, confidences, orientation) and
// those are simply not read here.
// `nonnegative` because a page index is a position in a document: a negative one would become page 0 in
// a passage, which is not a page anyone can turn to. Uniqueness is not expressible here and is settled
// where the pages are assembled (`extractedFromPages` in @magna-carta/search/extraction), since the
// native and recognition halves can each contribute a reading of the same page.
const RecognitionSchema = z.object({
  pages: z.array(
    z.object({
      pageIndex: z.number().int().nonnegative(),
      lines: z.array(z.object({ text: z.string() })),
    }),
  ),
});

// The discovery engine's reading, validated at the same trust boundary and for the same reason. The
// engine reports more than this (digests, the entry listing of an archive); only what routing and the
// review document need is declared.
const ReadingSchema = z.object({
  outcome: z.enum(["read", "needsConversion", "needsExpansion"]),
  identification: z.object({ format: z.string(), confidence: z.string() }),
  passages: z.array(
    z.object({ chunkId: z.string(), text: z.string(), page: z.number().int().positive() }),
  ),
  pageCount: z.number().int().nonnegative().nullable().optional(),
  documentDate: z.object({ value: z.string(), source: z.string() }).nullable().optional(),
  pagesNeedingRecognition: z.array(z.number().int().nonnegative()),
  textFingerprint: z.string().nullable().optional(),
  // The engine hashes the bytes in the same pass it reads them. Only the three digests the corpus
  // has columns for are declared; the engine reports SHA-384 and SHA-512 as well and they are simply
  // not read, because a digest nothing stores is a digest nothing can be checked against.
  digests: z
    .object({ md5: z.string(), sha1: z.string(), sha256: z.string() })
    .nullable()
    .optional(),
});

// The engine's 422 body: its stable code and nothing else. Anything richer would be a way for a
// document's own bytes to leave in a response, which is why the engine refuses to send one.
const EngineErrorSchema = z.object({ code: z.string() });

// The engine's own error codes, and what the pipeline does with each. Everything but the last is
// TERMINAL FOR THIS DOCUMENT — bytes nobody has the key to, or a format nothing can parse, do not
// become readable on a retry — so it is recorded rather than retried, and the code travels with it so
// the corpus report can say which one it was.
const ENGINE_CODE_DISPOSITION: Readonly<
  Record<string, { readonly code: ExtractionFailureCode; readonly detail: string }>
> = {
  corrupt: { code: "corrupt", detail: "the document is damaged past reading" },
  encrypted: { code: "encrypted", detail: "the document's content is encrypted" },
  passwordProtected: {
    code: "passwordProtected",
    detail: "the document is locked with a user password",
  },
  unsupportedFormat: {
    code: "unsupportedFormat",
    detail: "no native route reads this format",
  },
  limitExceeded: {
    code: "limitExceeded",
    detail: "the document is past a declared extraction bound",
  },
  containerGuardTripped: {
    code: "containerGuardTripped",
    detail: "the container tripped an expansion guard",
  },
  noTextExtracted: { code: "noTextExtracted", detail: "the document holds no text at all" },
};

// Which modern package each legacy binary converts to. The identified format is the engine's own
// label; the target is a conversion-registry format id, and the conversion path is resolved by that
// registry rather than by a second mapping owned here.
const LEGACY_CONVERSION: Readonly<Record<string, { readonly from: string; readonly to: string }>> =
  {
    legacyWordDocument: { from: "doc", to: "docx" },
    legacyExcelWorkbook: { from: "xls", to: "xlsx" },
    legacyPowerPointPresentation: { from: "ppt", to: "pptx" },
  };

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

// Sniffed from the bytes, not from the declared content type. The declared type is whatever the
// uploader said; the native route reads a PDF parser's output and must only be given a PDF.
function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= PDF_MAGIC.length && PDF_MAGIC.every((byte, index) => bytes[index] === byte)
  );
}

interface NativePages {
  readonly pages: readonly ExtractedPage[];
  readonly needRecognition: readonly number[];
  readonly facts: ExtractedDocumentFacts;
}

// Read the document's own text layer with the in-Worker PDF reader. Returns undefined when the bytes
// are not a PDF, or when the PDF engine refuses them — an image, a bomb, or a document with more pages
// than one call will interpret. Undefined means "the native route has nothing to say about this", NOT
// "this document has no text": the caller falls through to recognition, which is the honest next thing
// to try rather than a conclusion.
//
// The page ceiling is the engine's, and it matches the discovery engine's (50,000 pages), so a long
// born-digital document reads the same whichever native route looked. It is bounded at all only
// because page count is declared in the file and wholly attacker-controlled.
async function nativePages(bytes: Uint8Array): Promise<NativePages | undefined> {
  if (!looksLikePdf(bytes)) return undefined;
  try {
    const extractedText = await extractPdfText(bytes, pdfWasmModule);
    const pages: ExtractedPage[] = [];
    const needRecognition: number[] = [];
    for (const page of extractedText.pages) {
      if (page.needsRecognition) {
        needRecognition.push(page.pageIndex);
        continue;
      }
      pages.push({ pageIndex: page.pageIndex, provenance: "native", lines: page.lines });
    }
    return {
      pages,
      needRecognition,
      // This reader answers about text layers and page indexes only. It identifies nothing (the caller
      // already sniffed the magic bytes), dates nothing, and fingerprints nothing — so it reports the
      // page count it actually walked and leaves the rest null rather than filling them with guesses.
      facts: {
        ...NO_DOCUMENT_FACTS,
        formatIdentified: "pdf",
        pageCount: pages.length + needRecognition.length,
      },
    };
  } catch {
    // A guard refusal, a page-count refusal, or a parse failure is this document's property, and
    // recognition applies its own guards to the same bytes: let it have its turn rather than deciding
    // here. Rethrowing would turn a document the recognizer could have read into a retry storm.
    return undefined;
  }
}

// The recognition half. The engine is handed the whole document and skips the pages that already carry a
// text layer of their own — the same judgement the native half made, from the same function — so only
// the wanted pages come back with lines. Sending the whole document rather than a page subset is what
// keeps this one round trip instead of one per page, and costs nothing extra: a skipped page is a
// coverage measurement, not a raster and an inference.
async function recognizedPages(
  ocr: Pick<Fetcher, "fetch">,
  bytes: Uint8Array,
  wanted: ReadonlySet<number> | undefined,
): Promise<{ pages: ExtractedPage[] } | TextExtractionFailureResult> {
  let response: Response;
  try {
    response = await ocr.fetch(new Request("http://ocr/ocr", { method: "POST", body: bytes }));
  } catch (error) {
    return {
      failure: extractionAdapterError(
        error instanceof Error ? error.message : "recognition service error",
        "recognitionFailed",
      ),
    };
  }
  // A document the engine rejects outright will never parse: retrying burns attempts and ends in a
  // dead-letter that reads like an outage. Terminal for this document instead.
  if (response.status === 422) {
    return {
      failure: unextractable("the recognition engine rejected the document", "recognitionFailed"),
    };
  }
  if (response.status !== 200) {
    return {
      failure: extractionAdapterError(
        `recognition service ${response.status}`,
        "recognitionFailed",
      ),
    };
  }
  const parsed = RecognitionSchema.safeParse(await response.json());
  if (!parsed.success) {
    return {
      failure: extractionAdapterError("recognition response did not validate", "recognitionFailed"),
    };
  }
  return {
    pages: parsed.data.pages
      .filter((page) => wanted === undefined || wanted.has(page.pageIndex))
      .map((page) => ({
        pageIndex: page.pageIndex,
        provenance: "ocr" as const,
        lines: page.lines,
      })),
  };
}

interface TextExtractionFailureResult {
  readonly failure: TextExtractionFailure;
}

function isFailure(
  value: { pages: ExtractedPage[] } | TextExtractionFailureResult,
): value is TextExtractionFailureResult {
  return "failure" in value;
}

type EngineReading = z.infer<typeof ReadingSchema>;

// One call to the discovery engine. Its failures are typed the same three ways every other port here
// is: a code it named (terminal), a transport fault (transient), or a body that did not validate
// (transient, because a service answering nonsense is a deployment problem rather than this
// document's).
async function engineReading(
  discovery: Pick<Fetcher, "fetch">,
  bytes: Uint8Array,
): Promise<EngineReading | TextExtractionFailureResult> {
  let response: Response;
  try {
    response = await discovery.fetch(
      new Request("http://discovery/read", { method: "POST", body: bytes }),
    );
  } catch (error) {
    return {
      failure: extractionAdapterError(
        error instanceof Error ? error.message : "discovery engine error",
      ),
    };
  }
  if (response.status === 422) {
    const named = EngineErrorSchema.safeParse(await response.json());
    const disposition =
      named.success === true ? ENGINE_CODE_DISPOSITION[named.data.code] : undefined;
    if (disposition === undefined) {
      // A code this router does not know is still the engine's considered answer about a document, so
      // it is terminal rather than retried — but it is NOT given one of the known codes, because a
      // corpus report that named the wrong reason is worse than one that says the reason is unnamed.
      return { failure: unextractable("the discovery engine refused the document") };
    }
    return { failure: unextractable(disposition.detail, disposition.code) };
  }
  if (response.status !== 200) {
    return { failure: extractionAdapterError(`discovery engine ${response.status}`) };
  }
  const parsed = ReadingSchema.safeParse(await response.json());
  if (!parsed.success) {
    return { failure: extractionAdapterError("discovery engine response did not validate") };
  }
  return parsed.data;
}

function isEngineFailure(
  value: EngineReading | TextExtractionFailureResult,
): value is TextExtractionFailureResult {
  return "failure" in value;
}

// The engine's passages back into the per-page shape the assembly point takes. Splitting on newlines
// is the exact inverse of the join `passagesFromPages` performs, and the engine's normalization has
// already trimmed each line, so a passage that goes out and comes back is byte-identical.
function pagesOfReading(reading: EngineReading): ExtractedPage[] {
  return reading.passages.map((passage) => ({
    // The engine's `page` is the 1-based page a person would name; every page index in this module is
    // 0-based, as the readers report them.
    pageIndex: passage.page - 1,
    provenance: "native" as const,
    lines: passage.text.split("\n").map((text) => ({ text })),
  }));
}

function factsOfReading(reading: EngineReading): ExtractedDocumentFacts {
  return {
    formatIdentified: reading.identification.format,
    pageCount: reading.pageCount ?? null,
    documentDate: reading.documentDate?.value ?? null,
    documentDateSource: reading.documentDate?.source ?? null,
    textFingerprint: reading.textFingerprint ?? null,
    digests: reading.digests ?? null,
  };
}

interface CompositeServices {
  readonly discovery: Pick<Fetcher, "fetch"> | undefined;
  readonly ocr: Pick<Fetcher, "fetch"> | undefined;
  // Resolved lazily and per hop by the conversion registry's own resolver, so discovery does not grow
  // a second answer to "which service runs the office engine".
  readonly convert: ReturnType<typeof resolveEnginePort>;
}

function compositePort(services: CompositeServices): TextExtractionPort {
  return {
    extract(input: TextExtractionInput): Promise<TextExtractionResult> {
      return services.discovery === undefined
        ? readWithoutEngine(services.ocr, input.bytes)
        : readWithEngine(services, services.discovery, input.bytes, 0);
    },
  };
}

// How many times a conversion may hand its output back to the engine. One: a legacy binary converts
// to its modern package and the package is read. A second hop would mean the office engine produced
// something that itself needs converting, which is a loop rather than a document.
const MAXIMUM_CONVERSION_HOPS = 1;

async function readWithEngine(
  services: CompositeServices,
  discovery: Pick<Fetcher, "fetch">,
  bytes: Uint8Array,
  hop: number,
): Promise<TextExtractionResult> {
  const reading = await engineReading(discovery, bytes);
  if (isEngineFailure(reading)) return reading.failure;

  // An archive's entries are separate documents, not this document's text. Naming that outcome is what
  // lets the caller record the archive honestly and expand it as a family in its own right; reporting
  // it as "no text" would be a lie about a file that never had any.
  if (reading.outcome === "needsExpansion") {
    return unextractable(
      "the document is a container whose entries are separate documents",
      "needsExpansion",
    );
  }

  if (reading.outcome === "needsConversion") {
    if (hop >= MAXIMUM_CONVERSION_HOPS) {
      return unextractable(
        "the conversion produced a document that itself needs converting",
        "conversionFailed",
      );
    }
    return convertThenRead(services, discovery, bytes, reading);
  }

  const engineRoute: ExtractionEngine[] = ["discovery-engine"];
  const facts = factsOfReading(reading);
  const wanted = new Set(reading.pagesNeedingRecognition);
  // The pages the engine actually read. The placeholders it left for pixel pages are excluded here so
  // that a page which went to recognition is never also reported as a page the text layer answered.
  const readNatively = pagesOfReading(reading).filter((page) => !wanted.has(page.pageIndex));
  if (wanted.size === 0) {
    return finish(readNatively, engineRoute, facts);
  }

  if (services.ocr === undefined) {
    // Parked, not failed. The pages are pictures and the engine that reads pictures is not deployed;
    // recording the document unreadable would take a document out of the corpus over a deploy step.
    return extractionEngineNotImplemented("the recognition engine is not deployed");
  }
  const recognized = await recognizedPages(services.ocr, bytes, wanted);
  if (isFailure(recognized)) {
    return partialOrFailure(readNatively, recognized.failure, engineRoute, facts);
  }
  return finish(
    [...readNatively, ...withUnansweredPages(recognized.pages, wanted)],
    [...engineRoute, "recognition"],
    facts,
  );
}

// A page recognition was asked about and did not answer for is carried through as an EMPTY `ocr` page
// rather than dropped. It contributes no passage either way; what it contributes is the provenance
// row that says "page 7 went to recognition and came back with nothing", which is the difference
// between a corpus report that accounts for every page and one with a hole in it.
function withUnansweredPages(
  recognized: readonly ExtractedPage[],
  wanted: ReadonlySet<number>,
): ExtractedPage[] {
  const answered = new Set(recognized.map((page) => page.pageIndex));
  const pages = [...recognized];
  for (const pageIndex of wanted) {
    if (answered.has(pageIndex)) continue;
    pages.push({ pageIndex, provenance: "ocr", lines: [] });
  }
  return pages;
}

// A legacy binary: convert with the consented office engine, then read the conversion with the pure
// Rust engine. THE CONVERSION IS NOT THE ANSWER, it is a way to reach one — the text still comes out
// of the memory-safe reader, which is what keeps the parser that touches an opposing party's bytes
// pure Rust even for a format no pure-Rust parser exists for.
async function convertThenRead(
  services: CompositeServices,
  discovery: Pick<Fetcher, "fetch">,
  bytes: Uint8Array,
  reading: EngineReading,
): Promise<TextExtractionResult> {
  const edge = LEGACY_CONVERSION[reading.identification.format];
  if (edge === undefined) {
    return unextractable("no conversion route reads this format", "unsupportedFormat");
  }
  const conversion = await runConversion(edge.from, edge.to, bytes, services.convert);
  if (!conversion.ok) {
    if (conversion.reason === "engine-not-implemented") {
      // The office container is not deployed. Parked for the same reason a missing recognizer parks a
      // scan: the document is readable, by an engine that is not there yet.
      return extractionEngineNotImplemented("the office conversion engine is not deployed");
    }
    if (conversion.reason === "unsupported-edge") {
      return unextractable("no conversion route reads this format", "conversionUnavailable");
    }
    return extractionAdapterError(
      conversion.detail ?? "office conversion failed",
      "conversionFailed",
    );
  }
  const converted = await readWithEngine(services, discovery, conversion.bytes, 1);
  if (!converted.ok) return converted;
  return {
    ...converted,
    // The route names the conversion FIRST and the engine second, in the order they ran, so a reader
    // of the corpus report can see that the text is a reading of a converted document rather than of
    // the bytes the other side handed over. That distinction is the whole reason the route is stored.
    route: ["office-conversion", ...converted.route],
    // The identified format stays the LEGACY one, and so do the DIGESTS. The review document must
    // record what arrived, not what the platform turned it into on the way to reading it — a
    // manifest whose hashes were taken over a conversion the other side never sent would be a
    // manifest the other side could not check. Everything else is a fact about the text, and the
    // text is the conversion's.
    facts: {
      ...converted.facts,
      formatIdentified: reading.identification.format,
      digests: reading.digests ?? null,
    },
  };
}

// The route when the discovery engine is not bound: the in-Worker PDF reader plus recognition. Narrower
// than the engine — a PDF and anything recognition can read, and nothing else — and kept because a
// deployment without the engine still has to read the documents it can.
async function readWithoutEngine(
  ocr: Pick<Fetcher, "fetch"> | undefined,
  bytes: Uint8Array,
): Promise<TextExtractionResult> {
  const native = await nativePages(bytes);
  if (ocr === undefined) {
    if (native === undefined || native.needRecognition.length > 0) {
      return extractionEngineNotImplemented();
    }
    if (native.pages.length === 0) return unextractable("the document has no pages to extract");
    const result = finish(native.pages, ["pdf-text-layer"], native.facts);
    // A PDF whose every page is born-digital and yet yields nothing is a document we have genuinely
    // read and found empty — but with no engine bound there is no second opinion, so it parks rather
    // than being recorded as terminally unreadable.
    if (!result.ok && result.reason === "unextractable") return extractionEngineNotImplemented();
    return result;
  }

  // Every page read natively: no recognition call at all. This is the common case for a firm's
  // documents, and skipping the round trip is the difference between extraction costing a parse and
  // costing a rasterize-and-infer per page.
  if (native !== undefined && native.needRecognition.length === 0) {
    if (native.pages.length === 0) {
      return unextractable("the document has no pages to extract");
    }
    return finish(native.pages, ["pdf-text-layer"], native.facts);
  }

  const wanted = native === undefined ? undefined : new Set(native.needRecognition);
  const recognized = await recognizedPages(ocr, bytes, wanted);
  const route: ExtractionEngine[] =
    native === undefined ? ["recognition"] : ["pdf-text-layer", "recognition"];
  const facts = native?.facts ?? NO_DOCUMENT_FACTS;
  if (isFailure(recognized)) {
    return partialOrFailure(native?.pages ?? [], recognized.failure, route, facts);
  }
  return finish([...(native?.pages ?? []), ...recognized.pages], route, facts);
}

// Recognition failed on a document whose native half already produced text. That text is real and
// indexing it is strictly better than indexing nothing — but only for a TERMINAL failure. A transient
// one is reported as transient so the queue retries and the missing pages get another chance, rather
// than publishing a permanently half-read document.
function partialOrFailure(
  partial: readonly ExtractedPage[],
  failure: TextExtractionFailure,
  route: readonly ExtractionEngine[],
  facts: ExtractedDocumentFacts,
): TextExtractionResult {
  const terminal = failure.reason !== "adapter-error";
  if (terminal && partial.some((page) => page.lines.some((line) => line.text.trim() !== ""))) {
    return finish(partial, route, facts);
  }
  return failure;
}

// An empty result is reported as `noTextExtracted`, never indexed empty: an empty index entry asserts
// "this document contains no text", which is the one answer a discovery search must never give wrongly.
function finish(
  pages: readonly ExtractedPage[],
  route: readonly ExtractionEngine[],
  facts: ExtractedDocumentFacts,
): TextExtractionResult {
  const result = extractedFromPages(pages, route, facts);
  if (result.ok && result.passages.length === 0) {
    return unextractable("the document yielded no readable text", "noTextExtracted");
  }
  return result;
}

export function resolveTextExtractionPort(env: Bindings): TextExtractionPort {
  return compositePort({
    discovery: env.DISCOVERY_SERVICE,
    ocr: env.OCR_SERVICE,
    convert: resolveEnginePort(env),
  });
}
