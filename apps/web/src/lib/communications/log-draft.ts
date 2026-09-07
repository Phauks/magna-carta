/*
 * The log form's draft, and the rules about what it is missing.
 *
 * Pure, and separate from the dialog that renders it, so what makes a record loggable has one home
 * and one test rather than being spread through a form's disabled states.
 *
 * WHAT IS REQUIRED IS DIFFERENT PER CHANNEL, and that is the whole reason this file exists. A text
 * needs the words: a text with no words is not a text. A call needs neither its words nor its
 * length in principle — a missed call is a real record and the honest content of it is that the
 * phone rang — but a MEMBER sat down and typed this one, so an entirely empty one means they
 * abandoned the form rather than finished it, and it is refused with the reason.
 */
import type { CommunicationChannel, CommunicationDirection } from "./communications-api.ts";
import { MOST_RECENT_FIRST_TOLERANCE_MINUTES } from "./occurred-at.ts";

export interface LogDraft {
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  /**
   * The anchor, or null for a row that goes into the queue.
   *
   * An UNNUMBERED matter is a perfectly good anchor: an intake and a consultation are where a first
   * contact usually lands, and a form that only accepted numbered matters would refuse the most
   * common case it exists to serve.
   */
  matterId: string | null;
  counterpartyNumber: string;
  /** The Directory entity behind that number, where the person picked one. */
  counterpartyEntityId: string | null;
  /** ISO-8601. Defaulted to now when the form opens, which is right for a call just finished. */
  occurredAt: string;
  /** Whole minutes as typed, for a call. Converted to seconds on the way out. */
  durationMinutes: string;
  /** The message, for a text. */
  body: string;
  /** What was said, for a call. */
  summary: string;
}

export function emptyLogDraft(now: string): LogDraft {
  return {
    channel: "voice",
    direction: "outbound",
    matterId: null,
    counterpartyNumber: "",
    counterpartyEntityId: null,
    occurredAt: now,
    durationMinutes: "",
    body: "",
    summary: "",
  };
}

/** Whether this channel carries text rather than audio. */
export function isTextDraft(draft: LogDraft): boolean {
  return draft.channel === "sms" || draft.channel === "mms";
}

/**
 * Everything still missing, in the order a person meets it. The form shows the FIRST one beside the
 * control it refuses, rather than hiding the control: being told which answer is missing beats
 * hunting for it.
 */
export function logDraftShortfalls(draft: LogDraft, now: string): readonly string[] {
  const shortfalls: string[] = [];

  if (draft.counterpartyNumber.trim() === "") {
    shortfalls.push("A call or a text needs the number at the other end.");
  }

  if (draft.occurredAt.trim() === "") {
    shortfalls.push("Say when it happened.");
  } else {
    const occurred = Date.parse(draft.occurredAt);
    if (Number.isNaN(occurred)) {
      shortfalls.push("That is not a date and time.");
    } else if (occurred > Date.parse(now) + MOST_RECENT_FIRST_TOLERANCE_MINUTES * 60_000) {
      // Refused here as well as at the server, because a slip in the year or the month is a typo
      // every time, and a row dated forward sits above everything real until the date arrives.
      shortfalls.push("A call or a text cannot have happened yet.");
    }
  }

  if (isTextDraft(draft)) {
    if (draft.body.trim() === "") shortfalls.push("A text needs its words.");
  } else if (draft.summary.trim() === "" && draft.durationMinutes.trim() === "") {
    shortfalls.push("Write what was said, or at least how long the call took.");
  }

  if (!isTextDraft(draft) && draft.durationMinutes.trim() !== "") {
    const minutes = Number(draft.durationMinutes);
    if (!Number.isFinite(minutes) || minutes < 0 || !Number.isInteger(minutes)) {
      shortfalls.push("A call's length is a whole number of minutes.");
    }
  }

  return shortfalls;
}

export function logDraftReady(draft: LogDraft, now: string): boolean {
  return logDraftShortfalls(draft, now).length === 0;
}

/**
 * The draft as the write wants it.
 *
 * The channel decides which fields go, and the ones that do not belong are sent as null rather than
 * omitted: the server refuses a body on a call and a duration on a text, so leaving a stale value in
 * the draft where somebody switched the channel mid-form would turn a correction into a rejection.
 */
export function logDraftRequest(draft: LogDraft): {
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  matterId: string | null;
  counterpartyNumber: string;
  counterpartyEntityId: string | null;
  occurredAt: string;
  durationSeconds: number | null;
  body: string | null;
  summary: string | null;
} {
  const text = isTextDraft(draft);
  const minutes = draft.durationMinutes.trim();
  return {
    channel: draft.channel,
    direction: draft.direction,
    matterId: draft.matterId,
    counterpartyNumber: draft.counterpartyNumber.trim(),
    counterpartyEntityId: draft.counterpartyEntityId,
    occurredAt: new Date(draft.occurredAt).toISOString(),
    durationSeconds: text || minutes === "" ? null : Number(minutes) * 60,
    body: text && draft.body.trim() !== "" ? draft.body.trim() : null,
    // A summary is kept on a text too where somebody wrote one — it is the member's own note about
    // the exchange, and the server accepts it on either channel. Only the BODY is channel-bound.
    summary: draft.summary.trim() === "" ? null : draft.summary.trim(),
  };
}
