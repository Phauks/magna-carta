import { MAX_CUSTODY_REVIEW_INTERVAL_MONTHS } from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type CustodyValidationCode =
  // A packet cannot exist without at least one owner link. The orphan-prevention invariant: the
  // catastrophic outcome in safe custody is not a misplaced packet but an unattributable one.
  | "custody-owner-required"
  // A hold is in force and forbids this action (release, destruction).
  | "custody-hold-blocks-action"
  // An item flagged as an irreplaceable original is never destructible through the API.
  | "custody-intrinsic-value-not-destructible"
  // Re-parenting a location into its own subtree, or past the depth cap.
  | "custody-location-cycle"
  | "custody-location-too-deep"
  // Closing a location that still holds packets, or has children that do.
  | "custody-location-occupied"
  // The number draw did not converge, or a manual number is already taken.
  | "custody-number-exhausted"
  | "custody-number-taken"
  // Destruction is a two-person action by construction.
  | "custody-approver-must-differ"
  // An original may not leave the firm's custody until the authority it leaves on and the identity
  // check made on the person collecting it have both been recorded. The one movement where recording
  // after the fact is worth nothing, because the property is already gone.
  | "custody-release-not-authorized"
  // A firm that requires two signatories on a release requires two people.
  | "custody-release-signatories-must-differ"
  // Ordinary shape and lifecycle refusals.
  | "custody-empty-name"
  | "custody-empty-description"
  | "custody-unknown-location"
  | "custody-unknown-packet"
  | "custody-unknown-item"
  | "custody-unknown-item-type"
  | "custody-unknown-hold"
  | "custody-hold-already-released"
  | "custody-item-type-name-taken"
  | "custody-item-type-code-taken"
  | "custody-invalid-movement"
  | "custody-packet-closed"
  // A completed review was recorded against something with no review date set.
  | "custody-no-review-scheduled"
  // A review interval outside the bounds the schema accepts.
  | "custody-invalid-review-interval"
  // A label sheet was asked for with nothing on it, or with more than one sheet run can carry.
  | "custody-label-selection-invalid"
  | "custody-scan-file-not-filed-here";

export class CustodyValidationError extends Error {
  constructor(
    readonly code: CustodyValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "CustodyValidationError";
  }
}

// A review interval is a positive whole number of months, bounded. The schema carries the same
// CHECK, so this exists to turn a database abort into a named refusal a caller can act on rather
// than to be the only guard. Zero and negatives are refused rather than treated as "no interval":
// clearing a cycle is passing null, and reading a zero as null would make a typo silently disable a
// recurring review.
export function assertReviewIntervalMonths(months: number | null | undefined): void {
  if (months === null || months === undefined) return;
  if (!Number.isInteger(months) || months <= 0 || months > MAX_CUSTODY_REVIEW_INTERVAL_MONTHS) {
    throw new CustodyValidationError(
      "custody-invalid-review-interval",
      `a review interval is a whole number of months between 1 and ${MAX_CUSTODY_REVIEW_INTERVAL_MONTHS}`,
    );
  }
}
