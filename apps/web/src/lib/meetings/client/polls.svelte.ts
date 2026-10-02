/*
 * The polls a host has asked the room, held where the room is drawn from.
 *
 * THE ROUTE IS THE RECORD, ON CHAT'S TERMS. A poll is opened, answered and closed by writes, and read
 * back by a paged read; the room relays a copy of a committed row so three hundred browsers see a
 * poll the moment it opens rather than on a poller's next tick, and `notePollOpened` is where that
 * copy lands. Nothing here writes through the socket — a record that lived only where a Durable
 * Object's transient storage holds it would be a record that empties when the room does.
 *
 * A TALLY ONLY EVER GROWS, AND THAT IS HOW TWO DOORS AGREE. An answer cannot be changed or taken back,
 * so every count on a poll is non-decreasing for the life of the poll. The same tally reaches this
 * browser through the relay's once-a-second frame and through the read, in whichever order the
 * network delivers them — so a count is merged by keeping the larger, and a read that was asked
 * before a frame and answered after it can never put a bar back.
 *
 * WHETHER THIS MEMBER HAS ANSWERED IS THE READ'S TO SAY, and the answer's. The frames are the same for
 * every socket and carry nothing about who answered; the page carries whether the caller did, and
 * this member's own answer, once the record has it, is the other door.
 *
 * A HOST ANSWERS LIKE ANYBODY, EXCEPT THE POLL THEY ASKED. Running the meeting is not a reason to be
 * kept from the options: a co-host is in the room as much as anybody, and a poll another host opened
 * is a question to them too. Only the poll a member opened themselves goes straight to its tally —
 * they are watching the answers to their own question arrive — and `awaitsAnswerFrom` is the one
 * place that says so, for the card, the count on the control and the toast alike.
 *
 * THE RELAY IS THE PATH AND THE READ IS NOT A CLOCK. While the socket carries the room's frames,
 * nothing here reads on a timer: the polls are read when the member arrives, when the panel opens,
 * and when the socket comes back, and only while it is DOWN does a slow read stand in for the frames.
 *
 * EVERY EDGE IS A SEAM, like every other module in this directory: the calls and the ticking. Nothing
 * here touches `window`, so what a panel does with a tally frame is a unit test.
 */
import type { Failure } from "$lib/api/problem.ts";
import type { MeetingWrite } from "../meetings-api.ts";
import { isRecord, readString } from "./signaling.ts";

/**
 * How often the polls are read while the socket is DOWN, and only then.
 *
 * A frame reaches a socket that is open, so while one is, the frames are the path and a timed read
 * would be three hundred browsers asking the firm's record for what they were already told. Once
 * the socket goes, the screen says the room stopped answering and offers Rejoin; this keeps an open
 * panel honest meanwhile, slowly, because a room that goes away takes everybody's socket at once.
 */
export const POLLS_BACKSTOP_INTERVAL_MILLISECONDS = 60_000;

/** The most pages one read walks. Far past what a meeting's polls fill; a bound, not a budget. */
const MAX_POLL_PAGES_READ = 20;

/** The fewest options a poll offers: one option is a statement, not a question. */
export const MIN_MEETING_POLL_OPTIONS = 2;
/** The most options a poll offers. The record refuses an eleventh. */
export const MAX_MEETING_POLL_OPTIONS = 10;
/** The longest question, in characters. The record refuses a longer one. */
export const MAX_MEETING_POLL_QUESTION_LENGTH = 500;
/** The longest option, in characters. The record refuses a longer one. */
export const MAX_MEETING_POLL_OPTION_LENGTH = 200;

/** One option of a poll, with how many have chosen it so far. */
export interface MeetingPollOptionView {
  readonly optionId: string;
  /** Where it stands in the poll, counted from zero. The order the room sees. */
  readonly position: number;
  readonly label: string;
  readonly count: number;
}

/** A poll as the panel draws it. */
export interface MeetingPollView {
  readonly pollId: string;
  /** The member who opened it. Null on a copy the room sends a guest, which names no member. */
  readonly askedByUserId: string | null;
  readonly question: string;
  /** Whether answers are held without the name of who gave them. */
  readonly anonymous: boolean;
  /** How many options one participant may choose. One is a single choice. */
  readonly maxChoices: number;
  readonly openedAt: string;
  /** When a host closed it. Null while it is open. */
  readonly closedAt: string | null;
  /** In `position` order, every option, including the ones nobody has chosen. */
  readonly options: readonly MeetingPollOptionView[];
  /** How many people have answered, whatever each of them chose. */
  readonly respondents: number;
  /** Whether THIS member has answered it. */
  readonly answered: boolean;
}

