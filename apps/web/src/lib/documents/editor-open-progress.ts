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
 * THE STAGES ARE TOLD AS THEY HAPPEN, NOT TICKED OFF. The owner's direction of 2026-09-18: a list
 * of six boxes that go from empty to checked tells a member nothing about what the wait IS, so
 * the screen streams the open instead — each stage that finishes becomes a line saying what just
 * happened and when, and the stage under way says what is happening and why it takes the time it
 * takes, with each stage's own duration as its stamp. Behind one control sits the open's LOG: what
 * the editor's container, the host and the page each did, in the order it happened (`openLog`),
 * which is different in kind from the stages and is where a slow or stuck open is explained. That
 * is `openFeed` here (drawn through ProgressSteps, with the stamps as notes) and `openLogRows`;
 * `openRows` is the stage timings for a report, and `openSteps` the whole sequence as a step list.
 *
 * TWO SOURCES FEED THE MARKS, AND THEY ARRIVE OUT OF ORDER. The frame's own messages and the
 * iframe's load event are immediate; the host's record of the editor's callbacks (CheckFileInfo,
 * GetFile) reaches the screen through a poll, so it can lag the frame's later signals. That is why
 * a later mark implies every earlier one: `document-loaded` proves the whole chain ran, whatever
 * the poll has caught up on.
 *
 * THE BAR IS AGAINST TIME, NEVER AGAINST THE STAGES. The stages are of wildly unequal length (a
 * session is minted in a moment; a cold container takes most of the wait), so a bar drawn at a
 * fraction of them would claim to know how far along the open is, which is the one thing this
 * screen does not know. What it does know is how long an open usually takes, so the bar fills over
 * that time and says so beside it — a member sees the wait against the usual wait, which is what
 * "is this normal?" actually asks — and past the usual time it stops moving and says that too.
 */
import type { FailureDetailRow } from "@magna-carta/design-system/failure-details";
import type { ProgressStep } from "@magna-carta/design-system/progress-steps";
import type { ContainerEventRecord, EditOpenProgress, OpenCallbackRecord } from "./document-api.ts";

export type OpenStage = "session" | "editor" | "frame" | "information" | "bytes" | "shown";

/**
 * The stages in the order they happen. `label` names the stage in the sequence and the report;
 * `doing` is what the feed says while the stage runs, in the present; `done` is the one line the
 * feed keeps once it has happened.
 */
export const OPEN_STAGES: readonly {
  id: OpenStage;
  label: string;
  doing: string;
  done: string;
}[] = [
  {
    id: "session",
    label: "Opening your session",
    doing: "Opening your editing session.",
    done: "Session opened.",
  },
  {
    id: "editor",
    label: "Starting the editor",
    doing: "Starting the editor. The first time a document opens takes the longest.",
    done: "Editor started.",
  },
  {
    id: "frame",
    label: "Loading the editor",
    doing: "Loading the editor's page.",
    done: "Editor loaded.",
  },
  {
    id: "information",
    label: "Reading the document's details",
    doing: "The editor is reading the document's details.",
    done: "Details read.",
  },
  {
    id: "bytes",
    label: "Fetching the document",
    doing: "The editor is fetching the document's contents.",
    done: "Document fetched.",
  },
  {
    id: "shown",
    label: "Laying out the document",
    doing: "Laying the document out on the page.",
    done: "Document shown.",
  },
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
  /** Every call the editor made to the host in this open, as the last poll reported them. */
  readonly callbacks: readonly OpenCallbackRecord[];
  /** What the editor's container has been doing, as the last poll reported it. */
  readonly containerEvents: readonly ContainerEventRecord[];
}

/**
 * How often the host's open record is read while the open is in flight. Frequent enough that a
 * callback stage shows within a breath of happening; sparse enough that a ninety-second wait is a
 * few dozen reads, not a few hundred.
 */
export const OPEN_PROGRESS_POLL_MILLISECONDS = 2500;

/**
 * How long an open usually takes, from the owner's own opens on 2026-09-18: about half a minute,
 * nearly all of it the editor's container starting. The bar fills over this and the words beside
 * it say it is the usual time, not a promise.
 */
export const TYPICAL_OPEN_MILLISECONDS = 30_000;

/**
 * When Retry is offered. Later than the usual open by a clear margin, because Retry shown at the
 * usual time invites a member to abandon an open that is about to finish, and starting over is the
 * one thing certain to take longer. Before this the panel says the open is running long; at this
 * it says so and offers the way out.
 */
export const RETRY_AFTER_MILLISECONDS = 45_000;

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
    callbacks: [],
    containerEvents: [],
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
 * The sequence as ProgressSteps shows it, behind the details control. Done stages are done; the
 * failed stage carries the sentence in place of its label; while nothing has failed, the current
 * stage is the active one.
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

