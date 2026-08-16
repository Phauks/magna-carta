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

// WHAT WENT WRONG, as distinct from WHAT THE PIPELINE SHOULD DO ABOUT IT. The reason above answers
// the second question and has exactly three answers because the pipeline does exactly three things.
// This answers the first, and a corpus report has to be able to say it: "we could not read this, and
// it was an encrypted Word document" is a defensible sentence in front of a court, where "extraction
// failed" is not. The two are separate fields because they are separate facts — `encrypted` and
// `unsupportedFormat` are both terminal, and a reader who only had the disposition could not tell a
// document nobody has the key to from one nothing can parse.
//
// The first seven are the discovery engine's own stable codes, byte-identical to the strings
// crates/discovery-core/src/error.rs emits, so the mapping across the wire is an equality check
// rather than a translation table that can drift. The last four are the router's own: an engine that
// is not deployed, a conversion that could not run or could not read its own output, and an archive
// whose entries are separate documents rather than text.
export const EXTRACTION_FAILURE_CODES = [
  "corrupt",
  "encrypted",
  "passwordProtected",
  "unsupportedFormat",
  "limitExceeded",
  "containerGuardTripped",
  "noTextExtracted",
  "recognitionFailed",
  "conversionUnavailable",
  "conversionFailed",
  "needsExpansion",
] as const;
export type ExtractionFailureCode = (typeof EXTRACTION_FAILURE_CODES)[number];

