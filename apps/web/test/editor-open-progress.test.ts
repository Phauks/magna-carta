import { describe, expect, it } from "vitest";
import {
  currentStage,
  freshMarks,
  marked,
  OPEN_PROGRESS_POLL_MILLISECONDS,
  OPEN_STAGES,
  openFeed,
  openPace,
  openRows,
  openSteps,
  openTrace,
  refusal,
  RETRY_AFTER_MILLISECONDS,
  RUNNING_LONG_SENTENCE,
  stageDone,
  stalledSentence,
  stoppedLabel,
  TYPICAL_OPEN_MILLISECONDS,
  USUAL_TIME_SENTENCE,
  type OpenMarks,
  type OpenStage,
} from "../src/lib/documents/editor-open-progress.ts";

const STARTED_AT = new Date("2026-09-17T14:00:00.000Z");

const at = (seconds: number): Date => new Date(STARTED_AT.getTime() + seconds * 1000);

/** Marks with every stage up to and including `through` reached, at a plausible second each. */
function reached(through: OpenStage | null): OpenMarks {
  let marks = freshMarks(STARTED_AT);
  if (through === null) return marks;
  const seconds: Record<OpenStage, number> = {
    session: 0.4,
    editor: 28.1,
    frame: 29.6,
    information: 30.2,
    bytes: 31,
    shown: 33.5,
  };
  for (const stage of OPEN_STAGES) {
    marks = marked(marks, stage.id, at(seconds[stage.id]));
    if (stage.id === through) break;
  }
  return marks;
}

const answered = (
  marks: OpenMarks,
  operation: string,
  status: number,
  errorId: string | null = null,
): OpenMarks => ({
  ...marks,
  lastCallback: { operation, status, errorId, at: at(31).toISOString() },
});

describe("the stages", () => {
  it("run in the order an open happens", () => {
    expect(OPEN_STAGES.map((stage) => stage.id)).toEqual([
      "session",
      "editor",
      "frame",
      "information",
      "bytes",
      "shown",
    ]);
  });

  it("start on the session, and move to the first stage without a mark", () => {
    expect(currentStage(freshMarks(STARTED_AT))).toBe("session");
    expect(currentStage(reached("session"))).toBe("editor");
    expect(currentStage(reached("frame"))).toBe("information");
    expect(currentStage(reached("shown"))).toBe("done");
  });

  it("treat a later mark as proof of every earlier one, since the poll can lag the frame", () => {
    // The frame said the document is on screen before the poll ever reported the host's callbacks:
    // the whole chain ran, whatever the record has caught up on.
    const marks = marked(freshMarks(STARTED_AT), "shown", at(33.5));
    expect(currentStage(marks)).toBe("done");
    for (const stage of OPEN_STAGES) expect(stageDone(marks, stage.id)).toBe(true);

    const frameOnly = marked(marked(freshMarks(STARTED_AT), "session", at(0.4)), "frame", at(29.6));
    expect(stageDone(frameOnly, "editor")).toBe(true);
    expect(currentStage(frameOnly)).toBe("information");
  });

  it("never move a mark that is already set", () => {
    const marks = marked(reached("session"), "session", at(9));
    expect(marks.sessionAt).toEqual(at(0.4));
  });

  it("read the host's record on a cadence measured in seconds, not in requests", () => {
    expect(OPEN_PROGRESS_POLL_MILLISECONDS).toBeGreaterThanOrEqual(1000);
    expect(OPEN_PROGRESS_POLL_MILLISECONDS).toBeLessThanOrEqual(5000);
  });
});

describe("refusal", () => {
  it("is the host refusing the editor's request for the document's bytes", () => {
    const marks = answered(reached("information"), "wopi:get-file", 404, "error_01J8Q4R7ZK3T");
    expect(refusal(marks)).toEqual({ stage: "bytes", status: 404, errorId: "error_01J8Q4R7ZK3T" });
  });

  it("is the host refusing the editor's request for the document's information", () => {
    const marks = answered(reached("frame"), "wopi:check-file-info", 403);
    expect(refusal(marks)).toEqual({ stage: "information", status: 403, errorId: null });
  });

  it("is not a lock answer: a 409 on the lock is a co-editor, not a refusal of the open", () => {
    expect(refusal(answered(reached("bytes"), "wopi:lock", 409))).toBeNull();
    expect(refusal(answered(reached("bytes"), "wopi:put-file", 500))).toBeNull();
  });

  it("is not a callback that succeeded, and not one for a stage already behind us", () => {
    expect(refusal(answered(reached("information"), "wopi:get-file", 200))).toBeNull();
    // The record says GetFile was refused once, but the bytes have since been fetched.
    expect(refusal(answered(reached("bytes"), "wopi:get-file", 404))).toBeNull();
    expect(refusal(freshMarks(STARTED_AT))).toBeNull();
  });
});

