/*
 * THE STAGES OF OPENING A DOCUMENT IN THE BROWSER EDITOR, and the words for each of them — one home,
 * beside the screen that shows them, with nothing in it that needs a DOM.
 *
 * WHY STAGES AND NOT ONE SENTENCE. An open is a chain: the host mints a session, the editor's
 * container starts and serves its page, that page reports itself ready, the editor asks the host
 * what the document is, then for its bytes, then draws it. "Opening this document in the editor"
 * held for ninety seconds names none of those, so a member watching it could not tell a cold start
 * from a refusal, and a stall after the budget said only that the editor did not come up. Naming
 * the stage as it happens costs nothing (the signals already arrive to end the wait) and turns a
 * stall into a finding: the stage it stopped at, how long each earlier one took, and the host's
 * last answer with its Error ID.
 *
 * TWO SOURCES FEED THE MARKS, AND THEY ARRIVE OUT OF ORDER. The frame's own messages and the
 * iframe's load event are immediate; the host's record of the editor's callbacks (CheckFileInfo,
 * GetFile) reaches the screen through a poll, so it can lag the frame's later signals. That is why
 * a later mark implies every earlier one: `document-loaded` proves the whole chain ran, whatever
 * the poll has caught up on.
 *
 * NOT A PROGRESS BAR. The stages are of wildly unequal length (a session is minted in a moment; a
 * cold container takes most of a minute), so a bar drawn at a fraction would claim to know how far
 * along the open is, which is the one thing this screen does not know.
 */
import type { FailureDetailRow } from "@magna-carta/design-system/failure-details";
import type { ProgressStep } from "@magna-carta/design-system/progress-steps";
import type { EditOpenProgress } from "./document-api.ts";

export type OpenStage = "session" | "editor" | "frame" | "information" | "bytes" | "shown";

/** The stages in the order they happen, each with the words the sequence shows while it runs. */
export const OPEN_STAGES: readonly { id: OpenStage; label: string }[] = [
  { id: "session", label: "Opening an editing session" },
  { id: "editor", label: "Starting the editor" },
  { id: "frame", label: "Loading the editor" },
  { id: "information", label: "Asking the host about the document" },
  { id: "bytes", label: "Fetching the document" },
  { id: "shown", label: "Showing the document" },
];

/** When each stage completed, or null while it has not; plus what the host last told the editor. */
export interface OpenMarks {
  readonly startedAt: Date;
  readonly sessionAt: Date | null;
  readonly editorAt: Date | null;
  readonly frameAt: Date | null;
  readonly informationAt: Date | null;
  readonly bytesAt: Date | null;
  readonly shownAt: Date | null;
  readonly lastCallback: EditOpenProgress["lastCallback"];
}

/**
 * How often the host's open record is read while the open is in flight. Frequent enough that a
 * callback stage shows within a breath of happening; sparse enough that a ninety-second wait is a
 * few dozen reads, not a few hundred.
 */
export const OPEN_PROGRESS_POLL_MILLISECONDS = 2500;

/** Marks for an open that has just begun: nothing reached, nothing answered. */
export function freshMarks(startedAt: Date = new Date()): OpenMarks {
  return {
    startedAt,
    sessionAt: null,
    editorAt: null,
    frameAt: null,
    informationAt: null,
    bytesAt: null,
    shownAt: null,
    lastCallback: null,
  };
}

const MARK_KEY: Record<OpenStage, keyof OpenMarks> = {
  session: "sessionAt",
  editor: "editorAt",
  frame: "frameAt",
  information: "informationAt",
  bytes: "bytesAt",
  shown: "shownAt",
};

function markOf(marks: OpenMarks, stage: OpenStage): Date | null {
  const value = marks[MARK_KEY[stage]];
  return value instanceof Date ? value : null;
}

/** The same marks with one stage's completion recorded. A mark already set is never moved. */
export function marked(marks: OpenMarks, stage: OpenStage, at: Date): OpenMarks {
  if (markOf(marks, stage) !== null) return marks;
  return { ...marks, [MARK_KEY[stage]]: at };
}

/**
 * Whether a stage is behind us. Its own mark says so, and so does any later stage's: the chain
 * cannot reach a later stage without passing this one, whatever the poll has reported so far.
 */
export function stageDone(marks: OpenMarks, stage: OpenStage): boolean {
  const from = OPEN_STAGES.findIndex((candidate) => candidate.id === stage);
  return OPEN_STAGES.slice(from).some((candidate) => markOf(marks, candidate.id) !== null);
}

/** The stage the open is on: the first one not behind us, or "done" once the document is shown. */
export function currentStage(marks: OpenMarks): OpenStage | "done" {
  const next = OPEN_STAGES.find((stage) => !stageDone(marks, stage.id));
  return next === undefined ? "done" : next.id;
}

/** The host's callbacks that decide whether a document opens, by the stage each one completes. */
const REFUSABLE_OPERATIONS: Readonly<Record<string, OpenStage>> = {
  "wopi:check-file-info": "information",
  "wopi:get-file": "bytes",
};

export interface OpenRefusal {
  readonly stage: OpenStage;
  readonly status: number;
  readonly errorId: string | null;
}

