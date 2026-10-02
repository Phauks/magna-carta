// @vitest-environment happy-dom
/*
 * The question queue: what the room asks whoever is running it.
 *
 * THE ORDER IS THE BROWSER'S, AND IT HAS TO MOVE WITHOUT A READ. The pages walk the record's own
 * stable key, because a cursor over a count that changes while it pages repeats rows and skips rows;
 * so this browser holds the whole queue and sorts it — unanswered first, the most upvoted first in
 * each group — and a tally frame re-sorts what is held the moment it lands.
 *
 * THE UPVOTE READS ITS OWN STATE, AND ONLY THE RECORD AND THE PRESS MOVE IT. A tally says how many,
 * never who, so a relayed frame must never flip the control; withdrawing is the same press, and what
 * comes back is what is drawn.
 *
 * AND WHAT A MEMBER WHO IS NOT HOSTING SEES: no Mark Answered anywhere, and Redact only on their own
 * question.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MeetingQuestions,
  questionsInQueueOrder,
  readQuestionTally,
  type MeetingQuestionSeams,
  type MeetingQuestionView,
} from "$lib/meetings/client/questions.svelte.ts";
import type { MeetingWrite } from "$lib/meetings/meetings-api.ts";
import Panel from "../src/lib/meetings/screen/meeting-questions-panel.svelte";

type PanelProps = ComponentProps<typeof Panel>;

function question(over: Partial<MeetingQuestionView> = {}): MeetingQuestionView {
  return {
    questionId: "meetingQuestion_1",
    participantId: "attendance_2",
    participantKind: "member",
    userId: "usr_2",
    body: "When is the filing due?",
    askedAt: "2026-09-20T15:00:00.000Z",
    answeredAt: null,
    redactedAt: null,
    upvotes: 0,
    upvotedByMe: false,
    ...over,
  };
}

/** Seams driven by hand. An upvote answers with the row as the record would state it after one. */
class Seams implements MeetingQuestionSeams {
  pages: MeetingQuestionView[][] = [[]];
  readonly asked: string[] = [];

  list(
    cursor: string | null,
  ): Promise<MeetingWrite<{ questions: MeetingQuestionView[]; nextCursor: string | null }>> {
    const index = cursor === null ? 0 : Number(cursor);
    const nextCursor = index + 1 < this.pages.length ? String(index + 1) : null;
    return Promise.resolve({
      kind: "ok",
      value: { questions: this.pages[index] ?? [], nextCursor },
    });
  }

  ask(body: string): Promise<MeetingWrite<MeetingQuestionView>> {
    this.asked.push(`ask:${body}`);
    return Promise.resolve({ kind: "ok", value: question({ questionId: "asked", body }) });
  }

  upvote(questionId: string): Promise<MeetingWrite<MeetingQuestionView>> {
    this.asked.push(`upvote:${questionId}`);
    return Promise.resolve({
      kind: "ok",
      value: question({ questionId, upvotes: 1, upvotedByMe: true }),
    });
  }

  withdrawUpvote(questionId: string): Promise<MeetingWrite<MeetingQuestionView>> {
    this.asked.push(`withdraw:${questionId}`);
    return Promise.resolve({ kind: "ok", value: question({ questionId, upvotes: 0 }) });
  }

  markAnswered(questionId: string, answered: boolean): Promise<MeetingWrite<MeetingQuestionView>> {
    this.asked.push(`answered:${questionId}:${String(answered)}`);
    return Promise.resolve({
      kind: "ok",
      value: question({ questionId, answeredAt: answered ? "2026-09-20T15:01:00.000Z" : null }),
    });
  }

  redact(questionId: string): Promise<MeetingWrite<MeetingQuestionView>> {
    this.asked.push(`redact:${questionId}`);
    return Promise.resolve({
      kind: "ok",
      value: question({ questionId, body: "", redactedAt: "2026-09-20T15:02:00.000Z" }),
    });
  }

