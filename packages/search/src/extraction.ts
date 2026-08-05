import type { Passage } from "./port.ts";

// TextExtractionPort is the "extract" stage of the write pipeline: document bytes in, indexable passages
// out. It is a separate port from SearchIndexPort because the two are separate services with separate
// deploy states — text recognition is a live engine today, the index engine is not — and a caller has to
// be able to tell "nothing extracted this document yet" from "nothing indexed it yet".
//
// Same discipline as SearchIndexPort and ConversionPort: every outcome is a typed value, never a thrown
// error, so the consumer pattern-matches. The reasons are deliberately three, because the pipeline does
// three different things with them: `engine-not-implemented` parks the job (the engine is simply not
// deployed — not this document's fault), `unextractable` is terminal for this document (a format nothing
// can read: retrying cannot help), and `adapter-error` is transient (retry, then dead-letter).
export type TextExtractionFailureReason =
  | "engine-not-implemented"
  | "unextractable"
  | "adapter-error";

export interface TextExtractionFailure {
  readonly ok: false;
  readonly reason: TextExtractionFailureReason;
  readonly detail?: string;
}

// Where one page's text came from. Extraction is composite and decided per page, not per document: a
// scan appended to a born-digital contract has pages of both kinds, and a document routed whole would
// lose one half or the other. `native` is the document's own text layer, read exactly; `ocr` is a
// recognizer's reading of a picture of the page, which is a different kind of evidence — good enough to
// search, not the characters the author typed. A consumer that has to report on its corpus (the review
// exception report is the one that must) can only tell them apart if the extractor says which is which.
export type TextProvenance = "native" | "ocr";

export interface PageProvenance {
  // Zero-based, as the engines report it.
  readonly pageIndex: number;
  readonly provenance: TextProvenance;
  // False for a page that produced nothing — a genuinely blank page, or one recognition could not read.
  // Recorded rather than dropped, so "page 7 went to recognition and came back empty" stays answerable.
  readonly hasText: boolean;
}

export type TextExtractionResult =
  | {
      readonly ok: true;
      readonly passages: readonly Passage[];
      // One entry per page the extractor looked at, in page order. Empty for a format that has no
      // pages at all, which is why it is not a substitute for `passages`.
      readonly pages: readonly PageProvenance[];
    }
  | TextExtractionFailure;

export interface TextExtractionInput {
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
}

export interface TextExtractionPort {
  extract(input: TextExtractionInput): Promise<TextExtractionResult>;
}

export function extracted(
  passages: readonly Passage[],
  pages: readonly PageProvenance[] = [],
): TextExtractionResult {
  return { ok: true, passages, pages };
}

export function extractionEngineNotImplemented(): TextExtractionFailure {
  return { ok: false, reason: "engine-not-implemented" };
}

export function unextractable(detail: string): TextExtractionFailure {
  return { ok: false, reason: "unextractable", detail };
}

export function extractionAdapterError(detail: string): TextExtractionFailure {
  return { ok: false, reason: "adapter-error", detail };
}

// One page's text and where it came from, as the composite extractor assembles it.
export interface ExtractedPage {
  readonly pageIndex: number;
  readonly provenance: TextProvenance;
  readonly lines: readonly { readonly text: string }[];
}

// One page of text becomes one passage. A page is the chunk boundary the whole subsystem
// already uses — the semantic half embeds per passage, and a hit carries the page back for display — so
// the keyword and semantic halves stay aligned on the same units without a second chunking rule.
// A page whose lines are all empty contributes nothing rather than an empty passage, so a blank page
// does not become a document the index has to carry.
export function passagesFromPages(
  pages: readonly { readonly pageIndex: number; readonly lines: readonly { text: string }[] }[],
): Passage[] {
  const passages: Passage[] = [];
  for (const page of pages) {
    const text = page.lines
      .map((line) => line.text.trim())
      .filter((line) => line !== "")
      .join("\n");
    if (text === "") continue;
    // pageIndex is 0-based off the engine; a passage's `page` is the 1-based page a person would name.
    passages.push({ chunkId: `page-${page.pageIndex}`, text, page: page.pageIndex + 1 });
  }
  return passages;
}

// The composite extractor's one assembly point: pages in page order, from whichever route read each,
// out as the passages the index takes plus the provenance record the reports read. Both halves are
// derived from the same input here rather than assembled twice at the call site, because a passage
// whose page is not in the provenance list — or the reverse — is a document nobody can account for.
export function extractedFromPages(pages: readonly ExtractedPage[]): TextExtractionResult {
  const ordered = [...pages].sort((left, right) => left.pageIndex - right.pageIndex);
  const passages = passagesFromPages(ordered);
  const withText = new Set(passages.map((passage) => passage.chunkId));
  return extracted(
    passages,
    ordered.map((page) => ({
      pageIndex: page.pageIndex,
      provenance: page.provenance,
      hasText: withText.has(`page-${page.pageIndex}`),
    })),
  );
}
