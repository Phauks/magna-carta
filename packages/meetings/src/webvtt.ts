import type { MeetingTranscriptSegmentKind } from "./transcript-types.ts";

// THE TRANSCRIPT AS THE MATTER FILE HOLDS IT: a WebVTT document, filed beside the recording's audio.
//
// The rows are the record the application reads; this is the record the matter file holds, so the file
// is complete without the application — any media player shows it as captions over the audio, and any
// text editor reads it. Each cue carries the speaker's name twice over: in its identifier, which is what
// a reader of the text sees first, and as a VOICE SPAN (`<v Name>`), which is what a player and every
// caption tool use to say who is talking.
//
// EVERYTHING WRITTEN INTO IT IS SOMEBODY ELSE'S TEXT — the event's title a member typed, a guest's name
// typed at the door, the words the model heard — and WebVTT is a format a stray character breaks: a
// blank line ends a cue, a line containing `-->` is read as a cue's timing, and `<` and `&` begin markup.
// So every piece of text is made safe for where it goes:
//
//   - the title, in a NOTE: on one line, and with no `-->` (which a NOTE may not contain);
//   - a cue's identifier: on one line, and with no `-->`;
//   - a cue's words: on one line, with `&`, `<` and `>` written as character references, which also
//     takes the `>` out of any `-->`;
//   - a voice span's name: as the words are, since a name is read up to the first `>`.
//
// Controls (a NUL, an escape) are dropped everywhere, because a reader that stops at one stops reading
// the transcript. So are the bidirectional controls and the invisible joiners and marks: a right-to-left
// override in a guest's typed name can make a plain-text view of the document show a line under somebody
// else's name, and two names differing only by a zero-width character read as one person.
//
// Pure TypeScript with no binding and no clock.

/** One cue, in reading order: a line of the transcript and who it belongs to. */
export interface WebVttCue {
  readonly kind: MeetingTranscriptSegmentKind;
  readonly startedMs: number;
  readonly endedMs: number;
  readonly text: string;
  // The speaker's name; null for a gap that is nobody's.
  readonly speakerName: string | null;
}

// C0 and C1 controls, and the two Unicode line terminators. Tab is kept as the space it means.
// eslint-disable-next-line no-control-regex -- matching control characters is this pattern's purpose
const CONTROLS = /[\u0000-\u0008\u000B\u000E-\u001F\u007F-\u009F]/gu;
const LINE_BREAKS = /[\r\n\u2028\u2029\u0085\u000C\t]+/gu;

/**
 * THE CHARACTERS NO DOCUMENT A RECORDING FILES MAY CARRY, though they print as nothing: the bidirectional
 * controls (an override can make "gpj.exe" read as "exe.jpg", or one speaker's line read as another's)
 * and the invisible joiners and marks that make two names look identical while differing. One set, read
 * by both documents — the filed audio's name (`recordingTitleForFileName` in the Worker's compose
 * consumer) and every piece of text in the transcript — so the two never disagree about what is hidden.
 */
export const INVISIBLE_CHARACTER_CODES: ReadonlySet<number> = new Set([
  0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
  0x2067, 0x2068, 0x2069, 0xfeff,
]);

/** Text with every character in `INVISIBLE_CHARACTER_CODES` removed. */
export function withoutInvisibleCharacters(text: string): string {
  let kept = "";
  for (const character of text) {
    if (!INVISIBLE_CHARACTER_CODES.has(character.codePointAt(0) ?? 0)) kept += character;
  }
  return kept;
}

/**
 * Text on one line with no controls and nothing invisible: every line break is a space, runs of space
 * are one.
 */
function oneSafeLine(text: string): string {
  return withoutInvisibleCharacters(text)
    .replace(LINE_BREAKS, " ")
    .replace(CONTROLS, "")
    .replace(/ {2,}/gu, " ")
    .trim();
}

/** A run of `-->` (however many dashes lead it) loses its arrow, repeatedly until none is left. */
function withoutArrow(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replaceAll("-->", "->");
    if (next === current) return next;
    current = next;
  }
}

/** Text as a cue's payload carries it: one line, and markup written as character references. */
export function escapeCueText(text: string): string {
  return oneSafeLine(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Text as a cue identifier or a NOTE carries it: one line, and no `-->`. */
export function escapeCueLabel(text: string): string {
  return withoutArrow(oneSafeLine(text));
}

/** A timeline offset as WebVTT writes one: `hh:mm:ss.ttt`, hours always present. */
export function webVttTimestamp(milliseconds: number): string {
  const whole = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(whole / 3_600_000);
  const minutes = Math.floor((whole % 3_600_000) / 60_000);
  const seconds = Math.floor((whole % 60_000) / 1000);
  const thousandths = whole % 1000;
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(hours)}:${two(minutes)}:${two(seconds)}.${String(thousandths).padStart(3, "0")}`;
}

/** What a gap's cue says: whose audio was not captured, or that nobody could be heard. */
function gapWords(speakerName: string | null): string {
  return speakerName === null
    ? "[No speech was captured]"
    : `[Audio from ${speakerName} was not captured]`;
}

/**
 * THE DOCUMENT: the `WEBVTT` signature, a NOTE naming the meeting, and one cue per line in reading
 * order. A cue whose end does not follow its start is given one millisecond, because a player drops a
 * cue of no length and the line would vanish from the captions while staying in the text.
 */
export function renderWebVtt(input: {
  readonly title: string;
  readonly cues: readonly WebVttCue[];
}): string {
  const blocks: string[] = ["WEBVTT", `NOTE Meeting transcript — ${escapeCueLabel(input.title)}`];
  input.cues.forEach((cue, index) => {
    const name = cue.speakerName === null ? null : oneSafeLine(cue.speakerName);
    const shownName = name === null || name === "" ? null : name;
    const identifier = escapeCueLabel(
      shownName === null ? String(index + 1) : `${String(index + 1)} ${shownName}`,
    );
    const endedMs = cue.endedMs > cue.startedMs ? cue.endedMs : cue.startedMs + 1;
    const timing = `${webVttTimestamp(cue.startedMs)} --> ${webVttTimestamp(endedMs)}`;
    const payload =
      cue.kind === "gap"
        ? escapeCueText(gapWords(shownName))
        : shownName === null
          ? escapeCueText(cue.text)
          : `<v ${escapeCueText(shownName)}>${escapeCueText(cue.text)}`;
    blocks.push(`${identifier}\n${timing}\n${payload}`);
  });
  return `${blocks.join("\n\n")}\n`;
}