/**
 * The host refusing the editor's request for the document's information or its bytes, while that
 * stage is still outstanding. A refusal ends the open now rather than at the budget: the editor
 * will not ask again, and a screen that keeps waiting is waiting on nothing.
 *
 * A lock or a save answer is never a refusal of the OPEN. A 409 on the lock is a co-editor already
 * holding it, which is the read-only seat the launch already stated; a PutFile answer belongs to a
 * document that is open and being written.
 */
export function refusal(marks: OpenMarks): OpenRefusal | null {
  const callback = marks.lastCallback;
  if (callback === null || callback.status < 400) return null;
  const stage = REFUSABLE_OPERATIONS[callback.operation];
  if (stage === undefined || stageDone(marks, stage)) return null;
  return { stage, status: callback.status, errorId: callback.errorId };
}

/**
 * The sequence as ProgressSteps shows it. Done stages are done; the failed stage carries the
 * sentence in place of its label; while nothing has failed, the current stage is the active one.
 */
export function openSteps(
  marks: OpenMarks,
  failedStage: OpenStage | null,
  failureSentence?: string,
): ProgressStep[] {
  const current = currentStage(marks);
  return OPEN_STAGES.map(({ id, label }): ProgressStep => {
    if (stageDone(marks, id)) return { label, status: "done" };
    if (id === failedStage) return { label, status: "failed", failure: failureSentence ?? label };
    if (failedStage === null && id === current) return { label, status: "active" };
    return { label, status: "pending" };
  });
}

const STALLED_SENTENCES: Record<OpenStage, string> = {
  session: "The editing session did not open.",
  editor: "The editor did not answer. It may still be starting, or it could not be reached.",
  frame: "The editor page arrived but never reported itself ready.",
  information: "The editor came up but never asked the host about the document.",
  bytes: "The host described the document, but the editor never asked for its contents.",
  shown: "The document was sent to the editor, but the editor never showed it.",
};

const REFUSED_SUBJECT: Partial<Record<OpenStage, string>> = {
  information: "the document's information",
  bytes: "the document's contents",
};

/** What to say when the open stopped at a stage: the host's refusal where there is one, else the stall. */
export function stalledSentence(stage: OpenStage, marks: OpenMarks): string {
  const refused = refusal(marks);
  const subject = REFUSED_SUBJECT[stage];
  if (refused !== null && refused.stage === stage && subject !== undefined) {
    return `The host refused the editor's request for ${subject} (answered ${String(refused.status)}).`;
  }
  return STALLED_SENTENCES[stage];
}

// The unit is spelled out: "28.1 seconds", never "28.1 s". A wait is read by a person who is
// waiting, and an abbreviation is one more thing to decode while they do.
function seconds(milliseconds: number): string {
  const value = (Math.max(0, milliseconds) / 1000).toFixed(1);
  return `${value} ${value === "1.0" ? "second" : "seconds"}`;
}

function wholeSeconds(milliseconds: number): string {
  const value = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(value)} ${value === 1 ? "second" : "seconds"}`;
}

/**
 * What the panel says once the open has run past the point a wait stops feeling like progress. The
 * same sentence the design system's loading region says of any read, in the same voice, so a member
 * who has seen one has seen the other; here it is said inside the staged panel, beside Retry, so it
 * arrives without moving anything else on the screen.
 */
export const TAKING_LONGER_SENTENCE =
  "Still opening this document in the editor. This is taking longer than it should.";

/**
 * The facts a stalled open hands over, one row per stage and then the host's side of it. A stage
 * reads as the seconds from the start of the open to its mark; the stage the open stopped at says
 * how long it was waited for, and the stages after it were simply never reached. Nothing here is
 * anything but a stage's name, a number of seconds, the callback's operation, its status and its
 * Error ID: the block is written to be pasted into a report, so it must carry nothing privileged.
 */
export function openRows(marks: OpenMarks, now: Date): FailureDetailRow[] {
  const stopped = currentStage(marks);
  const rows: FailureDetailRow[] = OPEN_STAGES.map(({ id, label }) => {
    const at = markOf(marks, id);
    if (at !== null) return { label, value: seconds(at.getTime() - marks.startedAt.getTime()) };
    if (id === stopped) {
      return {
        label,
        value: `not reached after ${wholeSeconds(now.getTime() - marks.startedAt.getTime())}`,
      };
    }
    return { label, value: "not reached" };
  });
  const callback = marks.lastCallback;
  rows.push({
    label: "Last answer from the host",
    value: callback === null ? "none" : `${callback.operation} answered ${String(callback.status)}`,
    mono: callback !== null,
  });
  rows.push({ label: "Error ID", value: callback?.errorId ?? "None issued", mono: true });
  return rows;
}

/** The same facts as one plain-text block, one line per row, for a report. */
export function openTrace(marks: OpenMarks, now: Date): string {
  return openRows(marks, now)
    .map((row) => `${row.label}: ${row.value}`)
    .join("\n");
}

/** "12 seconds so far": how long the open has been running, in whole seconds. */
export function elapsedLabel(startedAt: Date, now: Date): string {
  return `${wholeSeconds(now.getTime() - startedAt.getTime())} so far`;
}

/** "Stopped after 90 seconds": how long the open ran before it was called off. */
export function stoppedLabel(startedAt: Date, failedAt: Date): string {
  return `Stopped after ${wholeSeconds(failedAt.getTime() - startedAt.getTime())}`;
}
