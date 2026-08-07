import { extractPdfText } from "@magna-carta/pdf";
import pdfWasmModule from "@magna-carta/pdf/src/pkg/pdf_core_bg.wasm";
import {
  extractedFromPages,
  extractionAdapterError,
  extractionEngineNotImplemented,
  unextractable,
  type ExtractedPage,
  type TextExtractionFailure,
  type TextExtractionInput,
  type TextExtractionPort,
  type TextExtractionResult,
} from "@magna-carta/search/extraction";
import { z } from "zod";
import type { Bindings } from "../app.ts";

// The text-extraction port: document bytes in, indexable passages out, COMPOSITE and decided per page.
//
// WHY COMPOSITE. Recognition deliberately skips a page that already carries a text layer — recognizing a
// born-digital page is slower, worse, and returns a recognizer's reading of a picture of the text rather
// than the text. That is right for a recognizer and fatal for an extractor: routed through recognition
// alone, a born-digital PDF — the most common document a firm holds — comes back with no lines on any
// page and is recorded as having no readable text at all. So the native text layer is read first, in
// pure Rust (crates/pdf-core), and only the pages that have no usable text layer are sent on.
//
// PER PAGE, not per document. A scan appended to a born-digital contract is one document with pages of
// both kinds. Whichever way a whole-document router sent it, half the document would be lost. The page
// is the unit that has a single honest answer, and it is already the unit the index chunks on.
//
// THE SAME GATE ON BOTH SIDES. Which pages need recognizing is decided by `pdf-core`, and the
// recognition container asks the identical function. That matters more than it looks: if the extractor
// and the recognizer disagreed about one page, that page would either be read twice (duplicate text in
// the index) or by neither (a page silently absent from the corpus). One function, one answer.

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
}

// Read the document's own text layer. Returns undefined when the bytes are not a PDF, or when the PDF
// engine refuses them — an image, a bomb, or a document with more pages than one call will interpret.
// Undefined means "the native route has nothing to say about this", NOT "this document has no text":
// the caller falls through to recognition, which is the honest next thing to try rather than a
// conclusion.
//
// The page ceiling is the engine's, and it deliberately matches the recognition container's, so a
// document too long for one route is too long for the other and the outcome does not depend on which
// one looked. Both are bounded because page count is declared in the file and wholly
// attacker-controlled. Lifting it belongs with the move of extraction into a Container of its own,
// where a long document can be walked without a request-shaped CPU budget over it.
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
    return { pages, needRecognition };
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
      ),
    };
  }
  // A document the engine rejects outright will never parse: retrying burns attempts and ends in a
  // dead-letter that reads like an outage. Terminal for this document instead.
  if (response.status === 422) {
    return { failure: unextractable("the recognition engine rejected the document") };
  }
  if (response.status !== 200) {
    return { failure: extractionAdapterError(`recognition service ${response.status}`) };
  }
  const parsed = RecognitionSchema.safeParse(await response.json());
  if (!parsed.success) {
    return { failure: extractionAdapterError("recognition response did not validate") };
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

function compositePort(ocr: Pick<Fetcher, "fetch">): TextExtractionPort {
  return {
    async extract(input: TextExtractionInput): Promise<TextExtractionResult> {
      const native = await nativePages(input.bytes);

      // Every page read natively: no recognition call at all. This is the common case for a firm's
      // documents, and skipping the round trip is the difference between extraction costing a parse and
      // costing a rasterize-and-infer per page.
      if (native !== undefined && native.needRecognition.length === 0) {
        if (native.pages.length === 0) {
          return unextractable("the document has no pages to extract");
        }
        return finish(native.pages);
      }

      const wanted = native === undefined ? undefined : new Set(native.needRecognition);
      const recognized = await recognizedPages(ocr, input.bytes, wanted);
      if (isFailure(recognized)) {
        // Recognition failed on a document whose native half already produced text. That text is real
        // and indexing it is strictly better than indexing nothing — but only for a terminal failure.
        // A transient one is reported as transient so the queue retries and the missing pages get
        // another chance, rather than publishing a permanently half-read document.
        const partial = native?.pages ?? [];
        const terminal = recognized.failure.reason !== "adapter-error";
        if (terminal && partial.some((page) => page.lines.length > 0)) {
          return finish(partial);
        }
        return recognized.failure;
      }

      return finish([...(native?.pages ?? []), ...recognized.pages]);
    },
  };
}

// An empty result is reported as `unextractable`, never indexed empty: an empty index entry asserts
// "this document contains no text", which is the one answer a discovery search must never give wrongly.
function finish(pages: readonly ExtractedPage[]): TextExtractionResult {
  const result = extractedFromPages(pages);
  if (result.ok && result.passages.length === 0) {
    return unextractable("the document yielded no readable text");
  }
  return result;
}

// The deferred port for when the recognition service binding is absent — every test environment, and any
// deployment where the engine is not bound. A PDF whose pages all carry their own text layer is still
// extracted, because that half needs no engine at all; only a document with a page that genuinely needs
// recognizing reports engine-not-implemented, which parks the job rather than failing it.
const deferredPort: TextExtractionPort = {
  async extract(input: TextExtractionInput): Promise<TextExtractionResult> {
    const native = await nativePages(input.bytes);
    if (native === undefined || native.needRecognition.length > 0) {
      return extractionEngineNotImplemented();
    }
    if (native.pages.length === 0) return unextractable("the document has no pages to extract");
    const result = finish(native.pages);
    // A PDF whose every page is born-digital and yet yields nothing is a document we have genuinely
    // read and found empty — but with no engine bound there is no second opinion, so it parks rather
    // than being recorded as terminally unreadable.
    if (!result.ok && result.reason === "unextractable") return extractionEngineNotImplemented();
    return result;
  },
};

export function resolveTextExtractionPort(env: Bindings): TextExtractionPort {
  return env.OCR_SERVICE === undefined ? deferredPort : compositePort(env.OCR_SERVICE);
}
