// The closed vocabularies of the review-set model, in one home so the schema CHECK constraints, the
// services, the routes, and the eventual manifest cannot drift on a spelling.
//
// The bare word is never written here. The platform already ships a register of physical client
// originals whose family is `custody*`; a record custodian is a completely different thing — whose
// ELECTRONIC RECORDS these were — and the two appear in the same matter, sometimes on the same
// screen. Two words, always, in code, in schema, and in anything a person reads. The vocabulary gate
// in tooling/ enforces it mechanically, in both directions.

// A review set moves forward only. `locked` refuses new loads and still serves every read; `closed`
// additionally releases the derived artifacts (extracted text, metadata sidecars, index splits) for
// collection. Closing destroys a derived cache and never a record: every row, every manifest, and
// every exception report survives it, which is why there is no path back.
export const REVIEW_SET_STATES = ["open", "locked", "closed"] as const;
export type ReviewSetState = (typeof REVIEW_SET_STATES)[number];

// Which forward moves are legal. A reopen is not among them, and its absence is the point.
export const REVIEW_SET_FORWARD_TRANSITIONS: Readonly<Record<ReviewSetState, readonly ReviewSetState[]>> =
  {
    open: ["locked", "closed"],
    locked: ["closed"],
    closed: [],
  };

// Whose records these were. `unattributed` is first-class rather than a null: a production that
// arrives with no custodial attribution is a fact about the production, and recording it as "we do
// not know" is a different statement from leaving a column empty.
export const RECORD_CUSTODIAN_KINDS = ["person", "organization", "unattributed"] as const;
export type RecordCustodianKind = (typeof RECORD_CUSTODIAN_KINDS)[number];

// Where material comes from. The lane determines what the loader must supply and what the platform
// may assume — for the two internal lanes the platform already holds the bytes, the hash, and the
// scan verdict, so a load is a metadata operation; `received-production` is an ingest operation at
// scale through the same quarantine gate every other external byte crosses.
export const DISCOVERY_LOAD_LANES = [
  "internal-files",
  "internal-email",
  "received-production",
  "direct-collection",
] as const;
export type DiscoveryLoadLane = (typeof DISCOVERY_LOAD_LANES)[number];

// Collection from a client's own system needs a collection tool, not an ingest design. It is declared
// and refused BY NAME rather than being silently absent, so a firm asking for it learns that the
// platform knows what it is and has not built it — the difference between a gap and a mystery.
export const UNBUILT_LOAD_LANES: readonly DiscoveryLoadLane[] = ["direct-collection"];

// A load's lifecycle. `reversed` is reachable from `complete`: a production subject to a clawback is
// withdrawn by a recorded act, never by editing the load that brought it in.
export const DISCOVERY_LOAD_STATES = [
  "declared",
  "loading",
  "processing",
  "complete",
  "failed",
  "reversed",
] as const;
export type DiscoveryLoadState = (typeof DISCOVERY_LOAD_STATES)[number];

export const DISCOVERY_LOAD_FORWARD_TRANSITIONS: Readonly<
  Record<DiscoveryLoadState, readonly DiscoveryLoadState[]>
> = {
  declared: ["loading", "failed"],
  loading: ["processing", "failed"],
  processing: ["complete", "failed"],
  complete: ["reversed"],
  failed: [],
  reversed: [],
};

// What a review document points AT. It is always a pointer and never a copy: the bytes stay where the
// File Manager and the email record model already put them, under one blob store, one scan gate, one
// hold mechanism, and one destruction policy.
export const REVIEW_DOCUMENT_SOURCE_KINDS = [
  "file_version",
  "email_message",
  "email_attachment",
] as const;
export type ReviewDocumentSourceKind = (typeof REVIEW_DOCUMENT_SOURCE_KINDS)[number];

// A family is a self-reference plus a role, not a junction table: families are at most two deep in
// practice (a message and its attachments; an archive and its entries) and a join would buy nothing.
// A standalone document is its own family, so every document has one and no read has a special case.
export const REVIEW_DOCUMENT_FAMILY_ROLES = [
  "standalone",
  "parent",
  "attachment",
  "container-child",
] as const;
export type ReviewDocumentFamilyRole = (typeof REVIEW_DOCUMENT_FAMILY_ROLES)[number];

// EXACTLY TWO TERMINAL STATES, and there is no third. A document that ends in neither has fallen out
// of the corpus with nobody able to tell, which in discovery is a defensibility failure rather than a
// cache miss. Everything that is not `processed` is `excepted` and carries a named code.
export const REVIEW_DOCUMENT_PROCESSING_STATES = [
  "pending",
  "processing",
  "processed",
  "excepted",
] as const;
export type ReviewDocumentProcessingState = (typeof REVIEW_DOCUMENT_PROCESSING_STATES)[number];

export const TERMINAL_PROCESSING_STATES: readonly ReviewDocumentProcessingState[] = [
  "processed",
  "excepted",
];

export function isTerminalProcessingState(state: ReviewDocumentProcessingState): boolean {
  return TERMINAL_PROCESSING_STATES.includes(state);
}

// Every named reason a document did not process. Each is a different conversation with a court, which
// is why "extraction failed" is not on the list: a firm hands the exception report to opposing
// counsel, and the report is what converts "we produced everything we could read" from an assertion
// into a document. The codes the processing lane raises are filled in as that lane lands; the list is
// closed here so the schema, the report, and the user guide cannot disagree about what exists.
export const REVIEW_DOCUMENT_EXCEPTION_CODES = [
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
] as const;
export type ReviewDocumentExceptionCode = (typeof REVIEW_DOCUMENT_EXCEPTION_CODES)[number];

// The stage an exception was raised in — enough for the report to group by "where did this go wrong"
// without a reader having to infer it from the code.
export const REVIEW_DOCUMENT_EXCEPTION_STAGES = [
  "load",
  "identify",
  "extract",
  "deduplicate",
  "family",
  "index",
] as const;
export type ReviewDocumentExceptionStage = (typeof REVIEW_DOCUMENT_EXCEPTION_STAGES)[number];

// Bounds. A name a person types, and a description of where a production came from.
export const REVIEW_SET_NAME_MAX_LENGTH = 200;
export const RECORD_CUSTODIAN_NAME_MAX_LENGTH = 200;
export const LOAD_SOURCE_DESCRIPTION_MAX_LENGTH = 2000;
