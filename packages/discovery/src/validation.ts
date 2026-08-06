import {
  RECORD_CUSTODIAN_NAME_MAX_LENGTH,
  REVIEW_SET_FORWARD_TRANSITIONS,
  REVIEW_SET_NAME_MAX_LENGTH,
  type ReviewSetState,
} from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type DiscoveryValidationCode =
  // Shape refusals on the two things a person names.
  | "discovery-empty-review-set-name"
  | "discovery-review-set-name-taken"
  | "discovery-empty-record-custodian-name"
  | "discovery-record-custodian-name-taken"
  | "discovery-unknown-record-custodian-kind"
  // The review set's forward-only lifecycle. A REOPEN has its own code rather than sharing the
  // generic transition refusal, because it is the request a firm will actually make and the answer
  // needs to explain itself: the corpus under review is what was reviewed, and a closed review set
  // that could be reopened is a corpus whose contents depend on when you looked.
  | "discovery-review-set-reopen-refused"
  | "discovery-review-set-transition-refused"
  // A load into a review set that is no longer accepting material. Distinct from the transition
  // refusal above: nothing is being transitioned, the destination is simply shut.
  | "discovery-review-set-not-open"
  // The load-source contract.
  | "discovery-unknown-load-lane"
  | "discovery-load-lane-not-built"
  // The transcript control. Two codes, because "you did not say" and "you said include, which is not
  // built" are different problems with different fixes.
  | "discovery-transcript-scope-unstated"
  | "discovery-transcript-lane-not-built"
  | "discovery-invalid-declared-count"
  | "discovery-load-transition-refused"
  // The ceiling. REFUSED at declaration by name, with the count and the ceiling in the message,
  // never degraded: the alternative is a firm discovering at 400,000 documents that its database is
  // at its hard limit, which is an outage with no good exit.
  | "discovery-document-ceiling-exceeded"
  | "discovery-invalid-document-ceiling"
  // A selection the internal lanes refuse to resolve. A quarantined or still-pending version is not
  // review material, and saying so by name is what keeps a corpus from quietly containing a file
  // nobody was allowed to open.
  | "discovery-version-not-clean"
  | "discovery-selection-empty"
  | "discovery-selection-too-large"
  | "discovery-selection-matter-mismatch"
  // Ordinary lookups.
  | "discovery-unknown-review-set"
  | "discovery-unknown-record-custodian"
  | "discovery-unknown-load"
  | "discovery-unknown-review-document"
  // A record custodian named on a load that belongs to a different review set. Custodians are
  // review-set-scoped on purpose — the same name in one matter is not assertably the same person as
  // in another, and asserting it wrongly is a defensibility problem.
  | "discovery-record-custodian-review-set-mismatch";

export class DiscoveryValidationError extends Error {
  constructor(
    readonly code: DiscoveryValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryValidationError";
  }
}

function refuse(code: DiscoveryValidationCode, message: string): never {
  throw new DiscoveryValidationError(code, message);
}

export function assertReviewSetName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    refuse("discovery-empty-review-set-name", "a review set needs a name");
  }
  if (trimmed.length > REVIEW_SET_NAME_MAX_LENGTH) {
    refuse(
      "discovery-empty-review-set-name",
      `a review set name is at most ${REVIEW_SET_NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

export function assertRecordCustodianName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    refuse("discovery-empty-record-custodian-name", "a record custodian needs a display name");
  }
  if (trimmed.length > RECORD_CUSTODIAN_NAME_MAX_LENGTH) {
    refuse(
      "discovery-empty-record-custodian-name",
      `a record custodian display name is at most ${RECORD_CUSTODIAN_NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

// The forward-only lifecycle, checked in the service so a caller gets a named refusal rather than a
// database abort. The database carries the same rule as a trigger, because a rule enforced only in
// application code is a rule a second write path does not know about.
export function assertReviewSetTransition(from: ReviewSetState, to: ReviewSetState): void {
  if (from === to) return;
  if (from === "closed") {
    refuse(
      "discovery-review-set-reopen-refused",
      "a closed review set is not reopened. The corpus under review is what was reviewed, and its " +
        "derived index has been released for collection. Create a new review set and load into it — " +
        "that is a recorded act, and the record is the point.",
    );
  }
  const allowed = REVIEW_SET_FORWARD_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    refuse(
      "discovery-review-set-transition-refused",
      `a review set moves open -> locked -> closed and never back; ${from} -> ${to} is not a move it makes`,
    );
  }
}

// The ceiling refusal, with both numbers in the message. A refusal that says "too many" leaves a firm
// guessing at how much of the load to split off; one that names the count and the ceiling does not.
export function assertWithinDocumentCeiling(options: {
  readonly currentDocumentCount: number;
  readonly incomingDocumentCount: number;
  readonly documentCeiling: number;
}): void {
  const total = options.currentDocumentCount + options.incomingDocumentCount;
  if (total <= options.documentCeiling) return;
  refuse(
    "discovery-document-ceiling-exceeded",
    `this load would carry the review set to ${total} documents, past its ceiling of ` +
      `${options.documentCeiling} (it holds ${options.currentDocumentCount} now, and the load ` +
      `declares ${options.incomingDocumentCount}). Split the material across review sets, or raise ` +
      `the firm's ceiling deliberately — it is refused rather than degraded because a database that ` +
      `fills up mid-review has no good exit.`,
  );
}
