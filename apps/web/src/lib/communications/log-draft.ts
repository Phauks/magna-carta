/*
 * The log form's draft, and the rules about what it is missing.
 *
 * Pure, and separate from the window that renders it, so what makes a record complete has one home
 * and one test rather than being spread through a form's disabled states. The same draft serves
 * recording a new call and correcting one already recorded — a correction that asked different
 * questions from the entry would be a second place to learn what a call record IS.
 *
 * A CALL AND A TEXT ASK THE SAME QUESTIONS (owner ruling, 2026-09-08). One type control, one
 * direction, one number, one date, one start, one description. The only fields a call has that a
 * text does not are its end and the length worked out from it, because a text has no length in
 * seconds and the database refuses one outright.
 *
 * THE LENGTH IS DERIVED FROM TWO CLOCK TIMES, AND STORED AS A LENGTH (owner ruling, 2026-09-08). The
 * form asks when the call started and when it ended; the record holds seconds. `draftEndTime` and
 * `durationFromEnd` are the bridge, and the draft keeps the LENGTH rather than the two times so a
 * record read back and saved untouched writes exactly the seconds it held.
 *
 * WHAT IS REQUIRED IS STILL DIFFERENT PER TYPE, and that is not cosmetic. A text needs the words: a
 * text with no words is not a text. A call needs neither its words nor its length in principle — a
 * missed call is a real record and the honest content of it is that the phone rang — but a MEMBER
 * sat down and typed this one, so an entirely empty one means they abandoned the form rather than
 * finished it, and it is refused with the reason.
 *
 * THE ANCHOR IS ONE THING. A matter, or a reason it belongs to none, or neither while nobody has
 * decided. Never both, which is what the server says too.
 */
import { checkPhoneEntry, DEFAULT_PHONE_REGION } from "$lib/directory/phone-entry.ts";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import type {
  Communication,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationDisposition,
} from "./communications-api.ts";
import {
  clockTimeAfter,
  instantFromLocalParts,
  localDateValue,
  localTimeValue,
  minutesBetweenClockTimes,
  MOST_RECENT_FIRST_TOLERANCE_MINUTES,
} from "./occurred-at.ts";

/**
 * What a person chooses between. Two, not three: a picture message is a text that happens to carry
 * a picture, so it is a property of the record rather than a kind to decide between.
 */
export type LogKind = "call" | "text";

/** Where the row belongs. Exactly one of these is true of any record. */
export type AnchorChoice = "matter" | "setAside" | "undecided";

export interface LogDraft {
  kind: LogKind;
  /**
   * The channel the record already carries, where it is being corrected rather than made.
   *
   * It exists so a picture message stays one. The form offers Call and Text; a text that arrived as
   * an `mms` and is edited without changing its type must not silently become a plain `sms`, which
   * would drop the fact that it carried a picture.
   */
  originalChannel: CommunicationChannel | null;
  direction: CommunicationDirection;
  /** Which anchor is being given, so an empty matter picker and a deliberate "no matter" differ. */
  anchor: AnchorChoice;
  /**
   * The matter, or null for a row that goes into the queue.
   *
   * An UNNUMBERED matter is a perfectly good anchor: an intake and a consultation are where a first
   * contact usually lands, and a form that only accepted numbered matters would refuse the most
   * common case it exists to serve.
   */
  matterId: string | null;
  /** Why it is on no matter, where that is the answer. */
  disposition: CommunicationDisposition | null;
  /** The country the number belongs to, which is what makes its grouping and its +code right. */
  region: string;
  /** The number as typed, grouped in that country's national form. */
  counterpartyNumber: string;
  /** The Directory entity behind that number, where the person picked one. */
  counterpartyEntityId: string | null;
  /** The name of that entity, for the field to show at rest. Never sent; the server holds handles. */
  counterpartyName: string | null;
  /** The calendar date it happened, in the reader's own zone. */
  occurredDate: string;
  /** The clock time it happened, in the reader's own zone. */
  occurredTime: string;
  /**
   * How long a call ran, in whole minutes. Converted to seconds on the way out.
   *
   * IT IS THE STORED FACT, AND THE END TIME IS DERIVED FROM IT (owner ruling, 2026-09-08: a duration
   * "should auto-calculate off start and stop"). The form asks for a start and an end, because that
   * is what somebody who has just put the phone down actually knows, and the duration follows —
   * `draftEndTime` renders the end, `durationFromEnd` reads one back. The record stores the length
   * rather than the two times, so keeping the length as the draft's own field is what makes a
   * correction round-trip exactly: a record read back, rendered and saved untouched writes the same
   * seconds it held, with nothing recomputed through a clock on the way.
   */
  durationMinutes: string;
  /** What was said — the member's account of a call, or the words of a text. One field for both. */
  description: string;
  /**
   * A note a member wrote beside a TEXT before the two fields became one, kept and written back
   * untouched.
   *
   * The form that preceded this one asked a text for its words and, separately, for the member's own
   * note about the exchange. Those are now one Description, which is the message itself — so a note
   * recorded under the old form has no field to be edited in, and correcting the message must not
   * silently delete it. Null on everything made since.
   */
  preservedTextNote: string | null;
}

