// @vitest-environment happy-dom
/*
 * What has been recorded in a meeting, as the list says it: what each state and each way of stopping
 * is called, and what a recording that reached the matter offers.
 *
 * WHAT IS PINNED. Every stop reason reads as itself — a start that could not be carried out is not a
 * recording that was interrupted halfway, and it used to say so — and a recording whose recorder went
 * away says it was interrupted and that nothing was added to the matter, never that it ended on its
 * own. A recording on the matter is opened as the DOCUMENT, through the file's own route, rather than
 * through a player of the list's own, and only once the scan has let the version it added through and
 * that version is still the file's current one: a version being checked, held, replaced or gone says
 * so instead. One being put together says so; one that failed states its Error ID. A recording on
 * the matter says where its transcript stands in a column of its own, and pressing it opens the
 * transcript over the list without reaching the row's own gesture. Where the transcript has a
 * summary, a Summary column says where it stands on the same terms and opens the summary panel over
 * the list, offering Re-run there only to a member who holds the key to host. And the list keeps the
 * house's structured emptiness: the table stands while it loads and while it holds nothing, saying "No
 * Results" inside its own frame, and only a failed read replaces it.
 *
 * The first half is the pure wording; the second mounts the panel over a canned server.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import { sessionPermissions } from "../src/lib/access/session-permissions.svelte.ts";
import {
  RECORDING_DOCUMENT_WORDS,
  RECORDING_STATE_WORDS,
  recordingDocumentAddress,
  recordingDocumentText,
  recordingErrorId,
  recordingStateWord,
  recordingIncompleteNote,
  recordingStopText,
  recordingStopWord,
  recordingSummaryOpens,
  recordingSummaryText,
  recordingTranscriptOpens,
  recordingTranscriptText,
} from "../src/lib/meetings/screen/recording-list.ts";
import type {
  MeetingRecordingDocumentView,
  MeetingRecordingListView,
  MeetingRecordingView,
} from "../src/lib/meetings/meetings-api.ts";
import Harness from "./meeting-recording-list-harness.svelte";

const ORIGIN = "https://app.example";
const MEETING_ID = "meeting_1";

function recording(overrides: Partial<MeetingRecordingListView> = {}): MeetingRecordingListView {
  return {
    id: "meetingRecording_1",
    meetingId: MEETING_ID,
    state: "composing",
    startedBy: { userId: "usr_2", displayName: "Rosalind Chase" },
    startedAt: "2026-09-20T15:00:00.000Z",
    stoppedBy: { userId: "usr_2", displayName: "Rosalind Chase" },
    stoppedAt: "2026-09-20T15:30:00.000Z",
    stopReason: "member",
    trackCount: 3,
    capturedSeconds: 1800,
    fileId: null,
    transcriptId: null,
    summaryState: null,
    failureErrorId: null,
    document: null,
    transcript: null,
    summary: null,
    ...overrides,
  };
}

/** A recording on the matter whose document stands where it is said to. */
function onTheMatter(
  state: MeetingRecordingDocumentView["state"],
  overrides: Partial<MeetingRecordingListView> = {},
): MeetingRecordingListView {
  return recording({
    state: "filed",
    fileId: "file_9",
    document: { versionId: "fileVersion_9", state },
    ...overrides,
  });
}

describe("what a recording's state is called", () => {
  it("names every state in plain words, and never says a recording was filed", () => {
    expect(recordingStateWord({ state: "recording" })).toBe("Recording");
    expect(recordingStateWord({ state: "composing" })).toBe("Being Put Together");
    expect(recordingStateWord({ state: "filed" })).toBe("Added to the Matter");
    expect(recordingStateWord({ state: "failed" })).toBe("Failed");
    expect(recordingStateWord({ state: "abandoned" })).toBe("Interrupted");
    for (const word of Object.values(RECORDING_STATE_WORDS)) {
      expect(word.toLowerCase()).not.toContain("filed");
    }
  });
});