describe("openSteps", () => {
  it("marks the stages behind us done, the current one active and the rest pending", () => {
    expect(openSteps(reached("frame"), null).map((step) => step.status)).toEqual([
      "done",
      "done",
      "done",
      "active",
      "pending",
      "pending",
    ]);
  });

  it("carries each stage's own words", () => {
    expect(openSteps(freshMarks(STARTED_AT), null).map((step) => step.label)).toEqual([
      "Opening an editing session",
      "Starting the editor",
      "Loading the editor",
      "Asking the host about the document",
      "Fetching the document",
      "Showing the document",
    ]);
  });

  it("replaces the failed stage's label with the sentence, and leaves nothing active", () => {
    const marks = reached("frame");
    const sentence = stalledSentence("information", marks);
    const steps = openSteps(marks, "information", sentence);
    expect(steps.map((step) => step.status)).toEqual([
      "done",
      "done",
      "done",
      "failed",
      "pending",
      "pending",
    ]);
    expect(steps[3]).toEqual({
      label: "Asking the host about the document",
      status: "failed",
      failure: "The editor came up but never asked the host about the document.",
    });
    expect(steps.some((step) => step.status === "active")).toBe(false);
  });

  it("shows every stage done once the document is on screen", () => {
    expect(openSteps(reached("shown"), null).every((step) => step.status === "done")).toBe(true);
  });
});

describe("stalledSentence", () => {
  it("names what stopped, at every stage", () => {
    const marks = freshMarks(STARTED_AT);
    expect(stalledSentence("session", marks)).toBe("The editing session did not open.");
    expect(stalledSentence("editor", marks)).toBe(
      "The editor did not answer. It may still be starting, or it could not be reached.",
    );
    expect(stalledSentence("frame", marks)).toBe(
      "The editor page arrived but never reported itself ready.",
    );
    expect(stalledSentence("information", marks)).toBe(
      "The editor came up but never asked the host about the document.",
    );
    expect(stalledSentence("bytes", marks)).toBe(
      "The host described the document, but the editor never asked for its contents.",
    );
    expect(stalledSentence("shown", marks)).toBe(
      "The document was sent to the editor, but the editor never showed it.",
    );
  });

  it("states the host's refusal, with the real status, where there is one", () => {
    expect(stalledSentence("bytes", answered(reached("information"), "wopi:get-file", 404))).toBe(
      "The host refused the editor's request for the document's contents (answered 404).",
    );
    expect(
      stalledSentence("information", answered(reached("frame"), "wopi:check-file-info", 500)),
    ).toBe("The host refused the editor's request for the document's information (answered 500).");
  });

  it("does not let a refusal of one stage reword a stall at another", () => {
    const marks = answered(reached("frame"), "wopi:check-file-info", 404);
    expect(stalledSentence("bytes", marks)).toBe(
      "The host described the document, but the editor never asked for its contents.",
    );
  });
});

