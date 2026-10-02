// @vitest-environment happy-dom
/*
 * The polls: what a host asks the room, and the answers as they come in.
 *
 * THE HALF THAT FAILS QUIETLY IS THE TALLY'S. It reaches a browser through two doors — the room's
 * once-a-second frame and the paged read — in whichever order the network delivers them, and an
 * answer can never be withdrawn, so a count must only ever grow: a read asked before a frame and
 * answered after it must not put a bar back. And whether THIS member answered is the read's to say
 * and never a frame's, because a frame is the same for every socket.
 *
 * THE OTHER HALF IS WHAT THE PANEL OFFERS AND WITHHOLDS. One choice is a radio group and several are
 * checkboxes; Answer is refused past what the poll allows, before anything is sent; an answered or
 * closed poll is a tally; an anonymous poll says what that means BEFORE the answer; and a member who
 * is not running the meeting sees no New Poll form, no Close Poll and no See Who Answered.
 *
 * WHAT IS NOT ASSERTED is anything about pixels. These render under happy-dom.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isAcceptableAnswer,
  isOpenablePoll,
  MeetingPolls,
  readPoll,
  readPollTally,
  type MeetingPollSeams,
  type MeetingPollView,
} from "$lib/meetings/client/polls.svelte.ts";
import type { MeetingWrite } from "$lib/meetings/meetings-api.ts";
import Panel, {
  NOT_ATTRIBUTED_SENTENCE,
} from "../src/lib/meetings/screen/meeting-polls-panel.svelte";

type PanelProps = ComponentProps<typeof Panel>;

/** A poll as the panel draws it, with whatever a case changes. */
function poll(over: Partial<MeetingPollView> = {}): MeetingPollView {
  return {
    pollId: "meetingPoll_1",
    question: "Which date works for the hearing?",
    anonymous: false,
    maxChoices: 1,
    openedAt: "2026-09-20T15:00:00.000Z",
    closedAt: null,
    options: [
      { optionId: "meetingPollOption_1", position: 0, label: "Thursday", count: 0 },
      { optionId: "meetingPollOption_2", position: 1, label: "Friday", count: 0 },
      { optionId: "meetingPollOption_3", position: 2, label: "Monday", count: 0 },
    ],
    respondents: 0,
    answered: false,
    ...over,
  };
}

/** Seams driven by hand: what the read answers, and what each write was asked. */
class Seams implements MeetingPollSeams {
  pages: MeetingPollView[][] = [[]];
  readonly answered: { pollId: string; optionIds: readonly string[] }[] = [];
  answerWith: MeetingPollView | null = null;

  list(
    cursor: string | null,
  ): Promise<MeetingWrite<{ polls: MeetingPollView[]; nextCursor: string | null }>> {
    const index = cursor === null ? 0 : Number(cursor);
    const nextCursor = index + 1 < this.pages.length ? String(index + 1) : null;
    return Promise.resolve({ kind: "ok", value: { polls: this.pages[index] ?? [], nextCursor } });
  }

  open(): Promise<MeetingWrite<MeetingPollView>> {
    return Promise.resolve({ kind: "ok", value: poll() });
  }

  answer(pollId: string, optionIds: readonly string[]): Promise<MeetingWrite<MeetingPollView>> {
    this.answered.push({ pollId, optionIds });
    return Promise.resolve({ kind: "ok", value: this.answerWith ?? poll({ answered: true }) });
  }

  close(pollId: string): Promise<MeetingWrite<MeetingPollView>> {
    return Promise.resolve({
      kind: "ok",
      value: poll({ pollId, closedAt: "2026-09-20T15:05:00.000Z" }),
    });
  }

  answers(): Promise<never> {
    return Promise.reject(new Error("not asked"));
  }

  every(): () => void {
    return () => {};
  }
}

async function settle(remaining = 20): Promise<void> {
  if (remaining === 0) return;
  await Promise.resolve();
  await settle(remaining - 1);
}

describe("reading a poll off the wire", () => {
  it("reads the room's copy whole, options in the order the room was shown them", () => {
    const read = readPoll({
      id: "meetingPoll_1",
      question: "Which date?",
      anonymous: true,
      maxChoices: 2,
      openedAt: "2026-09-20T15:00:00.000Z",
      closedAt: null,
      options: [
        { optionId: "b", position: 1, label: "Friday", count: 2 },
        { optionId: "a", position: 0, label: "Thursday", count: 1 },
      ],
      respondents: 3,
    });
    expect(read?.options.map((option) => option.label)).toEqual(["Thursday", "Friday"]);
    expect(read?.anonymous).toBe(true);
    expect(read?.respondents).toBe(3);
    // A frame is the same for every socket, so it never says this member answered.
    expect(read?.answered).toBe(false);
  });

  it("refuses a row with no options, which no answer could reach", () => {
    expect(
      readPoll({ id: "p", question: "q", openedAt: "2026-09-20T15:00:00.000Z", options: [] }),
    ).toBeNull();
  });

  it("reads a tally frame as a count per option and a number of people", () => {
    const tally = readPollTally({
      counts: [
        { optionId: "a", count: 3 },
        { optionId: "b", count: 1 },
      ],
      respondents: 4,
    });
    expect(tally?.counts.get("a")).toBe(3);
    expect(tally?.respondents).toBe(4);
  });
});