describe("a filed recording missing somebody's audio", () => {
  it("says so beside how it stopped, with the Error ID", () => {
    const incomplete = onTheMatter("available", { failureErrorId: "err_track" });
    expect(recordingIncompleteNote(incomplete)).toBe(
      "Somebody's audio could not be included. Error ID: err_track",
    );
    expect(recordingStopText(incomplete)).toBe(
      "Stopped by Rosalind Chase. Somebody's audio could not be included. Error ID: err_track",
    );
    // The document still opens: everybody else's audio is in it.
    expect(recordingDocumentText(incomplete)).toBe("Open");
  });

  it("says nothing more for a whole recording, or one not yet filed", () => {
    expect(recordingIncompleteNote(onTheMatter("available"))).toBeNull();
    expect(recordingIncompleteNote(recording({ failureErrorId: "err_retry" }))).toBeNull();
    expect(recordingStopText(onTheMatter("available"))).toBe("Stopped by Rosalind Chase");
  });
});

describe("how a recording stopped", () => {
  it("gives every reason its own words", () => {
    const nobody = { state: "composing" as const, stoppedBy: null };
    expect(recordingStopWord({ ...nobody, stopReason: null })).toBe("");
    expect(
      recordingStopWord({
        state: "composing",
        stopReason: "member",
        stoppedBy: { userId: "usr_2", displayName: "Rosalind Chase" },
      }),
    ).toBe("Stopped by Rosalind Chase");
    expect(
      recordingStopWord({
        state: "composing",
        stopReason: "host",
        stoppedBy: { userId: "usr_3", displayName: "Omar Haddad" },
      }),
    ).toBe("Stopped by Omar Haddad");
    expect(recordingStopWord({ ...nobody, stopReason: "meeting-ended" })).toBe("The meeting ended");
    expect(recordingStopWord({ ...nobody, stopReason: "sink-lost" })).toBe("The sound was lost");
    expect(recordingStopWord({ ...nobody, stopReason: "ceiling" })).toBe(
      "It reached the longest a recording may run",
    );
    // The recorder stopped a silent room itself, and the recording went on to the matter.
    expect(recordingStopWord({ ...nobody, stopReason: "abandoned" })).toBe(
      "It stopped when nobody had been heard for a while",
    );
    expect(recordingStopWord({ ...nobody, stopReason: "start-failed" })).toBe("It could not start");
  });

  it("no longer calls a start that failed an interruption, nor reads two machine reasons alike", () => {
    const words = new Set(
      (["meeting-ended", "sink-lost", "ceiling", "abandoned", "start-failed"] as const).map(
        (stopReason) => recordingStopWord({ state: "composing", stopReason, stoppedBy: null }),
      ),
    );
    // Five reasons nobody pressed, five sentences.
    expect(words.size).toBe(5);
    expect(words.has("Interrupted")).toBe(false);
    // A person's stop names the person; one the record names nobody for still says somebody did it.
    expect(recordingStopWord({ state: "composing", stopReason: "member", stoppedBy: null })).toBe(
      "Stopped from the meeting",
    );
  });

  it("says a recording whose recorder went away was interrupted and nothing reached the matter", () => {
    const word = recordingStopWord({
      state: "abandoned",
      stopReason: "abandoned",
      stoppedBy: null,
    });
    expect(word).toBe("It was interrupted, and nothing was added to the matter");
    // Never that it finished by itself, nor that anything of it was saved somewhere.
    expect(word.toLowerCase()).not.toContain("on its own");
    expect(word.toLowerCase()).not.toContain("gathered");
    expect(word.toLowerCase()).not.toContain("filed");
    expect(recordingDocumentText(recording({ state: "abandoned", stopReason: "abandoned" }))).toBe(
      "",
    );
  });
});

