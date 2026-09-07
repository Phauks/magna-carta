/*
 * The words the call and text log renders — one home for them, so the table, the record window and
 * the log form cannot end up calling the same thing three things.
 */
import type {
  Communication,
  CommunicationChannel,
  CommunicationDirection,
} from "./communications-api.ts";

export interface VocabularyEntry {
  readonly label: string;
  /** What the word means, said to somebody who is not sure. Rendered on a hover, never as prose. */
  readonly meaning: string;
}

const CHANNELS: Readonly<Record<CommunicationChannel, VocabularyEntry>> = Object.freeze({
  voice: { label: "Call", meaning: "A phone call, in either direction." },
  sms: { label: "Text", meaning: "A text message." },
  // Named for what a person sees rather than for the carrier's acronym: nobody in a law firm says
  // MMS, they say the client sent a photo.
  mms: { label: "Picture", meaning: "A text message carrying a picture or a file." },
});

export function channelEntry(channel: CommunicationChannel): VocabularyEntry {
  return CHANNELS[channel];
}

const DIRECTIONS: Readonly<Record<CommunicationDirection, VocabularyEntry>> = Object.freeze({
  inbound: { label: "In", meaning: "The other person contacted the firm." },
  outbound: { label: "Out", meaning: "The firm contacted them." },
});

export function directionEntry(direction: CommunicationDirection): VocabularyEntry {
  return DIRECTIONS[direction];
}

/** What the Matter column says for a row with none. It is a value, so the set filter can hold it. */
export const NOT_FILED_TEXT = "Not filed";

/**
 * How the anchor reads on a row.
 *
 * THE NUMBER IS NOT ALWAYS THERE, AND THAT IS NORMAL RATHER THAN MISSING. A matter number is drawn
 * when a matter opens; before that a consultation carries its own tentative number and an intake
 * carries none at all. So this falls through: matter number, then consultation number, then the
 * title alone — and a row with no anchor says it is not filed rather than rendering blank, because
 * a blank there reads as a record the platform failed to fill.
 */
export function anchorText(communication: Communication): string {
  if (communication.matterId === null) return NOT_FILED_TEXT;
  const number = communication.matterNumber ?? communication.consultationNumber;
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
 * The one line a row shows of what was said.
 *
 * For a text it is the message; for a call it is what the member wrote down. A call with neither is
 * a row that records only that the phone rang, which is a real thing to record — a missed call — and
 * it says so rather than rendering an empty cell.
 */
export function saidText(communication: Communication): string {
  const said = communication.body ?? communication.summary ?? "";
  if (said !== "") return said;
  return communication.channel === "voice" ? "No summary written" : "";
}
