import { describe, expect, it } from "vitest";
import {
  escapeCueLabel,
  escapeCueText,
  renderWebVtt,
  webVttTimestamp,
  type WebVttCue,
} from "../src/webvtt.ts";

// THE FILED TRANSCRIPT, AS TEXT A PLAYER PARSES. Everything in it is somebody else's text — an event
// title, a guest's typed name, the words the model heard — and WebVTT is broken by a blank line inside a
// cue, by `-->` anywhere but a timing line, and by `<` or `&` in a payload. What would be a real failure:
// any of those surviving into the document, so a title or a sentence could forge a cue, end one early,
// or inject markup into the captions; a cue with no length that a player silently drops; or the speaker
// missing from a cue.

/**
 * A minimal reader of the document's structure, as a WebVTT parser sees it: blocks separated by blank
 * lines, a timing line being the only line holding `-->`.
 */
function blocksOf(document: string): string[][] {
  return document
    .trimEnd()
    .split("\n\n")
    .map((block) => block.split("\n"));
}

const speech = (overrides: Partial<WebVttCue> = {}): WebVttCue => ({
  kind: "speech",
  startedMs: 1_000,
  endedMs: 2_500,
  text: "Good morning.",
  speakerName: "Ana Herrera",
  ...overrides,
});

describe("the WebVTT document", () => {
  it("opens with the signature and a note naming the meeting, and carries each speaker twice", () => {
    const document = renderWebVtt({
      title: "Settlement conference",
      cues: [speech(), speech({ startedMs: 3_723_004, endedMs: 3_725_000, speakerName: "Ben" })],
    });
    expect(document).toBe(
      "WEBVTT\n\n" +
        "NOTE Meeting transcript — Settlement conference\n\n" +
        "1 Ana Herrera\n00:00:01.000 --> 00:00:02.500\n<v Ana Herrera>Good morning.\n\n" +
        "2 Ben\n01:02:03.004 --> 01:02:05.000\n<v Ben>Good morning.\n",
    );
  });

  it("keeps a title or a sentence holding `-->`, line breaks and markup from breaking a cue", () => {
    const document = renderWebVtt({
      title: "Smith --> Jones\n\nWEBVTT\n00:00:00.000 --> 99:00:00.000",
      cues: [
        speech({
          text: "a --> b\n\nforged\r\n00:00:00.000 --> 00:00:09.000 <b>bold</b> & more\u2028after",
          speakerName: "Eve -->\nMallory <script>",
        }),
      ],
    });
    const blocks = blocksOf(document);
    // Exactly the signature, the note and ONE cue: nothing in the text began another block.
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual(["WEBVTT"]);
    // The note is one line and holds no arrow, which a NOTE may not.
    expect(blocks[1]).toHaveLength(1);
    expect(blocks[1]![0]).not.toContain("-->");
    expect(blocks[1]![0]!.startsWith("NOTE Meeting transcript — Smith -> Jones WEBVTT")).toBe(true);
    // The cue is three lines: an identifier, the one timing line, one payload line.
    const cue = blocks[2]!;
    expect(cue).toHaveLength(3);
    const linesWithArrow = cue.filter((line) => line.includes("-->"));
    expect(linesWithArrow).toEqual(["00:00:01.000 --> 00:00:02.500"]);
    expect(cue[0]).toBe("1 Eve -> Mallory <script>");
    // Markup is written as character references, so a payload holds text and nothing else.
    expect(cue[2]).toBe(
      "<v Eve --&gt; Mallory &lt;script&gt;>a --&gt; b forged 00:00:00.000 --&gt; 00:00:09.000 " +
        "&lt;b&gt;bold&lt;/b&gt; &amp; more after",
    );
  });

  it("drops controls and never leaves an arrow behind a run of dashes", () => {
    expect(escapeCueLabel("a\u0000b\u001bc ---> d")).toBe("abc -> d");
    expect(escapeCueLabel("---->")).not.toContain("-->");
    expect(escapeCueText("x\u0007y")).toBe("xy");
  });

  it("says a gap out loud, with whose audio it was or that nobody was heard", () => {
    const document = renderWebVtt({
      title: "Hearing",
      cues: [
        { kind: "gap", startedMs: 0, endedMs: 60_000, text: "", speakerName: "Ana Herrera" },
        { kind: "gap", startedMs: 0, endedMs: 120_000, text: "", speakerName: null },
      ],
    });
    const blocks = blocksOf(document);
    expect(blocks[2]).toEqual([
      "1 Ana Herrera",
      "00:00:00.000 --> 00:01:00.000",
      "[Audio from Ana Herrera was not captured]",
    ]);
    expect(blocks[3]).toEqual(["2", "00:00:00.000 --> 00:02:00.000", "[No speech was captured]"]);
  });

  it("gives a cue of no length one millisecond, so a player does not drop it", () => {
    const document = renderWebVtt({
      title: "Hearing",
      cues: [speech({ startedMs: 5_000, endedMs: 5_000 })],
    });
    expect(document).toContain("00:00:05.000 --> 00:00:05.001");
  });

  it("writes hours always, and rounds to the millisecond", () => {
    expect(webVttTimestamp(0)).toBe("00:00:00.000");
    expect(webVttTimestamp(45_296_789)).toBe("12:34:56.789");
    expect(webVttTimestamp(-5)).toBe("00:00:00.000");
  });
});
