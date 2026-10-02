import { MAX_MEETING_MESSAGE_LENGTH } from "./chat-types.ts";

// The chat's own refusals, as codes the route maps to problem types. Codes — never messages — drive
// the mapping, so a message can be reworded without changing the contract.
//
// It is a SEPARATE union from the room's (`./validation.ts`) because it answers a separate question:
// those refusals are about reaching a meeting, these are about a message inside one. What is
// deliberately NOT here is speaking from outside the room — that is the room's own
// `meeting-not-joined`, raised by the same absent open stay the socket upgrade refuses on, and a
// second code for it would let the two answers drift apart.
export type MeetingChatValidationCode =
  // A message handle that names nothing, and a message belonging to another meeting. One refusal for
  // both, on the rule the room already holds for an unknown event: telling them apart would make the
  // route an existence oracle — ask about an id, learn from the wording whether it is real.
  | "meeting-message-not-found"
  // Longer than a message is allowed to be. Refused rather than truncated — a message silently cut
  // in half is a record of something nobody said.
  | "meeting-message-too-long"
  // Empty, or nothing but whitespace. There is no such thing as saying nothing on the record.
  | "meeting-message-empty"
  // Somebody else's message, and the caller is not hosting. A host moderates the room and an author
  // takes back their own words; a third member does neither.
  | "meeting-message-not-redactable";

export class MeetingChatValidationError extends Error {
  constructor(
    readonly code: MeetingChatValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "MeetingChatValidationError";
  }
}

export function refuseChat(code: MeetingChatValidationCode, message: string): never {
  throw new MeetingChatValidationError(code, message);
}

/**
 * The body as it will be stored, or a refusal.
 *
 * TRIMMED AT THE EDGES AND NOWHERE ELSE. A browser sends the trailing newline the member's Enter key
 * left behind, and storing it would make two identical messages unequal; everything inside the
 * message is the member's, including the blank line they put between two paragraphs.
 *
 * The length is measured on what will be STORED, after the trim, because that is what the database's
 * own CHECK measures. Measuring the untrimmed value would refuse a message that fits.
 */
export function assertMessageBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    refuseChat("meeting-message-empty", "a message has to say something");
  }
  if (trimmed.length > MAX_MEETING_MESSAGE_LENGTH) {
    refuseChat(
      "meeting-message-too-long",
      `a message holds ${String(MAX_MEETING_MESSAGE_LENGTH)} characters at most`,
    );
  }
  return trimmed;
}
