import {
  pagesWithTextIn,
  splitReviewDocumentText,
  type ReviewDocumentSidecar,
} from "@magna-carta/discovery/processing";
import type { Passage } from "@magna-carta/search/port";

// Turning a review document's ALREADY-EXTRACTED text back into the passages the index takes.
//
// The corpus extracted this document once, wrote the text a firm certifies to R2, and recorded which
// pages produced it in the sidecar beside it. Indexing re-derives passages from those two objects
// rather than re-parsing the original bytes, and that is a correctness rule rather than an
// optimization: a second parse is a second answer to "what does this document say", produced by
// whatever engines happen to be deployed on the day the index ran, with nothing comparing it to the
// answer the manifest already stands behind.
//
// The pairing is positional and exact by construction — the extractor writes one block per page that
// produced text and records `hasText` for every page it saw — so filtering the sidecar's pages to
// those with text lines them up one for one with the blocks.

export type ReviewDocumentPassageResult =
  | { readonly ok: true; readonly passages: readonly Passage[] }
  | { readonly ok: false; readonly reason: string };

export function reviewDocumentPassages(
  text: string,
  sidecar: ReviewDocumentSidecar,
): ReviewDocumentPassageResult {
  const blocks = splitReviewDocumentText(text);
  const pages = pagesWithTextIn(sidecar.pages);

  // A document that produced nothing has no passages and no pages, and the split of an empty string
  // is one empty block rather than none. Answered here so the count check below is about real
  // disagreement rather than about that.
  if (pages.length === 0) {
    return blocks.every((block) => block === "")
      ? { ok: true, passages: [] }
      : { ok: false, reason: "the extracted text has content the metadata records no page for" };
  }

  // REFUSED RATHER THAN GUESSED. If the two objects disagree about how many pages produced text they
  // were written by different runs, and pairing them positionally anyway would put a word on a page
  // it is not on. A search hit that names the wrong page of an opposing party's production is worse
  // than no hit: somebody cites it.
  if (blocks.length !== pages.length) {
    return {
      ok: false,
      reason: `the extracted text holds ${blocks.length} pages and the metadata records ${pages.length}`,
    };
  }

  const passages: Passage[] = [];
  for (const [position, page] of pages.entries()) {
    const block = blocks[position] ?? "";
    if (block === "") continue;
    // The same shape the extraction port produces for a freshly-read document: a zero-based page index
    // in the chunk id, and the one-based page a person would turn to in `page`. Both halves of the
    // index have to agree on what a passage is, and this is what keeps a replayed review document
    // producing byte-identical passages to the ones the pipeline first derived.
    passages.push({ chunkId: `page-${page.pageIndex}`, text: block, page: page.pageIndex + 1 });
  }
  return { ok: true, passages };
}
