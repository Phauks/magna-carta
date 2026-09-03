// Stable machine-readable refusal codes for the time-entry lifecycle and capture guards — callers
// branch on the code, never the message. `illegal-transition` is an unreachable status move under the
// active gate; `frozen-entry` is an attempted write to a billed/void row beyond the billing lock; the
// remaining codes guard a capture's shape.
export type TimeEntryValidationCode =
  | "illegal-transition"
  | "frozen-entry"
  | "empty-narrative"
  | "non-positive-duration"
  | "non-billable-rate"
  | "missing-utbms-code"
  | "utbms-required"
  | "draft-only"
  | "not-found"
  | "empty-name"
  | "empty-patch"
  // Attachment guards: the file is not one of the entry's matter's own live documents, or the
  // link already exists / does not exist.
  | "file-not-on-matter"
  | "already-attached"
  | "not-attached"
  // Conversion guards: an entry already billed (or claimed by a draft bill), already void, or
  // carrying no amount cannot convert to another charge kind.
  | "no-amount"
  | "claimed-by-draft"
  // Refile guard: the entry is already on the matter it was asked to move to. Refusing rather than
  // no-opping keeps the act's meaning — a move that moved nothing still reported success.
  | "same-matter"
  // Unvoid guards. `not-void` is an entry that was never voided, so there is nothing to undo.
  // `converted-to-cost` is the one void that must stay a void: the entry's value was carried over
  // to a cost entry, and putting the time back would bill the same work twice.
  | "not-void"
  | "converted-to-cost";

export class TimeEntryValidationError extends Error {
  constructor(
    readonly code: TimeEntryValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "TimeEntryValidationError";
  }
}
