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
  | "reconciliation-outstanding-items-truncated"
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
