// Every refusal carries a stable machine-readable code; callers branch on the code, never on the
// message text. One error type for the whole subsystem, mirroring the ledger's LedgerValidationError.
export type TrustValidationCode =
  // Account tree
  | "unknown-trust-account"
  | "trust-account-closed"
  | "unknown-trust-node"
  | "trust-node-currency-mismatch"
  | "matter-leaf-already-exists"
  // Entry composition — the structural guards
  | "not-a-trust-entry"
  | "crosses-trust-accounts"
  | "commingled-entry"
  | "posting-to-liability-root"
  | "posting-to-client-node"
  | "firm-funds-node-not-enabled"
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
  // Holds and available balance
  | "hold-exceeds-available"
  | "unknown-hold"
  | "hold-already-released"
  | "hold-is-a-release"
  | "hold-currency-mismatch"
  // Transfers out of trust
  | "transfer-exceeds-available"
  | "operating-side-is-trust-account"
  | "earned-fee-precondition-unavailable"
  // Jurisdiction
  | "jurisdiction-not-recorded"
  | "jurisdiction-not-encoded"
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
  | "match-is-a-withdrawal"
  | "match-already-withdrawn"
  | "statement-line-already-matched"
  | "ledger-entry-already-matched"
  | "entry-is-not-a-bank-item";

export class TrustValidationError extends Error {
  constructor(
    readonly code: TrustValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "TrustValidationError";
  }
}