/** One line of the streamed open: what happened or is happening, and how long that stage took. */
export interface OpenFeedLine {
  readonly stage: OpenStage;
  readonly status: "done" | "active" | "failed";
  readonly text: string;
  /**
   * How long THIS stage took, or has taken so far: "27.7 s" against the stage before it, never
   * against the start of the open. A stage's own time is the answer to "which part is slow".
   */
  readonly at: string;
}

// The unit is spelled out in prose: "28.1 seconds", never "28.1 s". A wait is read by a person who
// is waiting, and an abbreviation is one more thing to decode while they do. The feed's timestamp
// column is the exception the prose rule allows for, a column of numbers a reader scans rather
// than reads, and it says "s" once per line where the words would crowd the sentence they belong to.
function seconds(milliseconds: number): string {
  const value = (Math.max(0, milliseconds) / 1000).toFixed(1);
  return `${value} ${value === "1.0" ? "second" : "seconds"}`;
}

function wholeSeconds(milliseconds: number): string {
  const value = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(value)} ${value === 1 ? "second" : "seconds"}`;
}

// One precision for the whole column, so the decimals line up down it.
function feedStamp(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1000).toFixed(1)} s`;
}

/**
 * The open as a stream: every stage behind us as the line it left, then the stage under way as
 * what it is doing right now, or, once the open has stopped, the stage it stopped on. Nothing for
 * the stages still to come — those are the timings, behind the details control — so the feed only
 * ever grows, one line per thing that actually happened. The stopped line carries the stage's
 * name and not the sentence: the notice beneath the feed says what went wrong, once, with the way
 * out beside it. Each line's stamp is the stage's OWN duration, measured from the stage before.
 */
export function openFeed(
  marks: OpenMarks,
  now: Date,
  failedStage: OpenStage | null = null,
): OpenFeedLine[] {
  const lines: OpenFeedLine[] = [];
  const current = currentStage(marks);
  let previousAt = marks.startedAt;
  for (const stage of OPEN_STAGES) {
    if (stageDone(marks, stage.id)) {
      // A stage the poll never marked but a later signal proved is stamped with the later mark: it
      // happened no later than that, and a line without a time would read as a line without a fact.
      const at = markOf(marks, stage.id) ?? firstMarkAfter(marks, stage.id) ?? now;
      lines.push({
        stage: stage.id,
        status: "done",
        text: stage.done,
        at: feedStamp(at.getTime() - previousAt.getTime()),
      });
      previousAt = at;
      continue;
    }
    if (stage.id === failedStage) {
      lines.push({
        stage: stage.id,
        status: "failed",
        text: stage.label,
        at: feedStamp(now.getTime() - previousAt.getTime()),
      });
      break;
    }
    if (failedStage === null && stage.id === current) {
      lines.push({
        stage: stage.id,
        status: "active",
        text: stage.doing,
        at: feedStamp(now.getTime() - previousAt.getTime()),
      });
    }
    break;
  }
  return lines;
}

/** The feed as ProgressSteps draws it: the line's words as the label, its stamp as the note. */
export function feedSteps(lines: readonly OpenFeedLine[]): ProgressStep[] {
  return lines.map((line) => ({ label: line.text, status: line.status, note: line.at }));
}

function firstMarkAfter(marks: OpenMarks, stage: OpenStage): Date | null {
  const from = OPEN_STAGES.findIndex((candidate) => candidate.id === stage);
  for (const later of OPEN_STAGES.slice(from + 1)) {
    const at = markOf(marks, later.id);
    if (at !== null) return at;
  }
  return null;
}

/** The wait against the usual wait: how full the bar is, and the sentence beside it. */
export interface OpenPace {
  /** The elapsed time, for the bar's value; it is capped at `TYPICAL_OPEN_MILLISECONDS` there. */
  readonly elapsedMilliseconds: number;
  readonly sentence: string;
  /** True once the open has run past the usual time: the bar is full and stays there. */
  readonly overdue: boolean;
}

/**
 * The usual time in words, read off the constant so the bar, the sentence and the label can never
 * disagree: "about half a minute" at thirty seconds, "about a minute" at sixty, else the seconds.
 */
export function usualTimeWords(milliseconds: number = TYPICAL_OPEN_MILLISECONDS): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds === 30) return "about half a minute";
  if (seconds === 60) return "about a minute";
  return `about ${String(seconds)} seconds`;
}

export function usualTimeSentence(): string {
  return `Usually ${usualTimeWords()}.`;
}

export const RUNNING_LONG_SENTENCE = "Taking longer than usual. Still working on it.";

/**
 * What the panel says beside the bar. Under the usual time the bar fills and the words say what
 * the usual time is; past it the bar is full and the words say so, without yet offering Retry
 * (`RETRY_AFTER_MILLISECONDS` decides that, and the panel reads it), because an open past the
 * usual time is far more often about to finish than stuck.
 */