describe("what a poll will take", () => {
  it("refuses an answer past what the poll allows, and an empty one", () => {
    const several = poll({ maxChoices: 2 });
    expect(isAcceptableAnswer(several, [])).toBe(false);
    expect(isAcceptableAnswer(several, ["meetingPollOption_1", "meetingPollOption_2"])).toBe(true);
    expect(
      isAcceptableAnswer(several, [
        "meetingPollOption_1",
        "meetingPollOption_2",
        "meetingPollOption_3",
      ]),
    ).toBe(false);
  });

  it("opens a poll with two to ten options and a choice count they can meet", () => {
    const draft = { question: "Which date?", options: ["Thursday", "Friday"], anonymous: false };
    expect(isOpenablePoll({ ...draft, maxChoices: 1 })).toBe(true);
    expect(isOpenablePoll({ ...draft, options: ["Thursday"], maxChoices: 1 })).toBe(false);
    expect(isOpenablePoll({ ...draft, options: ["Thursday", " "], maxChoices: 1 })).toBe(false);
    expect(isOpenablePoll({ ...draft, maxChoices: 3 })).toBe(false);
    expect(
      isOpenablePoll({ ...draft, options: Array.from({ length: 11 }, String), maxChoices: 1 }),
    ).toBe(false);
  });
});

describe("the polls a room holds", () => {
  it("never lets a count go backwards, whichever door it came through", async () => {
    const seams = new Seams();
    const polls = new MeetingPolls(seams);
    polls.notePollOpened(poll());
    polls.notePollTally("meetingPoll_1", {
      counts: new Map([["meetingPollOption_1", 5]]),
      respondents: 5,
    });

    // A read asked before that frame and answered after it: its counts are older.
    seams.pages = [[poll({ respondents: 2 })]];
    await polls.refresh();

    expect(polls.polls[0]?.respondents).toBe(5);
    expect(polls.polls[0]?.options[0]?.count).toBe(5);
  });

  it("walks every page of polls and keeps them newest first", async () => {
    const seams = new Seams();
    seams.pages = [
      [poll({ pollId: "late", openedAt: "2026-09-20T15:10:00.000Z" })],
      [poll({ pollId: "early", openedAt: "2026-09-20T15:00:00.000Z" })],
    ];
    const polls = new MeetingPolls(seams);
    await polls.refresh();
    expect(polls.polls.map((one) => one.pollId)).toEqual(["late", "early"]);
  });

  it("becomes a tally once this member's answer is on the record", async () => {
    const seams = new Seams();
    const polls = new MeetingPolls(seams);
    polls.notePollOpened(poll());
    expect(polls.waitingForAnswer).toBe(1);

    expect(await polls.answer("meetingPoll_1", ["meetingPollOption_2"])).toBe(true);

    expect(seams.answered).toEqual([
      { pollId: "meetingPoll_1", optionIds: ["meetingPollOption_2"] },
    ]);
    expect(polls.polls[0]?.answered).toBe(true);
    expect(polls.waitingForAnswer).toBe(0);
  });

  it("sends nothing for an answer the poll would refuse", async () => {
    const seams = new Seams();
    const polls = new MeetingPolls(seams);
    polls.notePollOpened(poll());
    expect(
      await polls.answer("meetingPoll_1", ["meetingPollOption_1", "meetingPollOption_2"]),
    ).toBe(false);
    expect(seams.answered).toEqual([]);
  });

  it("counts a poll that opened while the panel was shut, once, and forgets it when the panel opens", () => {
    const polls = new MeetingPolls(new Seams());
    polls.notePollOpened(poll());
    // The same poll again — a frame and then a read — is still one poll.
    polls.notePollOpened(poll());
    expect(polls.openedUnseen).toBe(1);

    polls.noteOpened();
    expect(polls.openedUnseen).toBe(0);
    polls.notePollOpened(poll({ pollId: "meetingPoll_2" }));
    expect(polls.openedUnseen).toBe(0);
  });
});

function buttonReading(words: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === words,
  );
}