/** What a host asks the room: the question, the options, and the two rules the poll is held to. */
export interface MeetingPollDraft {
  readonly question: string;
  readonly options: readonly string[];
  readonly anonymous: boolean;
  readonly maxChoices: number;
}

/** One page of the polls, newest first, and where the next page starts. */
export interface MeetingPollPageView {
  readonly polls: readonly MeetingPollView[];
  readonly nextCursor: string | null;
}

/** One person's answer to an attributed poll, for the host's read of who answered what. */
export interface MeetingPollAnswerView {
  readonly participantId: string;
  readonly participantKind: string;
  readonly userId: string | null;
  readonly answeredAt: string;
  /** The options this person chose, by handle. */
  readonly optionIds: readonly string[];
}

/** One page of who answered what, oldest first. */
export interface MeetingPollAnswerPageView {
  readonly answers: readonly MeetingPollAnswerView[];
  readonly nextCursor: string | null;
}

/** A tally as the relay carries it: a count per option, and how many answered. */
export interface MeetingPollTally {
  readonly counts: ReadonlyMap<string, number>;
  readonly respondents: number;
}

/** The edges this module reaches the outside world through. */
export interface MeetingPollSeams {
  list: (cursor: string | null) => Promise<MeetingWrite<MeetingPollPageView>>;
  open: (draft: MeetingPollDraft) => Promise<MeetingWrite<MeetingPollView>>;
  answer: (pollId: string, optionIds: readonly string[]) => Promise<MeetingWrite<MeetingPollView>>;
  close: (pollId: string) => Promise<MeetingWrite<MeetingPollView>>;
  answers: (
    pollId: string,
    cursor: string | null,
  ) => Promise<MeetingWrite<MeetingPollAnswerPageView>>;
  /** Start ticking, and answer with the way to stop. A seam for the reason the chat poll's is. */
  every: (milliseconds: number, tick: () => void) => () => void;
}

/**
 * Where the room's relay lands. The polls are the SCREEN's, for the reason the transcript is: the
 * client is what is torn down when a connection drops, and a record does not go with it.
 */
export interface MeetingPollRelay {
  notePollOpened: (poll: MeetingPollView) => void;
  notePollClosed: (pollId: string, closedAt: string, tally: MeetingPollTally | null) => void;
  notePollTally: (pollId: string, tally: MeetingPollTally) => void;
}

/** A relay nobody is listening to, for a client with no polls panel beside it. */
export const NO_POLL_RELAY: MeetingPollRelay = {
  notePollOpened: () => {},
  notePollClosed: () => {},
  notePollTally: () => {},
};

/** A count off the wire, or zero where it is not one. */
function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * A tally as a frame or a page states it: a list of `{ optionId, count }` — `counts` on the relay's
 * frames, and the `options` a poll row carries — and `respondents`, which is people, not answers.
 */
export function readPollTally(value: unknown): MeetingPollTally | null {
  if (!isRecord(value)) return null;
  const listed = Array.isArray(value.counts) ? value.counts : value.options;
  if (!Array.isArray(listed)) return null;
  const counts = new Map<string, number>();
  for (const entry of listed) {
    if (!isRecord(entry)) continue;
    const optionId = readString(entry, "optionId");
    if (optionId !== null) counts.set(optionId, readCount(entry.count));
  }
  return { counts, respondents: readCount(value.respondents) };
}

/**
 * One poll, read whole off a frame or a page, or null where the row is not one.
 *
 * READ DEFENSIVELY, like every other frame here: a poll with no handle, no question or no options is
 * not a poll a member can answer, and drawing one would put a card on screen that no write can
 * reach. The read that follows it carries the same row correctly.
 */
