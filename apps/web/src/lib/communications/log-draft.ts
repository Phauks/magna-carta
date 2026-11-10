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
 * text does not are its end and its length, because a text happens at one moment and has no length
 * in seconds — the database refuses both outright.
 *
 * THE LENGTH IS TYPED, AND IT IS NOT THE SPAN (owner ruling, 2026-09-08: "you should be able to type
 * in the length of time for the call, and this doesn't need to match calculation, considering people
 * can be put on hold"). The form asks three things and stores three things — when the call started,
 * when the line closed, and how long the call actually took — because a caller left on hold occupies
 * an hour of the line and spends twenty minutes of anybody's attention, and both of those are facts
 * a firm records. The end still FILLS the length, once, while the length is empty, because that is
 * the ordinary case and typing the same answer twice is what the earlier derivation was avoiding;
 * what it never does is overwrite a length somebody typed. That is the whole of the ruling.
 *
 * SO THE LENGTH IS FREE TEXT UNTIL IT IS READ. Somebody who has just put the phone down says "twenty
 * minutes", "1h 5m" or "1:20", not "the integer 65" — `parseDurationMinutes` is the one place those
 * are understood, and the draft keeps what was typed so a half-typed "1h" is not rewritten under the
 * cursor.
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
import {
  checkPhoneEntry,
  formatPhoneAsTyped,
  DEFAULT_PHONE_REGION,
} from "$lib/directory/phone-entry.ts";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import type {
  CallOutcome,
  Communication,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationDisposition,
  LogCommunicationInput,
  SpamKind,
} from "./communications-api.ts";
import {
  endInstantFromLocalParts,
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
  /**
   * The direct dial behind it, digits only.
   *
   * Its own draft field and its own control, but NOT its own column: the record stores one number,
   * and the extension rides in it as `+13125550148x4102` (phone-entry.ts says why). Split back out
   * when a record is read for correction, so the two halves are edited where they were typed.
   */
  counterpartyExtension: string;
  /** The Directory entity behind that number, where the person picked one. */
  counterpartyEntityId: string | null;
  /** The name of that entity, for the field to show at rest. Never sent; the server holds handles. */
  counterpartyName: string | null;
  /** The calendar date it happened, in the reader's own zone. */
  occurredDate: string;
  /** The clock time it started, in the reader's own zone. */
  occurredTime: string;
  /**
   * The clock time the line closed, in the reader's own zone. Empty where nobody recorded one.
   *
   * ITS OWN STORED FACT rather than a rendering of the length: the two are allowed to disagree, and
   * a rendered end would make the disagreement invisible the moment the record was read back.
   */
  endTime: string;
  /**
   * How long the call actually took, exactly as it was typed — "20", "1h 5m", "1:20".
   *
   * Kept as text rather than as minutes so a half-typed answer is not rewritten under the cursor,
   * and read through `parseDurationMinutes` at every point that needs a number.
   */
  durationText: string;
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
  /** The name the caller gave, as typed. Optional, and never a Directory record. */
  callerIdName: string;
  /** What happened on the line, or null while nobody has said. Only asked while a record is MADE. */
  outcome: CallOutcome | null;
  /** On a spam call, which kind. */
  spamKind: SpamKind | null;
  /** The member a transferred call went to. They become the member on the call. */
  transferToUserId: string | null;
  /** The member a message is for. */
  messageForUserId: string | null;
  /** What the caller asked for, which becomes the line on that member's task. */
  messageRequest: MessageRequest;
  /** By when, as a civil date in the reader's zone; empty for no date. */
  messageByDate: string;
  messageUrgent: boolean;
}

/** What a caller who left a message asked for. Each one words the task it becomes. */
export const MESSAGE_REQUESTS = ["callBack", "willCallAgain", "noReplyNeeded"] as const;
export type MessageRequest = (typeof MESSAGE_REQUESTS)[number];

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
    counterpartyExtension: "",
    counterpartyEntityId: null,
    counterpartyName: null,
    occurredDate: localDateValue(now),
    occurredTime: localTimeValue(now),
    endTime: "",
    durationText: "",
    description: "",
    preservedTextNote: null,
    ...emptyActivity(),
  };
}

/** The Activity fields, all unanswered. */
function emptyActivity(): Pick<
  LogDraft,
  | "callerIdName"
  | "outcome"
  | "spamKind"
  | "transferToUserId"
  | "messageForUserId"
  | "messageRequest"
  | "messageByDate"
  | "messageUrgent"