describe("what a recording became", () => {
  it("is the document on the matter, opened through the file's own route once it is available", () => {
    expect(recordingDocumentAddress(onTheMatter("available"))).toBe(
      "/api/v1/files/file_9/download",
    );
    expect(recordingDocumentText(onTheMatter("available"))).toBe("Open");
    expect(recordingDocumentAddress(recording({ state: "composing" }))).toBeNull();
    // The recording says it reached the matter, but nothing says where its document stands.
    expect(recordingDocumentAddress(recording({ state: "filed", fileId: "file_9" }))).toBeNull();
  });

  it("offers nothing to open while the version is checked, held, replaced or gone, and says which", () => {
    expect(recordingDocumentAddress(onTheMatter("pending"))).toBeNull();
    expect(recordingDocumentText(onTheMatter("pending"))).toBe("Being Checked");
    expect(recordingDocumentAddress(onTheMatter("held"))).toBeNull();
    expect(recordingDocumentText(onTheMatter("held"))).toBe("Held");
    // A later version is what the file's route would serve, which is not this recording.
    expect(recordingDocumentAddress(onTheMatter("replaced"))).toBeNull();
    expect(recordingDocumentText(onTheMatter("replaced"))).toBe("Replaced by a Later Version");
    expect(recordingDocumentText(onTheMatter("removed"))).toBe("Removed from the Matter");
    expect(recordingDocumentText(onTheMatter("unavailable"))).toBe("Not Available");
    for (const word of Object.values(RECORDING_DOCUMENT_WORDS)) {
      expect(word.toLowerCase()).not.toContain("filed");
      expect(word).not.toBe("Open");
    }
  });

  it("states a failed recording's Error ID, and no other recording's", () => {
    expect(recordingErrorId(recording({ state: "failed", failureErrorId: "err_ABC123" }))).toBe(
      "err_ABC123",
    );
    expect(recordingErrorId(recording({ state: "failed", failureErrorId: null }))).toBeNull();
    // An attempt still being put together may carry the Error ID of a try that will run again.
    expect(
      recordingErrorId(recording({ state: "composing", failureErrorId: "err_ABC123" })),
    ).toBeNull();
  });
});

describe("where a recording's transcript stands", () => {
  it("says nothing before the recording reaches the matter, and offers nothing to open", () => {
    expect(recordingTranscriptText(recording())).toBe("");
    expect(recordingTranscriptOpens(recording())).toBe(false);
  });

  it("names each state in the column, and offers the transcript wherever there is one", () => {
    const being = onTheMatter("available", {
      transcript: { id: "meetingTranscript_1", state: "pending", fileId: null },
    });
    const ready = onTheMatter("available", {
      transcript: { id: "meetingTranscript_1", state: "ready", fileId: "file_vtt" },
    });
    const failed = onTheMatter("available", {
      transcript: { id: "meetingTranscript_1", state: "failed", fileId: null },
    });
    expect(recordingTranscriptText(being)).toBe("Being Made");
    expect(recordingTranscriptText(ready)).toBe("Read");
    expect(recordingTranscriptText(failed)).toBe("Could Not Be Made");
    for (const row of [being, ready, failed]) expect(recordingTranscriptOpens(row)).toBe(true);
  });

  it("states a failed transcript's Error ID wherever the row carries one", () => {
    const failed = onTheMatter("available", {
      transcript: {
        id: "meetingTranscript_1",
        state: "failed",
        fileId: null,
        failureErrorId: "err_T1",
      } as MeetingRecordingListView["transcript"],
    });
    expect(recordingTranscriptText(failed)).toBe("Could Not Be Made. Error ID: err_T1");
  });
});

