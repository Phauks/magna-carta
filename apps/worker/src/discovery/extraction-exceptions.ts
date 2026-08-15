import type {
  ReviewDocumentExceptionCode,
  ReviewDocumentExceptionStage,
} from "@magna-carta/discovery/types";
import type { ExtractionFailureCode } from "@magna-carta/search/extraction";

// WHAT A REVIEWER SEES WHEN A DOCUMENT COULD NOT BE READ: the map from the extraction port's
// diagnosis to the closed set of exception codes the review-set model records.
//
// It lives here, in the composition root, rather than in either package, because it joins two
// vocabularies neither package may import from the other: the extraction port belongs to search and
// the exception codes belong to discovery, and a dependency either way would put the pipeline's
// wiring inside a domain package. This module is the wiring.
//
// The map is TOTAL over the port's failure codes. A code with no entry would be a document that ended
// in neither terminal state — the one outcome discovery cannot have — and
// `test/discovery-extraction-exceptions.test.ts` proves totality against the port's own exported
// vocabulary rather than against a copy of it, so a code added to the port fails a test here on the
// same commit.
//
// Each entry is a different conversation with a court, which is why "extraction failed" is not among
// them: a firm hands the exception report to opposing counsel, and the report is what converts "we
// produced everything we could read" from an assertion into a document.

export interface ReviewDocumentExceptionFact {
  readonly stage: ReviewDocumentExceptionStage;
  readonly code: ReviewDocumentExceptionCode;
}

const EXCEPTION_FOR_FAILURE: Readonly<Record<ExtractionFailureCode, ReviewDocumentExceptionFact>> =
  {
    // Identified, and nothing in the platform reads it. The stage is `identify` because the document
    // never reached an extractor, and the identified format is written onto the row beside the
    // exception — "we could not read this, and it was a legacy WordPerfect document" is defensible
    // where "extraction failed" is not.
    unsupportedFormat: { stage: "identify", code: "unsupported-format" },
    corrupt: { stage: "extract", code: "corrupt" },
    encrypted: { stage: "extract", code: "encrypted" },
    // Kept apart from `encrypted` because the remedy differs: a password can be asked for and a key
    // cannot, and a firm working through an exception report acts on that difference.
    passwordProtected: { stage: "extract", code: "password-protected" },
    limitExceeded: { stage: "extract", code: "oversize" },
    containerGuardTripped: { stage: "extract", code: "container-guard-tripped" },
    // NOT indexed as empty, which is the reason this code exists. An empty index entry asserts "this
    // document contains no text", the one answer a discovery search must never give wrongly; the
    // document appears in the report and reads to a reviewer as processed but unsearchable.
    noTextExtracted: { stage: "extract", code: "no-text-extracted" },
    recognitionFailed: { stage: "extract", code: "recognition-failed" },
    conversionUnavailable: { stage: "extract", code: "conversion-failed" },
    conversionFailed: { stage: "extract", code: "conversion-failed" },
    // An archive reached the extractor. Its entries are separate documents and expanding them is a
    // recorded act with its own family; until that lands the archive is in the corpus and says so,
    // rather than appearing as a file that turned out to hold no words.
    needsExpansion: { stage: "extract", code: "container-not-expanded" },
  };

export function exceptionForExtractionFailure(
  code: ExtractionFailureCode,
): ReviewDocumentExceptionFact {
  return EXCEPTION_FOR_FAILURE[code];
}

export function mappedExtractionFailureCodes(): readonly string[] {
  return Object.keys(EXCEPTION_FOR_FAILURE);
}

// The bytes are gone — the version was reaped, or a production's object was removed under a
// destruction policy. Terminal, and its own code because "we cannot find what we loaded" is a
// different sentence from "we could not read it".
export const SOURCE_BYTES_MISSING: ReviewDocumentExceptionFact = {
  stage: "extract",
  code: "source-bytes-missing",
};

// A version the scan gate quarantined. A flagged file in discovery is EVIDENCE: it stays in the
// corpus, it appears in the manifest and in the report, and no parser is ever pointed at it — which
// is why this is decided from the version's recorded status at dispatch rather than from anything
// read out of the bytes.
export const MALWARE_FLAGGED: ReviewDocumentExceptionFact = {
  stage: "load",
  code: "malware-flagged",
};