  every(): () => void {
    return () => {};
  }
}

describe("the order a host works the queue in", () => {
  it("puts the unanswered first and the most upvoted first within each group", () => {
    const ordered = questionsInQueueOrder([
      question({
        questionId: "answered-popular",
        upvotes: 9,
        answeredAt: "2026-09-20T15:05:00.000Z",
      }),
      question({ questionId: "quiet", upvotes: 1 }),
      question({ questionId: "popular", upvotes: 5 }),
      question({
        questionId: "answered-quiet",
        upvotes: 0,
        answeredAt: "2026-09-20T15:06:00.000Z",
      }),
    ]);
    expect(ordered.map((one) => one.questionId)).toEqual([
      "popular",
      "quiet",
      "answered-popular",
      "answered-quiet",
    ]);
  });

  it("keeps the one asked first ahead where two are level", () => {
    const ordered = questionsInQueueOrder([
      question({ questionId: "later", askedAt: "2026-09-20T15:03:00.000Z", upvotes: 2 }),
      question({ questionId: "earlier", askedAt: "2026-09-20T15:01:00.000Z", upvotes: 2 }),
    ]);
    expect(ordered.map((one) => one.questionId)).toEqual(["earlier", "later"]);
  });

  it("re-sorts the queue it holds when a tally arrives, without a read", async () => {
    const seams = new Seams();
    seams.pages = [
      [
        question({ questionId: "first", askedAt: "2026-09-20T15:00:00.000Z", upvotes: 3 }),
        question({ questionId: "second", askedAt: "2026-09-20T15:01:00.000Z", upvotes: 1 }),
      ],
    ];
    const questions = new MeetingQuestions(seams);
    await questions.refresh();
    expect(questions.queue.map((one) => one.questionId)).toEqual(["first", "second"]);

    const reads = seams.asked.length;
    questions.noteQuestionTally(
      readQuestionTally({ questions: [{ questionId: "second", upvotes: 7 }] }),
    );

    expect(questions.queue.map((one) => one.questionId)).toEqual(["second", "first"]);
    expect(seams.asked).toHaveLength(reads);
  });
});

describe("the upvote", () => {
  it("reads its own state, and withdrawal returns it", async () => {
    const seams = new Seams();
    seams.pages = [[question()]];
    const questions = new MeetingQuestions(seams);
    await questions.refresh();

    await questions.toggleUpvote("meetingQuestion_1");
    expect(questions.questions[0]?.upvotedByMe).toBe(true);
    expect(questions.questions[0]?.upvotes).toBe(1);

    await questions.toggleUpvote("meetingQuestion_1");
    expect(questions.questions[0]?.upvotedByMe).toBe(false);
    expect(seams.asked).toEqual(["upvote:meetingQuestion_1", "withdraw:meetingQuestion_1"]);
  });

  it("is never flipped by a relayed copy, which says how many but never who", async () => {
    const seams = new Seams();
    seams.pages = [[question({ upvotes: 1, upvotedByMe: true })]];
    const questions = new MeetingQuestions(seams);
    await questions.refresh();

    questions.noteQuestionUpdated(question({ answeredAt: "2026-09-20T15:01:00.000Z", upvotes: 1 }));

    expect(questions.questions[0]?.upvotedByMe).toBe(true);
    expect(questions.waiting).toBe(0);
  });

  it("keeps a question taken back blank, whichever door a later copy came through", async () => {
    const questions = new MeetingQuestions(new Seams());
    questions.noteQuestionAsked(question());
    questions.noteQuestionUpdated(question({ body: "", redactedAt: "2026-09-20T15:02:00.000Z" }));
    // A stale copy of the row from before the redaction.
    questions.noteQuestionAsked(question());

    expect(questions.questions[0]?.body).toBe("");
    expect(questions.questions[0]?.redactedAt).not.toBeNull();
  });
});

