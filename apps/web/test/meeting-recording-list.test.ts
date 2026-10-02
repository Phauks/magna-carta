// @vitest-environment happy-dom
/*
 * What has been recorded in a meeting, as the list says it: what each state and each way of stopping
 * is called, and what a recording that reached the matter offers.
 *
 * WHAT IS PINNED. Every stop reason reads as itself — a start that could not be carried out is not a
 * recording that was interrupted halfway, and it used to say so. A recording on the matter is opened
 * as the DOCUMENT, through the file's own route, rather than through a player of the list's own; one
 * being put together says so; one that failed states its Error ID. And the list keeps the house's
 * structured emptiness: the table stands while it loads and while it holds nothing, saying "No
 * Results" inside its own frame, and only a failed read replaces it.
 *
 * The first half is the pure wording; the second mounts the panel over a canned server.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { queryClient } from "../src/lib/api/screen-data.ts";
import {
  RECORDING_STATE_WORDS,
  recordingDocumentAddress,
  recordingErrorId,
  recordingStateWord,
  recordingStopWord,
} from "../src/lib/meetings/screen/recording-list.ts";
import type { MeetingRecordingView } from "../src/lib/meetings/meetings-api.ts";
import Harness from "./meeting-recording-list-harness.svelte";

const ORIGIN = "https://app.example";
const MEETING_ID = "meeting_1";

function recording(overrides: Partial<MeetingRecordingView> = {}): MeetingRecordingView {
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
    ...overrides,
  };
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

describe("how a recording stopped", () => {
  it("gives every reason its own words", () => {
    const nobody = { stoppedBy: null };
    expect(recordingStopWord({ ...nobody, stopReason: null })).toBe("");
    expect(
      recordingStopWord({
        stopReason: "member",
        stoppedBy: { userId: "usr_2", displayName: "Rosalind Chase" },
      }),
    ).toBe("Stopped by Rosalind Chase");
    expect(
      recordingStopWord({
        stopReason: "host",
        stoppedBy: { userId: "usr_3", displayName: "Omar Haddad" },
      }),
    ).toBe("Stopped by Omar Haddad");
    expect(recordingStopWord({ ...nobody, stopReason: "meeting-ended" })).toBe("The meeting ended");
    expect(recordingStopWord({ ...nobody, stopReason: "sink-lost" })).toBe("The sound was lost");
    expect(recordingStopWord({ ...nobody, stopReason: "ceiling" })).toBe(
      "It reached the longest a recording may run",
    );
    expect(recordingStopWord({ ...nobody, stopReason: "abandoned" })).toBe("It ended on its own");
    expect(recordingStopWord({ ...nobody, stopReason: "start-failed" })).toBe("It could not start");
  });

  it("no longer calls a start that failed an interruption, nor reads two machine reasons alike", () => {
    const words = new Set(
      (["meeting-ended", "sink-lost", "ceiling", "abandoned", "start-failed"] as const).map(
        (stopReason) => recordingStopWord({ stopReason, stoppedBy: null }),
      ),
    );
    // Five reasons nobody pressed, five sentences.
    expect(words.size).toBe(5);
    expect(words.has("Interrupted")).toBe(false);
    // A person's stop names the person; one the record names nobody for still says somebody did it.
    expect(recordingStopWord({ stopReason: "member", stoppedBy: null })).toBe(
      "Stopped from the meeting",
    );
  });
});

describe("what a recording became", () => {
  it("is the document on the matter, opened through the file's own route", () => {
    expect(recordingDocumentAddress(recording({ state: "filed", fileId: "file_9" }))).toBe(
      "/api/v1/files/file_9/download",
    );
    expect(recordingDocumentAddress(recording({ state: "composing" }))).toBeNull();
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

// ---------------------------------------------------------------------------------------------
// The panel, over a canned server.
// ---------------------------------------------------------------------------------------------

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let reads = 0;

/** Answer the list with a page, a failure, or nothing at all. */
function serve(answer: "never" | number | readonly MeetingRecordingView[]): void {
  const stub = ((request: Request) => {
    const path = new URL(request.url).pathname;
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
  queryClient.clear();
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("the recordings panel", () => {
  it("opens a recording on the matter as the document, says the rest plainly, and offers no player", async () => {
    serve([
      recording({
        id: "meetingRecording_4",
        state: "filed",
        fileId: "file_9",
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
});
