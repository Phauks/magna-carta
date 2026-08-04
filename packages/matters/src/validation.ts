// Stable machine-readable refusal codes for the matter lifecycle — callers branch on the code, never
// the message. The numbering renderer has its own error type (numbering/render.ts).
export type MatterValidationCode =
  | "empty-matter-title"
  | "matter-not-found"
  | "matter-not-prospective"
  | "matter-not-closed"
  | "matter-already-closed"
  | "scheme-missing"
  | "matter-number-not-url-safe"
  | "matter-number-taken"
  // Matter types (one error type for the whole matters module).
  | "empty-type-name"
  | "type-name-taken"
  | "type-code-taken"
  | "unknown-matter-type";

export class MatterValidationError extends Error {
  constructor(
    readonly code: MatterValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "MatterValidationError";
  }
}
