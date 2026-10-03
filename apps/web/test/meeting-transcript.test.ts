// @vitest-environment happy-dom
/*
 * The transcript of a recording, as the panel reads it: where it is in the recording each line was
 * said, who said it, where nobody could be heard and for how long, and what a transcript still being
 * made or one that could not be made says instead of lines.
 *
 * WHAT IS PINNED. A line's time is its place in the recording, written as a player writes it —
 * minutes and seconds, with the hour in front once the recording runs past one — and never a time
 * of day. A gap names whose audio is missing and for how long, and a gap naming nobody says nothing
 * was heard. A guest is marked as a guest. A transcript being made and one that could not be made
 * are the design system's empty state with their own titles, the failure carrying its Error ID; a
 * ready one with no lines says "No Results" inside its own frame. The lines page on from the cursor
 * the last page answered, and the document the transcript became opens beside the reader through
 * the file's own route. The words of a line never reach an address.
 *
 * The first half is the pure wording; the second mounts the panel over a canned server.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import {
  TRANSCRIPT_STATE_WORDS,
  spanLengthWords,
  transcriptBody,
  transcriptErrorId,
  transcriptGapSentence,
  transcriptLines,
  transcriptOffset,
  transcriptOffsetAttribute,
  transcriptSettled,
  transcriptSpeakerLabel,
  transcriptStateWord,
} from "../src/lib/meetings/screen/transcript-panel.ts";
import type {
  MeetingTranscriptHeaderView,
  MeetingTranscriptLineView,
  MeetingTranscriptSpeakerView,
  MeetingTranscriptWithheldView,
} from "../src/lib/meetings/meetings-api.ts";
import Harness from "./meeting-transcript-harness.svelte";

const ORIGIN = "https://app.example";
const MEETING_ID = "meeting_1";
const RECORDING_ID = "meetingRecording_1";
const TRANSCRIPT_PATH = `/api/v1/meetings/${MEETING_ID}/recordings/${RECORDING_ID}/transcript`;

const ROSALIND: MeetingTranscriptSpeakerView = {
  participantKind: "member",
  participantId: "meetingAttendance_1",
  userId: "usr_2",
  displayName: "Rosalind Chase",
};

const GUEST: MeetingTranscriptSpeakerView = {
  participantKind: "guest",
  participantId: "meetingGuestStay_1",
  userId: null,
  displayName: "Omar Haddad",
};

function line(overrides: Partial<MeetingTranscriptLineView> = {}): MeetingTranscriptLineView {
  return {
    id: "meetingTranscriptSegment_1",
    ordinal: 0,
    kind: "speech",
    startedMs: 5_000,
    endedMs: 9_000,
    text: "We will file the reply by Friday.",
    speaker: ROSALIND,
    ...overrides,
  };
}

function header(overrides: Partial<MeetingTranscriptHeaderView> = {}): MeetingTranscriptHeaderView {
  return {
    id: "meetingTranscript_1",
    recordingId: RECORDING_ID,
    state: "ready",
    language: "en",
    segmentCount: 2,
    wordCount: 14,
    fileId: "file_vtt",
    failureErrorId: null,
    createdAt: "2026-09-20T15:31:00.000Z",
    updatedAt: "2026-09-20T15:40:00.000Z",
    ...overrides,
  };
}

describe("where in the recording a line was said", () => {
  it("is minutes and seconds, padded, rounded down to the second", () => {
    expect(transcriptOffset(0)).toBe("00:00");
    expect(transcriptOffset(5_000)).toBe("00:05");
    expect(transcriptOffset(59_999)).toBe("00:59");
    expect(transcriptOffset(60_000)).toBe("01:00");
    expect(transcriptOffset(754_000)).toBe("12:34");
    expect(transcriptOffset(3_599_999)).toBe("59:59");
  });

  it("puts the hour in front once the recording runs past one", () => {
    expect(transcriptOffset(3_600_000)).toBe("1:00:00");
    expect(transcriptOffset(3_723_000)).toBe("1:02:03");
    expect(transcriptOffset(36_000_000)).toBe("10:00:00");
  });

  it("never reads a value that is not a place as a negative or a nonsense time", () => {
    expect(transcriptOffset(-500)).toBe("00:00");
    expect(transcriptOffset(Number.NaN)).toBe("00:00");
    expect(transcriptOffsetAttribute(3_723_400)).toBe("PT3723S");
  });
});

describe("how long a span lasted", () => {
  it("is said in words, leaving out the parts that are nothing", () => {
    expect(spanLengthWords(1_000)).toBe("1 second");
    expect(spanLengthWords(45_000)).toBe("45 seconds");
    expect(spanLengthWords(60_000)).toBe("1 minute");
    expect(spanLengthWords(150_000)).toBe("2 minutes and 30 seconds");
    expect(spanLengthWords(3_900_000)).toBe("1 hour and 5 minutes");
    expect(spanLengthWords(7_263_000)).toBe("2 hours, 1 minute and 3 seconds");
  });

  it("says a span shorter than a second is, rather than calling it nothing", () => {
    expect(spanLengthWords(400)).toBe("less than a second");
    expect(spanLengthWords(0)).toBe("less than a second");
  });
});

describe("a gap in the transcript", () => {
  it("names whose audio is missing and for how long", () => {
    expect(
      transcriptGapSentence(line({ kind: "gap", startedMs: 60_000, endedMs: 210_000, text: "" })),
    ).toBe("Rosalind Chase's audio is missing for 2 minutes and 30 seconds.");
    expect(
      transcriptGapSentence(
        line({ kind: "gap", startedMs: 0, endedMs: 12_000, text: "", speaker: GUEST }),
      ),
    ).toBe("Omar Haddad's audio is missing for 12 seconds.");
  });

  it("says nothing was heard where the gap names nobody", () => {
    expect(
      transcriptGapSentence(
        line({ kind: "gap", startedMs: 0, endedMs: 1_800_000, text: "", speaker: null }),
      ),
    ).toBe("Nothing was heard for 30 minutes.");
  });

  it("still says somebody's audio is missing where the record has no name for them", () => {
    expect(
      transcriptGapSentence(
        line({ kind: "gap", endedMs: 7_000, text: "", speaker: { ...ROSALIND, displayName: " " } }),
      ),
    ).toBe("Somebody's audio is missing for 2 seconds.");
  });
});

describe("who said a line", () => {
  it("is a member by name, a guest marked as a guest, and never a blank", () => {
    expect(transcriptSpeakerLabel(ROSALIND)).toBe("Rosalind Chase");
    expect(transcriptSpeakerLabel(GUEST)).toBe("Omar Haddad (Guest)");
    expect(transcriptSpeakerLabel(null)).toBe("Unnamed Speaker");
    expect(transcriptSpeakerLabel({ ...ROSALIND, displayName: "" })).toBe("Unnamed Speaker");
  });
});

describe("where a transcript stands", () => {
  it("names every state in plain words", () => {
    expect(transcriptStateWord({ state: "pending" })).toBe("Being Made");
    expect(transcriptStateWord({ state: "ready" })).toBe("Ready");
    expect(transcriptStateWord({ state: "failed" })).toBe("Could Not Be Made");
    for (const word of Object.values(TRANSCRIPT_STATE_WORDS)) {
      expect(word.toLowerCase()).not.toContain("filed");
    }
  });

  it("states a failed transcript's Error ID, and no other transcript's", () => {
    expect(transcriptErrorId({ state: "failed", failureErrorId: "err_T1" })).toBe("err_T1");
    expect(transcriptErrorId({ state: "failed", failureErrorId: null })).toBeNull();
    expect(transcriptErrorId({ state: "failed" })).toBeNull();
    expect(transcriptErrorId({ state: "pending", failureErrorId: "err_T1" })).toBeNull();
  });

  it("is settled only when one being made becomes ready or fails", () => {
    expect(transcriptSettled("pending", "ready")).toBe(true);
    expect(transcriptSettled("pending", "failed")).toBe(true);
    expect(transcriptSettled("pending", "pending")).toBe(false);
    // Opened on a transcript that was already ready is not a settle the opener needs to hear about.
    expect(transcriptSettled(null, "ready")).toBe(false);
    expect(transcriptSettled("ready", "ready")).toBe(false);
  });

  it("decides the panel's body in one place: being made, could not be made, withheld, or lines", () => {
    expect(transcriptBody(header({ state: "pending" }), null)).toEqual({
      kind: "being-made",
      title: "Transcript Being Made",
      detail: null,
    });
    expect(transcriptBody(header({ state: "failed", failureErrorId: "err_T1" }), null)).toEqual({
      kind: "could-not-be-made",
      title: "Transcript Could Not Be Made",
      detail: "Error ID: err_T1",
    });
    expect(transcriptBody(header({ state: "failed" }), null)).toEqual({
      kind: "could-not-be-made",
      title: "Transcript Could Not Be Made",
      detail: null,
    });
    expect(transcriptBody(header(), null)).toEqual({ kind: "lines" });
  });

  it("says why a ready transcript's lines are withheld, in the document column's own words", () => {
    expect(transcriptBody(header(), "removed")).toEqual({
      kind: "withheld",
      title: "Transcript Withheld",
      detail: "Removed from the Matter",
    });
    expect(transcriptBody(header(), "held")).toMatchObject({ detail: "Held" });
    expect(transcriptBody(header(), "unavailable")).toMatchObject({ detail: "Not Available" });
    // Only a ready transcript has lines to withhold.
    expect(transcriptBody(header({ state: "pending" }), "removed").kind).toBe("being-made");
  });

  it("keeps the lines of every page in the order they were read", () => {
    const pages = [
      { data: [line({ id: "a", ordinal: 0 }), line({ id: "b", ordinal: 1 })] },
      { data: [line({ id: "c", ordinal: 2 })] },
    ];
    expect(transcriptLines(pages).map((each) => each.id)).toEqual(["a", "b", "c"]);
  });
});

// ---------------------------------------------------------------------------------------------
// The panel, over a canned server.
// ---------------------------------------------------------------------------------------------

interface TranscriptAnswer {
  readonly transcript: MeetingTranscriptHeaderView;
  readonly data: readonly MeetingTranscriptLineView[];
  readonly nextCursor: string | null;
  readonly linesWithheld?: MeetingTranscriptWithheldView;
}

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
/** Every address the panel asked for, so a case can see the cursor and see no words in it. */
let asked: URL[] = [];