> {
  return {
    callerIdName: "",
    outcome: null,
    spamKind: null,
    transferToUserId: null,
    messageForUserId: null,
    messageRequest: "callBack",
    messageByDate: "",
    messageUrgent: false,
  };
}

/** The outcomes that need no notes and no length: saying so is the whole record. */
const SELF_DESCRIBING: ReadonlySet<CallOutcome> = new Set(["spam", "noAnswer", "voicemailLeft"]);

/** Who the caller is, as the record can best say it: the Directory name, the given name, the number. */
export function draftCallerLabel(draft: LogDraft): string {
  const typed = draft.callerIdName.trim();
  return draft.counterpartyName ?? (typed === "" ? draft.counterpartyNumber.trim() : typed);
}

/** The line a message becomes on the member's task list. */
export function messageTaskTitle(draft: LogDraft): string {
  const who = draftCallerLabel(draft);
  switch (draft.messageRequest) {
    case "callBack":
      return `Call back ${who}`;
    case "willCallAgain":
      return `${who} will call again`;
    case "noReplyNeeded":
      return `Message from ${who}`;
  }
}

/**
 * The Activity half of a NEW record: the caller's name, what happened, and the transfer or message
 * that came of it. Kept apart from logDraftRequest because a correction does not send it.
 */
export function activityRequest(
  draft: LogDraft,
  timeZone: string,
): Pick<
  LogCommunicationInput,
  "callerIdName" | "outcome" | "spamKind" | "memberUserId" | "message" | "disposition" | "matterId"
> {
  const callerIdName = draft.callerIdName.trim();
  const outcome = isTextDraft(draft) && draft.outcome !== "spam" ? null : draft.outcome;
  const fields: ReturnType<typeof activityRequest> = {
    callerIdName: callerIdName === "" ? null : callerIdName,
    outcome,
    spamKind: outcome === "spam" ? draft.spamKind : null,
  };
  if (outcome === "spam") {
    // A spam call IS set aside as spam, whatever the anchor fields were left saying.
    return { ...fields, matterId: null, disposition: "spam" };
  }
  if (outcome === "transferred") return { ...fields, memberUserId: draft.transferToUserId };
  if (outcome === "messageTaken" && draft.messageForUserId !== null) {
    const dueOn = draft.messageByDate.trim();
    return {
      ...fields,
      message: {
        forUserId: draft.messageForUserId,
        title: messageTaskTitle(draft),
        dueOn: dueOn === "" ? null : dueOn,
        timeZone: dueOn === "" ? null : timeZone,
        urgent: draft.messageUrgent,
      },
    };
  }
  return fields;
}

/** Whether this draft carries text rather than audio. */
export function isTextDraft(draft: LogDraft): boolean {
  return draft.kind === "text";
}

/** The instant the two date fields name, or the empty string while either half is missing. */
export function draftOccurredAt(draft: LogDraft): string {
  return instantFromLocalParts(draft.occurredDate, draft.occurredTime);
}

/** The instant the line closed, or the empty string while the end has not been given. */
export function draftEndedAt(draft: LogDraft): string {
  if (draft.endTime.trim() === "") return "";
  return endInstantFromLocalParts(draft.occurredDate, draft.occurredTime, draft.endTime);
}

/**
 * A typed length as whole minutes, or null where it is not a length.
 *
 * FOUR SPELLINGS, BECAUSE PEOPLE USE FOUR. A bare number is minutes, which is what somebody typing
 * fast writes; `1h`, `1h 5m` and `45m` are what somebody writes when they are being careful; `1:20`
 * is what a phone's own call log shows them. Anything else is not a length and says so rather than
 * being rounded into one — "about twenty" is a note, and it belongs in the description.
 */
export function parseDurationMinutes(typed: string): number | null {
  const text = typed.trim().toLowerCase();
  if (text === "") return null;
  const clock = /^(\d{1,3}):([0-5]\d)$/u.exec(text);
  if (clock !== null) return Number(clock[1]) * 60 + Number(clock[2]);
  const bare = /^\d{1,5}$/u.exec(text);
  if (bare !== null) return Number(text);
  const spelled = /^(?:(\d{1,3})\s*h)?\s*(?:(\d{1,3})\s*m)?$/u.exec(text);
  if (spelled === null || (spelled[1] === undefined && spelled[2] === undefined)) return null;
  return Number(spelled[1] ?? 0) * 60 + Number(spelled[2] ?? 0);
}

