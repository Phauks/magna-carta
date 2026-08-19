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
export const REVIEW_SET_FORWARD_TRANSITIONS: Readonly<
  Record<ReviewSetState, readonly ReviewSetState[]>
> = {
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

// The stages whose reasons belong in the record artifact a firm hands to another party.
//
// `index` is the one that does not, and the omission is the point. The exception report is the
// document that turns "we produced everything we could read" from an assertion into a record, so
// every line in it is a statement about a document the firm could not READ. Whether that document is
// in the firm's own keyword index is a fact about the platform's housekeeping, invisible and
// irrelevant to the receiving party, and a report that carried it would put a number in front of a
// court that a later deploy silently changes. It stays fully visible in the live exception read,
// where the people who can act on it are looking.
export const PRODUCED_EXCEPTION_STAGES: readonly ReviewDocumentExceptionStage[] = [
  "load",
  "identify",
  "extract",
  "deduplicate",
  "family",
];

// Where a review document stands with the SEARCH INDEX. A different stage from processing, run by a
// different engine, so it gets its own answer rather than being folded into the processing state:
// a document can be perfectly readable, produced, and reviewed while the index engine that would make
// it searchable is not deployed at all.
//
// NOT A TERMINAL-STATE VOCABULARY, and not an exception vocabulary either. `deferred` here means the
// platform has not got to it, which the exception codes above deliberately have no word for. Null on
// the row means the corpus has never asked the index about this document.
export const REVIEW_DOCUMENT_INDEX_STATES = ["indexed", "deferred", "failed"] as const;
export type ReviewDocumentIndexState = (typeof REVIEW_DOCUMENT_INDEX_STATES)[number];

// What a review set is still owed by the index: everything that is not `indexed`, including the
// documents nothing has asked about yet.
export const UNINDEXED_INDEX_STATES: readonly (ReviewDocumentIndexState | null)[] = [
  null,
  "deferred",
  "failed",
];

// ---------------------------------------------------------------------------------------------
// Coding — the vocabularies a reviewer's decision is made of.

// The cardinality of a coding question, carried on the GROUP. A single-choice group is a radio row
// (Responsiveness); a multi-choice group is a flag set (issue codes). Independent booleans cannot
// express a mutually exclusive choice, and a corpus where some documents are both responsive and
// non-responsive cannot be produced from without a cleanup pass.
export const REVIEW_TAG_GROUP_CARDINALITIES = ["single", "multi"] as const;
export type ReviewTagGroupCardinality = (typeof REVIEW_TAG_GROUP_CARDINALITIES)[number];

// A `system` group is seeded into every review set and is not deletable, because production logic
// stands on its existence. It is freely renamable — nothing matches a group by name.
export const REVIEW_TAG_GROUP_KINDS = ["system", "custom"] as const;
export type ReviewTagGroupKind = (typeof REVIEW_TAG_GROUP_KINDS)[number];

// SEMANTICS, NOT NAMES, DRIVE THE MACHINE. Privilege-log generation, production membership rules,
// redaction checks and completion arithmetic read only this value, so a firm may rename "Privileged"
// to "Withhold — AC privilege" and nothing breaks, because nothing ever matched the string. A custom
// tag carries no semantic and drives no machinery — it filters, groups and exports, which is what
// custom tags are for. The vocabulary is CLOSED: a semantic nothing reads is a semantic that lies.
export const REVIEW_TAG_SEMANTICS = [
  "responsive",
  "non-responsive",
  "needs-further-review",
  "privileged",
  "privileged-redact",
  "not-privileged",
  "confidential",
] as const;
export type ReviewTagSemantic = (typeof REVIEW_TAG_SEMANTICS)[number];

// The semantics a production must never resolve to a produced document without a deliberate,
// recorded decision. Named here rather than at the production writer so the coding layer and the
// production layer read one list.
export const WITHHOLDING_TAG_SEMANTICS: readonly ReviewTagSemantic[] = [
  "privileged",
  "privileged-redact",
];

// What a human did. One row per act, however many documents it touched.
export const REVIEW_TAG_EVENT_KINDS = [
  "apply",
  "remove",
  "bulk-apply",
  "bulk-remove",
  "undo",
] as const;
export type ReviewTagEventKind = (typeof REVIEW_TAG_EVENT_KINDS)[number];

// The gesture's reach. `document` is one document; `family` is a document and everything sharing its
// family identifier; `selection` is a materialized list resolved once at initiation.
export const REVIEW_TAG_EVENT_SCOPES = ["document", "family", "selection"] as const;
export type ReviewTagEventScope = (typeof REVIEW_TAG_EVENT_SCOPES)[number];

// `undone` rather than a deletion: history never shortens, and an undone act stays in the journal
// pointing at the act that reversed it.
export const REVIEW_TAG_EVENT_STATES = ["running", "complete", "undone"] as const;
export type ReviewTagEventState = (typeof REVIEW_TAG_EVENT_STATES)[number];

// The three groups seeded into every review set at creation, with the semantics the machine reads.
// Names and colour tokens are a starting point a firm edits freely; the SEMANTICS are what production
// logic stands on, which is why a semantic-bearing tag is deactivated rather than deleted.
//
// Confidentiality is seeded from the common protective-order designations and carries only the one
// `confidential` semantic — the finer tiers are label-only, because no machinery reads them yet and a
// semantic nothing reads is a semantic that lies.
export interface SeededTagDefinition {
  readonly name: string;
  readonly semantic: ReviewTagSemantic | null;
  readonly colorToken: string;
}

export interface SeededTagGroupDefinition {
  readonly name: string;
  readonly cardinality: ReviewTagGroupCardinality;
  readonly requiredForCompletion: boolean;
  readonly tags: readonly SeededTagDefinition[];
}

export const SEEDED_TAG_GROUPS: readonly SeededTagGroupDefinition[] = [
  {
    name: "Responsiveness",
    cardinality: "single",
    // The one group a document must answer before anything counts it coded: responsiveness is what
    // membership in a production is drawn from, so an unanswered document is one nobody has decided
    // about rather than one decided against.
    requiredForCompletion: true,
    tags: [
      { name: "Responsive", semantic: "responsive", colorToken: "status-success" },
      { name: "Non-responsive", semantic: "non-responsive", colorToken: "status-neutral" },
      {
        name: "Needs further review",
        semantic: "needs-further-review",
        colorToken: "status-warning",
      },
    ],
  },
  {
    name: "Privilege",
    cardinality: "single",
    // Not required for completion: on a large corpus most documents are simply not privileged, and
    // forcing an explicit answer on every one of them would make the uncoded count meaningless.
    requiredForCompletion: false,
    tags: [
      { name: "Privileged", semantic: "privileged", colorToken: "status-danger" },
      { name: "Privileged — redact", semantic: "privileged-redact", colorToken: "status-warning" },
      { name: "Not privileged", semantic: "not-privileged", colorToken: "status-neutral" },
    ],
  },
  {
    name: "Confidentiality",
    cardinality: "single",
    requiredForCompletion: false,
    tags: [
      { name: "Confidential", semantic: "confidential", colorToken: "status-info" },
      {
        name: "Highly confidential — attorneys' eyes only",
        semantic: null,
        colorToken: "status-danger",
      },
      { name: "Not confidential", semantic: null, colorToken: "status-neutral" },
    ],
  },
];

// Bounds. A name a person types, and a description of where a production came from.
export const REVIEW_SET_NAME_MAX_LENGTH = 200;
export const RECORD_CUSTODIAN_NAME_MAX_LENGTH = 200;
export const LOAD_SOURCE_DESCRIPTION_MAX_LENGTH = 2000;
export const REVIEW_TAG_GROUP_NAME_MAX_LENGTH = 120;
export const REVIEW_TAG_NAME_MAX_LENGTH = 120;
// A design-token NAME, never a raw colour value — the coding panel styles through the design system,
// and a hex string here would be an off-token value the UI could not refuse. Bounded to the shape a
// token name actually has, which also refuses anything that could be a CSS value.
export const REVIEW_TAG_COLOR_TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,48}$/;