/**
 * Answer the transcript read. A function is handed the cursor the request carried, so a case can
 * answer page by page; a number is a failure with that status; "never" is a read that does not end.
 */
function serve(
  answer: "never" | number | TranscriptAnswer | ((cursor: string | null) => TranscriptAnswer),
): void {
  const stub = ((request: Request) => {
    const address = new URL(request.url);
    asked.push(address);
    if (answer === "never") return new Promise<Response>(() => {});
    if (typeof answer === "number") {
      return Promise.resolve(
        new Response(JSON.stringify({ title: "Not Found", status: answer }), {
          status: answer,
          headers: { "content-type": "application/problem+json" },
        }),
      );
    }
    const body = typeof answer === "function" ? answer(address.searchParams.get("cursor")) : answer;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
}

async function settle(remaining = 6): Promise<void> {
  if (remaining === 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  await settle(remaining - 1);
}

async function draw(onSettled?: () => void): Promise<void> {
  instance = mount(Harness, {
    target,
    props: { meetingId: MEETING_ID, recordingId: RECORDING_ID, onSettled },
  });
  flushSync();
  await settle();
}

/** The open panel, which the dialog draws outside the harness's own element. */
function panel(): Element | undefined {
  return [...document.body.querySelectorAll('[role="dialog"]')].find((candidate) =>
    candidate.textContent?.includes("Transcript"),
  );
}

function buttonNamed(container: Element | undefined, name: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll("button") ?? [])].find(
    (control) => control.textContent?.trim() === name,
  );
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  asked = [];
  queryClient.clear();
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("the transcript panel", () => {
  it("reads a ready transcript in order, with who said each line, when, and who was not heard", async () => {
    serve({
      transcript: header(),
      data: [
        line({ id: "line_1", ordinal: 0, startedMs: 5_000 }),
        line({
          id: "line_2",
          ordinal: 1,
          startedMs: 62_000,
          text: "Agreed, and I will send the exhibits.",
          speaker: GUEST,
        }),
        line({
          id: "line_3",
          ordinal: 2,
          kind: "gap",
          startedMs: 90_000,
          endedMs: 240_000,
          text: "",
        }),
        line({ id: "line_4", ordinal: 3, startedMs: 3_723_000, text: "That is everything." }),
      ],
      nextCursor: null,
    });
    await draw();
    const shown = panel();
    const record = shown?.querySelector('[role="log"]');
    expect(record).not.toBeNull();

    const turns = [...(record?.querySelectorAll("article") ?? [])];
    expect(turns).toHaveLength(4);
    expect(turns[0]?.textContent).toContain("Rosalind Chase");
    expect(turns[0]?.textContent).toContain("00:05");
    expect(turns[0]?.textContent).toContain("We will file the reply by Friday.");
    expect(turns[1]?.textContent).toContain("Omar Haddad (Guest)");
    expect(turns[1]?.textContent).toContain("01:02");
    // The gap is a turn that never gets its words, and says whose audio is missing.
    expect(turns[2]?.getAttribute("data-state")).toBe("failed");
    expect(turns[2]?.textContent).toContain(
      "Rosalind Chase's audio is missing for 2 minutes and 30 seconds.",
    );
    expect(turns[3]?.textContent).toContain("1:02:03");

    // The document the transcript became, beside the reader, through the file's own route.
    const filedDocument = shown?.querySelector<HTMLAnchorElement>(
      'a[href="/api/v1/files/file_vtt/download"]',
    );
    expect(filedDocument?.textContent?.trim()).toBe("Open Document");
    expect(filedDocument?.getAttribute("target")).toBe("_blank");
    expect(filedDocument?.getAttribute("rel")).toContain("noopener");

    // One page and no more, so nothing offers the rest.
    expect(buttonNamed(shown, "Load more lines")).toBeUndefined();
    // The words never ride an address.
    expect(asked.map((address) => address.pathname)).toEqual([TRANSCRIPT_PATH]);
    expect(asked.some((address) => address.href.includes("Friday"))).toBe(false);
  });

  it("pages on from the cursor the last page answered", async () => {
    serve((cursor) =>
      cursor === null
        ? {
            transcript: header(),
            data: [line({ id: "line_1", ordinal: 0, text: "The first page." })],
            nextCursor: "0",
          }
        : {
            transcript: header(),
            data: [line({ id: "line_2", ordinal: 1, startedMs: 70_000, text: "The second page." })],
            nextCursor: null,
          },
    );
    await draw();
    const more = buttonNamed(panel(), "Load more lines");
    expect(more).toBeDefined();
    expect(panel()?.textContent).not.toContain("The second page.");

    more?.click();
    await settle();
    expect(asked.map((address) => address.searchParams.get("cursor"))).toEqual([null, "0"]);
    const turns = [...(panel()?.querySelectorAll('[role="log"] article') ?? [])];
    expect(turns.map((turn) => turn.textContent?.includes("page."))).toEqual([true, true]);
    expect(turns[1]?.textContent).toContain("The second page.");
    expect(buttonNamed(panel(), "Load more lines")).toBeUndefined();
  });

  it("says a transcript is still being made, with no lines and no document", async () => {
    serve({
      transcript: header({ state: "pending", fileId: null, segmentCount: null, wordCount: null }),
      data: [],
      nextCursor: null,
    });
    await draw();
    const shown = panel();
    expect(shown?.textContent).toContain("Transcript Being Made");
    expect(shown?.querySelector('[role="log"]')).toBeNull();
    expect(shown?.querySelector('a[href*="/api/v1/files/"]')).toBeNull();
    expect(shown?.textContent).not.toContain("No Results");
  });

  it("tells the opener once the transcript it watched being made settles", async () => {
    let state: MeetingTranscriptHeaderView["state"] = "pending";
    serve(() => ({
      transcript: header({ state, fileId: state === "ready" ? "file_vtt" : null }),
      data: state === "ready" ? [line()] : [],
      nextCursor: null,
    }));
    let told = 0;
    await draw(() => (told += 1));
    expect(told).toBe(0);

    state = "ready";
    await queryClient.refetchQueries();
    await settle();
    expect(told).toBe(1);
    expect(panel()?.querySelector('[role="log"]')?.textContent).toContain(
      "We will file the reply by Friday.",
    );

    // Asking again about a transcript that is already ready tells nobody a second time.
    await queryClient.refetchQueries();
    await settle();
    expect(told).toBe(1);
  });

  it("says a transcript could not be made, with the Error ID to quote", async () => {
    serve({
      transcript: header({ state: "failed", fileId: null, failureErrorId: "err_TRANSCRIPT" }),
      data: [],
      nextCursor: null,
    });
    await draw();
    const shown = panel();
    expect(shown?.textContent).toContain("Transcript Could Not Be Made");
    expect(shown?.textContent).toContain("Error ID: err_TRANSCRIPT");
    expect(shown?.querySelector('[role="log"]')).toBeNull();
  });

  it("says why a ready transcript's lines are withheld, and offers no document to open", async () => {
    serve({ transcript: header(), data: [], nextCursor: null, linesWithheld: "held" });
    await draw();
    const shown = panel();
    expect(shown?.textContent).toContain("Transcript Withheld");
    expect(shown?.textContent).toContain("Held");
    expect(shown?.querySelector('[role="log"]')).toBeNull();
    expect(shown?.querySelector('a[href*="/api/v1/files/"]')).toBeNull();
  });

  it("says a ready transcript with no lines has no results, inside its own frame", async () => {
    serve({ transcript: header({ segmentCount: 0 }), data: [], nextCursor: null });
    await draw();
    const record = panel()?.querySelector('[role="log"]');
    expect(record).not.toBeNull();
    expect(record?.textContent).toContain("No Results");
  });

  it("draws the transcript's own shape while it is read, with nothing to press", async () => {
    serve("never");
    await draw();
    const shown = panel();
    expect(shown?.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(shown?.querySelectorAll("article").length).toBeGreaterThan(0);
    expect(shown?.textContent).not.toContain("No Results");
    expect(shown?.querySelector('a[href*="/api/v1/files/"]')).toBeNull();
  });

  it("replaces the transcript with the failure, and the way to try again, when the read failed", async () => {
    serve(404);
    await draw();
    const shown = panel();
    expect(shown?.querySelector('[role="log"]')).toBeNull();
    expect(buttonNamed(shown, "Retry")).toBeDefined();
  });
});
