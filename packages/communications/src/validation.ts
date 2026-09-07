import {
  MAX_CALL_DURATION_SECONDS,
  MAX_COMMUNICATION_BODY_LENGTH,
  MAX_COMMUNICATION_SUMMARY_LENGTH,
  MAX_COUNTERPARTY_NUMBER_LENGTH,
  isTextChannel,
  type CommunicationChannel,
} from "./types.ts";

// Every refusal this subsystem raises, as a code the route maps to a problem type. Codes — never
// messages — drive the mapping, so a message can be reworded without changing the contract.
export type CommunicationValidationCode =
  | "communication-empty-number"
  | "communication-invalid-number"
  | "communication-body-too-long"
  | "communication-summary-too-long"
  // The channel-shape refusals. Each names the one field that is wrong rather than a generic
  // "invalid", because each is fixed by the caller supplying something different.
  | "communication-body-on-call"
  | "communication-duration-on-message"
  | "communication-invalid-duration"
  | "communication-duration-too-long"
  | "communication-empty-content"
  | "communication-invalid-instant"
  | "communication-future-instant"
  // A row this reader cannot reach, or one that is not where the caller said it was. Kept distinct
  // because they are fixed differently, and neither reveals which by its message.
  | "communication-unknown"
  | "communication-matter-mismatch"
  // The anchor refusals. A matter that does not exist, and one the reader may not see, are the same
  // refusal on purpose — telling them apart would make the route an existence oracle for walled
  // matters. A CLOSED matter is its own refusal because it is fixed by reopening the matter.
  | "communication-unknown-matter"
  | "communication-matter-closed"
  | "communication-already-routed"
  | "communication-not-routed";

export class CommunicationValidationError extends Error {
  constructor(
    readonly code: CommunicationValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "CommunicationValidationError";
  }
}

function refuse(code: CommunicationValidationCode, message: string): never {
  throw new CommunicationValidationError(code, message);
}

// The counterparty number as it will be stored.
//
// NOT NORMALIZED TO E.164, and that is the decision rather than a shortcut. A member logging a call
// types what they dialled — "(702) 555-0143", or an extension, or an international number with the
// country code spelled however their phone showed it — and rewriting that into a canonical form
// requires knowing the firm's own country, which is a jurisdiction fact this subsystem does not have
// and would be guessing at. What IS removed is the formatting nobody typed on purpose: the run of
// spaces a copy-paste leaves behind. When the carrier adapter lands it supplies real E.164 and the
// column holds that; until then the column holds what a person wrote, which is honest.
const NUMBER_ALLOWED = /^[+0-9 ()\-.x#*]+$/u;

export function normalizeCounterpartyNumber(value: string): string {
  const collapsed = value.trim().replaceAll(/\s+/gu, " ");
  if (collapsed.length === 0) {
    refuse("communication-empty-number", "a call or a message needs the number at the other end");
  }
  if (collapsed.length > MAX_COUNTERPARTY_NUMBER_LENGTH) {
    refuse(
      "communication-invalid-number",
      `a phone number is at most ${String(MAX_COUNTERPARTY_NUMBER_LENGTH)} characters`,
    );
  }
  if (!NUMBER_ALLOWED.test(collapsed)) {
    refuse("communication-invalid-number", "that does not look like a phone number");
  }
  // A number has to have at least one digit in it. The character class above admits "+++", which is
  // punctuation rather than a number, and a row holding it is unreachable by every later lookup.
  if (!/[0-9]/u.test(collapsed)) {
    refuse("communication-invalid-number", "that does not look like a phone number");
  }
  return collapsed;
}

// Text as it will be stored. Trimmed at the edges and never in the middle: trailing whitespace is an
// artifact of typing, and the line breaks inside are the writer's.
function normalizeText(
  value: string | null | undefined,
  limit: number,
  tooLong: CommunicationValidationCode,
  what: string,
): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > limit) {
    refuse(tooLong, `${what} is at most ${String(limit)} characters`);
  }
  return normalized;
}

export interface CommunicationContentInput {
  readonly channel: CommunicationChannel;
  readonly body?: string | null;
  readonly summary?: string | null;
  readonly durationSeconds?: number | null;
}

export interface CommunicationContent {
  readonly body: string | null;
  readonly summary: string | null;
  readonly durationSeconds: number | null;
}

// The channel decides which fields may be filled, and the database says the same thing in its own
// CHECKs. Both, rather than either: the CHECK is what makes a bad row impossible, and this is what
// makes the refusal legible to whoever typed it.
export function normalizeContent(input: CommunicationContentInput): CommunicationContent {
  const body = normalizeText(
    input.body,
    MAX_COMMUNICATION_BODY_LENGTH,
    "communication-body-too-long",
    "a message",
  );
  const summary = normalizeText(
    input.summary,
    MAX_COMMUNICATION_SUMMARY_LENGTH,
    "communication-summary-too-long",
    "a summary",
  );
  const text = isTextChannel(input.channel);

  if (!text && body !== null) {
    refuse(
      "communication-body-on-call",
      "a call has no message text; what was said goes in the summary",
    );
  }

  const duration = input.durationSeconds ?? null;
  if (duration !== null) {
    if (text) {
      refuse("communication-duration-on-message", "a message has no length in seconds");
    }
    if (!Number.isInteger(duration) || duration < 0) {
      refuse("communication-invalid-duration", "a call's length is a whole number of seconds");
    }
    if (duration > MAX_CALL_DURATION_SECONDS) {
      refuse("communication-duration-too-long", "that is longer than a day");
    }
  }

  // A row that records neither what was said nor how long it took is a row nobody can read anything
  // from. The number and the instant alone are what a carrier row legitimately carries — a missed
  // call really is just "this number rang at this time" — but a MEMBER sat down to type this one,
  // and an empty one means they abandoned the form rather than finished it.
  if (body === null && summary === null && duration === null) {
    refuse(
      "communication-empty-content",
      text
        ? "a message needs its text"
        : "a call needs a summary of what was said, or at least its length",
    );
  }

  return { body, summary, durationSeconds: duration };
}

// The instant it happened, which is not the instant it was typed. Accepted as an ISO-8601 string and
// stored as one, on the platform's convention.
//
// REFUSED IF IT IS IN THE FUTURE, which is the one bound worth enforcing here. A call logged for
// next Tuesday is a typo every time — a slip in the year or the month — and a log that silently
// accepts it puts a row at the top of every list, above everything real, until the date arrives.
// A small tolerance rides along so a client clock that is a minute fast is not an error.
const FUTURE_TOLERANCE_MILLISECONDS = 60_000;

export function normalizeOccurredAt(value: string, now: string): string {
  const occurred = Date.parse(value);
  if (Number.isNaN(occurred)) {
    refuse("communication-invalid-instant", "that is not a date and time");
  }
  const current = Date.parse(now);
  if (!Number.isNaN(current) && occurred > current + FUTURE_TOLERANCE_MILLISECONDS) {
    refuse("communication-future-instant", "a call or a message cannot have happened yet");
  }
  return new Date(occurred).toISOString();
}
