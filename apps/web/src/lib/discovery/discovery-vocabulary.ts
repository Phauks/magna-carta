/*
 * The closed vocabularies of the review-set model, as a reader meets them.
 *
 * Mirrors packages/discovery/src/types.ts, which is the domain's own home for these words. What is
 * added here — and only here — is the presentation: the label a person reads, the tone a badge
 * takes, and the one line saying what the word MEANS, which for this subsystem is not decoration.
 * A firm hands an exception report to opposing counsel; "encrypted" and "password-protected" are
 * two different conversations with a court, and a surface that rendered either as "failed" would
 * have destroyed the distinction the report exists to make.
 *
 * NO WORD IS INVENTED HERE. Every label is the domain's own term or the plain-English expansion of
 * it, because a reviewer says these words out loud in a meet-and-confer and the platform's spelling
 * of them ends up in correspondence.
 */

/** How finished a review set's life is. Forward only; there is no reopen. */
export type ReviewSetState = "open" | "locked" | "closed";

/** Where material came from. */
export type DiscoveryLoadLane =
  | "internal-files"
  | "internal-email"
  | "received-production"
  | "direct-collection";

/** A load's lifecycle. `reversed` is a clawback, reachable only from `complete`. */
export type DiscoveryLoadState =
  | "declared"
  | "loading"
  | "processing"
  | "complete"
  | "failed"
  | "reversed";

/** Exactly two terminal states, and no third: everything that is not processed is excepted. */
export type ReviewDocumentProcessingState = "pending" | "processing" | "processed" | "excepted";

/** Where a document stands with the search index. A different stage from processing. */
export type ReviewDocumentIndexState = "indexed" | "deferred" | "failed";

/** Every named reason a document could not be read. */
export type ReviewDocumentExceptionCode =
  | "unsupported-format"
  | "corrupt"
  | "encrypted"
  | "password-protected"
  | "encrypted-container-entry"
  | "container-not-expanded"
  | "container-guard-tripped"
  | "oversize"
  | "extraction-timeout"
  | "no-text-extracted"
  | "malware-flagged"
  | "conversion-failed"
  | "recognition-failed"
  | "load-file-metadata-mismatch"
  | "source-bytes-missing";

/** The stage an exception was raised in. */
export type ReviewDocumentExceptionStage =
  | "load"
  | "identify"
  | "extract"
  | "deduplicate"
  | "family"
  | "index";

/** Whose electronic records these were. */
export type RecordCustodianKind = "person" | "organization" | "unattributed";

/** Whether the firm's own assistant transcripts are in scope for a load. */
export type TranscriptScope = "include" | "exclude";

/** The badge tones a status word may take. Mirrors the design system's Badge variants. */
type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** One word as it is presented: what it reads, what colour it takes, and what it means. */
export interface VocabularyEntry {
  readonly label: string;
  readonly tone: Tone;
  /** One sentence, in the reader's own words. Rendered as the badge's title. */
  readonly meaning: string;
}

const REVIEW_SET_STATES: Readonly<Record<ReviewSetState, VocabularyEntry>> = {
  open: {
    label: "Open",
    tone: "success",
    meaning: "Takes new material, and everything on it can be worked.",
  },
  locked: {
    label: "Locked",
    tone: "info",
    meaning: "Takes no more material. Everything already in it still reads and still codes.",
  },
  closed: {
    label: "Closed",
    tone: "neutral",
    meaning:
      "Finished. The extracted text, the metadata and the search index have been released; every " +
      "row, manifest and exception report survives. A closed review set does not reopen.",
  },
};

export function reviewSetStateEntry(state: ReviewSetState): VocabularyEntry {
  return REVIEW_SET_STATES[state];
}

/*
 * The lanes. Two are built, one arrives through the ordinary upload gate, and one is REFUSED BY
 * NAME — direct collection needs a collection tool rather than an ingest path, and a firm asking
 * for it should learn that the platform knows what it is and has not built it. That is the
 * difference between a gap and a mystery, and it is why the unbuilt lane is declared here at all
 * rather than being absent from the list.
 */
const LOAD_LANES: Readonly<
  Record<
    DiscoveryLoadLane,
    { readonly label: string; readonly describes: string; readonly built: boolean }
  >