export function openPace(startedAt: Date, now: Date): OpenPace {
  const elapsedMilliseconds = Math.max(0, now.getTime() - startedAt.getTime());
  const overdue = elapsedMilliseconds >= TYPICAL_OPEN_MILLISECONDS;
  return {
    elapsedMilliseconds: Math.min(elapsedMilliseconds, TYPICAL_OPEN_MILLISECONDS),
    sentence: overdue ? RUNNING_LONG_SENTENCE : usualTimeSentence(),
    overdue,
  };
}

const STALLED_SENTENCES: Record<OpenStage, string> = {
  session: "The editing session did not open.",
  editor: "The editor didn't respond. It may still be starting. Try again in a moment.",
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

/**
 * What the panel says once the open has run past the point Retry is offered. The same sentence
 * the design system's loading region says of any read, in the same voice, so a member who has seen
 * one has seen the other; here it is said inside the streamed panel, beside Retry, so it arrives
 * without moving anything else on the screen.
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

/** One line of the open's log: something that happened, on whichever side, and when. */
export interface OpenLogLine {
  readonly at: Date;
  readonly text: string;
  readonly failed: boolean;
}

const CONTAINER_PHASE_WORDS: Record<ContainerEventRecord["phase"], string> = {
  requested: "The editor's container was asked for",
  started: "The editor's container is running",
  listening: "The editor is answering on its port",
  served: "The editor's page was served",
  stopped: "The editor's container stopped",
  error: "The editor's container reported an error",
};

const CALLBACK_WORDS: Readonly<Record<string, string>> = {
  "wopi:check-file-info": "The editor asked for the document's details",
  "wopi:get-file": "The editor asked for the document's contents",
  "wopi:lock": "The editor took the document's lock",
  "wopi:put-file": "The editor saved the document",
};

function callbackLine(callback: OpenCallbackRecord): OpenLogLine {
  const words = CALLBACK_WORDS[callback.operation] ?? `The editor called ${callback.operation}`;
  const refused = callback.status >= 400;
  const answer = refused
    ? `refused ${String(callback.status)}${callback.errorId === null ? "" : ` (Error ID ${callback.errorId})`}`
    : `answered ${String(callback.status)}`;
  return { at: new Date(callback.at), text: `${words}: ${answer}`, failed: refused };
}

function containerLine(event: ContainerEventRecord): OpenLogLine {
  const failed = event.phase === "error";
  const detail = event.detail === null ? "" : ` (${event.detail})`;
  return { at: new Date(event.at), text: `${CONTAINER_PHASE_WORDS[event.phase]}${detail}`, failed };
}

/**
 * Everything that happened in this open, from every side that reports, in the order it happened:
 * the container's phases as the editor worker saw them, the editor's calls to the host and what
 * each was told, and the page's own moments (the launch answered, the editor's page loaded, the
 * editor ready, the document on screen). This is what the details show while the open runs, and it
 * is different in kind from the feed above it: the feed is the six stages, this is what was
 * actually going on inside them, which is where a slow or stuck open is explained.
 *
 * Three clocks meet here (the browser's, the host's, the editor worker's), so the order is by each
 * line's own instant and the stamps are offsets from the start of the open on the browser's clock;
 * a line from another clock can read a moment early or late, which is the truth of it.
 */
export function openLog(marks: OpenMarks): OpenLogLine[] {
  const lines: OpenLogLine[] = [];
  const own: readonly [Date | null, string][] = [
    [marks.sessionAt, "The host opened your session"],
    [marks.editorAt, "The editor's page loaded in the browser"],
    [marks.frameAt, "The editor reported itself ready"],
    [marks.shownAt, "The document is on screen"],
  ];
  for (const [at, text] of own) if (at !== null) lines.push({ at, text, failed: false });
  for (const event of marks.containerEvents) lines.push(containerLine(event));
  for (const callback of marks.callbacks) lines.push(callbackLine(callback));
  return lines.sort((left, right) => left.at.getTime() - right.at.getTime());
}

/** The log as FailureDetails rows: the offset from the start as the label, the line as the value. */
export function openLogRows(marks: OpenMarks): FailureDetailRow[] {
  return openLog(marks).map((line) => ({
    label: `${(Math.max(0, line.at.getTime() - marks.startedAt.getTime()) / 1000).toFixed(1)} s`,
    value: line.text,
    mono: false,
  }));
}

/** The same facts as one plain-text block, one line per row, for a report: the stages, then the log. */
export function openTrace(marks: OpenMarks, now: Date): string {
  return [...openRows(marks, now), ...openLogRows(marks)]
    .map((row) => `${row.label}: ${row.value}`)
    .join("\n");
}

/** "Stopped after 90 seconds": how long the open ran before it was called off. */
export function stoppedLabel(startedAt: Date, failedAt: Date): string {
  return `Stopped after ${wholeSeconds(failedAt.getTime() - startedAt.getTime())}`;
}
