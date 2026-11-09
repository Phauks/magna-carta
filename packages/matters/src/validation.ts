// Stable machine-readable refusal codes for the matter lifecycle — callers branch on the code, never
// the message. The numbering renderer has its own error type (numbering/render.ts).
export type MatterValidationCode =
  | "empty-matter-title"
  | "matter-not-found"
  | "matter-not-consultation"
  | "matter-not-intake"
  | "matter-not-closed"
  | "matter-already-closed"
  // The hold: only an active matter or a consultation can be put on hold, only a held one
  // released, and a hold with no reason is a pause nobody can explain. The code keeps its name
  // because callers branch on it; its message names both statuses the hold accepts.
  | "matter-not-open"
  | "matter-not-held"
  | "empty-hold-reason"
  | "scheme-missing"
  | "matter-number-not-url-safe"
  | "matter-number-taken"
  // Matter types (one error type for the whole matters module).
  | "empty-type-name"
  | "type-name-taken"
  | "type-code-taken"
  | "unknown-matter-type"
  // Staffing (matter-assignment.ts): the responsible attorney lives on the matter row, and an
  // assignment role must carry at least one letter or digit to match anything.
  | "invalid-assignment-role"
  // Staffing validity window: each bound is a civil date (YYYY-MM-DD) and the window must be
  // ordered — an arbitrary string would silently mis-window the staffing read's comparison.
  | "invalid-validity-window"
  // The paper file's destruction date: a real calendar day (YYYY-MM-DD), because the route's
  // pattern alone accepts a day that does not exist and a reminder dated 2026-02-30 never falls due.
  | "invalid-file-destruction-date"
  // ...and no earlier than the firm's minimum retention after the close.
  | "file-destruction-date-before-minimum"
  // Court-case and estate records: a Directory reference that names no live record is refused up
  // front rather than resolving to silent absences forever.
  | "unknown-entity";

export class MatterValidationError extends Error {
  constructor(
    readonly code: MatterValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "MatterValidationError";
  }
}
