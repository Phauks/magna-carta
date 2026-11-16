// @vitest-environment happy-dom
/*
 * The summary of a recording, as the panel reads it: what the platform wrote, the action items it
 * read out of the conversation, and what a summary being written, one that could not be written,
 * one that was not written and one whose words are withheld say instead.
 *
 * WHAT IS PINNED. A ready summary stands under one quiet line saying it is the platform's
 * characterization of the conversation and not a record of it. The action items are numbered in the
 * summary's own order, each with its owner or "No owner", and its due date through the design
 * system's civil-date formatter. Every other state is the design system's empty state with its own
 * title: the failure with its Error ID, each refusal in its own sentence (the model one naming the
 * firm's AI settings page), and a withheld summary in the transcript panel's words. Create Task makes
 * nothing on its own press: it asks first, naming who the task will be assigned to and letting the
 * reader take the name off, and only then goes to the task route with an idempotency key, linking to
 * the task once made; a task somebody else made first is said plainly and linked. Re-run is offered to a host only, and asks first. The words
 * of the summary and of every item never reach an address.
 *
 * The first half is the pure wording; the second mounts the panel over a canned server.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { client } from "@magna-carta/api-client/client";
import { formatDate } from "@magna-carta/design-system/formatters";
import { queryClient } from "../src/lib/api/screen-data.ts";
import {
  ALREADY_TASKED_WORDS,
  MADE_WITHOUT_OWNER_WORDS,
  SUMMARY_CHARACTERIZATION,
  SUMMARY_REFUSAL_WORDS,
  SUMMARY_RERUN_CONSEQUENCE,
  SUMMARY_STATE_WORDS,
  actionItemDueWords,
  actionItemOwnerWords,
  assignsToOwner,
  mayAssignToOwner,
  orderedActionItems,
  summaryBody,
  summaryErrorId,
  summaryMarkText,
  summarySettled,
  summaryStateWord,
  taskAssigneeWords,
  withTaskMade,
} from "../src/lib/meetings/screen/summary-panel.ts";
import { TRANSCRIPT_WITHHELD_WORDS } from "../src/lib/meetings/screen/transcript-panel.ts";
import {
  meetingProblemType,
  taskAddress,
  type MeetingSummaryActionItemView,
  type MeetingSummaryHeaderView,
  type MeetingSummaryReadView,
  type MeetingSummaryRefusalView,
} from "../src/lib/meetings/meetings-api.ts";
import Harness from "./meeting-summary-harness.svelte";

const ORIGIN = "https://app.example";
const MEETING_ID = "meeting_1";
const RECORDING_ID = "meetingRecording_1";
const MATTER_ID = "matter_7";
const SUMMARY_PATH = `/api/v1/meetings/${MEETING_ID}/recordings/${RECORDING_ID}/summary`;
const MEETING_PATH = `/api/v1/meetings/${MEETING_ID}`;

/** Words that appear only in the privileged text, so a case can look for them in every address. */
const PRIVILEGED_WORDS = ["Pemberton", "exhibits", "deposition"];

function header(overrides: Partial<MeetingSummaryHeaderView> = {}): MeetingSummaryHeaderView {
  return {
    id: "meetingSummary_1",
    transcriptId: "meetingTranscript_1",
    recordingId: RECORDING_ID,
    state: "ready",
    refusalReason: null,
    failureErrorId: null,
    modelId: "@cf/openai/gpt-oss-120b",
    createdAt: "2026-09-20T15:41:00.000Z",
    updatedAt: "2026-09-20T15:43:00.000Z",
    ...overrides,
  };
}

function item(overrides: Partial<MeetingSummaryActionItemView> = {}): MeetingSummaryActionItemView {
  return {
    id: "meetingSummaryActionItem_1",
    ordinal: 0,
    text: "Send Pemberton the exhibits.",
    owner: { userId: "usr_2", displayName: "Rosalind Chase" },
    dueOn: "2026-10-09",
    taskId: null,
    ...overrides,
  };
}

