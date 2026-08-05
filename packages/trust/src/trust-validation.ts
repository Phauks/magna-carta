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
  | "jurisdiction-not-encoded";

export class TrustValidationError extends Error {
  constructor(
    readonly code: TrustValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "TrustValidationError";
  }
}
