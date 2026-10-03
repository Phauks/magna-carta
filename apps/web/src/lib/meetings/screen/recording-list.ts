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
 * OPEN ONLY WHAT THE SCAN HAS LET THROUGH, AND ONLY THE VERSION THAT WAS RECORDED. Reaching the matter
 * is not the same as being openable: the version is scanned first, and the scan may hold it. The list
 * row carries where that version stands (`document.state`), read from the file pipeline rather than
 * from the recording, so a version still being checked says so, a held one is shown as held rather
 * than as something to play, and "Open" is offered only for an available one. There is no download
 * address for one version of a file — the file's own route serves its CURRENT clean version — so
 * `available` means exactly that the current version is the one this recording added; once a later
 * version replaces it, the row says so rather than opening somebody else's document under this
 * recording's name.
 *
 * NEVER "FILED" ON SCREEN. The server calls the state `filed`; to a lawyer filing means filing with a
 * court, and this platform files nothing with a court. The wire word stays; the reader's word is
 * "Added to the Matter".
 *
 * A FAILURE CARRIES ITS ERROR ID where the record has one, because a recording that could not be put
 * together is a thing somebody will ask support about, and the Error ID is what they quote.
 *
 * A RECORDING ON THE MATTER ALSO GETS A TRANSCRIPT, and the list says where it stands in a column of
 * its own: being made, ready to read, or could not be made. The words are the transcript's
 * (`transcript-panel.ts`), so the list and the panel that reads it cannot disagree about what a
 * transcript is called.
 */
import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
import type {
  MeetingRecordingDocumentView,
  MeetingRecordingListView,
  MeetingRecordingView,
  MeetingTranscriptMarkView,
} from "../meetings-api.ts";
import { transcriptErrorId, transcriptStateWord } from "./transcript-panel.ts";

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
 * run.
 *
 * `abandoned` IS TWO STORIES, AND THE STATE TELLS THEM APART. A recording whose room had been silent
 * for long enough is stopped by its own recorder with that reason and then put together like any
 * other, so it reaches the matter. A recording whose recorder went away mid-meeting is closed by the
 * platform in the `abandoned` STATE: it was cut off, and nothing from it is added to the matter. The
 * second must never read as something that finished, nor as something that was saved.
 */
export function recordingStopWord(
  recording: Pick<MeetingRecordingView, "state" | "stopReason" | "stoppedBy">,
): string {
  if (recording.state === "abandoned") {
    return "It was interrupted, and nothing was added to the matter";
  }
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
      return "It stopped when nobody had been heard for a while";
    case "start-failed":
      return "It could not start";
    default:
      return UNWORDED_STOP;
  }
}

/**
 * A FILED recording that carries an Error ID was filed without somebody's audio: a participant's
 * staged sound was missing when the recording was put together, so the document plays everybody
 * else. The row says so beside how it stopped, with the Error ID support needs to find out whose,
 * because "Open" alone would let a reader take the file for the whole meeting.
 */
export function recordingIncompleteNote(
  recording: Pick<MeetingRecordingView, "state" | "failureErrorId">,
): string | null {
  if (recording.state !== "filed") return null;
  const errorId = recording.failureErrorId ?? null;
  if (errorId === null || errorId === "") return null;
  return `Somebody's audio could not be included. Error ID: ${errorId}`;
}

/**
 * How it stopped, followed by the incomplete note where a filed recording is missing somebody.
 */
export function recordingStopText(
  recording: Pick<MeetingRecordingView, "state" | "stopReason" | "stoppedBy" | "failureErrorId">,
): string {
  const stopped = recordingStopWord(recording);
  const incomplete = recordingIncompleteNote(recording);
  if (incomplete === null) return stopped;
  return stopped === "" ? incomplete : `${stopped}. ${incomplete}`;
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

/** What the Document column says for each place a recording's document can stand, other than open. */
export const RECORDING_DOCUMENT_WORDS: Readonly<
  Record<Exclude<MeetingRecordingDocumentView["state"], "available">, string>
> = Object.freeze({
  pending: "Being Checked",
  held: "Held",
  replaced: "Replaced by a Later Version",
  removed: "Removed from the Matter",
  unavailable: "Not Available",
});

/**
 * Where the document a recording became is opened: the file's own route, which hands the browser the
 * bytes and lets it play them. Null unless the version the recording added is the file's current,
 * clean one — still being checked, held, replaced or gone, there is nothing of this recording's to
 * open.
 */
export function recordingDocumentAddress(
  recording: Pick<MeetingRecordingListView, "state" | "fileId" | "document">,
): string | null {
  if (recording.state !== "filed" || recording.fileId === null) return null;
  if (recording.document?.state !== "available") return null;
  return fileDownloadUrl(recording.fileId);
}

/**
 * What the Document column says in words: "Open" where there is a document to open, where the
 * document stands where it cannot be opened, the Error ID where it could not be made, and nothing
 * while it is still on its way.
 */
export function recordingDocumentText(recording: MeetingRecordingListView): string {
  if (recordingDocumentAddress(recording) !== null) return "Open";
  const document = recording.state === "filed" ? recording.document : null;
  if (document !== null && document.state !== "available") {
    return RECORDING_DOCUMENT_WORDS[document.state];
  }
  const errorId = recordingErrorId(recording);
  return errorId === null ? "" : `Error ID: ${errorId}`;
}

/**
 * What the Transcript column says: nothing for a recording that has not reached the matter, "Being
 * Made" while the transcript is made, "Read" where there is one to read, and "Could Not Be Made"
 * where it failed, with its Error ID wherever the row carries one.
 */
export function recordingTranscriptText(
  recording: Pick<MeetingRecordingListView, "transcript">,
): string {
  // Typed as the view so a failure's Error ID is read wherever the mark states one.
  const transcript: MeetingTranscriptMarkView | null = recording.transcript;
  if (transcript === null) return "";
  if (transcript.state === "ready") return "Read";
  const word = transcriptStateWord(transcript);
  const errorId = transcriptErrorId(transcript);
  return errorId === null ? word : `${word}. Error ID: ${errorId}`;
}

/**
 * Whether the row offers the transcript panel: wherever there is a transcript at all. A ready one is
 * read there; one still being made is watched there until it settles; a failed one states its Error
 * ID there, which is the only place it is stated while the row's mark does not carry it.
 */
export function recordingTranscriptOpens(
  recording: Pick<MeetingRecordingListView, "transcript">,
): boolean {
  return recording.transcript !== null;
}