function ready(overrides: Partial<MeetingSummaryReadView> = {}): MeetingSummaryReadView {
  return {
    summary: header(),
    text: "The team agreed the deposition schedule and who sends what before the hearing.",
    actionItems: [
      item(),
      item({
        id: "meetingSummaryActionItem_2",
        ordinal: 1,
        text: "Book the deposition room.",
        owner: null,
        dueOn: null,
      }),
    ],
    withheld: null,
    ...overrides,
  };
}

/** A summary that is not ready: its header, and no words. */
function headerOnly(overrides: Partial<MeetingSummaryHeaderView>): MeetingSummaryReadView {
  return { summary: header(overrides), text: null, actionItems: [], withheld: null };
}

describe("where a summary stands", () => {
  it("names every state in plain words, and never says a summary was filed", () => {
    expect(summaryStateWord({ state: "pending" })).toBe("Being Written");
    expect(summaryStateWord({ state: "ready" })).toBe("Ready");
    expect(summaryStateWord({ state: "failed" })).toBe("Could Not Be Written");
    expect(summaryStateWord({ state: "refused" })).toBe("Not Written");
    for (const word of Object.values(SUMMARY_STATE_WORDS)) {
      expect(word.toLowerCase()).not.toContain("filed");
    }
  });

  it("states a failed summary's Error ID, and no other summary's", () => {
    expect(summaryErrorId({ state: "failed", failureErrorId: "err_S1" })).toBe("err_S1");
    expect(summaryErrorId({ state: "failed", failureErrorId: null })).toBeNull();
    expect(summaryErrorId({ state: "failed", failureErrorId: "" })).toBeNull();
    expect(summaryErrorId({ state: "pending", failureErrorId: "err_S1" })).toBeNull();
    expect(summaryErrorId({ state: "refused", failureErrorId: "err_S1" })).toBeNull();
  });

  it("decides the panel's body in one place, in one order", () => {
    expect(summaryBody(header({ state: "pending" }), null)).toEqual({
      kind: "being-written",
      title: "Summary Being Written",
      detail: null,
    });
    expect(summaryBody(header({ state: "failed", failureErrorId: "err_S1" }), null)).toEqual({
      kind: "could-not-be-written",
      title: "Summary Could Not Be Written",
      detail: "Error ID: err_S1",
    });
    expect(summaryBody(header({ state: "failed" }), null)).toMatchObject({ detail: null });
    expect(summaryBody(header(), null)).toEqual({ kind: "summary" });
    // Only a ready summary has words to withhold.
    expect(summaryBody(header({ state: "pending" }), "removed").kind).toBe("being-written");
  });

  it("words each refusal as itself, naming the firm's AI settings where the model is the reason", () => {
    const reasons: readonly MeetingSummaryRefusalView[] = [
      "disabled",
      "not-eligible",
      "transcript-empty",
    ];
    for (const reason of reasons) {
      expect(summaryBody(header({ state: "refused", refusalReason: reason }), null)).toEqual({
        kind: "not-written",
        title: "Summary Not Written",
        detail: SUMMARY_REFUSAL_WORDS[reason],
      });
    }
    expect(SUMMARY_REFUSAL_WORDS.disabled).toContain("turned off for this firm");
    expect(SUMMARY_REFUSAL_WORDS["not-eligible"]).toContain("AI isn't turned on for this firm");
    expect(SUMMARY_REFUSAL_WORDS["not-eligible"]).toContain("AI and the Assistant");
    expect(SUMMARY_REFUSAL_WORDS["transcript-empty"]).toContain("Nothing was said");
    // Three reasons, three sentences.
    expect(new Set(Object.values(SUMMARY_REFUSAL_WORDS)).size).toBe(3);
  });

  it("still says something true of a refusal whose reason it has no words for", () => {
    const unworded = header({
      state: "refused",
      refusalReason: "a-reason-added-later" as MeetingSummaryRefusalView,
    });
    expect(summaryBody(unworded, null)).toMatchObject({ detail: "This summary wasn't written." });
  });

  it("says a withheld summary in the transcript panel's own words", () => {
    for (const withheld of ["removed", "held", "unavailable"] as const) {
      expect(summaryBody(header(), withheld)).toEqual({
        kind: "withheld",
        title: "Summary Withheld",
        detail: TRANSCRIPT_WITHHELD_WORDS[withheld],
      });
    }
  });

  it("is settled once one being written becomes anything else", () => {
    expect(summarySettled("pending", "ready")).toBe(true);
    expect(summarySettled("pending", "failed")).toBe(true);
    expect(summarySettled("pending", "refused")).toBe(true);
    expect(summarySettled("pending", "pending")).toBe(false);
    expect(summarySettled(null, "ready")).toBe(false);
    expect(summarySettled("ready", "pending")).toBe(false);
  });

  it("is said in the recordings list's column, with nothing before there is one", () => {
    expect(summaryMarkText(null)).toBe("");
    expect(summaryMarkText({ id: "s", state: "pending", refusalReason: null })).toBe(
      "Being Written",
    );
    expect(summaryMarkText({ id: "s", state: "ready", refusalReason: null })).toBe("Read");
    expect(summaryMarkText({ id: "s", state: "failed", refusalReason: null })).toBe(
      "Could Not Be Written",
    );
    expect(summaryMarkText({ id: "s", state: "refused", refusalReason: "disabled" })).toBe(
      "Not Written",
    );
  });
});

