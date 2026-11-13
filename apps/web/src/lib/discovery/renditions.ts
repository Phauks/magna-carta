/*
 * THE RENDITION REGISTRY — how a review document is shown, chosen from what the document is.
 *
 * A review document is a POINTER and never a copy: it names a file version, an email message or an
 * email attachment that the firm already holds. So showing one is never a matter of fetching "the
 * document" — it is a matter of picking which of several ways of showing it applies, and asking the
 * read path that already serves that kind of thing.
 *
 * THE EXTRACTED TEXT IS A FIRST-CLASS RENDITION, NOT A FALLBACK. It is what the engine actually read
 * — the same bytes that were indexed, deduplicated and fingerprinted — so a reviewer coding from it
 * is coding from what the corpus says the document contains. It is also the rendition that works for
 * a reviewer holding no file permission at all, which is the ordinary situation for somebody brought
 * in for one production. Treating it as a consolation prize would get the priority backwards.
 *
 * AND A DOCUMENT THAT COULD NOT BE READ STILL RENDERS. Its rendition is the named reason it could
 * not be, which is a real answer and the one a reviewer needs in order to decide what to do about
 * it. A blank pane would say the platform lost it.
 *
 * WHAT IS NOT HERE YET, and each is a capability a rendition declares rather than a new viewer: the
 * page images a redaction is drawn on, the recognized-text overlay, and the native preview through
 * the file manager's own safe-delivery sandbox. The last one is deliberately sequenced after the
 * text: it re-authorizes on file permissions rather than on the review set's access list, so it is
 * an additional way in for the readers who have it and never the only one.
 */
import type { MaturityStage } from "@magna-carta/design-system/maturity";
import type { ReviewDocumentDetail } from "./discovery-api.ts";

/** Which way of showing a document applies. */
export type RenditionKind = "extracted-text" | "unreadable" | "not-read-yet";

export interface Rendition {
  readonly kind: RenditionKind;
  /** What the pane's own heading says this is. */
  readonly label: string;
  /** One line placing what the reader is looking at, in the reader's words. */
  readonly explains: string;
}

/**
 * The rendition for one document.
 *
 * Order matters and is the reviewer's own order of questions: is this readable at all, has it been
 * read yet, and then what does it say. An excepted document leads with its reason even when some
 * text was salvaged, because the reason is what a person has to act on.
 */
export function renditionFor(document: ReviewDocumentDetail): Rendition {
  if (document.processingState === "excepted") {
    return {
      kind: "unreadable",
      label: "Could not be read",
      explains:
        "This document is in the corpus and counted, and it appears on the exception report with " +
        "the reason below. It is not lost and it was not skipped.",
    };
  }
  if (document.processingState !== "processed") {
    return {
      kind: "not-read-yet",
      label: "Not read yet",
      explains:
        "The engine has not finished with this document. Every document ends read or not read, " +
        "never neither, so this state is temporary.",
    };
  }
  if (!document.hasExtractedText) {
    // Processed, and nothing came out. That is a real outcome rather than a gap — a page of pixels
    // nobody recognized, a file whose content is not text — and the corpus records it as such.
    return {
      kind: "unreadable",
      label: "No text",
      explains: "The document was read and yielded no text at all.",
    };
  }
  return {
    kind: "extracted-text",
    label: "Extracted text",
    explains: "The text read from this document, as indexed for search.",
  };
}

/** A way of showing a document that the design names and nobody has built. */
export interface SoonRendition {
  readonly id: string;
  readonly label: string;
  readonly shows: string;
  readonly stage: Extract<MaturityStage, "soon">;
  readonly waitsOn: string;
}

export const SOON_RENDITIONS: readonly SoonRendition[] = [
  {
    id: "native",
    label: "The original",
    shows: "The document as it was produced, in the file manager's own safe viewer.",
    stage: "soon",
    waitsOn: "the viewer being wired to the file manager's delivery path",
  },
  {
    id: "pages",
    label: "Pages",
    shows: "The document as page images, which is what a redaction is drawn on.",
    stage: "soon",
    waitsOn: "redaction in review",
  },
  {
    id: "recognized-overlay",
    label: "Recognized text",
    shows: "Text recognized off pages that are pixels, laid over the page it came from.",
    stage: "soon",
    waitsOn: "the page renderer",
  },
];
