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
  // The destruction request named is unknown, already decided, or not yet approved. Three distinct
  // states a caller acts on differently: find the right request, raise a new one, get a second
  // person to approve.
  | "custody-unknown-destruction-request"
  | "custody-destruction-request-decided"
  | "custody-destruction-not-approved"
  // The owner link named an ownership role the firm's own catalog does not contain. A firm that has
  // configured no catalog constrains nothing — the label stays free text, as it always was.
  | "custody-ownership-role-not-in-catalog"
  // A jurisdiction was needed and none was supplied, versus one was supplied and no verified rules
  // are encoded for it. These stay distinct because they are fixed differently: the first by
  // recording the jurisdiction, the second by researching and verifying it against primary text.
  // Conflating them is how a firm comes to read silence as "nothing applies to us".
  | "custody-jurisdiction-not-recorded"
  | "custody-jurisdiction-not-encoded"
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
  | "custody-scan-file-not-filed-here"
  // A stocktake that is no longer taking sightings: closed or abandoned. Recording against one, or
  // closing it a second time, would change a reconciliation somebody has already read and acted on.
  | "custody-stocktake-closed"
  | "custody-unknown-stocktake"
  // A sighting whose shape does not match what its kind asserts — an `unregistered` observation with
  // no description of what was found, a `sighted` naming no location.
  | "custody-invalid-sighting";

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