describe("the summary's own words", () => {
  it("say plainly that it characterizes the conversation and is not a record of it", () => {
    expect(SUMMARY_CHARACTERIZATION).toContain("describes the conversation");
    expect(SUMMARY_CHARACTERIZATION).toContain("isn't a record of it");
    expect(SUMMARY_RERUN_CONSEQUENCE).toContain("action items are replaced");
    expect(SUMMARY_RERUN_CONSEQUENCE).toContain("Tasks already made from them stay");
    for (const words of [
      SUMMARY_CHARACTERIZATION,
      SUMMARY_RERUN_CONSEQUENCE,
      MADE_WITHOUT_OWNER_WORDS,
      ALREADY_TASKED_WORDS,
      ...Object.values(SUMMARY_REFUSAL_WORDS),
    ]) {
      expect(words).not.toContain("—");
    }
  });
});

describe("an action item", () => {
  it("names its owner, or says it has none, never a blank", () => {
    expect(actionItemOwnerWords(item())).toBe("Owner: Rosalind Chase");
    expect(actionItemOwnerWords(item({ owner: null }))).toBe("No owner");
    expect(actionItemOwnerWords(item({ owner: { userId: "usr_2", displayName: "  " } }))).toBe(
      "No owner",
    );
  });

  it("states its due day through the civil-date formatter, and nothing where none was stated", () => {
    expect(actionItemDueWords(item(), "en-US")).toBe("Due Oct 9, 2026");
    expect(actionItemDueWords(item())).toBe(`Due ${formatDate("2026-10-09")}`);
    expect(actionItemDueWords(item({ dueOn: null }))).toBeNull();
  });

  it("is listed in the summary's own order", () => {
    const shuffled = [
      item({ id: "c", ordinal: 2 }),
      item({ id: "a", ordinal: 0 }),
      item({ id: "b", ordinal: 1 }),
    ];
    expect(orderedActionItems(shuffled).map((each) => each.id)).toEqual(["a", "b", "c"]);
  });

  it("is put in its owner's name only where the reader may and left the box ticked", () => {
    // The reader's own item, or a reader who may assign: the name may go on it.
    expect(mayAssignToOwner(item(), "usr_2", false)).toBe(true);
    expect(mayAssignToOwner(item(), "usr_9", true)).toBe(true);
    // Somebody else's, and no key to assign: it may not, ticked or not.
    expect(mayAssignToOwner(item(), "usr_9", false)).toBe(false);
    expect(assignsToOwner(item(), "usr_9", false, true)).toBe(false);
    // Taken off by the reader: in nobody's name.
    expect(assignsToOwner(item(), "usr_2", false, true)).toBe(true);
    expect(assignsToOwner(item(), "usr_2", false, false)).toBe(false);
    // No owner to name.
    expect(mayAssignToOwner(item({ owner: null }), "usr_9", true)).toBe(false);
    expect(assignsToOwner(item({ owner: null }), "usr_9", true, true)).toBe(false);
  });

  it("says who the task will be assigned to, before anything is made", () => {
    expect(taskAssigneeWords(item(), true)).toBe("Assigned to Rosalind Chase.");
    expect(taskAssigneeWords(item(), false)).toBe("Assigned to nobody.");
    expect(taskAssigneeWords(item({ owner: null }), true)).toBe(
      "Not assigned. No owner was named.",
    );
  });

  it("takes the task the route answered with, and leaves every other item alone", () => {
    const view = ready();
    const made = withTaskMade(view, { taskId: "task_1", actionItem: item({ taskId: "task_1" }) });
    expect(made.actionItems.map((each) => each.taskId)).toEqual(["task_1", null]);
    // A summary written again in between no longer holds the item; nothing is invented into it.
    const gone = withTaskMade(view, {
      taskId: "task_1",
      actionItem: item({ id: "meetingSummaryActionItem_99", taskId: "task_1" }),
    });
    expect(gone).toBe(view);
  });

  it("links to its task where the task's own notice does: the matter's Tasks section", () => {
    expect(taskAddress(MATTER_ID, "task_1")).toBe(`/matters/${MATTER_ID}/tasks?entry=task_1`);
    expect(taskAddress(null, "task_1")).toBe("/tasks?entry=task_1");
  });
});

