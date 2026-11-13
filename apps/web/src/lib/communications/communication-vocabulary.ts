/*
 * The words the call and text log renders — one home for them, so the table, the record window and
 * the log form cannot end up calling the same thing three things.
 *
 * TWO KINDS, NOT THREE (owner ruling, 2026-09-08). A firm records a call or a text. A picture
 * message is a text that happens to carry a picture, not a third thing to choose between, so `mms`
 * reads as "Text" everywhere and says what it carries beside the row rather than in place of it.
 * The channel stays in the record because a carrier will hand us one and the log has to hold it.
 */
import { formatStoredPhone } from "$lib/directory/phone-entry.ts";
import type {
  CallOutcome,
  Communication,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationDisposition,
  SpamKind,
} from "./communications-api.ts";

export interface VocabularyEntry {
  readonly label: string;
  /** What the word means, said to somebody who is not sure. Rendered on a hover, never as prose. */
  readonly meaning: string;
}

const CHANNELS: Readonly<Record<CommunicationChannel, VocabularyEntry>> = Object.freeze({
  voice: { label: "Call", meaning: "A phone call, in either direction." },
  sms: { label: "Text", meaning: "A text message." },
  // A picture message is a text. Named for what a person sees rather than for the carrier's
  // acronym — nobody in a law firm says MMS — and not offered as a separate kind to record.
  mms: { label: "Text", meaning: "A text message carrying a picture or a file." },
});

export function channelEntry(channel: CommunicationChannel): VocabularyEntry {
  return CHANNELS[channel];
}

/**
 * What a text carries beyond its words, or null where there is nothing extra to say.
 *
 * The picture has not been dropped from the record — it is stated as a property of the text rather
 * than as a kind of its own, which is what the ruling asks for.
 */
export function attachmentNote(channel: CommunicationChannel): string | null {
  return channel === "mms" ? "With a picture or a file" : null;
}

const DIRECTIONS: Readonly<Record<CommunicationDirection, VocabularyEntry>> = Object.freeze({
  inbound: { label: "Incoming", meaning: "The other person contacted the firm." },
  outbound: { label: "Outgoing", meaning: "The firm contacted them." },
});

export function directionEntry(direction: CommunicationDirection): VocabularyEntry {
  return DIRECTIONS[direction];
}

/**
 * Why a call or a text belongs to no matter.
 *
 * The three are what a firm's phone actually receives that is not a case: a wrong number or a
 * salesman, the firm's own business, and a prospect who never came back. Each is a real outcome
 * somebody decided, which is why they are recorded rather than left in a queue nobody can empty.
 */
const DISPOSITIONS: Readonly<Record<CommunicationDisposition, VocabularyEntry>> = Object.freeze({
  spam: { label: "Spam or wrong number", meaning: "Nobody the firm has business with." },
  firmBusiness: {
    label: "Firm business",
    meaning:
      "The firm's own business, such as a vendor, the landlord or the bar. Not a client matter.",
  },
  noAction: {
    label: "Nothing came of it",
    meaning: "A real enquiry that never became a matter.",
  },
});

export function dispositionEntry(disposition: CommunicationDisposition): VocabularyEntry {
  return DISPOSITIONS[disposition];
}

/** Every set-aside reason, in the order a person meets them, for a picker or a menu. */
export const DISPOSITION_CHOICES: readonly {
  readonly value: CommunicationDisposition;
  readonly label: string;
  readonly meaning: string;
}[] = (["spam", "firmBusiness", "noAction"] as const).map((value) => ({
  value,
  label: DISPOSITIONS[value].label,
  meaning: DISPOSITIONS[value].meaning,
}));

/** What the Matter column says for a row with none. It is a value, so the set filter can hold it. */
export const NOT_FILED_TEXT = "Not filed";

/**
 * What the Number column says for a row that carries none.
 *
 * Only rows recorded before the sequence existed reach this, and the migration that added the column
 * numbered every one of them — so in practice it is what a row written by something that has not
 * been taught to draw a number would say. Stated rather than left blank, because a blank in a column
 * of numbers reads as a column that failed to fill rather than as a record that has no number.
 */
export const NOT_NUMBERED_TEXT = "No number";

/**
 * How the anchor reads on a row.
 *
 * A ROW HAS ONE ANCHOR: a matter, a reason it is on none, or nothing while nobody has decided. This
 * falls through all three.
 *
 * THE NUMBER SHOWN IS THE NEWEST ONE THE MATTER HAS DRAWN. A matter number is drawn when a matter
 * opens; before that a consultation carries its own tentative number, and before that an intake
 * carries the one it was written down under. So the matter branch falls through: matter number, then
 * consultation number, then intake number — the title alone is reached only by a matter recorded
 * before the rung it is on was numbered. A row with no anchor at all says it is not filed rather
 * than rendering blank, because a blank there reads as a record the platform failed to fill.
 */
