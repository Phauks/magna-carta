import { BULK_CODING_MAX_DOCUMENTS, CODING_CRITERIA_MAX_LENGTH } from "./limits.ts";
import {
  RECORD_CUSTODIAN_NAME_MAX_LENGTH,
  REVIEW_SET_FORWARD_TRANSITIONS,
  REVIEW_SET_NAME_MAX_LENGTH,
  REVIEW_TAG_COLOR_TOKEN_PATTERN,
  REVIEW_TAG_GROUP_NAME_MAX_LENGTH,
  REVIEW_TAG_NAME_MAX_LENGTH,
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
  | "discovery-record-custodian-review-set-mismatch"
  // The coding panel.
  | "discovery-empty-tag-group-name"
  | "discovery-tag-group-name-taken"
  | "discovery-empty-tag-name"
  | "discovery-tag-name-taken"
  | "discovery-invalid-tag-color-token"
  | "discovery-unknown-tag-group"
  | "discovery-unknown-tag"
  | "discovery-tag-group-limit-reached"
  | "discovery-tag-limit-reached"
  // A system group and its semantic-bearing tags are RENAMABLE but not deletable, because production
  // logic stands on their existence. Deactivating a semantic-bearing tag is the same refusal for the
  // same reason.
  | "discovery-system-tag-group-not-deletable"
  | "discovery-semantic-tag-not-deactivatable"
  // Applying an inactive tag. A deactivated tag stays readable on every row it ever wrote and is
  // refused as a NEW answer, which is the difference between hiding a question and rewriting history.
  | "discovery-tag-inactive"
  // A tag applied to a document in a different review set. The panel is review-set-scoped, so this is
  // always a caller mistake rather than a rule the firm can change.
  | "discovery-tag-review-set-mismatch"
  // Bulk gestures.
  | "discovery-coding-selection-empty"
  | "discovery-coding-selection-too-large"
  | "discovery-coding-criteria-too-long"
  // Undo, which is exact or it is nothing: only a completed act is reversible, and only once.
  | "discovery-event-not-undoable"
  | "discovery-unknown-tag-event"
  // The access list. `discovery-review-set-unreachable` is what a member not on the list gets, and the
  // route turns it into a 404 rather than a 403 — a walled review set is ABSENT, not present and
  // refused, because "you may not see this one" names its existence.
  | "discovery-review-set-unreachable"
  | "discovery-access-list-would-be-empty";

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
    refuse("discovery-empty-record-custodian-name", "a Custodian of Record needs a display name");
  }
  if (trimmed.length > RECORD_CUSTODIAN_NAME_MAX_LENGTH) {
    refuse(
      "discovery-empty-record-custodian-name",
      `a Custodian of Record display name is at most ${RECORD_CUSTODIAN_NAME_MAX_LENGTH} characters`,
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

export function assertTagGroupName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    refuse("discovery-empty-tag-group-name", "a coding question needs a name");
  }
  if (trimmed.length > REVIEW_TAG_GROUP_NAME_MAX_LENGTH) {
    refuse(
      "discovery-empty-tag-group-name",
      `a coding question's name is at most ${REVIEW_TAG_GROUP_NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

export function assertTagName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    refuse("discovery-empty-tag-name", "a tag needs a name");
  }
  if (trimmed.length > REVIEW_TAG_NAME_MAX_LENGTH) {
    refuse(
      "discovery-empty-tag-name",
      `a tag name is at most ${REVIEW_TAG_NAME_MAX_LENGTH} characters`,
    );
  }
  return trimmed;
}

// A design-token NAME, never a raw colour value. Refused rather than sanitized: a firm that sent
// `#ff0000` has a client bypassing the design system, and quietly storing something else would hide
// that instead of surfacing it.
export function assertTagColorToken(colorToken: string): string {
  const trimmed = colorToken.trim();
  if (!REVIEW_TAG_COLOR_TOKEN_PATTERN.test(trimmed)) {
    refuse(
      "discovery-invalid-tag-color-token",
      "a tag's colour is the NAME of a design token (lower-case letters, digits and hyphens), " +
        "never a colour value — the coding panel styles through the design system, and a raw value " +
        "here would be an off-token colour no theme could correct",
    );
  }
  return trimmed;
}

// A bulk selection is bounded the same way a load selection is, and for the same reason: it is a
// request body, not a corpus.
export function assertCodingSelectionSize(documentCount: number): void {
  if (documentCount === 0) {
    refuse("discovery-coding-selection-empty", "a bulk coding operation needs documents to act on");
  }
  if (documentCount > BULK_CODING_MAX_DOCUMENTS) {
    refuse(
      "discovery-coding-selection-too-large",
      `a bulk coding operation names at most ${BULK_CODING_MAX_DOCUMENTS} documents at a time ` +
        `(this one names ${documentCount}). Coding a whole corpus at once is a different operation ` +
        `and arrives with the corpus index read.`,
    );
  }
}

export function assertCodingCriteria(criteria: string | null): string | null {
  if (criteria === null) return null;
  if (criteria.length > CODING_CRITERIA_MAX_LENGTH) {
    refuse(
      "discovery-coding-criteria-too-long",
      `the recorded criteria of a bulk gesture are at most ${CODING_CRITERIA_MAX_LENGTH} ` +
        `characters — they are a note naming fields and identifiers, never free text`,
    );
  }
  return criteria;
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
