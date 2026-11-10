import {
  MAX_CALL_DURATION_SECONDS,
  MAX_CALLER_ID_NAME_LENGTH,
  INBOUND_CALL_OUTCOMES,
  OUTBOUND_CALL_OUTCOMES,
  SELF_DESCRIBING_OUTCOMES,
  isCallOutcome,
  isSpamKind,
  type CallOutcome,
  type CommunicationDirection,
  type SpamKind,
  isCommunicationDisposition,
  MAX_COMMUNICATION_BODY_LENGTH,
  MAX_COMMUNICATION_SUMMARY_LENGTH,
  MAX_COUNTERPARTY_NUMBER_LENGTH,
  isTextChannel,
  type CommunicationChannel,
  type CommunicationDisposition,
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
  // The END of a call, which is a fact about the line rather than about the length. A message has no
  // end, and an end before the start is a typo rather than a call that ran backwards.
  | "communication-ended-on-message"
  | "communication-ended-before-start"
  | "communication-span-too-long"
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
  | "communication-not-routed"
  // The anchor is ONE thing. A row is on a matter, or set aside as something that belongs to no
  // matter, or waiting while nobody has decided — never two of those at once.
  | "communication-invalid-disposition"
  | "communication-anchor-conflict"
  | "communication-not-set-aside"
  // A carrier's row is what the network reported. A member editing it would turn an observation into
  // a recollection wearing an observation's badge, which is the one thing `producer` exists against.
  | "communication-not-editable"
  // What happened on the line. An outcome belongs to a call, and to the direction it went: nobody
  // leaves a voicemail on a call they took. A spam kind belongs to a spam call, and a call passed to
  // somebody else names who it went to.
  | "communication-caller-id-too-long"
  | "communication-invalid-outcome"
  | "communication-outcome-on-message"
  | "communication-outcome-direction"
  | "communication-invalid-spam-kind"
  | "communication-spam-kind-without-spam"
  | "communication-spam-on-matter"
  | "communication-transfer-without-member"
  | "communication-message-without-outcome";

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
    refuse("communication-empty-number", "the number at the other end is missing");
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
  // An outcome that says everything there is to say (a robocall, a call that rang out) is content
  // enough on its own; see SELF_DESCRIBING_OUTCOMES.
  readonly outcome?: CallOutcome | null;
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
  const describedByOutcome =
    input.outcome !== null &&
    input.outcome !== undefined &&
    SELF_DESCRIBING_OUTCOMES.has(input.outcome);
  if (body === null && summary === null && duration === null && !describedByOutcome) {
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

// The set-aside reason as it will be stored, or null for a row that has none.
//
// Checked here as well as at the route's own enum, because this vocabulary has no CHECK behind it in
// SQLite: the column was added to a populated table, and SQLite cannot add a CHECK to one without
// the destructive rebuild the expand-contract rule forbids. So this function is the constraint, and
// every write path goes through it.
export function normalizeDisposition(
  value: string | null | undefined,
): CommunicationDisposition | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!isCommunicationDisposition(trimmed)) {
    refuse("communication-invalid-disposition", "that is not a reason a call can be set aside");
  }
  return trimmed;
}

// A row has ONE anchor. "This is spam AND it is on the Whitfield matter" is not a fact anybody can
// act on, and a row carrying both would make every read decide which of the two to believe.
export function assertOneAnchor(
  matterId: string | null,
  disposition: CommunicationDisposition | null,
): void {
  if (matterId !== null && disposition !== null) {
    refuse(
      "communication-anchor-conflict",
      "a call is either on a matter or set aside, never both",
    );
  }
}

