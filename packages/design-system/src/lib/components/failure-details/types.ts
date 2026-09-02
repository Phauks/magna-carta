/** One scannable fact on a failure surface: "Error ID", "err_7FQ2K9XW", in the monospace face. */
export interface FailureDetailRow {
  /** What the fact is called, in the reader's words. Doubles as the row's key, so it is unique. */
  readonly label: string;
  /** The fact. Already a string — a surface decides how a null or a missing value reads. */
  readonly value: string;
  /** Render in the monospace face. True for identifiers, request lines, and codes. */
  readonly mono?: boolean;
}