function buttonsReading(words: string): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === words,
  );
}

describe("the question panel", () => {
  let target: HTMLElement;
  let instance: Record<string, unknown> | undefined;
  let pressed: string[] = [];

  function props(over: Partial<PanelProps> = {}): PanelProps {
    return {
      open: true,
      subject: { facts: ["Hearing preparation"] },
      queue: [
        question(),
        question({
          questionId: "meetingQuestion_2",
          participantId: "attendance_1",
          userId: "usr_1",
          body: "Can the exhibits be shared first?",
        }),
      ],
      hosting: false,
      nameOf: (asked: MeetingQuestionView) =>
        asked.participantId === "attendance_1" ? "Priya Raman" : "Rosalind Chase",
      isMine: (asked: MeetingQuestionView) => asked.participantId === "attendance_1",
      onAsk: (body: string) => {
        pressed.push(`ask:${body}`);
        return Promise.resolve(true);
      },
      onToggleUpvote: (questionId: string) => pressed.push(`upvote:${questionId}`),
      onMarkAnswered: (questionId: string, answered: boolean) =>
        pressed.push(`answered:${questionId}:${String(answered)}`),
      onRedact: (questionId: string) => pressed.push(`redact:${questionId}`),
      ...over,
    };
  }

  beforeEach(() => {
    target = document.createElement("div");
    document.body.append(target);
    pressed = [];
  });

  afterEach(() => {
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    target.remove();
    for (const panel of document.body.querySelectorAll('[role="dialog"],[role="alertdialog"]')) {
      panel.remove();
    }
  });

  it("offers a member who is not hosting no Mark Answered, and Redact only on their own", () => {
    instance = mount(Panel, { target, props: props() });
    flushSync();

    expect(buttonsReading("Mark Answered")).toHaveLength(0);
    const redacts = buttonsReading("Redact");
    expect(redacts).toHaveLength(1);
    expect(redacts[0]?.getAttribute("aria-label")).toContain("Priya Raman");
  });

  it("offers a host Mark Answered and Redact on every question", () => {
    instance = mount(Panel, { target, props: props({ hosting: true }) });
    flushSync();

    expect(buttonsReading("Mark Answered")).toHaveLength(2);
    expect(buttonsReading("Redact")).toHaveLength(2);
    buttonsReading("Mark Answered")[0]?.click();
    expect(pressed).toEqual(["answered:meetingQuestion_1:true"]);
  });

  it("draws the upvote pressed or not, from the question's own state", () => {
    instance = mount(Panel, {
      target,
      props: props({ queue: [question({ upvotes: 3, upvotedByMe: true })] }),
    });
    flushSync();

    const upvote = [...document.body.querySelectorAll("button")].find((button) =>
      (button.getAttribute("aria-label") ?? "").includes("upvote"),
    );
    expect(upvote?.getAttribute("aria-pressed")).toBe("true");
    expect(upvote?.getAttribute("aria-label")).toContain("Take back your upvote");
    expect(upvote?.textContent).toContain("3");
  });

  it("counts the thousand characters down, and refuses Ask past them", () => {
    instance = mount(Panel, { target, props: props({ draft: "x".repeat(1001) }) });
    flushSync();

    expect(document.body.textContent).toContain("1 character too many.");
    expect(buttonsReading("Ask")[0]?.disabled).toBe(true);
  });

  it("says what to do where nothing has been asked", () => {
    instance = mount(Panel, { target, props: props({ queue: [] }) });
    flushSync();
    expect(document.body.textContent).toContain("Ask the first question.");
    expect(document.body.textContent).toContain("1000 characters left.");
  });
});

/*
 * A modal panel locks the page's scroll and lets go of the lock on a short timer after it closes. The
 * timer reaches for the document, so the file waits it out rather than letting it fire after the
 * test environment has been taken down, where it would be reported against whichever file ran last.
 */
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 250));
});