describe("the polls panel", () => {
  let target: HTMLElement;
  let instance: Record<string, unknown> | undefined;
  let asked: string[] = [];

  function props(over: Partial<PanelProps> = {}): PanelProps {
    return {
      open: true,
      subject: { facts: ["Hearing preparation"] },
      polls: [poll()],
      hosting: false,
      inRoom: 30,
      onOpenPoll: () => Promise.resolve(true),
      onAnswer: (pollId: string, optionIds: readonly string[]) => {
        asked.push(`answer:${pollId}:${optionIds.join(",")}`);
        return Promise.resolve(true);
      },
      onClosePoll: () => Promise.resolve(true),
      onReadAnswers: () => Promise.reject(new Error("not asked")),
      nameOfAnswer: () => "Rosalind Chase",
      ...over,
    };
  }

  beforeEach(() => {
    target = document.createElement("div");
    document.body.append(target);
    asked = [];
  });

  afterEach(() => {
    if (instance !== undefined) void unmount(instance);
    instance = undefined;
    target.remove();
    for (const panel of document.body.querySelectorAll('[role="dialog"],[role="alertdialog"]')) {
      panel.remove();
    }
  });

  it("draws a radio group for one choice", () => {
    instance = mount(Panel, { target, props: props() });
    flushSync();
    expect(document.body.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(document.body.querySelector('[role="checkbox"]')).toBeNull();
  });

  it("draws checkboxes for several, and refuses Answer past what the poll allows", () => {
    instance = mount(Panel, { target, props: props({ polls: [poll({ maxChoices: 2 })] }) });
    flushSync();

    const boxes = [...document.body.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
    expect(boxes).toHaveLength(3);
    expect(document.body.querySelector('[role="radiogroup"]')).toBeNull();

    boxes[0]?.click();
    boxes[1]?.click();
    flushSync();
    expect(buttonReading("Answer")?.disabled).toBe(false);

    boxes[2]?.click();
    flushSync();
    expect(buttonReading("Answer")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Choose no more than 2.");
  });

  it("sends the chosen option on Answer", async () => {
    instance = mount(Panel, { target, props: props() });
    flushSync();

    const radios = [...document.body.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    radios[1]?.click();
    flushSync();
    buttonReading("Answer")?.click();
    await settle();

    expect(asked).toEqual(["answer:meetingPoll_1:meetingPollOption_2"]);
  });

  it("is a tally once answered: a bar per option and how many of the room answered", () => {
    const answered = poll({
      answered: true,
      respondents: 12,
      options: [
        { optionId: "meetingPollOption_1", position: 0, label: "Thursday", count: 9 },
        { optionId: "meetingPollOption_2", position: 1, label: "Friday", count: 3 },
        { optionId: "meetingPollOption_3", position: 2, label: "Monday", count: 0 },
      ],
    });
    instance = mount(Panel, { target, props: props({ polls: [answered] }) });
    flushSync();

    expect(document.body.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
    expect(document.body.querySelector('[role="radiogroup"]')).toBeNull();
    expect(document.body.textContent).toContain("12 of 30 answered");
    expect(buttonReading("Answer")).toBeUndefined();
  });

  it("says what an anonymous poll promises BEFORE the answer", () => {
    instance = mount(Panel, { target, props: props({ polls: [poll({ anonymous: true })] }) });
    flushSync();

    const text = document.body.textContent ?? "";
    expect(text).toContain(NOT_ATTRIBUTED_SENTENCE);
    expect(text.indexOf(NOT_ATTRIBUTED_SENTENCE)).toBeLessThan(text.indexOf("Thursday"));
  });

  it("offers a member who is not hosting no New Poll, no Close Poll and no See Who Answered", () => {
    instance = mount(Panel, { target, props: props({ hosting: false }) });
    flushSync();

    expect(document.body.textContent).not.toContain("New Poll");
    expect(buttonReading("Close Poll")).toBeUndefined();
    expect(buttonReading("See Who Answered")).toBeUndefined();
    expect(buttonReading("Open Poll")).toBeUndefined();
  });

  it("offers a host the form, Close Poll, and who answered on a poll that shows names", () => {
    instance = mount(Panel, { target, props: props({ hosting: true }) });
    flushSync();

    expect(document.body.textContent).toContain("New Poll");
    expect(buttonReading("Close Poll")).toBeDefined();
    expect(buttonReading("See Who Answered")).toBeDefined();
    // Two options to start, and nothing to open until the host has written a question.
    expect(buttonReading("Open Poll")?.disabled).toBe(true);
    // A host watches the answers arrive rather than answering their own question.
    expect(document.body.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
    expect(buttonReading("Answer")).toBeUndefined();
  });

  it("offers no See Who Answered on a poll that does not show names", () => {
    instance = mount(Panel, {
      target,
      props: props({ hosting: true, polls: [poll({ anonymous: true })] }),
    });
    flushSync();
    expect(buttonReading("See Who Answered")).toBeUndefined();
  });

  it("says what to do where nothing has been asked", () => {
    instance = mount(Panel, { target, props: props({ polls: [], hosting: true }) });
    flushSync();
    expect(document.body.textContent).toContain("Ask the room a question.");
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
