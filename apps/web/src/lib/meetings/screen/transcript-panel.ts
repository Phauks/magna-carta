/*
 * What a recording's transcript reads as: where it stands, when each line was said, who said it,
 * and where nobody could be heard. The one home for those words, so the recordings list and the
 * transcript panel cannot word one transcript two ways.
 *
 * A TRANSCRIPT IS MADE AFTER ITS RECORDING IS ADDED TO THE MATTER, from each person's own
 * microphone, so every line is attributed to the person whose sound it came from rather than to a
 * numbered voice. It stands in one of three places: still being made, ready to read, or failed with
 * an Error ID. Lines exist only once it is ready; until then the read answers where it stands and
 * nothing else.
 *
 * WHEN A LINE WAS SAID IS ITS PLACE IN THE RECORDING, NOT A TIME OF DAY. The lines carry
 * milliseconds from the recording's start, which is what somebody playing the audio beside the
 * transcript scrubs to, so the time is written the way a player writes a position: minutes and
 * seconds, with the hour in front once the recording has run past one.
 *
 * A GAP IS SAID AS A FACT ABOUT A PERSON. Where the transcript could not hear somebody (their
 * connection dropped, the room was too full for their sound to be kept, or what was captured could
 * not be read back) the line names whose sound is missing and for how long, so a reader never takes
 * a silence in the record for a silence in the room. A gap with nobody named is a recording in which
 * nothing at all was heard.
 *
 * THE WORDS OF A LINE ARE PRIVILEGED. Nothing in this module or the panel that draws it writes a
 * line's text anywhere but the screen: not to a log, not into an address, not into a failure report.
 */
import { guestAttendeeLabel } from "./meeting-host-labels.ts";
import type {
  MeetingTranscriptHeaderView,
  MeetingTranscriptLineView,
  MeetingTranscriptSpeakerView,
  MeetingTranscriptStateView,
  MeetingTranscriptWithheldView,
} from "../meetings-api.ts";

/** What each place a transcript can stand is called. */
export const TRANSCRIPT_STATE_WORDS: Readonly<Record<MeetingTranscriptStateView, string>> =
  Object.freeze({
    pending: "Being Made",
    ready: "Ready",
    failed: "Could Not Be Made",
  });

/** What one transcript's state is called. */
export function transcriptStateWord(transcript: {
  readonly state: MeetingTranscriptStateView;
}): string {
  return TRANSCRIPT_STATE_WORDS[transcript.state];
}

/**
 * The Error ID a failed transcript was recorded under, or null where it carries none. Only a FAILED
 * one, on the recording's own rule: a transcript still being made has nothing to quote.
 */
export function transcriptErrorId(transcript: {
  readonly state: MeetingTranscriptStateView;
  readonly failureErrorId?: string | null;
}): string | null {
  if (transcript.state !== "failed") return null;
  const errorId = transcript.failureErrorId ?? null;
  return errorId === null || errorId === "" ? null : errorId;
}

/**
 * What the panel's body shows once the read has answered. ONE function decides it, so every reason a
 * transcript has no lines to show is answered in one place and in one order:
 *
 * - `being-made`: the transcript is still being written.
 * - `could-not-be-made`: it failed, with its Error ID where it carries one.
 * - `withheld`: it is ready, but the read withheld its lines because the document it became on the
 *   matter can no longer be read (removed from the matter, held by the scan, or out of reach). The
 *   read states why on every page, and that reason is handed in as it arrived.
 * - `lines`: it is ready and its lines are shown, which includes a ready transcript with none, whose
 *   frame says "No Results" inside itself rather than standing in for the transcript.
 *
 * The first three are facts about the recording rather than an absence of lines, which is why each is
 * the design system's empty state with its own title instead of an empty transcript.
 */
export type TranscriptBody =
  | { readonly kind: "lines" }
  | {
      readonly kind: "being-made" | "could-not-be-made" | "withheld";
      /** The empty state's title. */
      readonly title: string;
      /** The one line beneath it, or null where there is nothing more to say. */
      readonly detail: string | null;
    };

/**
 * Why a ready transcript's lines are withheld, in the words the recording's own document column uses
 * for the same places a document can stand, so the transcript and the audio beside it say one thing.
 */
export const TRANSCRIPT_WITHHELD_WORDS: Readonly<
  Record<NonNullable<MeetingTranscriptWithheldView>, string>
> = Object.freeze({
  removed: "Removed from the Matter",
  held: "Held",
  unavailable: "Not Available",
});