export function emptyLogDraft(now: string): LogDraft {
  return {
    kind: "call",
    originalChannel: null,
    direction: "outbound",
    anchor: "undecided",
    matterId: null,
    disposition: null,
    region: DEFAULT_PHONE_REGION,
    counterpartyNumber: "",
    counterpartyEntityId: null,
    counterpartyName: null,
    occurredDate: localDateValue(now),
    occurredTime: localTimeValue(now),
    durationMinutes: "",
    description: "",
    preservedTextNote: null,
  };
}

/** Whether this draft carries text rather than audio. */
export function isTextDraft(draft: LogDraft): boolean {
  return draft.kind === "text";
}

/** The instant the two date fields name, or the empty string while either half is missing. */
export function draftOccurredAt(draft: LogDraft): string {
  return instantFromLocalParts(draft.occurredDate, draft.occurredTime);
}

/**
 * The clock time the call ended at: its start plus its length.
 *
 * Empty where either half is missing, which is the ordinary state of a form somebody is still
 * filling in — a call whose length nobody recorded has no end to show, and a made-up one would read
 * as a fact.
 */
export function draftEndTime(draft: LogDraft): string {
  const minutes = Number(draft.durationMinutes.trim());
  if (draft.durationMinutes.trim() === "" || !Number.isFinite(minutes)) return "";
  return clockTimeAfter(draft.occurredTime, minutes);
}

/**
 * The length a typed end time means, as the draft's own field holds it: whole minutes, or the empty
 * string where the two clock times do not make one.
 */
export function durationFromEnd(draft: LogDraft, end: string): string {
  const minutes = minutesBetweenClockTimes(draft.occurredTime, end);
  return minutes === null ? "" : String(minutes);
}

/**
 * Everything still missing, in the order a person meets it. The form shows the FIRST one beside the
 * control it refuses, rather than hiding the control: being told which answer is missing beats
 * hunting for it.
 *
 * The sentences are short on purpose. This one sits in the action bar for as long as the answer is
 * missing, which on a form somebody has only just opened is the whole time they are filling it in —
 * so it names the field rather than explaining the subsystem.
 */
export function logDraftShortfalls(draft: LogDraft, now: string): readonly string[] {
  const shortfalls: string[] = [];

  if (draft.counterpartyNumber.trim() === "") {
    shortfalls.push("The number.");
  } else {
    const checked = checkPhoneEntry(draft.region as CountryCode, draft.counterpartyNumber);
    if (!checked.ok) shortfalls.push(checked.reason);
  }

  if (draft.occurredDate.trim() === "") {
    shortfalls.push("The date.");
  } else if (draft.occurredTime.trim() === "") {
    shortfalls.push("The time.");
  } else {
    const occurred = Date.parse(draftOccurredAt(draft));
    if (Number.isNaN(occurred)) {
      shortfalls.push("That is not a date and time.");
    } else if (occurred > Date.parse(now) + MOST_RECENT_FIRST_TOLERANCE_MINUTES * 60_000) {
      // Refused here as well as at the server, because a slip in the year or the month is a typo
      // every time, and a row dated forward sits above everything real until the date arrives.
      shortfalls.push("That has not happened yet.");
    }
  }

  if (isTextDraft(draft)) {
    if (draft.description.trim() === "") shortfalls.push("What the text said.");
  } else if (draft.description.trim() === "" && draft.durationMinutes.trim() === "") {
    shortfalls.push("What was said, or when the call ended.");
  }

  if (!isTextDraft(draft) && draft.durationMinutes.trim() !== "") {
    const minutes = Number(draft.durationMinutes);
    if (!Number.isFinite(minutes) || minutes < 0 || !Number.isInteger(minutes)) {
      shortfalls.push("A length is a whole number of minutes.");
    }
  }

  if (draft.anchor === "matter" && draft.matterId === null) {
    shortfalls.push("Which matter.");
  }
  if (draft.anchor === "setAside" && draft.disposition === null) {
    shortfalls.push("Why it is on no matter.");
  }

  return shortfalls;
}

export function logDraftReady(draft: LogDraft, now: string): boolean {
  return logDraftShortfalls(draft, now).length === 0;
}

