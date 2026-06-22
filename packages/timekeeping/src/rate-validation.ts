// Stable machine-readable refusal codes for the rate engine — callers branch on the code, never the
// message. A rate-version write is append-only: the ways it can fail validation are an overlap with an
// existing interval for the same scope (SQLite cannot range-exclude, so the service enforces it) and a
// missing rate card (the service pre-reads existence to avoid writing a dangling row with no parent).
export type RateValidationCode = "overlapping-valid-from" | "rate-card-not-found";

export class RateValidationError extends Error {
  constructor(
    readonly code: RateValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "RateValidationError";
  }
}
