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

export type TextExtractionResult =
  | { readonly ok: true; readonly passages: readonly Passage[] }
  | TextExtractionFailure;

export interface TextExtractionInput {
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
}

export interface TextExtractionPort {
  extract(input: TextExtractionInput): Promise<TextExtractionResult>;
}

export function extracted(passages: readonly Passage[]): TextExtractionResult {
  return { ok: true, passages };
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

// One page of recognized text becomes one passage. A page is the chunk boundary the whole subsystem
// already uses — the semantic half embeds per passage, and a hit carries the page back for display — so
// the keyword and semantic halves stay aligned on the same units without a second chunking rule.
// A page whose lines are all empty contributes nothing rather than an empty passage, so a scanned blank
// page does not become a document the index has to carry.
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
