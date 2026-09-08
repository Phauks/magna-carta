// Stable machine-readable refusal codes for the fee-entry lifecycle and capture guards — callers
// branch on the code, never the message. `illegal-transition` is an unreachable status move under
// the active gate; `frozen-entry` is an attempted write to a billed/void row beyond the billing
// lock; the remaining codes guard a capture's shape.
//
// The set is deliberately the cost domain's minus the two guards a fee has no equivalent of. There
// is no `utbms-required`, because a UTBMS code classifies a disbursement and a fee carries none;
// what a fee has instead is a timekeeper, which is optional on the record and so guards nothing.
export type FeeValidationCode =
  | "not-found"
  | "draft-only"
  | "frozen-entry"
  | "illegal-transition"
  | "non-positive-amount"
  | "unsupported-currency"
  | "empty-patch";

export class FeeValidationError extends Error {
  constructor(
    readonly code: FeeValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "FeeValidationError";
  }
}
