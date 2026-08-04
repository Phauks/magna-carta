import {
  extracted,
  extractionAdapterError,
  extractionEngineNotImplemented,
  passagesFromPages,
  unextractable,
  type TextExtractionPort,
  type TextExtractionResult,
} from "@magna-carta/search/extraction";
import { z } from "zod";
import type { Bindings } from "../app.ts";

// The engine's per-page recognition facts, validated at the trust boundary before anything downstream
// reads them — the same discipline the /api/v1/ocr route applies to the same response. Only the fields
// the index needs are declared; the engine may report more (word boxes, confidences, orientation) and
// those are simply not read here.
const RecognitionSchema = z.object({
  pages: z.array(
    z.object({
      pageIndex: z.number().int(),
      lines: z.array(z.object({ text: z.string() })),
    }),
  ),
});

// The text-extraction port backed by the recognition service. It is the same engine the OCR route calls,
// reached the same way; the difference is only what happens to the text, which here becomes index
// passages instead of a response body.
//
// The engine skips a page that already carries a text layer, reporting no lines for it. That is correct
// for recognition and lossy for indexing: a born-digital PDF's existing text layer is not read back out,
// so such a document extracts to nothing today. It is recorded as `unextractable` rather than indexed
// empty — an empty index entry would assert "this document contains no text", which is the one answer a
// discovery search must never give wrongly. Reading an existing text layer needs a PDF text-extraction
// edge that crates/pdf-core has internally (page_text_glyphs) but does not yet expose through
// packages/pdf; wiring that edge is what closes this gap, and it drops in behind this same port.
function recognitionPort(ocr: Pick<Fetcher, "fetch">): TextExtractionPort {
  return {
    async extract(input): Promise<TextExtractionResult> {
      let response: Response;
      try {
        response = await ocr.fetch(
          new Request("http://ocr/ocr", { method: "POST", body: input.bytes }),
        );
      } catch (error) {
        return extractionAdapterError(
          error instanceof Error ? error.message : "recognition service error",
        );
      }
      // A document the engine rejects outright will never parse: retrying burns attempts and ends in a
      // dead-letter that reads like an outage. Terminal for this document instead.
      if (response.status === 422)
        return unextractable("the recognition engine rejected the document");
      if (response.status !== 200) {
        return extractionAdapterError(`recognition service ${response.status}`);
      }
      const parsed = RecognitionSchema.safeParse(await response.json());
      if (!parsed.success) return extractionAdapterError("recognition response did not validate");
      const passages = passagesFromPages(parsed.data.pages);
      if (passages.length === 0) {
        return unextractable("the document yielded no recognizable text");
      }
      return extracted(passages);
    },
  };
}

// The deferred port for when the recognition service binding is absent — every test environment, and any
// deployment where the engine is not bound. Reports engine-not-implemented, which parks the job rather
// than failing it, so no document is lost while the engine is unreachable.
const deferredPort: TextExtractionPort = {
  extract: () => Promise.resolve(extractionEngineNotImplemented()),
};

export function resolveTextExtractionPort(env: Bindings): TextExtractionPort {
  return env.OCR_SERVICE === undefined ? deferredPort : recognitionPort(env.OCR_SERVICE);
}
