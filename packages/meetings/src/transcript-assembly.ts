import type { MeetingRecordingTrackId, UserId } from "@magna-carta/identifiers/types";
import type { MeetingRecordingRow, MeetingRecordingTrackRow } from "./recording-types.ts";
import type { MeetingContributorKind } from "./types.ts";

// FROM WHAT THE SPEECH MODEL HEARD TO THE LINES OF A TRANSCRIPT: where each line falls on the
// recording's timeline, who said it, where the transcript says it could not hear, and the order every
// line is read in.
//
// Each piece of one track's speech is sent to the model on its own, and the model answers with times
// inside THAT piece; only the transcript knows where on the recording the piece was cut from, so every
// line is placed by adding the piece's own offset and kept inside the piece. The speaker is the track —
// the stay whose microphone it was — and never a guess.
//
// A GAP IS SAID OUT LOUD, never left as silence: a track that was lost is not heard from its last frame
// to the end of the recording, a track the ceiling refused was never heard from the moment it arrived,
// and a track whose staged audio was not there to read was not heard for the span it was captured. A
// recording in which nobody could be heard at all is ONE gap over the whole of it — the transcript is
// still ready, and it says what it is.
//
// THE ORDER is by when each line began, then when it ended, then by its handle — a total order, so
// overlapping speech interleaves by start and two lines that began together always read the same way.
// The settle's one renumbering statement and the document both use exactly this order.
//
// Pure TypeScript with no binding and no clock.

/** How many characters of the previous piece's words prompt the next — the model's context window. */
export const PROMPT_TAIL_MAXIMUM_CHARACTERS = 200;

/** One segment the model reported, in seconds within the piece it was sent. */
export interface HeardSegment {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
}

/** One line placed on the recording's timeline, in milliseconds from its start. */
export interface PlacedLine {
  readonly startedMs: number;
  readonly endedMs: number;
  readonly text: string;
}

/** Text as one line: every run of white space — a line break included — is one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * THE LINES ONE PIECE PRODUCED, placed on the recording. Each segment the model reported lands at the
 * piece's offset plus its own, kept inside the piece; an empty one is dropped. A model that reported
 * words with no timings produces one line over the whole piece rather than a timing made up to fit.
 */
export function placeHeardSegments(input: {
  readonly piece: { readonly startedMs: number; readonly endedMs: number };
  readonly text: string;
  readonly segments: readonly HeardSegment[];
}): PlacedLine[] {
  const { startedMs, endedMs } = input.piece;
  const within = (milliseconds: number) => Math.min(endedMs, Math.max(startedMs, milliseconds));
  const lines: PlacedLine[] = [];
  for (const segment of input.segments) {
    const text = oneLine(segment.text);
    if (text === "") continue;
    const from = within(startedMs + Math.round(Math.max(0, segment.startSeconds) * 1000));
    const to = within(startedMs + Math.round(Math.max(0, segment.endSeconds) * 1000));
    lines.push({ startedMs: from, endedMs: Math.max(from, to), text });
  }
  if (lines.length === 0 && input.segments.length === 0) {
    const text = oneLine(input.text);
    if (text !== "") lines.push({ startedMs, endedMs, text });
  }
  return lines;
}

/**
 * THE END OF THE LAST PIECE'S WORDS, for the next piece's prompt: at most
 * `PROMPT_TAIL_MAXIMUM_CHARACTERS`, begun at a word rather than inside one. Null for nothing.
 */
export function promptTail(text: string | null): string | null {
  if (text === null) return null;
  const line = oneLine(text);
  if (line === "") return null;
  const characters = Array.from(line);
  if (characters.length <= PROMPT_TAIL_MAXIMUM_CHARACTERS) return line;
  const tail = characters.slice(-PROMPT_TAIL_MAXIMUM_CHARACTERS).join("");
  const space = tail.indexOf(" ");
  return space >= 0 && space < tail.length - 1 ? tail.slice(space + 1) : tail;
}

/** A span the transcript could not hear, and whose it was — or nobody's. */
export interface GapLine {
  readonly startedMs: number;
  readonly endedMs: number;
  readonly speaker: {
    readonly trackId: MeetingRecordingTrackId;
    readonly participantKind: MeetingContributorKind;
    readonly participantId: string;
    readonly userId: UserId | null;
  } | null;
}

/** Milliseconds from the recording's start to an instant, never before the start. */
function offsetOf(recording: MeetingRecordingRow, instant: string): number {
  return Math.max(0, Date.parse(instant) - Date.parse(recording.started_at));
}

/**
 * THE GAPS ONE RECORDING'S TRACKS LEAVE, one per track at most:
 *
 * - a LOST track that carried audio: from its last frame to the end of the recording;
 * - a lost track that carried NONE (the ceiling refused it, or its socket never came back): from when
 *   it arrived to the end of the recording;
 * - a track whose staged audio was not there to read (`audioMissing` names them): the span it was
 *   captured, its first frame to its last.
 *
 * The end of the recording is its stop. A gap that would be empty is not one.
 */
export function gapsForTracks(
  recording: MeetingRecordingRow,
  tracks: readonly MeetingRecordingTrackRow[],
  audioMissing: ReadonlySet<MeetingRecordingTrackId>,
): GapLine[] {
  const endMs = offsetOf(recording, recording.stopped_at ?? recording.updated_at);
  const gaps: GapLine[] = [];
  for (const track of tracks) {
    let from: number | null = null;
    let to = endMs;
    if (track.state === "lost") {
      from = offsetOf(recording, track.last_frame_at ?? track.created_at);
    } else if (audioMissing.has(track.id) && track.first_frame_at !== null) {
      from = offsetOf(recording, track.first_frame_at);
      to = Math.min(endMs, offsetOf(recording, track.last_frame_at ?? track.first_frame_at));
    }
    if (from === null || to <= from) continue;
    gaps.push({
      startedMs: from,
      endedMs: to,
      speaker: {
        trackId: track.id,
        participantKind: track.participant_kind,
        participantId: track.participant_id,
        userId: track.user_id,
      },
    });
  }
  return gaps;
}

/** The one gap a recording in which nobody could be heard is: the whole of it, nobody's. */
export function wholeRecordingGap(recording: MeetingRecordingRow): GapLine {
  const lengthMs =
    recording.captured_seconds !== null
      ? recording.captured_seconds * 1000
      : offsetOf(recording, recording.stopped_at ?? recording.updated_at);
  return { startedMs: 0, endedMs: Math.max(0, lengthMs), speaker: null };
}

/** The fields the reading order is decided on. */
export interface OrderedLine {
  readonly started_ms: number;
  readonly ended_ms: number;
  readonly id: string;
}

/** Compares two lines in the transcript's reading order: start, then end, then handle. */
export function compareLines(left: OrderedLine, right: OrderedLine): number {
  if (left.started_ms !== right.started_ms) return left.started_ms - right.started_ms;
  if (left.ended_ms !== right.ended_ms) return left.ended_ms - right.ended_ms;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Lines in the transcript's reading order, as a new array. */
export function inReadingOrder<Line extends OrderedLine>(lines: readonly Line[]): Line[] {
  return [...lines].sort(compareLines);
}

/** How many words a line holds: runs of characters between spaces. */
export function countWords(text: string): number {
  const line = oneLine(text);
  return line === "" ? 0 : line.split(" ").length;
}