export function readPoll(value: unknown): MeetingPollView | null {
  if (!isRecord(value)) return null;
  const pollId = readString(value, "id");
  const question = readString(value, "question");
  const openedAt = readString(value, "openedAt");
  if (pollId === null || question === null || openedAt === null) return null;
  if (!Array.isArray(value.options)) return null;
  const options: MeetingPollOptionView[] = [];
  for (const entry of value.options) {
    if (!isRecord(entry)) continue;
    const optionId = readString(entry, "optionId");
    const label = readString(entry, "label");
    if (optionId === null || label === null) continue;
    options.push({
      optionId,
      position: readCount(entry.position),
      label,
      count: readCount(entry.count),
    });
  }
  if (options.length === 0) return null;
  const maxChoices = readCount(value.maxChoices);
  return {
    pollId,
    askedByUserId: readString(value, "askedByUserId"),
    question,
    anonymous: value.anonymous === true,
    maxChoices: maxChoices === 0 ? 1 : maxChoices,
    openedAt,
    closedAt: readString(value, "closedAt"),
    options: options.toSorted((first, second) => first.position - second.position),
    respondents: readCount(value.respondents),
    // Whether the CALLER answered, which only the read and the caller's own answer can say: the
    // frames are the same for every socket.
    answered: value.answeredByCaller === true,
  };
}

/** Newest first, which is the order the panel shows and the order a stack of polls is read in. */
function newestFirst(first: MeetingPollView, second: MeetingPollView): number {
  if (first.openedAt !== second.openedAt) return first.openedAt > second.openedAt ? -1 : 1;
  return first.pollId > second.pollId ? -1 : 1;
}

/** Keep the larger of two tallies of one poll, option by option. A tally never shrinks. */
function withTally(poll: MeetingPollView, tally: MeetingPollTally): MeetingPollView {
  return {
    ...poll,
    options: poll.options.map((option) => ({
      ...option,
      count: Math.max(option.count, tally.counts.get(option.optionId) ?? 0),
    })),
    respondents: Math.max(poll.respondents, tally.respondents),
  };
}

/** The tally one poll row states, for merging it into a row already held. */
function tallyOf(poll: MeetingPollView): MeetingPollTally {
  return {
    counts: new Map(poll.options.map((option) => [option.optionId, option.count] as const)),
    respondents: poll.respondents,
  };
}

/**
 * Whether a poll is waiting for THIS member's answer: it is open, they have not answered it, and it
 * is not the poll they opened themselves.
 *
 * Everything that decides whether a poll asks something of somebody reads this — the card, which is
 * the options until it is not and the tally after; the count on the Polls control; and the toast —
 * so a host is never told a poll is open by a toast and then shown a card with nothing to answer.
 */
export function awaitsAnswerFrom(poll: MeetingPollView, userId: string | null): boolean {
  if (poll.closedAt !== null || poll.answered) return false;
  return userId === null || poll.askedByUserId !== userId;
}

/**
 * Whether a set of chosen options is an answer this poll will take.
 *
 * At least one, and no more than the poll allows. The screen asks this before it enables Answer, so a
 * refusal the record would give is never something a member has to press to find out.
 */
export function isAcceptableAnswer(poll: MeetingPollView, chosen: readonly string[]): boolean {
  if (chosen.length === 0 || chosen.length > poll.maxChoices) return false;
  const offered = new Set(poll.options.map((option) => option.optionId));
  return chosen.every((optionId) => offered.has(optionId));
}

/**
 * Whether a draft is a poll the record will open: a question of the right length, two to ten
 * options each of the right length, and a choice count the options can meet.
 */
export function isOpenablePoll(draft: MeetingPollDraft): boolean {
  const question = draft.question.trim();
  if (question === "" || question.length > MAX_MEETING_POLL_QUESTION_LENGTH) return false;
  const options = draft.options.map((option) => option.trim());
  if (options.length < MIN_MEETING_POLL_OPTIONS || options.length > MAX_MEETING_POLL_OPTIONS) {
    return false;
  }
  if (options.some((option) => option === "" || option.length > MAX_MEETING_POLL_OPTION_LENGTH)) {
    return false;
  }
  return draft.maxChoices >= 1 && draft.maxChoices <= options.length;
}

/** How many of the options this poll's respondents chose, as a share of the respondents. */
export function shareOf(option: MeetingPollOptionView, poll: MeetingPollView): number {
  return poll.respondents === 0 ? 0 : option.count / poll.respondents;
}

export class MeetingPolls implements MeetingPollRelay {
  /** Every poll this room has opened that this browser has read, newest first. */
  polls = $state<readonly MeetingPollView[]>([]);
  /** True while the FIRST read is in flight. A later backstop read is not a region still arriving. */
  reading = $state(false);
  /** Why the polls could not be read. Null while nothing has refused a read. */
  readFailure = $state<Failure | null>(null);
  /** Why the last thing this member tried to do did not happen. Null while nothing has. */
  writeFailure = $state<Failure | null>(null);
  /** True while a new poll is on its way, so the form cannot open the same one twice. */
  opening = $state(false);
  /** The polls an answer is on its way for, so a card cannot send the same answer twice. */
  answering = $state<ReadonlySet<string>>(new Set());
  /**
   * How many polls have opened since the panel was last looked at. Zero while it is open.
   *
   * It is what raises the one toast: a poll opening while a member watches the room rather than the
   * panel is a poll nobody answers unless something says so, once.
   */
  openedUnseen = $state(0);