> = {
  "internal-files": {
    label: "The matter's own files",
    describes:
      "Documents the firm already holds on this matter. Nothing is copied: each review document " +
      "points at the file version you pick, and a later version of that file does not change what " +
      "is under review.",
    built: true,
  },
  "internal-email": {
    label: "The matter's filed email",
    describes:
      "Email already filed to this matter. A message and its attachments enter together as one " +
      "family, so nothing is reviewed away from the message it arrived on.",
    built: true,
  },
  "received-production": {
    label: "A production received from another party",
    describes:
      "Material another party produced, uploaded through the same quarantine gate every other " +
      "external byte crosses. An archive is expanded into a family rather than refused.",
    built: true,
  },
  "direct-collection": {
    label: "Collection from a client's own system",
    describes:
      "Collecting from a client's mailbox or file share needs a collection tool, which the " +
      "platform does not have. It is named here so its absence is a gap you can see rather than " +
      "one you have to discover.",
    built: false,
  },
};

export function loadLaneEntry(lane: DiscoveryLoadLane): {
  readonly label: string;
  readonly describes: string;
  readonly built: boolean;
} {
  return LOAD_LANES[lane];
}

/** The lanes a person may declare, in the order the form offers them. */
export const SELECTABLE_LOAD_LANES: readonly DiscoveryLoadLane[] = [
  "internal-files",
  "internal-email",
  "received-production",
  "direct-collection",
];

const LOAD_STATES: Readonly<Record<DiscoveryLoadState, VocabularyEntry>> = {
  declared: {
    label: "Declared",
    tone: "neutral",
    meaning: "Said what is coming. Nothing has arrived yet.",
  },
  loading: { label: "Loading", tone: "info", meaning: "Material is arriving." },
  processing: {
    label: "Processing",
    tone: "info",
    meaning: "Everything has arrived and is being read.",
  },
  complete: {
    label: "Complete",
    tone: "success",
    meaning: "Every document reached a terminal state, and the load's two records were written.",
  },
  failed: { label: "Failed", tone: "danger", meaning: "The load did not finish. Nothing further." },
  reversed: {
    label: "Reversed",
    tone: "warning",
    meaning: "Withdrawn by a clawback. The load itself wasn't edited.",
  },
};

export function loadStateEntry(state: DiscoveryLoadState): VocabularyEntry {
  return LOAD_STATES[state];
}

const PROCESSING_STATES: Readonly<Record<ReviewDocumentProcessingState, VocabularyEntry>> = {
  pending: { label: "Pending", tone: "neutral", meaning: "Waiting to be read." },
  processing: { label: "Reading", tone: "info", meaning: "Being read now." },
  processed: { label: "Read", tone: "success", meaning: "Read, with its text and metadata kept." },
  excepted: {
    label: "Not read",
    tone: "warning",
    meaning:
      "Could not be read, for a named reason. It stays in the corpus and appears on the " +
      "exception report; it is not lost and it is not skipped.",
  },
};

export function processingStateEntry(state: ReviewDocumentProcessingState): VocabularyEntry {
  return PROCESSING_STATES[state];
}

/*
 * The index states, and the one that matters most is `deferred`.
 *
 * A document that has been read but not indexed is NOT an exception and never appears on a
 * production's exception report — it is work the platform still owes. With no search engine
 * deployed every document parks there, which is the normal state of this product today, so the word
 * has to read as a platform fact rather than as something wrong with the document.
 */
const INDEX_STATES: Readonly<Record<ReviewDocumentIndexState, VocabularyEntry>> = {
  indexed: { label: "Searchable", tone: "success", meaning: "In the review set's search index." },
  deferred: {
    label: "Not searchable yet",
    tone: "neutral",
    meaning:
      "Read, but not yet in the search index. This is the platform's work outstanding, not a " +
      "problem with the document, and it never reaches an exception report.",
  },
  failed: {
    label: "Indexing failed",
    tone: "warning",
    meaning: "The document was read; putting it in the search index did not work.",
  },
};

/** Null means the corpus has never asked the index about this document. */
export function indexStateEntry(state: ReviewDocumentIndexState | null): VocabularyEntry {
  if (state === null) {
    return {
      label: "Not searchable yet",
      tone: "neutral",
      meaning: "Nothing has asked the search index about this document yet.",
    };
  }
  return INDEX_STATES[state];
}