/**
 * How long the line was open, in minutes, from the two clock times — or null where either is
 * missing.
 *
 * OFFERED RATHER THAN IMPOSED. The form fills an empty length with it and never replaces a typed
 * one, and the window states it beside the length so a reader can see the difference between the
 * span and the call rather than having to work it out.
 */
export function draftSpanMinutes(draft: LogDraft): number | null {
  if (draft.endTime.trim() === "") return null;
  return minutesBetweenClockTimes(draft.occurredTime, draft.endTime);
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
    const checked = checkPhoneEntry(
      draft.region as CountryCode,
      draft.counterpartyNumber,
      draft.counterpartyExtension,
    );
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

  const describedByOutcome = draft.outcome !== null && SELF_DESCRIBING.has(draft.outcome);
  if (isTextDraft(draft)) {
    if (draft.description.trim() === "") shortfalls.push("What the text said.");
  } else if (
    draft.description.trim() === "" &&
    draft.durationText.trim() === "" &&
    !describedByOutcome
  ) {
    shortfalls.push("What was said, or how long the call ran.");
  }

  if (!isTextDraft(draft) && draft.durationText.trim() !== "") {
    if (parseDurationMinutes(draft.durationText) === null) {
      shortfalls.push("A length reads as 20, 1h 5m or 1:20.");
    }
  }

  if (!isTextDraft(draft) && draft.endTime.trim() !== "" && draftEndedAt(draft) === "") {
    shortfalls.push("When the call ended.");
  }

  if (!isTextDraft(draft) && draft.outcome === "transferred" && draft.transferToUserId === null) {
    shortfalls.push("Who the call went to.");
  }
  if (!isTextDraft(draft) && draft.outcome === "messageTaken" && draft.messageForUserId === null) {
    shortfalls.push("Who the message is for.");
  }

  // A spam call files itself as spam, so the anchor fields are not asked about.
  if (draft.outcome === "spam") return shortfalls;

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
  const checked = checkPhoneEntry(
    draft.region as CountryCode,
    draft.counterpartyNumber,
    draft.counterpartyExtension,
  );
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
  endedAt: string | null;
  durationSeconds: number | null;
  body: string | null;
  summary: string | null;
} {
  const text = isTextDraft(draft);
  const minutes = parseDurationMinutes(draft.durationText);
  const endedAt = draftEndedAt(draft);
  const description = draft.description.trim();
  return {
    channel: draftChannel(draft),
    direction: draft.direction,
    matterId: draft.anchor === "matter" ? draft.matterId : null,
    disposition: draft.anchor === "setAside" ? draft.disposition : null,
    counterpartyNumber: draftStoredNumber(draft),
    counterpartyEntityId: draft.counterpartyEntityId,
    occurredAt: draftOccurredAt(draft),
    endedAt: text || endedAt === "" ? null : endedAt,
    durationSeconds: text || minutes === null ? null : minutes * 60,
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
      parsed === undefined
        ? communication.counterpartyNumber
        : // The national form WITHOUT the extension: the extension has its own field beside it, and
          // formatNational appends "ext. 4102" to the digits, which would then be typed into the
          // number half and stored twice.
          formatPhoneAsTyped(parsed.country ?? DEFAULT_PHONE_REGION, parsed.nationalNumber),
    counterpartyExtension: parsed?.ext ?? "",
    counterpartyEntityId: communication.counterpartyEntityId,
    counterpartyName,
    occurredDate: localDateValue(communication.occurredAt),
    occurredTime: localTimeValue(communication.occurredAt),
    endTime: communication.endedAt === null ? "" : localTimeValue(communication.endedAt),
    durationText:
      communication.durationSeconds === null
        ? ""
        : String(Math.round(communication.durationSeconds / 60)),
    description: (text ? communication.body : communication.summary) ?? "",
    // A note recorded beside a text under the two-field form, where the text itself is in `body`.
    // Nothing to keep when the summary IS what the field is showing.
    preservedTextNote: text && communication.body !== null ? communication.summary : null,
    ...emptyActivity(),
    callerIdName: communication.callerIdName ?? "",
    outcome: communication.outcome,
    spamKind: communication.spamKind,
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
