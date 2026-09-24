import { MAX_MEETING_QUESTION_LENGTH } from "./question-types.ts";

// The question queue's own refusals, as codes the route maps to problem types — a separate union
// from the room's and the chat's, on the chat's reasoning. Asking from outside the room is the room's
// own `meeting-not-joined`, and marking a question answered without a grant is `meeting-not-host`.
export type MeetingQuestionValidationCode =
  // A question handle that names nothing, and a question in another meeting — one refusal for both,
  // so the route is not an existence oracle.
  | "meeting-question-not-found"
  // Longer than a question may be. Refused rather than truncated: a question cut in half is a record
  // of something nobody asked.
  | "meeting-question-too-long"
  // Empty, or nothing but whitespace.
  | "meeting-question-empty"
  // The meeting's queue already holds as many questions as a queue may.
  | "meeting-question-limit-reached"
  // Somebody else's question, and the caller is not hosting. A host moderates the room and an author
  // takes back their own words; a third member does neither.
  | "meeting-question-not-redactable";

export class MeetingQuestionValidationError extends Error {
  constructor(
    readonly code: MeetingQuestionValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "MeetingQuestionValidationError";
  }
}

export function refuseQuestion(code: MeetingQuestionValidationCode, message: string): never {
  throw new MeetingQuestionValidationError(code, message);
}

/**
 * The body as it will be stored, or a refusal — trimmed at the edges and nowhere else, and measured
 * after the trim, because that is what the database's own CHECK measures. The chat message's rule.
 */
export function assertQuestionBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0)
    refuseQuestion("meeting-question-empty", "a question has to ask something");
  if (trimmed.length > MAX_MEETING_QUESTION_LENGTH) {
    refuseQuestion(
      "meeting-question-too-long",
      `a question holds ${String(MAX_MEETING_QUESTION_LENGTH)} characters at most`,
    );
  }
  return trimmed;
}