  /** The polls waiting for this member's answer: the number on the Polls control. */
  readonly waitingForAnswer = $derived(
    this.polls.filter((poll) => awaitsAnswerFrom(poll, this.#viewer())).length,
  );

  readonly #seams: MeetingPollSeams;
  /** Who is reading, which is what tells the poll they opened from one they are asked. */
  readonly #viewer: () => string | null;
  /** The slow read that stands in for the frames while the socket is down. Null while it is up. */
  #stopTicking: (() => void) | null = null;
  /** True while a read is in flight, so a slow answer cannot stack reads on itself. */
  #refreshing = false;
  /** True while the panel is showing. */
  #open = false;
  /** True between `start` and `stop`: a meeting this module is following. */
  #following = false;

  constructor(seams: MeetingPollSeams, viewer: () => string | null = () => null) {
    this.#seams = seams;
    this.#viewer = viewer;
  }

  /**
   * Start following the polls: read what is there, once. The room's frames carry them from there,
   * so nothing ticks while the socket is up.
   */
  start(): void {
    this.stop();
    this.#following = true;
    this.reading = true;
    void this.refresh();
  }

  /** Stop following them, and let go of what was read: a second meeting holds its own polls. */
  stop(): void {
    this.#stopTicking?.();
    this.#stopTicking = null;
    this.#following = false;
    this.polls = [];
    this.#refreshing = false;
    this.reading = false;
    this.opening = false;
    this.answering = new Set();
    this.openedUnseen = 0;
    this.readFailure = null;
    this.writeFailure = null;
  }

  /** The panel is showing: whatever opened has been seen, and the read is worth making now. */
  noteOpened(): void {
    this.#open = true;
    this.openedUnseen = 0;
    if (this.#following) void this.refresh();
  }

  noteClosed(): void {
    this.#open = false;
  }

  /**
   * The socket went away under a member still on the room's screen. Nothing relayed reaches this
   * browser now, so the slow read stands in for the frames until it comes back.
   */
  noteSocketLost(): void {
    if (!this.#following || this.#stopTicking !== null) return;
    this.#stopTicking = this.#seams.every(POLLS_BACKSTOP_INTERVAL_MILLISECONDS, () => {
      void this.refresh();
    });
  }

  /** The socket is carrying frames again: the slow read stops, and what it missed is read once. */
  noteSocketRestored(): void {
    if (!this.#following || this.#stopTicking === null) return;
    this.#stopTicking();
    this.#stopTicking = null;
    void this.refresh();
  }

  /**
   * Read every poll the room has opened, newest first, page by page.
   *
   * A refusal leaves what is already on screen where it is: a card a member was about to answer,
   * replaced by an error because one read failed, loses their place for nothing.
   */
  async refresh(): Promise<void> {
    if (this.#refreshing) return;
    this.#refreshing = true;
    const outcome = await this.#readFrom(null, [], MAX_POLL_PAGES_READ);
    this.#refreshing = false;
    this.reading = false;
    if (outcome.kind !== "ok") {
      this.readFailure = outcome.failure;
      return;
    }
    this.readFailure = null;
    this.#adopt(outcome.value);
  }

  /**
   * Walk the pages from a cursor to the end, one after the other.
   *
   * A room holds a handful of polls, so every page is read; the bound is what stops a read that
   * somehow never ends from being a walk that never ends.
   */
  async #readFrom(
    cursor: string | null,
    gathered: readonly MeetingPollView[],
    pagesLeft: number,
  ): Promise<MeetingWrite<readonly MeetingPollView[]>> {
    if (pagesLeft === 0) return { kind: "ok", value: gathered };
    const outcome = await this.#seams.list(cursor);
    if (outcome.kind !== "ok") return outcome;
    const next = [...gathered, ...outcome.value.polls];
    if (outcome.value.nextCursor === null) return { kind: "ok", value: next };
    return this.#readFrom(outcome.value.nextCursor, next, pagesLeft - 1);
  }

  /** Ask the room a question. Answers whether the record has it, so the form clears only then. */
  async open(draft: MeetingPollDraft): Promise<boolean> {
    if (this.opening || !isOpenablePoll(draft)) return false;
    this.opening = true;
    this.writeFailure = null;
    const outcome = await this.#seams.open({
      question: draft.question.trim(),
      options: draft.options.map((option) => option.trim()),
      anonymous: draft.anonymous,
      maxChoices: draft.maxChoices,
    });
    this.opening = false;
    if (outcome.kind !== "ok") {
      this.writeFailure = outcome.failure;
      return false;
    }
    this.#adopt([outcome.value]);
    return true;
  }

  /** Answer a poll. Refused here, before any write, where the choice is not one the poll takes. */
  async answer(pollId: string, optionIds: readonly string[]): Promise<boolean> {
    const poll = this.polls.find((held) => held.pollId === pollId);
    if (poll === undefined || poll.answered || poll.closedAt !== null) return false;
    if (!isAcceptableAnswer(poll, optionIds) || this.answering.has(pollId)) return false;
    this.answering = new Set([...this.answering, pollId]);
    this.writeFailure = null;
    const outcome = await this.#seams.answer(pollId, optionIds);
    const still = new Set(this.answering);
    still.delete(pollId);
    this.answering = still;
    if (outcome.kind !== "ok") {
      this.writeFailure = outcome.failure;
      return false;
    }
    // The answer is what makes the card a tally, whatever the row that came back says about who
    // answered: the record has just told this member it holds their answer.
    this.#adopt([{ ...outcome.value, answered: true }]);
    return true;
  }

  /** Close a poll. It cannot be undone, which is the screen's to ask about before this is called. */
  async close(pollId: string): Promise<boolean> {
    this.writeFailure = null;
    const outcome = await this.#seams.close(pollId);
    if (outcome.kind !== "ok") {
      this.writeFailure = outcome.failure;
      return false;
    }
    this.#adopt([outcome.value]);
    return true;
  }

  /** One page of who answered what on an attributed poll, for the host's own read. */
  whoAnswered(
    pollId: string,
    cursor: string | null,
  ): Promise<MeetingWrite<MeetingPollAnswerPageView>> {
    return this.#seams.answers(pollId, cursor);
  }

  /**
   * A poll the room relayed as it opened. News, unless the panel is already showing it — or it is the
   * poll this member opened, whose frame can land before their own write has answered.
   */
  notePollOpened(poll: MeetingPollView): void {
    const known = this.polls.some((held) => held.pollId === poll.pollId);
    this.#adopt([poll]);
    if (!known && !this.#open && awaitsAnswerFrom(poll, this.#viewer())) this.openedUnseen += 1;
  }

  /** A poll a host closed, with its final tally where the frame carried one. */
  notePollClosed(pollId: string, closedAt: string, tally: MeetingPollTally | null): void {
    const held = this.polls.find((poll) => poll.pollId === pollId);
    if (held === undefined) return;
    const closed = { ...held, closedAt: held.closedAt ?? closedAt };
    this.#adopt([tally === null ? closed : withTally(closed, tally)]);
  }

  /** The room's once-a-second tally. A poll nobody holds is left for the read to bring. */
  notePollTally(pollId: string, tally: MeetingPollTally): void {
    const held = this.polls.find((poll) => poll.pollId === pollId);
    if (held === undefined) return;
    this.#adopt([withTally(held, tally)]);
  }

  /**
   * Take what arrived, merged by handle and kept newest first.
   *
   * THREE THINGS NEVER GO BACKWARDS, whichever door a row arrived through: a count (answers are
   * never withdrawn), a close (a closed poll is never reopened), and this member having answered.
   */
  #adopt(arriving: readonly MeetingPollView[]): void {
    if (arriving.length === 0) return;
    const held = new Map(this.polls.map((poll) => [poll.pollId, poll] as const));
    for (const poll of arriving) {
      const before = held.get(poll.pollId);
      if (before === undefined) {
        held.set(poll.pollId, poll);
        continue;
      }
      held.set(
        poll.pollId,
        withTally(
          {
            ...poll,
            askedByUserId: poll.askedByUserId ?? before.askedByUserId,
            closedAt: poll.closedAt ?? before.closedAt,
            answered: poll.answered || before.answered,
          },
          tallyOf(before),
        ),
      );
    }
    this.polls = [...held.values()].toSorted(newestFirst);
  }
}