// WHEN THE LINE CLOSED, and it is deliberately not the same fact as how long the call ran (owner
// ruling, 2026-09-08: a typed length "doesn't need to match calculation, considering people can be
// put on hold"). A call that started at ten and ended at eleven with forty minutes of hold in the
// middle is a twenty-minute call over an hour-long span, and both numbers are true. So this is
// stored beside `duration_seconds` rather than derived from it, and nothing here checks that the two
// agree — a check that they agree would be the very rule the ruling removes.
//
// What IS checked is that the span is a span: a call cannot close before it opened, and one that ran
// longer than a day is a mistyped date rather than a call.
export function normalizeEndedAt(
  value: string | null | undefined,
  channel: CommunicationChannel,
  occurredAt: string,
): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  if (isTextChannel(channel)) {
    refuse("communication-ended-on-message", "a message has no end; it happened at one moment");
  }
  const ended = Date.parse(value);
  if (Number.isNaN(ended)) {
    refuse("communication-invalid-instant", "that is not a date and time");
  }
  const started = Date.parse(occurredAt);
  if (!Number.isNaN(started)) {
    if (ended < started) {
      refuse("communication-ended-before-start", "a call cannot end before it started");
    }
    if (ended - started > MAX_CALL_DURATION_SECONDS * 1000) {
      refuse("communication-span-too-long", "that call ran for longer than a day");
    }
  }
  return new Date(ended).toISOString();
}

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

// The name the caller gave, trimmed, or null where nobody typed one.
export function normalizeCallerIdName(value: string | null | undefined): string | null {
  return normalizeText(
    value,
    MAX_CALLER_ID_NAME_LENGTH,
    "communication-caller-id-too-long",
    "a caller's name",
  );
}

export interface CallOutcomeInput {
  readonly channel: CommunicationChannel;
  readonly direction: CommunicationDirection;
  readonly outcome?: string | null;
  readonly spamKind?: string | null;
  readonly matterId: string | null;
  readonly memberUserId?: string | null;
}

export interface CallOutcomeFacts {
  readonly outcome: CallOutcome | null;
  readonly spamKind: SpamKind | null;
}

// What happened on the line, checked against the call it is said of. No CHECK stands behind these
// columns (they were added to a populated table), so this is the constraint.
//
// SPAM IS ALSO AN ANCHOR. A spam call belongs to no matter, which is exactly what the `spam`
// disposition already says; so a spam outcome refuses a matter, and the service sets the
// disposition from it rather than asking the person to say the same thing twice. A text can be
// spam too, and that is the one outcome a message may carry.
export function normalizeCallOutcome(input: CallOutcomeInput): CallOutcomeFacts {
  const raw = input.outcome?.trim() ?? "";
  const kindRaw = input.spamKind?.trim() ?? "";
  if (raw === "") {
    if (kindRaw !== "") {
      refuse("communication-spam-kind-without-spam", "only a spam call has a kind of spam");
    }
    return { outcome: null, spamKind: null };
  }
  if (!isCallOutcome(raw)) {
    refuse("communication-invalid-outcome", "that is not something that can happen on a call");
  }
  if (isTextChannel(input.channel) && raw !== "spam") {
    refuse("communication-outcome-on-message", "a message was sent, not answered or transferred");
  }
  const allowed: readonly string[] =
    input.direction === "inbound" ? INBOUND_CALL_OUTCOMES : OUTBOUND_CALL_OUTCOMES;
  if (!isTextChannel(input.channel) && !allowed.includes(raw)) {
    refuse(
      "communication-outcome-direction",
      input.direction === "inbound"
        ? "that is what happens on a call the firm places, not one it takes"
        : "that is what happens on a call the firm takes, not one it places",
    );
  }
  if (raw === "spam" && input.matterId !== null) {
    refuse("communication-spam-on-matter", "a spam call belongs to no matter");
  }
  if (raw === "transferred" && (input.memberUserId ?? null) === null) {
    refuse("communication-transfer-without-member", "a transferred call names who it went to");
  }
  let spamKind: SpamKind | null = null;
  if (kindRaw !== "") {
    if (raw !== "spam") {
      refuse("communication-spam-kind-without-spam", "only a spam call has a kind of spam");
    }
    if (!isSpamKind(kindRaw)) {
      refuse("communication-invalid-spam-kind", "that is not a kind of spam call");
    }
    spamKind = kindRaw;
  }
  return { outcome: raw, spamKind };
}
