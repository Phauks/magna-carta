// Stable machine-readable refusal codes for the rate engine — callers branch on the code, never the
// message. A rate-version write is append-only: the only way it can fail validation is an overlap with
// an existing interval for the same scope (SQLite cannot range-exclude, so the service enforces it).
export type RateValidationCode = "overlapping-valid-from";

export class RateValidationError extends Error {
  constructor(
    readonly code: RateValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "RateValidationError";
  }
}
