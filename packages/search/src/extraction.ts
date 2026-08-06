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
      //
      // A FORWARD SEAM: nothing persists this yet. The index consumer reads `passages` and the catalog
      // records document count, size, and schema generation — so the native/ocr distinction described
      // above is produced correctly and then discarded. Saying so here rather than leaving it implied,
      // because a reader who assumes the corpus report is already possible would be wrong: it needs a
      // store on the split row first, which is the change that makes this field readable.
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
//
// EXACTLY ONE PAGE PER INDEX. The engines report page indexes and nothing downstream re-checks them: a
// `chunkId` is `page-<index>`, so a repeated index becomes two passages sharing one chunk id handed to
// the index, and two provenance rows for one page. If one of the duplicates carried lines and the other
// did not, the provenance list would hold `{page: 7, hasText: true}` and `{page: 7, hasText: false}` at
// once — two answers to a question the corpus report exists to answer once. A retry inside the
// recognition container, a page split across two result records, or a plain engine bug is enough to
// produce it, so the assembly point is where it is settled rather than trusted.
//
// The kept entry is the one with lines, and `native` wins a tie — the document's own text layer is the
// exact characters the author typed, where recognition is a reading of a picture of them.
export function extractedFromPages(pages: readonly ExtractedPage[]): TextExtractionResult {
  const byPageIndex = new Map<number, ExtractedPage>();
  for (const page of pages) {
    // A negative index would become page 0 in a passage, which is not a page anyone can turn to.
    if (!Number.isInteger(page.pageIndex) || page.pageIndex < 0) continue;
    const held = byPageIndex.get(page.pageIndex);
    if (held === undefined || preferredPage(held, page) === page) {
      byPageIndex.set(page.pageIndex, page);
    }
  }
  const ordered = [...byPageIndex.values()].sort((left, right) => left.pageIndex - right.pageIndex);
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

// Which of two readings of the same page to keep. Text beats no text, then native beats ocr; failing
// both, the one already held stays, so the choice is deterministic rather than arrival-ordered.
function preferredPage(held: ExtractedPage, candidate: ExtractedPage): ExtractedPage {
  const heldHasText = held.lines.some((line) => line.text.trim() !== "");
  const candidateHasText = candidate.lines.some((line) => line.text.trim() !== "");
  if (heldHasText !== candidateHasText) return heldHasText ? held : candidate;
  if (held.provenance !== candidate.provenance) {
    return held.provenance === "native" ? held : candidate;
  }
  return held;
}
