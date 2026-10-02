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
  | "invoice-numbering-needs-letterhead"
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
  | "retainer-replenishment-not-open"
  // Corrections after finalization. A finalized bill is frozen, so each of these refusals is about
  // whether a SECOND record may be written, never about editing the first.
  | "credit-note-invalid"
  | "credit-note-matter-not-billed"
  | "write-off-invalid"
  | "write-off-exceeds-unpaid-balance"
  | "unknown-client-credit"
  | "client-credit-exhausted"
  | "client-credit-client-mismatch"
  | "unknown-invoice-application"
  | "application-reversal-invalid"
  | "application-reversal-refused"
  // The delivery record. A delivery is recorded rather than performed, so the only refusals possible
  // are about whether the row describes something that could have happened.
  | "invoice-delivery-invalid";

export class BillingValidationError extends Error {
  constructor(
    readonly code: BillingValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "BillingValidationError";
  }
}