/*
 * Every reason a document could not be read, in the words a firm would use writing to the other
 * side. These are the lines that end up in an exception report, so each says what happened and
 * stops — no advice, no blame, and no word that concedes more than the fact does.
 */
const EXCEPTION_CODES: Readonly<Record<ReviewDocumentExceptionCode, VocabularyEntry>> = {
  "unsupported-format": {
    label: "Unsupported format",
    tone: "warning",
    meaning: "The platform has no reader for this kind of file.",
  },
  corrupt: {
    label: "Damaged",
    tone: "warning",
    meaning: "The file is structurally broken and could not be opened.",
  },
  encrypted: {
    label: "Encrypted",
    tone: "warning",
    meaning: "The contents are encrypted and no key was supplied.",
  },
  "password-protected": {
    label: "Password protected",
    tone: "warning",
    meaning: "Opening it needs a password nobody has given.",
  },
  "encrypted-container-entry": {
    label: "Encrypted entry in an archive",
    tone: "warning",
    meaning: "The archive opened; one or more entries inside it are encrypted.",
  },
  "container-not-expanded": {
    label: "Archive entry not opened",
    tone: "warning",
    meaning: "The archive described this entry but could not open it.",
  },
  "container-guard-tripped": {
    label: "Archive refused by a guard",
    tone: "warning",
    meaning:
      "The archive is too large to expand safely: too deep, too many entries, or too big once expanded.",
  },
  oversize: {
    label: "Too large",
    tone: "warning",
    meaning: "Larger than the platform will read in one pass.",
  },
  "extraction-timeout": {
    label: "Timed out",
    tone: "warning",
    meaning: "Reading it did not finish in the time allowed.",
  },
  "no-text-extracted": {
    label: "No text",
    tone: "warning",
    meaning: "The file opened and yielded no text at all.",
  },
  "malware-flagged": {
    label: "Flagged by the scanner",
    tone: "danger",
    meaning: "The malware scanner refused it. It is quarantined and was never read.",
  },
  "conversion-failed": {
    label: "Conversion failed",
    tone: "warning",
    meaning: "Converting it into a readable form did not work.",
  },
  "recognition-failed": {
    label: "Text recognition failed",
    tone: "warning",
    meaning: "The pages are images, and reading text off them did not work.",
  },
  "load-file-metadata-mismatch": {
    label: "Load file disagrees",
    tone: "warning",
    meaning: "What the producing party's load file says about this document is not what arrived.",
  },
  "source-bytes-missing": {
    label: "Source missing",
    tone: "danger",
    meaning: "The document was declared and its bytes were never found.",
  },
};

export function exceptionCodeEntry(code: ReviewDocumentExceptionCode): VocabularyEntry {
  return EXCEPTION_CODES[code];
}

/** Every exception code, in the order the narrowing control offers them. */
export const EXCEPTION_CODE_ORDER: readonly ReviewDocumentExceptionCode[] = [
  "unsupported-format",
  "corrupt",
  "encrypted",
  "password-protected",
  "encrypted-container-entry",
  "container-not-expanded",
  "container-guard-tripped",
  "oversize",
  "extraction-timeout",
  "no-text-extracted",
  "malware-flagged",
  "conversion-failed",
  "recognition-failed",
  "load-file-metadata-mismatch",
  "source-bytes-missing",
];

/** The processing states, in the order the narrowing control offers them. */
export const PROCESSING_STATE_ORDER: readonly ReviewDocumentProcessingState[] = [
  "pending",
  "processing",
  "processed",
  "excepted",
];

const CUSTODIAN_KINDS: Readonly<Record<RecordCustodianKind, string>> = {
  person: "A person",
  organization: "An organization",
  // First-class rather than a blank: material that arrived with no custodial attribution is a fact
  // about the production, and recording it as "we do not know" is a different statement from
  // leaving a field empty.
  unattributed: "Nobody attributed",
};

export function recordCustodianKindLabel(kind: RecordCustodianKind): string {
  return CUSTODIAN_KINDS[kind];
}

export const RECORD_CUSTODIAN_KIND_ORDER: readonly RecordCustodianKind[] = [
  "person",
  "organization",
  "unattributed",
];