/**
 * The channel the draft writes.
 *
 * A call is `voice`. A text is whatever it already was where that was a picture message, and `sms`
 * otherwise — so correcting the description of a picture message does not quietly drop the picture.
 */
export function draftChannel(draft: LogDraft): CommunicationChannel {
  if (draft.kind === "call") return "voice";
  return draft.originalChannel === "mms" ? "mms" : "sms";
}

/**
 * The number as the record stores it: the international form (`+17025550143`) where the country and
 * the digits make one, and exactly what was typed where they do not.
 *
 * STORING E.164 IS NOW HONEST, AND IT WAS NOT BEFORE. The server deliberately does not canonicalize
 * on its own, because that needs a country this subsystem has no way to know. The form does know —
 * a person picks it beside the digits — so the composition happens here, where the fact exists.
 */
export function draftStoredNumber(draft: LogDraft): string {
  const checked = checkPhoneEntry(draft.region as CountryCode, draft.counterpartyNumber);
  return checked.ok ? checked.number : draft.counterpartyNumber.trim();
}

/**
 * The draft as the write wants it.
 *
 * The type decides which fields go, and the ones that do not belong are sent as null rather than
 * omitted: the server refuses a body on a call and a duration on a text, so leaving a stale value in
 * the draft where somebody switched the type mid-form would turn a correction into a rejection.
 */
export function logDraftRequest(draft: LogDraft): {
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  matterId: string | null;
  disposition: CommunicationDisposition | null;
  counterpartyNumber: string;
  counterpartyEntityId: string | null;
  occurredAt: string;
  durationSeconds: number | null;
  body: string | null;
  summary: string | null;
} {
  const text = isTextDraft(draft);
  const minutes = draft.durationMinutes.trim();
  const description = draft.description.trim();
  return {
    channel: draftChannel(draft),
    direction: draft.direction,
    matterId: draft.anchor === "matter" ? draft.matterId : null,
    disposition: draft.anchor === "setAside" ? draft.disposition : null,
    counterpartyNumber: draftStoredNumber(draft),
    counterpartyEntityId: draft.counterpartyEntityId,
    occurredAt: draftOccurredAt(draft),
    durationSeconds: text || minutes === "" ? null : Number(minutes) * 60,
    // ONE FIELD, TWO COLUMNS, and the split is the record's rather than the reader's: `body` is what
    // was actually sent and `summary` is what a member remembered, so a read never has to ask which
    // it is holding. What a person types is called the description on either type.
    body: text && description !== "" ? description : null,
    summary: text ? draft.preservedTextNote : description === "" ? null : description,
  };
}

/**
 * A record already on the log, as a draft to correct.
 *
 * The number is split back into its country and its national digits, so the field a person edits
 * shows what their own phone would show rather than the `+1…` string the record stores. A number the
 * parser cannot split keeps the reader's default country and renders exactly as it is held — a
 * number nobody can parse is still the number somebody was given, and rewriting it would be worse
 * than leaving it alone.
 */
export function draftFromCommunication(
  communication: Communication,
  counterpartyName: string | null,
): LogDraft {
  const parsed = parsePhoneNumberFromString(communication.counterpartyNumber);
  const text = communication.channel !== "voice";
  return {
    kind: text ? "text" : "call",
    originalChannel: communication.channel,
    direction: communication.direction,
    anchor:
      communication.matterId !== null
        ? "matter"
        : communication.disposition !== null
          ? "setAside"
          : "undecided",
    matterId: communication.matterId,
    disposition: communication.disposition,
    region: parsed?.country ?? DEFAULT_PHONE_REGION,
    counterpartyNumber:
      parsed === undefined ? communication.counterpartyNumber : parsed.formatNational(),
    counterpartyEntityId: communication.counterpartyEntityId,
    counterpartyName,
    occurredDate: localDateValue(communication.occurredAt),
    occurredTime: localTimeValue(communication.occurredAt),
    durationMinutes:
      communication.durationSeconds === null
        ? ""
        : String(Math.round(communication.durationSeconds / 60)),
    description: (text ? communication.body : communication.summary) ?? "",
    // A note recorded beside a text under the two-field form, where the text itself is in `body`.
    // Nothing to keep when the summary IS what the field is showing.
    preservedTextNote: text && communication.body !== null ? communication.summary : null,
  };
}

/** The correction as the PATCH wants it: the record's own fields, without the anchor. */
export function updateDraftRequest(draft: LogDraft): {
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  counterpartyNumber: string;
  counterpartyEntityId: string | null;
  occurredAt: string;
  durationSeconds: number | null;
  body: string | null;
  summary: string | null;
} {
  const { matterId: _matterId, disposition: _disposition, ...fields } = logDraftRequest(draft);
  return fields;
}