// ---------------------------------------------------------------------------------------------
// The panel, over a canned server.
// ---------------------------------------------------------------------------------------------

interface Asked {
  readonly method: string;
  readonly address: URL;
  readonly idempotencyKey: string | null;
  readonly body: string;
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
/** Every request the panel made, so a case can see the route, the key and no words in any address. */
let asked: Asked[] = [];
/** What the summary read answers: a view, a failure status, or a read that never ends. */
let summaryAnswer: "never" | number | MeetingSummaryReadView = ready();
/** What a Create Task press answers, given the item it was for. */
let taskAnswer: (actionItemId: string) => Answer = () => ({ status: 500, body: {} });
/** What a re-run answers. */
let rerunAnswer: Answer = { status: 500, body: {} };

function problem(slug: string, status: number, detail: string): Answer {
  return { status, body: { type: meetingProblemType(slug), title: detail, status, detail } };
}

function respond(answer: Answer): Response {
  const isProblem = answer.status >= 400;
  return new Response(JSON.stringify(answer.body), {
    status: answer.status,
    headers: { "content-type": isProblem ? "application/problem+json" : "application/json" },
  });
}

function serve(): void {
  const stub = (async (request: Request) => {
    const address = new URL(request.url);
    asked.push({
      method: request.method,
      address,
      idempotencyKey: request.headers.get("idempotency-key"),
      body: request.method === "GET" ? "" : await request.text(),
    });
    const path = address.pathname;
    if (request.method === "GET" && path === MEETING_PATH) {
      return respond({
        status: 200,
        body: { id: MEETING_ID, eventKind: "matter", matterId: MATTER_ID },
      });
    }
    if (request.method === "GET" && path === SUMMARY_PATH) {
      if (summaryAnswer === "never") return new Promise<Response>(() => {});
      if (typeof summaryAnswer === "number") {
        return respond({
          status: summaryAnswer,
          body: { title: "Not Found", status: summaryAnswer },
        });
      }
      return respond({ status: 200, body: summaryAnswer });
    }
    if (request.method === "POST" && path === SUMMARY_PATH) return respond(rerunAnswer);
    const task = /\/summary\/action-items\/([^/]+)\/task$/u.exec(path);
    if (request.method === "POST" && task !== null) return respond(taskAnswer(task[1] ?? ""));
    return respond({ status: 404, body: { title: "Not Found", status: 404 } });
  }) as unknown as typeof fetch;
  client.setConfig({ baseUrl: ORIGIN, fetch: stub });
}

async function settle(remaining = 8): Promise<void> {
  if (remaining === 0) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  await settle(remaining - 1);
}

async function draw(
  props: {
    canHost?: boolean;
    canAssign?: boolean;
    viewerUserId?: string | null;
    onChanged?: () => void;
  } = {},
): Promise<void> {
  instance = mount(Harness, {
    target,
    props: { meetingId: MEETING_ID, recordingId: RECORDING_ID, viewerUserId: "usr_2", ...props },
  });
  flushSync();
  await settle();
}

/** The open summary panel, which the dialog draws outside the harness's own element. */
function panel(): Element | undefined {
  return [...document.body.querySelectorAll('[role="dialog"]')].find((candidate) =>
    candidate.textContent?.includes("Summary"),
  );
}

/** The confirmation Create Task opens, where one is standing. */
function taskConfirmation(): Element | undefined {
  return [...document.body.querySelectorAll('[role="dialog"]')].find((candidate) =>
    candidate.textContent?.includes("New Task"),
  );
}

/** Press Create Task on an item, then the confirmation's own commit. */
async function createTaskOn(row: Element | undefined): Promise<void> {
  buttonNamed(row, "Create Task")?.click();
  await settle();
  buttonNamed(taskConfirmation(), "Create Task")?.click();
  await settle();
}

/** The question standing over the panel, where one is. */
function question(): Element | null {
  return document.body.querySelector('[role="alertdialog"]');
}

function buttonNamed(
  container: Element | null | undefined,
  name: string,
): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll("button") ?? [])].find(
    (control) => control.textContent?.trim() === name,
  );
}