describe("where a recording's summary stands", () => {
  it("says nothing before the transcript has a summary, and offers nothing to open", () => {
    expect(recordingSummaryText(recording())).toBe("");
    expect(recordingSummaryOpens(recording())).toBe(false);
  });

  it("names each state in the column, and offers the summary wherever there is one", () => {
    const states = [
      { state: "pending", refusalReason: null, word: "Being Written" },
      { state: "ready", refusalReason: null, word: "Read" },
      { state: "failed", refusalReason: null, word: "Could Not Be Written" },
      { state: "refused", refusalReason: "not-eligible", word: "Not Written" },
    ] as const;
    for (const { state, refusalReason, word } of states) {
      const row = onTheMatter("available", {
        summary: { id: "meetingSummary_1", state, refusalReason },
      });
      expect(recordingSummaryText(row)).toBe(word);
      expect(recordingSummaryOpens(row)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The panel, over a canned server.
// ---------------------------------------------------------------------------------------------

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let reads = 0;
let transcriptReads = 0;
let summaryReads = 0;

/** What the summary read answers in these cases: a ready summary with one action item. */
const SUMMARY_ANSWER = {
  summary: {
    id: "meetingSummary_1",
    transcriptId: "meetingTranscript_1",
    recordingId: "meetingRecording_1",
    state: "ready",
    refusalReason: null,
    failureErrorId: null,
    modelId: "@cf/openai/gpt-oss-120b",
    createdAt: "2026-09-20T15:41:00.000Z",
    updatedAt: "2026-09-20T15:43:00.000Z",
  },
  text: "The team agreed who sends the exhibits.",
  actionItems: [
    {
      id: "meetingSummaryActionItem_1",
      ordinal: 0,
      text: "Send the exhibits.",
      owner: { userId: "usr_2", displayName: "Rosalind Chase" },
      dueOn: null,
      taskId: null,
    },
  ],
  withheld: null,
};

/** What the transcript read answers in these cases: a ready transcript of one line. */
const TRANSCRIPT_ANSWER = {
  transcript: {
    id: "meetingTranscript_1",
    recordingId: "meetingRecording_1",
    state: "ready",
    language: "en",
    segmentCount: 1,
    wordCount: 6,
    fileId: "file_vtt",
    failureErrorId: null,
    createdAt: "2026-09-20T15:31:00.000Z",
    updatedAt: "2026-09-20T15:40:00.000Z",
  },
  data: [
    {
      id: "meetingTranscriptSegment_1",
      ordinal: 0,
      kind: "speech",
      startedMs: 5_000,
      endedMs: 9_000,
      text: "We will file the reply by Friday.",
      speaker: {
        participantKind: "member",
        participantId: "meetingAttendance_1",
        userId: "usr_2",
        displayName: "Rosalind Chase",
      },
    },
  ],
  nextCursor: null,
};

/** Answer the list with a page, a failure, or nothing at all; the transcript read with one line. */
function serve(answer: "never" | number | readonly MeetingRecordingView[]): void {
  const stub = ((request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/summary")) {
      summaryReads += 1;
      return Promise.resolve(
        new Response(JSON.stringify(SUMMARY_ANSWER), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (path === `/api/v1/meetings/${MEETING_ID}`) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: MEETING_ID, matterId: "matter_7" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (path.endsWith("/transcript")) {
      transcriptReads += 1;
      return Promise.resolve(
        new Response(JSON.stringify(TRANSCRIPT_ANSWER), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (path === `/api/v1/meetings/${MEETING_ID}/recordings`) reads += 1;
    if (answer === "never") return new Promise<Response>(() => {});
    if (typeof answer === "number") {
      return Promise.resolve(
        new Response(JSON.stringify({ title: "Internal Server Error", status: answer }), {
          status: answer,
          headers: { "content-type": "application/problem+json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ data: answer, nextCursor: null }), {
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

async function draw(
  onWhoWasTold?: (row: MeetingRecordingView) => void,
): Promise<Record<string, unknown>> {
  instance = mount(Harness, { target, props: { meetingId: MEETING_ID, onWhoWasTold } });
  flushSync();
  await settle();
  return instance;
}

/** The open panel, which the dialog draws outside the harness's own element. */
function panel(): Element | undefined {
  return [...document.body.querySelectorAll('[role="dialog"]')].find((candidate) =>
    candidate.textContent?.includes("Recordings"),
  );
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  reads = 0;
  transcriptReads = 0;
  summaryReads = 0;
  queryClient.clear();
  holdPermissions([]);
});

/** The session the list reads who may host from, holding exactly these permissions. */
function holdPermissions(permissions: readonly string[]): void {
  sessionPermissions.session = {
    user: { id: "usr_2", name: "Rosalind Chase", email: "rosalind@example.com" },
    firm: { id: "firm_1", name: "Chase and Partners" },
    permissions,
    channel: "stable",
    flags: {},
  };
  sessionPermissions.settled = true;
}

// The dialog's scroll lock is released on a 24 ms timer after the dialog closes. Waiting past it here
// lets that timer run while the document still exists; left pending, it fires after the file's
// environment is torn down and reports an error against whichever file runs last.
const SCROLL_LOCK_RELEASE_MILLISECONDS = 50;

afterEach(async () => {
  if (instance !== undefined) await unmount(instance);
  instance = undefined;
  await new Promise((resolve) => setTimeout(resolve, SCROLL_LOCK_RELEASE_MILLISECONDS));
  target.remove();
  sessionPermissions.session = null;
  sessionPermissions.settled = false;
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("the recordings panel", () => {
  it("opens a recording on the matter as the document, says the rest plainly, and offers no player", async () => {
    serve([
      onTheMatter("available", {
        id: "meetingRecording_4",
        startedAt: "2026-09-20T18:00:00.000Z",
      }),
      recording({ id: "meetingRecording_3", state: "composing" }),
      recording({
        id: "meetingRecording_2",
        state: "failed",
        stopReason: "sink-lost",
        stoppedBy: null,
        failureErrorId: "err_ABC123",
      }),
      recording({
        id: "meetingRecording_1",
        state: "failed",
        stopReason: "start-failed",
        stoppedBy: null,
        stoppedAt: "2026-09-20T15:00:01.000Z",
      }),
    ]);
    await draw();
    const shown = panel();
    const text = shown?.textContent ?? "";

    const opened = shown?.querySelector<HTMLAnchorElement>(
      'a[href="/api/v1/files/file_9/download"]',
    );
    expect(opened).not.toBeNull();
    expect(opened?.textContent?.trim()).toBe("Open");
    // Beside the reader's work, and without handing the opener to the page it opens.
    expect(opened?.getAttribute("target")).toBe("_blank");
    expect(opened?.getAttribute("rel")).toContain("noopener");

    expect(text).toContain("Added to the Matter");
    expect(text).toContain("Being Put Together");
    expect(text).toContain("Error ID: err_ABC123");
    expect(text).toContain("The sound was lost");
    expect(text).toContain("It could not start");
    expect(text).not.toContain("Interrupted");
    // The placeholder that stood here until a recording could be opened is gone.
    expect(text).not.toContain("Play");
    expect(text).not.toContain("Soon");
  });

  it("shows a version still being checked, and a held one, without anything to open", async () => {
    serve([
      onTheMatter("pending", { id: "meetingRecording_2", fileId: "file_8" }),
      onTheMatter("held", { id: "meetingRecording_1", fileId: "file_7" }),
    ]);
    await draw();
    const shown = panel();
    const text = shown?.textContent ?? "";
    expect(text).toContain("Being Checked");
    expect(text).toContain("Held");
    expect(shown?.querySelector('a[href*="/api/v1/files/"]')).toBeNull();
    expect(text).not.toContain("Open");
  });

  it("says a meeting with nothing recorded has no results, inside the table", async () => {
    serve([]);
    await draw();
    const shown = panel();
    expect(shown?.querySelector("table")).not.toBeNull();
    expect(shown?.textContent).toContain("No Results");
  });

  it("stands the table while the list is read, with placeholder rows and no words", async () => {
    serve("never");
    await draw();
    const shown = panel();
    expect(shown?.querySelector("table")).not.toBeNull();
    expect(shown?.querySelectorAll('[data-placeholder="true"]').length).toBeGreaterThan(0);
    expect(shown?.textContent).not.toContain("No Results");
  });

  it("replaces the table with the failure, and the way to try again, when the read failed", async () => {
    serve(500);
    await draw();
    const shown = panel();
    expect(shown?.querySelector("table")).toBeNull();
    expect(
      [...(shown?.querySelectorAll("button") ?? [])].some(
        (control) => control.textContent?.trim() === "Retry",
      ),
    ).toBe(true);
  });

  it("reads again when the room announces a transition while it is open", async () => {
    serve([recording({ state: "recording", stopReason: null, stoppedAt: null, stoppedBy: null })]);
    const drawn = await draw();
    expect(reads).toBe(1);

    (drawn as unknown as { announce: () => void }).announce();
    await settle();
    expect(reads).toBe(2);
  });

  it("opens who was told from a row's own gesture, where the screen offers it", async () => {
    serve([recording()]);
    const asked: string[] = [];
    await draw((row) => asked.push(row.id));
    const row = panel()?.querySelector("tbody tr:not([data-placeholder])");
    row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    flushSync();
    expect(asked).toEqual(["meetingRecording_1"]);
  });

  it("says where each transcript stands, and opens a ready one over the list without the row's gesture", async () => {
    serve([
      onTheMatter("available", {
        id: "meetingRecording_1",
        transcript: { id: "meetingTranscript_1", state: "ready", fileId: "file_vtt" },
      }),
      onTheMatter("available", {
        id: "meetingRecording_2",
        startedAt: "2026-09-20T17:00:00.000Z",
        transcript: { id: "meetingTranscript_2", state: "pending", fileId: null },
      }),
      onTheMatter("available", {
        id: "meetingRecording_3",
        startedAt: "2026-09-20T16:00:00.000Z",
        transcript: { id: "meetingTranscript_3", state: "failed", fileId: null },
      }),
    ]);
    const whoWasTold: string[] = [];
    await draw((row) => whoWasTold.push(row.id));
    const shown = panel();
    const controls = [...(shown?.querySelectorAll("button") ?? [])];
    const named = (name: string) =>
      controls.find((control) => control.textContent?.trim() === name);
    expect(named("Being Made")).toBeDefined();
    expect(named("Could Not Be Made")).toBeDefined();
    const read = named("Read");
    expect(read).toBeDefined();
    expect(transcriptReads).toBe(0);

    read?.click();
    read?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    // Read, and for this recording. Not counted exactly: the cache's observer resubscribes when the
    // panel's key and its opening change together, which aborts the first request and sends it again.
    expect(transcriptReads).toBeGreaterThan(0);
    // The press is the transcript's, never the row's.
    expect(whoWasTold).toEqual([]);
    const transcript = [...document.body.querySelectorAll('[role="dialog"]')].find((candidate) =>
      candidate.querySelector('[role="log"]'),
    );
    expect(transcript?.textContent).toContain("Transcript");
    expect(transcript?.textContent).toContain("Rosalind Chase");
    expect(transcript?.textContent).toContain("We will file the reply by Friday.");
  });

  it("says where each summary stands, and opens a ready one over the list without the row's gesture", async () => {
    serve([
      onTheMatter("available", {
        id: "meetingRecording_1",
        transcript: { id: "meetingTranscript_1", state: "ready", fileId: "file_vtt" },
        summary: { id: "meetingSummary_1", state: "ready", refusalReason: null },
      }),
      onTheMatter("available", {
        id: "meetingRecording_2",
        startedAt: "2026-09-20T17:00:00.000Z",
        transcript: { id: "meetingTranscript_2", state: "ready", fileId: "file_vtt_2" },
        summary: { id: "meetingSummary_2", state: "refused", refusalReason: "disabled" },
      }),
    ]);
    const whoWasTold: string[] = [];
    await draw((row) => whoWasTold.push(row.id));
    const controls = [...(panel()?.querySelectorAll("button") ?? [])];
    const named = (name: string) =>
      controls.find((control) => control.textContent?.trim() === name);
    expect(named("Not Written")).toBeDefined();
    const read = controls.find((control) =>
      control.getAttribute("aria-label")?.startsWith("Read: the summary"),
    );
    expect(read).toBeDefined();
    expect(summaryReads).toBe(0);

    read?.click();
    read?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    expect(summaryReads).toBeGreaterThan(0);
    // The press is the summary's, never the row's.
    expect(whoWasTold).toEqual([]);
    const summary = [...document.body.querySelectorAll('[role="dialog"]')].find((candidate) =>
      candidate.textContent?.includes("Action Items"),
    );
    expect(summary?.textContent).toContain("The team agreed who sends the exhibits.");
    expect(summary?.textContent).toContain("Send the exhibits.");
    // A member who does not hold the key to host is not offered a second run.
    expect(
      [...(summary?.querySelectorAll("button") ?? [])].some(
        (control) => control.textContent?.trim() === "Re-run",
      ),
    ).toBe(false);
  });

  it("offers a second run of the summary to a member who holds the key to host", async () => {
    holdPermissions(["meetings:join", "meetings:host"]);
    serve([
      onTheMatter("available", {
        transcript: { id: "meetingTranscript_1", state: "ready", fileId: "file_vtt" },
        summary: { id: "meetingSummary_1", state: "ready", refusalReason: null },
      }),
    ]);
    await draw();
    const read = [...(panel()?.querySelectorAll("button") ?? [])].find((control) =>
      control.getAttribute("aria-label")?.startsWith("Read: the summary"),
    );
    read?.click();
    await settle();
    const summary = [...document.body.querySelectorAll('[role="dialog"]')].find((candidate) =>
      candidate.textContent?.includes("Action Items"),
    );
    expect(
      [...(summary?.querySelectorAll("button") ?? [])].some(
        (control) => control.textContent?.trim() === "Re-run",
      ),
    ).toBe(true);
  });
});