export function transcriptBody(
  header: Pick<MeetingTranscriptHeaderView, "state" | "failureErrorId">,
  withheldReason: MeetingTranscriptWithheldView,
): TranscriptBody {
  switch (header.state) {
    case "pending":
      return {
        kind: "being-made",
        title: `Transcript ${TRANSCRIPT_STATE_WORDS.pending}`,
        detail: null,
      };
    case "failed": {
      // The Error ID is what somebody quotes to support, so it is the one line under the title.
      const errorId = transcriptErrorId(header);
      return {
        kind: "could-not-be-made",
        title: `Transcript ${TRANSCRIPT_STATE_WORDS.failed}`,
        detail: errorId === null ? null : `Error ID: ${errorId}`,
      };
    }
    case "ready":
      break;
  }
  if (withheldReason === null) return { kind: "lines" };
  return {
    kind: "withheld",
    title: "Transcript Withheld",
    detail: TRANSCRIPT_WITHHELD_WORDS[withheldReason],
  };
}

/** How long the panel waits before asking again about a transcript that is still being made. */
export const PENDING_TRANSCRIPT_REREAD_MILLISECONDS = 15_000;

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** A count of whole seconds, never negative, from a count of milliseconds that may not be whole. */
function wholeSeconds(milliseconds: number): number {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 0;
  return Math.floor(milliseconds / MILLISECONDS_PER_SECOND);
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A line's place in the recording: `mm:ss`, or `h:mm:ss` once the recording has run past an hour.
 * Rounded DOWN to the second, the way a player counts, so a line said at 59.9 seconds is at 00:59
 * and not at a minute it had not reached.
 */
export function transcriptOffset(milliseconds: number): string {
  const total = wholeSeconds(milliseconds);
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  if (hours > 0) return `${String(hours)}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
  return `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

/** The same place, as the machine-readable duration a `<time>` element carries. */
export function transcriptOffsetAttribute(milliseconds: number): string {
  return `PT${String(wholeSeconds(milliseconds))}S`;
}

function counted(value: number, singular: string, plural: string): string {
  return `${String(value)} ${value === 1 ? singular : plural}`;
}

/**
 * How long a span lasted, in words: "2 minutes and 30 seconds", "1 hour and 5 minutes". Whole
 * seconds; a part that is zero is left out rather than said, and a span shorter than a second says
 * so rather than calling itself nothing.
 */
export function spanLengthWords(milliseconds: number): string {
  const total = wholeSeconds(milliseconds);
  if (total === 0) return "less than a second";
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  const parts = [
    hours > 0 ? counted(hours, "hour", "hours") : null,
    minutes > 0 ? counted(minutes, "minute", "minutes") : null,
    seconds > 0 ? counted(seconds, "second", "seconds") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/**
 * Who said a line, as the transcript names them: a member by name, a guest by the name they gave
 * at the door marked as a guest, on the label the rest of the meeting screens use. A speaker the
 * record names with nothing is said to be unnamed rather than drawn as a blank.
 */
export function transcriptSpeakerLabel(speaker: MeetingTranscriptSpeakerView | null): string {
  const name = speaker?.displayName.trim() ?? "";
  if (speaker === null || name === "") return "Unnamed Speaker";
  return speaker.participantKind === "guest" ? guestAttendeeLabel(name, null) : name;
}

/**
 * What a gap line says: whose sound is missing, and for how long. A gap that names nobody is a
 * recording in which nothing at all was heard, and says that instead.
 */
export function transcriptGapSentence(
  line: Pick<MeetingTranscriptLineView, "startedMs" | "endedMs" | "speaker">,
): string {
  const length = spanLengthWords(line.endedMs - line.startedMs);
  const name = line.speaker?.displayName.trim() ?? "";
  if (line.speaker === null) return `Nothing was heard for ${length}.`;
  if (name === "") return `Someone's audio is missing for ${length}.`;
  return `${name}'s audio is missing for ${length}.`;
}

/** Every line of every page read so far, in the order the server numbered them. */
export function transcriptLines(
  pages: readonly { readonly data: readonly MeetingTranscriptLineView[] }[],
): readonly MeetingTranscriptLineView[] {
  return pages.flatMap((page) => page.data);
}

/**
 * Whether a read that was still being made has now settled one way or the other. The recordings
 * list is read again at exactly that moment, so the row a reader returns to agrees with the panel
 * they are closing.
 */
export function transcriptSettled(
  before: MeetingTranscriptStateView | null,
  now: MeetingTranscriptStateView | null,
): boolean {
  return before === "pending" && (now === "ready" || now === "failed");
}