function items(): Element[] {
  return [...(panel()?.querySelectorAll("ol > li") ?? [])];
}

/** No address the panel asked for carries a word of the summary or of an item. */
function expectNoWordsInAddresses(): void {
  for (const request of asked) {
    for (const word of PRIVILEGED_WORDS) expect(request.address.href).not.toContain(word);
  }
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  asked = [];
  summaryAnswer = ready();
  taskAnswer = () => ({ status: 500, body: {} });
  rerunAnswer = { status: 500, body: {} };
  queryClient.clear();
  serve();
});

// The dialog's scroll lock is released on a 24 ms timer after the dialog closes. Waiting past it here
// lets that timer run while the document still exists; left pending, it fires after the file's
// environment is torn down and reports an error against whichever file runs last.
const SCROLL_LOCK_RELEASE_MILLISECONDS = 50;

afterEach(async () => {
  if (instance !== undefined) await unmount(instance);
  instance = undefined;
  await new Promise((resolve) => setTimeout(resolve, SCROLL_LOCK_RELEASE_MILLISECONDS));
  target.remove();
  client.setConfig({ baseUrl: "", fetch: globalThis.fetch });
});

describe("the summary panel", () => {
  it("reads a ready summary under the line saying what it is, with its action items in order", async () => {
    await draw();
    const shown = panel();
    const text = shown?.textContent ?? "";
    expect(text).toContain(SUMMARY_CHARACTERIZATION);
    expect(text).toContain("The team agreed the deposition schedule");
    // The characterization stands above the words it qualifies.
    expect(text.indexOf(SUMMARY_CHARACTERIZATION)).toBeLessThan(
      text.indexOf("The team agreed the deposition schedule"),
    );
    expect(text).toContain("Action Items");

    const listed = items();
    expect(listed).toHaveLength(2);
    expect(listed[0]?.textContent).toContain("1.");
    expect(listed[0]?.textContent).toContain("Send Pemberton the exhibits.");
    expect(listed[0]?.textContent).toContain("Owner: Rosalind Chase");
    expect(listed[0]?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-09");
    expect(listed[0]?.textContent).toContain(`Due ${formatDate("2026-10-09")}`);
    expect(listed[1]?.textContent).toContain("2.");
    expect(listed[1]?.textContent).toContain("No owner");
    expect(listed[1]?.querySelector("time")).toBeNull();
    for (const each of listed) expect(buttonNamed(each, "Create Task")).toBeDefined();

    // A member who cannot host is offered nothing that writes it again.
    expect(buttonNamed(shown, "Re-run")).toBeUndefined();
    expect(asked.filter((request) => request.address.pathname === SUMMARY_PATH)).toHaveLength(1);
    expectNoWordsInAddresses();
  });

  it("says a ready summary with no action items has no results, inside its own list", async () => {
    summaryAnswer = ready({ actionItems: [] });
    await draw();
    const list = panel()?.querySelector("ol");
    expect(list).not.toBeNull();
    expect(list?.textContent).toContain("No Results");
  });

  it("says a summary is being written, and tells the opener once it settles", async () => {
    summaryAnswer = headerOnly({ state: "pending", modelId: null });
    let told = 0;
    await draw({ onChanged: () => (told += 1) });
    const shown = panel();
    expect(shown?.textContent).toContain("Summary Being Written");
    expect(shown?.querySelector("ol")).toBeNull();
    expect(shown?.textContent).not.toContain(SUMMARY_CHARACTERIZATION);
    expect(told).toBe(0);

    summaryAnswer = ready();
    await queryClient.refetchQueries();
    await settle();
    expect(told).toBe(1);
    expect(panel()?.textContent).toContain("The team agreed the deposition schedule");

    // Reading a summary that is already ready again tells nobody a second time.
    await queryClient.refetchQueries();
    await settle();
    expect(told).toBe(1);
  });

  it("says a summary could not be written, with the Error ID to quote", async () => {
    summaryAnswer = headerOnly({ state: "failed", failureErrorId: "err_SUMMARY" });
    await draw();
    const shown = panel();
    expect(shown?.textContent).toContain("Summary Could Not Be Written");
    expect(shown?.textContent).toContain("Error ID: err_SUMMARY");
    expect(shown?.querySelector("ol")).toBeNull();
  });

  it.each(["disabled", "not-eligible", "transcript-empty"] as const)(
    "says why a summary was not written, in the sentence for %s",
    async (reason) => {
      summaryAnswer = headerOnly({ state: "refused", refusalReason: reason, modelId: null });
      await draw();
      const shown = panel();
      expect(shown?.textContent).toContain("Summary Not Written");
      expect(shown?.textContent).toContain(SUMMARY_REFUSAL_WORDS[reason]);
      // A refusal is not a fault, so there is nothing to quote to support.
      expect(shown?.textContent).not.toContain("Error ID");
      expect(shown?.querySelector("ol")).toBeNull();
    },
  );

  it("says why a ready summary's words are withheld, in the transcript's words, and shows none", async () => {
    summaryAnswer = { ...headerOnly({ state: "ready" }), withheld: "removed" };
    await draw();
    const shown = panel();
    expect(shown?.textContent).toContain("Summary Withheld");
    expect(shown?.textContent).toContain(TRANSCRIPT_WITHHELD_WORDS.removed);
    expect(shown?.querySelector("ol")).toBeNull();
    expect(shown?.textContent).not.toContain(SUMMARY_CHARACTERIZATION);
  });

  it("makes a task of an item with an idempotency key, then links to it in the matter's Tasks", async () => {
    taskAnswer = (actionItemId) => ({
      status: 201,
      body: { taskId: "task_1", actionItem: item({ id: actionItemId, taskId: "task_1" }) },
    });
    await draw();
    buttonNamed(items()[0], "Create Task")?.click();
    await settle();
    // The row's press makes nothing: it asks, naming who the task will be assigned to.
    expect(asked.some((request) => request.method === "POST")).toBe(false);
    const asking = taskConfirmation();
    expect(asking?.textContent).toContain("Send Pemberton the exhibits.");
    expect(asking?.textContent).toContain("Assigned to Rosalind Chase.");
    buttonNamed(asking, "Create Task")?.click();
    await settle();
    expect(taskConfirmation()).toBeUndefined();

    const press = asked.find((request) => request.method === "POST");
    expect(press?.address.pathname).toBe(
      `${SUMMARY_PATH}/action-items/meetingSummaryActionItem_1/task`,
    );
    expect(press?.idempotencyKey).toBeTruthy();
    // The reader owns this item, so it is made in their name.
    expect(JSON.parse(press?.body ?? "{}")).toEqual({ assignToOwner: true });

    const opened = items()[0]?.querySelector<HTMLAnchorElement>("a");
    expect(opened?.textContent?.trim()).toBe("Open Task");
    expect(opened?.getAttribute("href")).toBe(`/matters/${MATTER_ID}/tasks?entry=task_1`);
    expect(buttonNamed(items()[0], "Create Task")).toBeUndefined();
    // The other item is untouched.
    expect(buttonNamed(items()[1], "Create Task")).toBeDefined();
    expectNoWordsInAddresses();
  });

  it("lets the reader take the owner's name off before the task is made", async () => {
    taskAnswer = (actionItemId) => ({
      status: 201,
      body: { taskId: "task_2", actionItem: item({ id: actionItemId, taskId: "task_2" }) },
    });
    await draw();
    buttonNamed(items()[0], "Create Task")?.click();
    await settle();
    const box = taskConfirmation()?.querySelector<HTMLButtonElement>('[role="checkbox"]');
    expect(box?.getAttribute("aria-checked")).toBe("true");
    box?.click();
    await settle();
    expect(taskConfirmation()?.textContent).toContain("Assigned to nobody.");
    buttonNamed(taskConfirmation(), "Create Task")?.click();
    await settle();
    const press = asked.find((request) => request.method === "POST");
    expect(JSON.parse(press?.body ?? "{}")).toEqual({ assignToOwner: false });
  });

  it("names nobody where no owner was named, and offers no name to take off", async () => {
    taskAnswer = (actionItemId) => ({
      status: 201,
      body: {
        taskId: "task_3",
        actionItem: item({ id: actionItemId, owner: null, taskId: "task_3" }),
      },
    });
    await draw();
    buttonNamed(items()[1], "Create Task")?.click();
    await settle();
    expect(taskConfirmation()?.textContent).toContain("Not assigned. No owner was named.");
    expect(taskConfirmation()?.querySelector('[role="checkbox"]')).toBeNull();
    buttonNamed(taskConfirmation(), "Create Task")?.click();
    await settle();
    const press = asked.find((request) => request.method === "POST");
    expect(JSON.parse(press?.body ?? "{}")).toEqual({ assignToOwner: false });
  });

  it("refuses the owner's name to a reader who may not assign it, and says why", async () => {
    summaryAnswer = ready({
      actionItems: [item({ owner: { userId: "usr_9", displayName: "Omar Haddad" } })],
    });
    taskAnswer = (actionItemId) => ({
      status: 201,
      body: { taskId: "task_2", actionItem: item({ id: actionItemId, taskId: "task_2" }) },
    });
    await draw({ canAssign: false });
    buttonNamed(items()[0], "Create Task")?.click();
    await settle();
    const asking = taskConfirmation();
    expect(asking?.textContent).toContain("Assigned to nobody.");
    expect(asking?.textContent).toContain(MADE_WITHOUT_OWNER_WORDS);
    expect(asking?.querySelector('[role="checkbox"]')?.hasAttribute("disabled")).toBe(true);
    buttonNamed(asking, "Create Task")?.click();
    await settle();
    const press = asked.find((request) => request.method === "POST");
    expect(JSON.parse(press?.body ?? "{}")).toEqual({ assignToOwner: false });
  });

  it("says plainly when somebody else made the task first, and links to theirs", async () => {
    taskAnswer = () =>
      problem(
        "meeting-summary-action-item-tasked",
        409,
        "Somebody has already made a task of this action item.",
      );
    await draw();
    // Their press landed first: the next read carries their task.
    summaryAnswer = ready({
      actionItems: [item({ taskId: "task_theirs" }), ...ready().actionItems.slice(1)],
    });
    await createTaskOn(items()[0]);
    expect(taskConfirmation()).toBeUndefined();

    const first = items()[0];
    expect(first?.textContent).toContain(ALREADY_TASKED_WORDS);
    expect(first?.querySelector("a")?.getAttribute("href")).toBe(
      `/matters/${MATTER_ID}/tasks?entry=task_theirs`,
    );
    // Not a failure: there is nothing to try again.
    expect(buttonNamed(first, "Retry")).toBeUndefined();
  });

  it("leaves the confirmation standing with any other refusal in it, where pressing again retries", async () => {
    taskAnswer = () => ({
      status: 503,
      body: { title: "Service Unavailable", status: 503, detail: "The task could not be made." },
    });
    await draw();
    await createTaskOn(items()[0]);
    const asking = taskConfirmation();
    expect(asking?.textContent).toContain("The task could not be made.");
    expect(buttonNamed(asking, "Create Task")).toBeDefined();
    expect(buttonNamed(items()[0], "Create Task")).toBeDefined();
  });

  it("offers Re-run to a host only, and asks first, saying tasks already made are kept", async () => {
    rerunAnswer = { status: 202, body: headerOnly({ state: "pending", modelId: null }) };
    let told = 0;
    await draw({ canHost: true, onChanged: () => (told += 1) });
    const trigger = buttonNamed(panel(), "Re-run");
    expect(trigger).toBeDefined();
    expect(asked.some((request) => request.method === "POST")).toBe(false);

    trigger?.click();
    await settle();
    const asking = question();
    expect(asking).not.toBeNull();
    expect(asking?.textContent).toContain("Write the Summary Again");
    expect(asking?.textContent).toContain(SUMMARY_RERUN_CONSEQUENCE);
    // Opening the question sends nothing.
    expect(asked.some((request) => request.method === "POST")).toBe(false);

    buttonNamed(asking, "Re-run")?.click();
    await settle();
    const press = asked.find((request) => request.method === "POST");
    expect(press?.address.pathname).toBe(SUMMARY_PATH);
    expect(press?.idempotencyKey).toBeTruthy();
    expect(question()).toBeNull();
    expect(panel()?.textContent).toContain("Summary Being Written");
    expect(told).toBe(1);
  });

  it("leaves the question standing with the refusal in it when the transcript is not ready", async () => {
    rerunAnswer = problem(
      "meeting-transcript-not-ready",
      409,
      "This recording's transcript is not ready.",
    );
    await draw({ canHost: true });
    buttonNamed(panel(), "Re-run")?.click();
    await settle();
    buttonNamed(question(), "Re-run")?.click();
    await settle();
    expect(question()?.textContent).toContain("This recording's transcript is not ready.");
    expect(panel()?.textContent).toContain("The team agreed the deposition schedule");
  });

  it("draws the summary's own shape while it is read, with nothing to press", async () => {
    summaryAnswer = "never";
    await draw();
    const shown = panel();
    expect(shown?.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(shown?.textContent).not.toContain("No Results");
    expect(shown?.textContent).not.toContain("Summary Being Written");
  });

  it("replaces the summary with the failure, and the way to try again, when the read failed", async () => {
    summaryAnswer = 404;
    await draw();
    const shown = panel();
    expect(shown?.querySelector("ol")).toBeNull();
    expect(buttonNamed(shown, "Retry")).toBeDefined();
  });
});