export function anchorText(communication: Communication): string {
  if (communication.matterId === null) {
    return communication.disposition === null
      ? NOT_FILED_TEXT
      : dispositionEntry(communication.disposition).label;
  }
  const number =
    communication.matterNumber ?? communication.consultationNumber ?? communication.intakeNumber;
  const title = communication.matterTitle ?? "";
  if (number === null) return title;
  return title === "" ? number : `${number} · ${title}`;
}

/**
 * What the anchor's status is called where a reader needs to see it.
 *
 * It earns its place on the row rather than being tidied away, because what may be said to a
 * prospect and to a client are different things, and somebody about to reply to a text needs to know
 * which they are talking to before they type. Null on an unfiled row, which has no status to show.
 */
export function anchorStatusLabel(communication: Communication): string | null {
  if (communication.matterId === null) {
    // A set-aside row's own word is already the anchor text; repeating it as a chip would say the
    // same thing twice on one line.
    return communication.disposition === null ? null : "Set aside";
  }
  switch (communication.matterStatus) {
    case "intake": {
      return "Intake";
    }
    case "consultation": {
      return "Consultation";
    }
    case "hold": {
      return "On hold";
    }
    case "closed": {
      return "Closed";
    }
    case "open": {
      // An open matter is the unremarkable case, and a chip on every row saying so is a chip that
      // stops being read. The ones above are the ones worth stopping at.
      return null;
    }
    default: {
      return null;
    }
  }
}

/**
 * A call's length as a person says it. Minutes and seconds under an hour, hours and minutes above.
 * Null where the row is a message, or a call whose length nobody recorded.
 */
export function durationText(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(remainder)}m`;
}

/**
 * How long the line was OPEN, from the two instants — which is not how long the call took.
 *
 * A caller left on hold occupies the span without spending it (owner ruling, 2026-09-08), so a
 * record can carry an hour on the line and twenty minutes of call, and both are true. Null where
 * nobody recorded an end, which is most rows: a length is the fact people write down, and the span
 * is the one a carrier will supply.
 */
export function spanText(occurredAt: string, endedAt: string | null): string | null {
  if (endedAt === null) return null;
  const started = Date.parse(occurredAt);
  const ended = Date.parse(endedAt);
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) return null;
  return durationText(Math.round((ended - started) / 1000));
}

/**
 * The number at the other end, grouped the way its own country writes it.
 *
 * ONLY A CANONICAL NUMBER IS REFORMATTED, and the leading `+` is the test. The column holds two
 * different things: the international form, which the log form composes from the country a person
 * picked beside the digits, and — on every row recorded before that field existed, and on anything a
 * carrier hands us raw — whatever was typed. Handing the second kind to a parser that assumes a
 * country turns "ext 4102" into "4102", which is a different fact. So anything that is not already
 * canonical renders exactly as it is stored: a number nobody can parse is still the number somebody
 * was given.
 */
export function counterpartyNumberText(number: string): string {
  if (!number.startsWith("+")) return number;
  return formatStoredPhone({ number, countryRegionCode: null, extension: null });
}

/**
 * What a row shows of what was said — the whole of it, on the row's own second line.
 *
 * For a text it is the message; for a call it is what the member wrote down. Both are called the
 * DESCRIPTION on every surface (owner ruling, 2026-09-08): a call and a text read the same, and two
 * words for one thing is two things for a reader to learn. A call with neither is a row that records
 * only that the phone rang, which is a real thing to record — a missed call — and it says so rather
 * than rendering nothing, which would read as a row the platform failed to fill.
 */
export function saidText(communication: Communication): string {
  const said = communication.body ?? communication.summary ?? "";
  if (said !== "") return said;
  return communication.channel === "voice" ? "No description written" : "";
}

/*
 * WHAT HAPPENED ON THE LINE, in the firm's own formal words (owner ruling, 2026-11-09: the first
 * wording was "so informal"). Each direction has its own set, and the server refuses one from the
 * other. Spam is among them because a robocall is a call that happened, and saying so is what lets
 * the next call from the same number be recognised.
 */
export const CALL_OUTCOME_LABELS: Readonly<Record<CallOutcome, string>> = Object.freeze({
  answered: "Answered",
  transferred: "Transferred",
  messageTaken: "Message Taken",
  spam: "Spam",
  connected: "Connected",
  voicemailLeft: "Voicemail Left",
  noAnswer: "No Answer",
});

export const SPAM_KIND_LABELS: Readonly<Record<SpamKind, string>> = Object.freeze({
  sales: "Sales Or Robocall",
  wrongNumber: "Wrong Number",
  scam: "Scam",
});
