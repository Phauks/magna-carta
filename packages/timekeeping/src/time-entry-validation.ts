// Stable machine-readable refusal codes for the time-entry lifecycle and capture guards — callers
// branch on the code, never the message. `illegal-transition` is an unreachable status move under the
// active gate; `frozen-entry` is an attempted write to a billed/void row beyond the billing lock; the
// remaining codes guard a capture's shape.
export type TimeEntryValidationCode =
  | "illegal-transition"
  | "frozen-entry"
  | "empty-narrative"
  | "non-positive-duration"
  | "non-billable-rate"
  | "missing-utbms-code"
  | "utbms-required"
  | "draft-only"
  | "not-found";

export class TimeEntryValidationError extends Error {
  constructor(
    readonly code: TimeEntryValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "TimeEntryValidationError";
  }
}
