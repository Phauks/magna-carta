// Stable machine-readable refusal codes for the cost-entry lifecycle and capture guards — callers
// branch on the code, never the message. `illegal-transition` is an unreachable status move under the
// active gate; `frozen-entry` is an attempted write to a billed/void row beyond the billing lock; the
// remaining codes guard a capture's shape.
export type CostValidationCode =
  | "not-found"
  | "draft-only"
  | "frozen-entry"
  | "illegal-transition"
  | "non-positive-amount"
  | "unsupported-currency"
  | "utbms-required"
  | "empty-patch";

export class CostValidationError extends Error {
  constructor(
    readonly code: CostValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "CostValidationError";
  }
}
