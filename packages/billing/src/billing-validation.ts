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
  | "invoice-total-not-positive"
  | "invoice-matter-total-negative"
  | "invoice-line-currency-mismatch"
  | "unknown-number-scope"
  // The one application door, and the five conditions that let money leave a client's trust ledger
  // for the firm. Each names exactly which of them failed, because "the transfer was refused" is not
  // something a member can act on and "this invoice is still a draft" is.
  | "application-kind-not-built"
  | "application-amount-not-positive"
  | "application-currency-mismatch"
  | "earned-fee-invoice-not-final"
  | "earned-fee-invoice-client-mismatch"
  | "earned-fee-invoice-does-not-bill-matter"
  | "earned-fee-exceeds-unpaid-balance"
  | "earned-fee-amount-mismatch"
  | "earned-fee-node-mismatch"
  | "earned-fee-no-applications"
  | "earned-fee-too-many-invoices"
  // The pending earned-fee application — billing's side of the shared authorization queue
  | "request-not-an-earned-fee-application"
  | "application-request-malformed"
  // The fee models: the agreement, its shape, and the compositions each kind permits
  | "billing-arrangement-invalid"
  | "billing-arrangement-kind-mismatch"
  | "matter-not-billed-hourly"
  | "matter-recovery-invalid"
  | "unknown-matter-recovery"
  | "contingency-no-recovery"
  | "contingency-currency-mismatch"
  | "contingency-base-not-positive"
  | "contingency-fee-already-on-draft"
  | "contingency-nothing-unbilled"
  | "retainer-not-below-floor"
  | "retainer-replenishment-already-open"
  | "retainer-replenishment-not-open";

export class BillingValidationError extends Error {
  constructor(
    readonly code: BillingValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "BillingValidationError";
  }
}