export interface TextExtractionFailure {
  readonly ok: false;
  readonly reason: TextExtractionFailureReason;
  readonly detail?: string;
  // Absent only where the router genuinely has no diagnosis — a bare adapter error from a service
  // that did not answer. Never inferred from `reason`, because a guess recorded beside real codes
  // reads exactly like one of them.
  readonly code?: ExtractionFailureCode;
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

// WHICH ENGINE READ THE DOCUMENT. Provenance above is per page and says whether a page's words are
// the author's characters or a machine's reading of a picture of them; this is per document and says
// which service produced them. They answer different questions and a corpus report needs both: a
// firm asked how it read a production has to be able to name the engine, and an engine's version is
// what makes a re-processing years later able to state what changed.
//
// `discovery-engine` is the pure-Rust engine (crates/discovery-core behind containers/discovery) —
// the native route for every format it knows. `pdf-text-layer` is the in-Worker WASM PDF reader,
// which is the route when the engine is not bound. `recognition` is the OCR service, reached only
// for pages the native route reported as pixels. `office-conversion` is the LibreOffice container,
// reached only for a legacy binary the native route cannot open at all.
export const EXTRACTION_ENGINES = [
  "discovery-engine",
  "pdf-text-layer",
  "recognition",
  "office-conversion",
] as const;
export type ExtractionEngine = (typeof EXTRACTION_ENGINES)[number];

// The per-document facts an extraction produces in the same pass as the text, for the same cost.
// Every one of them is expensive to retrofit — recovering a page count or a document date later
// means re-reading every byte of the corpus, which at discovery scale is a second processing run
// rather than a migration — and every one of them is nullable, because a route that cannot produce
// one says so rather than inventing it.
export interface ExtractedDocumentFacts {
  // The engine's own stable format label, from its closed vocabulary. Never derived from a file name.
  readonly formatIdentified: string | null;
  readonly pageCount: number | null;
  // The best available internal date, and WHERE IT CAME FROM. The source travels with the value
  // because a sent time and a file-system timestamp are not the same kind of evidence, and a sort
  // column that mixed them without saying so would be a corpus ordered by two different facts.
  readonly documentDate: string | null;
  readonly documentDateSource: string | null;
  // The near-duplicate signature over the normalized text, hex. Computed inside the extraction pass
  // where the text is already in memory; clustering over it is a later slice.
  //
  // IT IS A SIMILARITY SCORE, NOT AN IDENTITY. It collides by design — that is what makes it useful
  // for finding near-duplicates — so nothing may suppress a document from review on the strength of
  // it. The digests below are the identity.
  readonly textFingerprint: string | null;
  // The digest set over the document's OWN bytes, computed in the same pass as the text for the same
  // cost. SHA-256 is the identity two copies of a document are the same by; MD5 and SHA-1 are
  // legacy-interop, present because e-discovery load-file specifications and opposing-party tooling
  // still ask for them, and labelled that way wherever they are rendered. Null from a route that
  // does not hash — a reader that reports pages says nothing about bytes, and a null here is that
  // silence rather than an absent hash.
  readonly digests: ExtractedDigestSet | null;
}

export interface ExtractedDigestSet {
  readonly md5: string;
  readonly sha1: string;
  readonly sha256: string;
}

export const NO_DOCUMENT_FACTS: ExtractedDocumentFacts = {
  formatIdentified: null,
  pageCount: null,
  documentDate: null,
  documentDateSource: null,
  textFingerprint: null,
  digests: null,
};

export type TextExtractionResult =
  | {
      readonly ok: true;
      readonly passages: readonly Passage[];
      // One entry per page the extractor looked at, in page order. Empty for a format that has no
      // pages at all, which is why it is not a substitute for `passages`.
      //
      // The search half of the pipeline still discards this: the index consumer reads `passages` and
      // the catalog records document count, size, and schema generation, so a split row cannot yet
      // answer which of its pages were recognized. The discovery half DOES persist it, on the review
      // document, which is what makes the exception report able to say "page 7 went to recognition
      // and came back empty" rather than only "this document is short".
      readonly pages: readonly PageProvenance[];
      // The engines that contributed, in the order they ran, deduplicated. NEVER EMPTY on a success:
      // a document that produced text produced it somewhere, and a route recorded as nothing is the
      // silence the whole subsystem exists to refuse.
      readonly route: readonly ExtractionEngine[];
      readonly facts: ExtractedDocumentFacts;
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
  route: readonly ExtractionEngine[] = [],
  facts: ExtractedDocumentFacts = NO_DOCUMENT_FACTS,
): TextExtractionResult {
  return { ok: true, passages, pages, route, facts };
}

export function extractionEngineNotImplemented(detail?: string): TextExtractionFailure {
  return detail === undefined
    ? { ok: false, reason: "engine-not-implemented" }
    : { ok: false, reason: "engine-not-implemented", detail };
}

export function unextractable(detail: string, code?: ExtractionFailureCode): TextExtractionFailure {
  return code === undefined
    ? { ok: false, reason: "unextractable", detail }
    : { ok: false, reason: "unextractable", detail, code };
}

export function extractionAdapterError(
  detail: string,
  code?: ExtractionFailureCode,
): TextExtractionFailure {
  return code === undefined
    ? { ok: false, reason: "adapter-error", detail }
    : { ok: false, reason: "adapter-error", detail, code };
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
//
// The route is an ARGUMENT rather than something inferred from the page provenances, because the two
// are not the same fact and inferring one from the other would be wrong in both directions: a page
// read `native` says nothing about whether the discovery engine or the in-Worker PDF reader read it,
// and a document routed through conversion and then read natively has an engine in its route that no
// page provenance mentions.
export function extractedFromPages(
  pages: readonly ExtractedPage[],
  route: readonly ExtractionEngine[],
  facts: ExtractedDocumentFacts = NO_DOCUMENT_FACTS,
): TextExtractionResult {
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
    dedupedRoute(route),
    facts,
  );
}

// The route in the order the engines ran, each named once. Deduplicated because a mixed document
// sends several pages through recognition and a conversion re-reads through the engine that asked
// for it — and "recognition, recognition, recognition" says nothing "recognition" does not.
function dedupedRoute(route: readonly ExtractionEngine[]): readonly ExtractionEngine[] {
  const seen = new Set<ExtractionEngine>();
  const ordered: ExtractionEngine[] = [];
  for (const engine of route) {
    if (seen.has(engine)) continue;
    seen.add(engine);
    ordered.push(engine);
  }
  return ordered;
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
