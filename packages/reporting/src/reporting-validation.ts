// Every refusal carries a stable machine-readable code; callers branch on the code, never on the
// message text. One error type for the whole reporting surface, mirroring the ledger's
// LedgerValidationError and trust's TrustValidationError.
//
// Refusals the DOMAIN packages raise are NOT re-coded here. A pack that cannot be produced because
// the outstanding-item list is truncated, or because nobody has recorded which jurisdiction governs
// the account, propagates the trust package's own refusal unchanged — a report that renamed a
// compliance refusal would be a second answer to a question trust already answers, and the remedy a
// firm has to act on is stated in trust's message rather than in a reporting synonym of it.
export type ReportingValidationCode =
  // The temporal pair every ledger-backed read is taken over
  | "reporting-period-not-a-calendar-date"
  | "reporting-period-inverted"
  | "reporting-knowledge-instant-not-an-instant"
  | "reporting-knowledge-instant-in-the-future"
  // The scope a bounded read is served for
  | "reporting-period-exceeds-read-budget";

export class ReportingValidationError extends Error {
  constructor(
    readonly code: ReportingValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "ReportingValidationError";
  }
}