describe("openRows and openTrace", () => {
  const stalled = reached("frame");
  const stalledAt = at(90);

  it("give the seconds to each mark, how long the stopped stage was waited for, and the rest", () => {
    const rows = openRows(stalled, stalledAt);
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ["Opening an editing session", "0.4 seconds"],
      ["Starting the editor", "28.1 seconds"],
      ["Loading the editor", "29.6 seconds"],
      ["Asking the host about the document", "not reached after 90 seconds"],
      ["Fetching the document", "not reached"],
      ["Showing the document", "not reached"],
      ["Last answer from the host", "none"],
      ["Error ID", "None issued"],
    ]);
    expect(rows.at(-1)?.mono).toBe(true);
  });

  it("quote the host's last answer and its Error ID", () => {
    const rows = openRows(
      answered(reached("information"), "wopi:get-file", 404, "error_01J8Q4R7ZK3T"),
      at(34.9),
    );
    expect(rows.at(-2)).toEqual({
      label: "Last answer from the host",
      value: "wopi:get-file answered 404",
      mono: true,
    });
    expect(rows.at(-1)).toEqual({ label: "Error ID", value: "error_01J8Q4R7ZK3T", mono: true });
  });

  it("carry nothing but stage names, seconds, the operation, the status and the Error ID", () => {
    // The block is written to be pasted into a report, so it must never pick up a document's name,
    // a URL or a token. Every value is checked against the closed vocabulary.
    const allowedValue =
      /^(?:\d+\.\d seconds?|not reached(?: after \d+ seconds?)?|none|None issued|wopi:[a-z-]+ answered \d{3}|error_[A-Za-z0-9]+)$/;
    const allowedLabel = new Set([
      ...OPEN_STAGES.map((stage) => stage.label),
      "Last answer from the host",
      "Error ID",
    ]);
    for (const marks of [
      stalled,
      answered(reached("information"), "wopi:get-file", 404, "error_01J8Q4R7ZK3T"),
      reached("shown"),
      freshMarks(STARTED_AT),
    ]) {
      for (const row of openRows(marks, stalledAt)) {
        expect(allowedLabel.has(row.label)).toBe(true);
        expect(row.value).toMatch(allowedValue);
      }
    }
  });

  it("write the trace as the rows, one line each", () => {
    const trace = openTrace(stalled, stalledAt);
    expect(trace.split("\n")).toEqual(
      openRows(stalled, stalledAt).map((row) => `${row.label}: ${row.value}`),
    );
    expect(trace).toContain("Asking the host about the document: not reached after 90 seconds");
  });
});

describe("openFeed", () => {
  it("streams each finished stage as the line it left, then what is happening now", () => {
    const lines = openFeed(reached("frame"), at(31));
    expect(lines.map((line) => [line.status, line.text, line.at])).toEqual([
      ["done", "Editing session opened.", "0.4 s"],
      ["done", "Editor started.", "28.1 s"],
      ["done", "Editor loaded.", "29.6 s"],
      [
        "active",
        "The editor is asking about the document: its name, its size, who you are.",
        "31 s",
      ],
    ]);
  });

  it("says nothing of the stages still to come, so the feed only ever grows", () => {
    const fresh = openFeed(freshMarks(STARTED_AT), at(2));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ stage: "session", status: "active", at: "2 s" });
    expect(openFeed(reached("shown"), at(34))).toHaveLength(OPEN_STAGES.length);
    expect(openFeed(reached("shown"), at(34)).every((line) => line.status === "done")).toBe(true);
  });

  it("stamps a stage the poll never marked with the later mark that proved it", () => {
    // The frame reported itself before the poll caught up on the editor's load: the editor stage
    // happened no later than the frame's mark, and a line without a time is a line without a fact.
    const frameOnly = marked(marked(freshMarks(STARTED_AT), "session", at(0.4)), "frame", at(29.6));
    const lines = openFeed(frameOnly, at(30));
    expect(lines[1]).toMatchObject({ stage: "editor", status: "done", at: "29.6 s" });
  });

  it("ends on the stopped stage's sentence once the open has been called off", () => {
    const marks = reached("frame");
    const lines = openFeed(marks, at(90), "information", stalledSentence("information", marks));
    expect(lines.at(-1)).toEqual({
      stage: "information",
      status: "failed",
      text: "The editor came up but never asked the host about the document.",
      at: "90 s",
    });
    expect(lines.some((line) => line.status === "active")).toBe(false);
  });
});

describe("openPace", () => {
  it("fills over the usual open and says what the usual time is", () => {
    const pace = openPace(STARTED_AT, at(12));
    expect(pace).toEqual({
      elapsedMilliseconds: 12_000,
      sentence: USUAL_TIME_SENTENCE,
      overdue: false,
    });
    expect(TYPICAL_OPEN_MILLISECONDS).toBe(30_000);
  });

  it("stops at full past the usual time and says the open is running long", () => {
    const pace = openPace(STARTED_AT, at(40));
    expect(pace.elapsedMilliseconds).toBe(TYPICAL_OPEN_MILLISECONDS);
    expect(pace.overdue).toBe(true);
    expect(pace.sentence).toBe(RUNNING_LONG_SENTENCE);
  });

  it("offers Retry only well after the usual open, not at it", () => {
    expect(RETRY_AFTER_MILLISECONDS).toBe(45_000);
    expect(RETRY_AFTER_MILLISECONDS).toBeGreaterThan(TYPICAL_OPEN_MILLISECONDS);
  });
});

describe("the stopped line", () => {
  it("says how long a stopped open ran", () => {
    expect(stoppedLabel(STARTED_AT, at(90))).toBe("Stopped after 90 seconds");
  });
});
