/*
 * What one recording reads as in the list of a meeting's recordings: its state, how it stopped, and
 * what became of it. The one home for those words, so the room's panel and the Meetings page's panel
 * cannot word one recording two ways.
 *
 * A RECORDING THAT HAS STOPPED IS PUT TOGETHER AND ADDED TO THE MATTER'S DOCUMENTS. Its tracks are
 * mixed into one audio document and that document arrives on the matter the way an upload does —
 * scanned, hashed and listed in the Files section. So what the list offers for a recording that got
 * there is the DOCUMENT, through the file's own route, rather than a player of this screen's own: the
 * file on the matter is the record, and a second way to play it would be a second copy to keep right.
 *
 * NEVER "FILED" ON SCREEN. The server calls the state `filed`; to a lawyer filing means filing with a
 * court, and this platform files nothing with a court. The wire word stays; the reader's word is
 * "Added to the Matter".
 *
 * A FAILURE CARRIES ITS ERROR ID where the record has one, because a recording that could not be put
 * together is a thing somebody will ask support about, and the Error ID is what they quote.
 */
import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
import type { MeetingRecordingView } from "../meetings-api.ts";

/** What each state of a recording is called, in the order a recording passes through them. */
export const RECORDING_STATE_WORDS: Readonly<Record<MeetingRecordingView["state"], string>> =
  Object.freeze({
    recording: "Recording",
    composing: "Being Put Together",
    filed: "Added to the Matter",
    failed: "Failed",
    abandoned: "Interrupted",
  });

/** What one recording's state is called. */
export function recordingStateWord(recording: Pick<MeetingRecordingView, "state">): string {
  return RECORDING_STATE_WORDS[recording.state];
}

/** What a stop is called where the record names a reason this screen has no words for yet. */
const UNWORDED_STOP = "It stopped";

/**
 * How a recording stopped, in a sentence: who pressed Stop, or what stopped it where nobody did.
 * Empty while it is still running.
 *
 * EVERY REASON HAS ITS OWN WORDS. A start that could not be carried out read as "Interrupted", which
 * is what a recording cut off halfway through is called — and a recording that never began is a
 * different fault with a different remedy, so it says so. `ceiling` is the longest a recording may
 * run, and `abandoned` is a recording nobody stopped that ended on its own: the room went quiet for
 * long enough, or the recorder went away and what it had kept was gathered up.
 */
export function recordingStopWord(
  recording: Pick<MeetingRecordingView, "stopReason" | "stoppedBy">,
): string {
  switch (recording.stopReason) {
    case null:
      return "";
    case "member":
    case "host": {
      const name = recording.stoppedBy?.displayName.trim() ?? "";
      return name === "" ? "Stopped from the meeting" : `Stopped by ${name}`;
    }
    case "meeting-ended":
      return "The meeting ended";
    case "sink-lost":
      return "The sound was lost";
    case "ceiling":
      return "It reached the longest a recording may run";
    case "abandoned":
      return "It ended on its own";
    case "start-failed":
      return "It could not start";
    default:
      return UNWORDED_STOP;
  }
}

/**
 * The Error ID a failed recording was recorded under, or null where it carries none. Only a FAILED
 * one: a recording still being put together may carry the Error ID of an attempt that will be tried
 * again, and stating it beside "Being Put Together" would read as a failure that has not happened.
 */
export function recordingErrorId(
  recording: Pick<MeetingRecordingView, "state" | "failureErrorId">,
): string | null {
  if (recording.state !== "failed") return null;
  const errorId = recording.failureErrorId ?? null;
  return errorId === null || errorId === "" ? null : errorId;
}

/**
 * Where the document a recording became is opened: the file's own route, which hands the browser the
 * bytes and lets it play them. Null until the recording has been added to the matter.
 */
export function recordingDocumentAddress(
  recording: Pick<MeetingRecordingView, "state" | "fileId">,
): string | null {
  if (recording.state !== "filed" || recording.fileId === null) return null;
  return fileDownloadUrl(recording.fileId);
}

/**
 * What the Document column says in words: "Open" where there is a document, the Error ID where it
 * could not be made, and nothing while it is still on its way.
 */
export function recordingDocumentText(recording: MeetingRecordingView): string {
  if (recordingDocumentAddress(recording) !== null) return "Open";
  const errorId = recordingErrorId(recording);
  return errorId === null ? "" : `Error ID: ${errorId}`;
}
