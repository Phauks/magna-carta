import { MAX_NOTE_BODY_LENGTH, MAX_RETRACTION_REASON_LENGTH } from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type NoteValidationCode =
  // An empty body, or one past the ceiling. The schema carries the emptiness check too; this exists
  // to turn a database abort into a named refusal a caller can act on.
  | "note-empty-body"
  | "note-body-too-long"
  // A retraction with no reason, or one longer than a reason should be. Required because "why did
  // this stop rendering" is the question somebody asks later and the only bad answer is silence.
  | "note-retraction-reason-required"
  | "note-retraction-reason-too-long"
  // An act asked of a note that has already been withdrawn. A retracted note is not revised and not
  // retracted twice: its body has stopped rendering, and appending to it would put new words behind
  // a tombstone where nothing displays them.
  | "note-retracted"
  // A note this reader cannot reach, or one that is not on the matter the caller named. Kept
  // distinct because they are fixed differently, and neither ever reveals which by its message.
  | "note-unknown"
  | "note-matter-mismatch";

export class NoteValidationError extends Error {
  constructor(
    readonly code: NoteValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "NoteValidationError";
  }
}

function refuse(code: NoteValidationCode, message: string): never {
  throw new NoteValidationError(code, message);
}

// The body as it will be stored. Trimmed at the edges and never in the middle: trailing whitespace
// is an artifact of typing, and the paragraph breaks inside are the writer's.
export function normalizeNoteBody(body: string): string {
  const normalized = body.trim();
  if (normalized.length === 0) refuse("note-empty-body", "a note needs something written in it");
  if (normalized.length > MAX_NOTE_BODY_LENGTH) {
    refuse(
      "note-body-too-long",
      `a note body is at most ${String(MAX_NOTE_BODY_LENGTH)} characters; this one is ${String(normalized.length)}`,
    );
  }
  return normalized;
}

export function normalizeRetractionReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length === 0) {
    refuse(
      "note-retraction-reason-required",
      "withdrawing a note requires a reason: the note stops rendering and the reason is what stays",
    );
  }
  if (normalized.length > MAX_RETRACTION_REASON_LENGTH) {
    refuse(
      "note-retraction-reason-too-long",
      `a retraction reason is at most ${String(MAX_RETRACTION_REASON_LENGTH)} characters; it says why the words came down, not what they were`,
    );
  }
  return normalized;
}
