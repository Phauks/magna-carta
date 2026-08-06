// Every refusal this package makes carries a code the route maps to an HTTP status and a message a
// person can act on. The codes are the vocabulary; the messages name the offending thing.
export type BillingValidationCode =
  | "unknown-invoice"
  | "unknown-invoice-line"
  | "unknown-invoice-claim"
  | "invoice-not-draft"
  | "invoice-not-final"
  | "invoice-has-no-lines"
  | "invoice-client-mismatch"
  | "matter-has-no-client"
  | "work-in-progress-not-billable"
  | "work-in-progress-already-claimed"
  | "work-in-progress-wrong-matter"
  | "claim-limit-exceeded"
  | "account-role-unmapped"
  | "invoice-total-not-positive";

export class BillingValidationError extends Error {
  constructor(
    readonly code: BillingValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "BillingValidationError";
  }
}
