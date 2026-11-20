// Every refusal the operating books make carries a code the route maps to an HTTP status and a
// message a person can act on. The codes are the vocabulary; the messages name the offending thing.
export type GeneralLedgerValidationCode =
  | "unknown-account"
  | "account-is-trust-registered"
  | "account-is-a-system-account"
  | "account-type-is-fixed"
  | "account-code-taken"
  | "section-not-of-type"
  | "empty-name"
  | "role-account-is-trust-registered"
  | "role-account-is-a-parent"
  | "role-account-type-mismatch"
  | "role-account-inactive"
  | "account-role-unmapped"
  | "chart-already-started"
  | "unknown-operating-account"
  | "operating-account-closed"
  | "operating-account-not-cash"
  | "last-four-malformed"
  | "unknown-vendor-bill"
  | "vendor-bill-has-no-lines"
  | "vendor-bill-line-malformed"
  | "vendor-bill-line-needs-expense-account"
  | "vendor-bill-line-account-not-expense"
  | "vendor-bill-reversed"
  | "vendor-bill-has-payments"
  | "vendor-bill-already-reversed"
  | "vendor-bill-cost-billed"
  | "vendor-bill-missing-vendor"
  | "payment-method-malformed"
  | "check-number-malformed"
  | "reversal-needs-reason"
  | "payment-exceeds-open-balance"
  | "payment-amount-not-positive"
  | "date-malformed";

export class GeneralLedgerValidationError extends Error {
  readonly code: GeneralLedgerValidationCode;
  constructor(code: GeneralLedgerValidationCode, message: string) {
    super(message);
    this.name = "GeneralLedgerValidationError";
    this.code = code;
  }
}
