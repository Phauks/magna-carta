// Every refusal carries a stable machine-readable code; callers branch on the code, never on the
// message text. One error type for the whole subsystem, mirroring the ledger's LedgerValidationError.
export type TrustValidationCode =
  // Account tree
  | "unknown-trust-account"
  | "trust-account-closed"
  | "unknown-trust-node"
  | "trust-node-currency-mismatch"
  | "matter-leaf-already-exists"
  | "matter-has-no-client"
  | "trust-leaf-client-mismatch"
  // Entry composition — the structural guards
  | "not-a-trust-entry"
  | "crosses-trust-accounts"
  | "commingled-entry"
  | "posting-to-liability-root"
  | "posting-to-client-node"
  | "missing-client-line"
  | "multiple-clients-on-entry"
  | "single-node-reallocation"
  // Movements
  | "movement-currency-mismatch"
  | "movement-exceeds-available"
  | "movement-node-is-not-a-matter-leaf"
  | "movement-transfer-to-same-node"
  | "movement-method-not-permitted"
  // Disbursement authorization — the pending request and the decision that settles it
  | "unknown-trust-disbursement-request"
  | "trust-disbursement-request-already-decided"
  | "trust-disbursement-decider-is-requester"
  | "trust-disbursement-withdrawal-not-by-requester"
  | "trust-request-not-a-disbursement"
  // The firm's authorization policy — the per-firm posture both money-out paths are decided under
  | "unknown-trust-authorization-policy"
  | "trust-authorization-policy-malformed"
  | "trust-authorization-policy-threshold-required"
  | "trust-authorization-policy-threshold-forbidden"
  | "trust-authorization-policy-unchanged"
  | "trust-authorization-authority-required"
  // Holds and available balance
  | "hold-exceeds-available"
  | "unknown-hold"
  | "hold-already-released"
  | "hold-is-a-release"
  | "hold-currency-mismatch"
  // Transfers out of trust
  | "transfer-exceeds-available"
  | "transfer-requires-second-person"
  | "operating-side-is-trust-account"
  | "earned-fee-precondition-unavailable"
  // Jurisdiction — four distinct refusals, each fixed by a different person doing a different thing:
  // record the office's state; research a jurisdiction; have an attorney review one that IS
  // researched; research the one field that was missed. Collapsing any two of them tells a firm
  // something about its obligations that nobody has stood behind.
  | "jurisdiction-not-recorded"
  | "jurisdiction-not-encoded"
  | "jurisdiction-not-verified"
  | "jurisdiction-requirement-not-encoded"
  // Check printing: the stock a check prints on, and a check number's life in the register
  | "check-stock-invalid"
  | "check-stock-missing"
  | "check-stock-unreadable"
  | "check-print-empty"
  | "check-print-too-many"
  | "check-print-duplicate"
  | "check-not-waiting"
  | "check-result-empty"
  | "check-already-answered"
  | "check-void-reason-missing"
  | "unknown-trust-check"
  // Bank statements — the one external input
  | "unknown-trust-bank-statement"
  | "unknown-trust-bank-statement-line"
  | "statement-currency-mismatch"
  | "statement-period-invalid"
  | "statement-line-outside-period"
  | "statement-has-no-lines"
  | "statement-too-many-lines"
  | "statement-already-superseded"
  | "statement-supersedes-other-account"
  // The guided CSV import: what the file said, and whether it is the file that was confirmed
  | "statement-import-columns-unrecognized"
  | "statement-import-preview-mismatch"
  | "statement-import-nothing-to-record"
  // Reconciliation and matching
  | "unknown-trust-reconciliation"
  | "reconciliation-closed"
  | "reconciliation-statement-mismatch"
  | "unknown-trust-reconciliation-match"
  | "match-belongs-to-another-reconciliation"
  // Two reads feed a proof, and neither may be a silently short list: the book items still in
  // transit, and the statement lines the period has not accounted for. A close freezes a figure
  // derived from each, so a truncated list is not a short answer but a confidently wrong one.
  | "reconciliation-outstanding-items-truncated"
  | "reconciliation-unmatched-lines-truncated"
  | "match-is-a-withdrawal"
  | "match-already-withdrawn"
  | "statement-line-already-matched"
  | "ledger-entry-already-matched"
  | "entry-is-not-a-bank-item"
  // The bank-charge carve-out — the firm's OWN money in a trust account. Every code here refuses;
  // none of them is a warning, and none has an override.
  | "firm-funds-node-already-open"
  | "firm-funds-node-not-open"
  | "firm-funds-entry-touches-client-money"
  | "firm-funds-entry-shape-invalid"
  | "firm-funds-account-is-pooled-interest-bearing"
  | "bank-charge-exceeds-firm-funds"
  // Unclaimed and dormant client funds — the diligence file, which never moves money
  | "unknown-trust-unclaimed-funds-review"
  | "trust-unclaimed-funds-review-already-closed"
  | "trust-unclaimed-funds-review-already-open"
  | "trust-unclaimed-funds-node-holds-no-balance"
  | "trust-unclaimed-funds-movement-is-not-this-ledger"
  | "trust-unclaimed-funds-window-invalid"
  | "trust-dormant-balances-truncated";

export class TrustValidationError extends Error {
  constructor(
    readonly code: TrustValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "TrustValidationError";
  }
}
