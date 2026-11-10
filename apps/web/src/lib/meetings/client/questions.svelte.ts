/*
 * The questions the room has put to whoever is running it, held where the room is drawn from.
 *
 * THE ROUTE IS THE RECORD, ON CHAT'S TERMS EXACTLY. A question is content somebody said in a meeting,
 * so it is written by a route, read back by a paged read, taken back rather than deleted, and relayed
 * by the room only as a copy of a row that is already committed. `noteQuestionAsked` and its two
 * siblings are where those copies land; nothing here writes through the socket.
 *
 * THE BROWSER SORTS, AND THE READ DOES NOT. The panel shows unanswered questions first and the most
 * upvoted first within each group, and the obvious read would order by that count — but a cursor
 * walking a value that changes while the reader pages repeats rows and skips rows, and an upvote
 * count in a live meeting changes constantly. So the pages walk the record's own stable key, this
 * module holds the whole queue (the record caps it at five hundred), and `questionsInQueueOrder`
 * orders what is held — which is also why the order moves the moment a tally frame arrives rather
 * than on the next read.
 *
 * WHETHER THIS MEMBER HAS UPVOTED IS THE READ'S TO SAY, and their own upvote's. The frames are the
 * same for every socket: a tally says how many, never who, so a frame never moves the control's own
 * state — only the read and this member's own press do.
 *
 * THE RELAY IS THE PATH AND THE READ IS NOT A CLOCK. While the socket is carrying the room's frames,
 * nothing here reads on a timer: three hundred browsers re-reading a queue every few seconds is a
 * steady load on the firm's record and a steady spend of its rate budget, to learn what the frames
 * already said. The queue is read whole when the member arrives and again when the socket comes
 * back (the frames it missed are exactly what a forward walk cannot see); opening the panel reads
 * only what was asked after the last row the read reached; and only while the socket is DOWN does a
 * slow read stand in for the frames.
 */
import type { Failure } from "$lib/api/problem.ts";
import type { MeetingWrite } from "../meetings-api.ts";
import { isRecord, readString } from "./signaling.ts";

/**
 * How often the queue is read while the socket is DOWN, and only then.
 *
 * Slow on purpose: the screen is saying the room stopped answering and offering Rejoin, so this is
 * what keeps an open panel honest meanwhile rather than a substitute for the room. A socket that
 * fails for everybody at once — the room itself going away — is three hundred browsers on this
 * clock together, which is why it is a minute and not the transcript's fifteen seconds.
 */
export const QUESTIONS_BACKSTOP_INTERVAL_MILLISECONDS = 60_000;

/** The longest question, in characters. The record refuses a longer one. */
export const MAX_MEETING_QUESTION_LENGTH = 1000;

/**
 * The most pages one read walks: the record holds at most five hundred questions a meeting, a
 * hundred to a page. A bound on a walk rather than a budget, one past what can exist.
 */
const MAX_QUESTION_PAGES_READ = 6;

/** A question as the panel draws it. */
export interface MeetingQuestionView {
  readonly questionId: string;
  /** The stay that asked it, which is what the roster names somebody by. */
  readonly participantId: string;
  /** Whether a member or a guest asked it. */
  readonly participantKind: string;
  /** The member behind the stay, where it was a member. Null for a guest. */
  readonly userId: string | null;
  /** What was asked. Blank once it has been taken back. */
  readonly body: string;
  readonly askedAt: string;
  /** When a host marked it answered. Null while it is waiting. */
  readonly answeredAt: string | null;
  /** When it was taken back. Null while it stands. */
  readonly redactedAt: string | null;
  readonly upvotes: number;
  /** Whether THIS member has upvoted it. */
  readonly upvotedByMe: boolean;
}

/**
 * A place in the queue on the record's own key: the instant a question was asked and its handle. The
 * list route takes it as `since` with `sinceId` and answers what comes after — or from — it.
 */
export interface MeetingQuestionPosition {
  readonly askedAt: string;
  readonly questionId: string;
}

/** One page of the queue, oldest first, and where the next page starts. */
export interface MeetingQuestionPageView {
  readonly questions: readonly MeetingQuestionView[];
  readonly nextCursor: string | null;
}

/** The edges this module reaches the outside world through. */
export interface MeetingQuestionSeams {
  /**
   * One page, from the beginning or from a cursor, and — where `after` is given — only what was
   * asked at or after that place. The route may answer the place's own row again; it is merged by
   * handle, so it is the same row twice rather than two.
   */
  list: (
    cursor: string | null,
    after?: MeetingQuestionPosition | null,
  ) => Promise<MeetingWrite<MeetingQuestionPageView>>;
  ask: (body: string) => Promise<MeetingWrite<MeetingQuestionView>>;
  upvote: (questionId: string) => Promise<MeetingWrite<MeetingQuestionView>>;
  withdrawUpvote: (questionId: string) => Promise<MeetingWrite<MeetingQuestionView>>;
  markAnswered: (
    questionId: string,
    answered: boolean,
  ) => Promise<MeetingWrite<MeetingQuestionView>>;
  redact: (questionId: string) => Promise<MeetingWrite<MeetingQuestionView>>;
  /** Start ticking, and answer with the way to stop. */
  every: (milliseconds: number, tick: () => void) => () => void;
}

/** Where the room's relay lands. The queue is the SCREEN's, for the reason the transcript is. */
export interface MeetingQuestionRelay {
  noteQuestionAsked: (question: MeetingQuestionView) => void;
  noteQuestionUpdated: (question: MeetingQuestionView) => void;
  noteQuestionTally: (upvotes: ReadonlyMap<string, number>) => void;
}

/**
 * How a row's upvote count is taken.
 *
 * `higher` keeps the larger of the two, for a copy this browser cannot place in time against the
 * tally frames: a relayed copy, a write's answer, a page read forward. `stated` takes the count as
 * it is said, which two doors may do: a tally frame, which arrives in the room's own order, and a
 * whole read asked while no tally frame for that question was arriving.
 */
type CountRule = "higher" | "stated";

/** A relay nobody is listening to, for a client with no question panel beside it. */
export const NO_QUESTION_RELAY: MeetingQuestionRelay = {
  noteQuestionAsked: () => {},
  noteQuestionUpdated: () => {},
  noteQuestionTally: () => {},
};

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * One question, read whole off a frame or a page, or null where the row is not one.
 *
 * A row missing its handle, its stay or the instant that orders it is not a row: drawing it would put
 * a question somewhere arbitrary in a queue a host is working through.
 */
export function readQuestion(value: unknown): MeetingQuestionView | null {
  if (!isRecord(value)) return null;
  const questionId = readString(value, "id");
  const participantId = readString(value, "participantId");
  const askedAt = readString(value, "askedAt");
  if (questionId === null || participantId === null || askedAt === null) return null;
  return {
    questionId,
    participantId,
    participantKind: readString(value, "participantKind") ?? "member",
    userId: readString(value, "userId"),
    body: readString(value, "body") ?? "",
    askedAt,
    answeredAt: readString(value, "answeredAt"),
    redactedAt: readString(value, "redactedAt"),
    upvotes: readCount(value.upvotes),
    // Only the read and the caller's own press say this; a relayed copy never carries it.
    upvotedByMe: value.upvotedByCaller === true,
  };
}

/**
 * The room's coalesced upvote counts — the frame's `questions`, as `[{ questionId, upvotes }]` — into
 * one count per handle. Only the questions whose count moved inside the room's second are on it.
 */
export function readQuestionTally(frame: Record<string, unknown>): ReadonlyMap<string, number> {
  const upvotes = new Map<string, number>();
  if (!Array.isArray(frame.questions)) return upvotes;
  for (const entry of frame.questions) {
    if (!isRecord(entry)) continue;
    const questionId = readString(entry, "questionId");
    if (questionId !== null) upvotes.set(questionId, readCount(entry.upvotes));
  }
  return upvotes;
}

/** Whether a question is still waiting for an answer, and still stands. */
export function isWaiting(question: MeetingQuestionView): boolean {
  return question.answeredAt === null && question.redactedAt === null;
}

/**
 * The queue in the order a host works it: unanswered first, the most upvoted first within each
 * group, and the question asked first where two are level — so a question that has waited longest
 * is not overtaken by one asked a second ago with the same support.
 */
export function questionsInQueueOrder(
  questions: readonly MeetingQuestionView[],
): readonly MeetingQuestionView[] {
  return questions.toSorted((first, second) => {
    const firstAnswered = first.answeredAt !== null ? 1 : 0;
    const secondAnswered = second.answeredAt !== null ? 1 : 0;
    if (firstAnswered !== secondAnswered) return firstAnswered - secondAnswered;
    if (first.upvotes !== second.upvotes) return second.upvotes - first.upvotes;
    if (first.askedAt !== second.askedAt) return first.askedAt < second.askedAt ? -1 : 1;
    return first.questionId < second.questionId ? -1 : 1;
  });
}

export class MeetingQuestions implements MeetingQuestionRelay {
  /** Every question this browser holds, in the order the record states them: oldest first. */
  questions = $state<readonly MeetingQuestionView[]>([]);
  /** True while the FIRST read is in flight. */
  reading = $state(false);
  readFailure = $state<Failure | null>(null);
  writeFailure = $state<Failure | null>(null);
  /** True while a question is on its way, so the composer cannot ask the same one twice. */
  asking = $state(false);
  /** The questions an upvote or its withdrawal is on its way for. */
  upvoting = $state<ReadonlySet<string>>(new Set());

  /** The queue as a host works it. */
  readonly queue = $derived(questionsInQueueOrder(this.questions));
  /** How many are still waiting: the number on the Q&A control. */
  readonly waiting = $derived(this.questions.filter(isWaiting).length);

  readonly #seams: MeetingQuestionSeams;
  /** The slow read that stands in for the frames while the socket is down. Null while it is up. */
  #stopTicking: (() => void) | null = null;
  #refreshing = false;
  /** True between `start` and `stop`: a meeting this module is following. */
  #following = false;
  /**
   * The last row a READ reached, which is where the next forward read starts.
   *
   * The read's own place and never the newest row held: a relayed copy can name a question asked
   * after one whose frame this browser never got, and starting from the copy would skip the one in
   * between for good. Null until a whole read has succeeded, and then a forward read is not offered.
   */
  #readThrough: MeetingQuestionPosition | null = null;
  /**
   * When each question's count was last moved by a tally frame, on a counter of frames rather than a
   * clock: a whole read that a frame arrived during cannot say which of the two is newer.
   */
  #talliedAt = new Map<string, number>();
  #tallies = 0;

  constructor(seams: MeetingQuestionSeams) {
    this.#seams = seams;
  }

  /**
   * Start following the queue: read it whole, once. The room's frames carry it from there, so
   * nothing ticks while the socket is up.
   */
  start(): void {
    this.stop();
    this.#following = true;
    this.reading = true;
    void this.refresh();
  }

  stop(): void {
    this.#stopTicking?.();
    this.#stopTicking = null;
    this.#following = false;
    this.#readThrough = null;
    this.#talliedAt = new Map();
    this.questions = [];
    this.#refreshing = false;
    this.reading = false;
    this.asking = false;
    this.upvoting = new Set();
    this.readFailure = null;
    this.writeFailure = null;
  }

  /**
   * The panel is showing, which is when a read is worth its cost — and only what was asked since the
   * last row the read reached, because while the socket is up the frames have said the rest.
   */
  noteOpened(): void {
    if (!this.#following) return;
    if (this.#readThrough === null) void this.refresh();
    else void this.#readForward(this.#readThrough);
  }

  /**
   * The socket went away under a member still on the room's screen. Nothing relayed reaches this
   * browser now, so the slow read stands in for the frames until it comes back.
   */
  noteSocketLost(): void {
    if (!this.#following || this.#stopTicking !== null) return;
    this.#stopTicking = this.#seams.every(QUESTIONS_BACKSTOP_INTERVAL_MILLISECONDS, () => {
      void this.refresh();
    });
  }

  /**
   * The socket is carrying frames again. The slow read stops, and the queue is read whole once:
   * what changed while it was down — a mark, a redaction, an upvote taken back — changed rows this
   * browser already holds, which a forward read would never reach.
   */
  noteSocketRestored(): void {
    if (!this.#following || this.#stopTicking === null) return;
    this.#stopTicking();
    this.#stopTicking = null;
    void this.refresh();
  }

  /**
   * Read the whole queue again, from its beginning.
   *
   * WHOLE, NOT FROM WHERE IT LEFT OFF, because what changes on a question is not where it sits: an
   * upvote, a mark and a redaction all leave a row at its own key, so a walk forward from the last
   * row would never see them. The record caps a meeting at five hundred questions, which is what
   * makes reading all of them a read rather than a scan; a failed read leaves the queue where it is.
   */
  async refresh(): Promise<void> {
    if (this.#refreshing) return;
    this.#refreshing = true;
    const askedAt = this.#tallies;
    const outcome = await this.#readFrom(null, null, [], MAX_QUESTION_PAGES_READ);
    this.#refreshing = false;
    this.reading = false;
    if (outcome.kind !== "ok") {
      this.readFailure = outcome.failure;
      return;
    }
    this.readFailure = null;
    this.#noteReadThrough(outcome.value);
    // The read is the record, so its counts stand as stated — an upvote taken back is how a count
    // comes DOWN — except on a question a tally frame moved while this read was on its way, where
    // which of the two is newer cannot be told and the higher is kept.
    const settled: MeetingQuestionView[] = [];
    const raced: MeetingQuestionView[] = [];
    for (const question of outcome.value) {
      const tallied = this.#talliedAt.get(question.questionId);
      if (tallied !== undefined && tallied >= askedAt) raced.push(question);
      else settled.push(question);
    }
    this.#adopt(settled, "stated", "stated");
    this.#adopt(raced, "stated", "higher");
  }

  /**
   * Read only what was asked from a place onward. The route answers the place's own row again, and
   * merging by handle makes that the same row rather than a second one.
   */
  async #readForward(from: MeetingQuestionPosition): Promise<void> {
    if (this.#refreshing) return;
    this.#refreshing = true;
    const outcome = await this.#readFrom(null, from, [], MAX_QUESTION_PAGES_READ);
    this.#refreshing = false;
    if (outcome.kind !== "ok") {
      this.readFailure = outcome.failure;
      return;
    }
    this.readFailure = null;
    this.#noteReadThrough(outcome.value);
    this.#adopt(outcome.value, "stated", "higher");
  }

  /** Remember the furthest row a read reached, on the record's own key. */
  #noteReadThrough(read: readonly MeetingQuestionView[]): void {
    const last = read.toSorted(inOrderAsked).at(-1);
    if (last === undefined) return;
    const held = this.#readThrough;
    if (held !== null && inOrderAsked(asPosition(last), held) <= 0) return;
    this.#readThrough = { askedAt: last.askedAt, questionId: last.questionId };
  }

  async #readFrom(
    cursor: string | null,
    after: MeetingQuestionPosition | null,
    gathered: readonly MeetingQuestionView[],
    pagesLeft: number,
  ): Promise<MeetingWrite<readonly MeetingQuestionView[]>> {
    if (pagesLeft === 0) return { kind: "ok", value: gathered };
    const outcome = await this.#seams.list(cursor, after);
    if (outcome.kind !== "ok") return outcome;
    const next = [...gathered, ...outcome.value.questions];
    if (outcome.value.nextCursor === null) return { kind: "ok", value: next };
    return this.#readFrom(outcome.value.nextCursor, after, next, pagesLeft - 1);
  }

  /** Put a question to the room. Answers whether the record has it, so the composer clears then. */
  async ask(body: string): Promise<boolean> {
    const stated = body.trim();
    if (stated === "" || stated.length > MAX_MEETING_QUESTION_LENGTH || this.asking) return false;
    this.asking = true;
    this.writeFailure = null;
    const outcome = await this.#seams.ask(stated);
    this.asking = false;
    if (outcome.kind !== "ok") {
      this.writeFailure = outcome.failure;
      return false;
    }
    this.#adopt([outcome.value], "stated", "higher");
    return true;
  }

  /**
   * Upvote a question, or take the upvote back: one control, read from its own state.
   *
   * An upvote that could not be taken back would be a vote rather than a signal, which is why the
   * withdrawal is the same press. The row that comes back is what is drawn, so the count and the
   * control's state are the record's rather than a guess made here.
   */
  async toggleUpvote(questionId: string): Promise<boolean> {
    const held = this.questions.find((question) => question.questionId === questionId);
    if (held === undefined || held.redactedAt !== null || this.upvoting.has(questionId)) {
      return false;
    }
    this.upvoting = new Set([...this.upvoting, questionId]);
    this.writeFailure = null;
    const outcome = held.upvotedByMe
      ? await this.#seams.withdrawUpvote(questionId)
      : await this.#seams.upvote(questionId);
    const still = new Set(this.upvoting);
    still.delete(questionId);
    this.upvoting = still;
    if (outcome.kind !== "ok") {
      this.writeFailure = outcome.failure;
      return false;
    }
    // The press itself is what says whose upvote it is, whatever the row that came back carries.
    // The COUNT keeps the higher: the row was read as this write committed, and a tally frame for
    // somebody else's upvote may already have landed past it. Taking an upvote back still shows,
    // because the room relays the count after it on its next frame.
    this.#adopt([{ ...outcome.value, upvotedByMe: !held.upvotedByMe }], "stated", "higher");
    return true;
  }

  /** Mark a question answered, or take the mark back where a host marked the wrong one. */
  async markAnswered(questionId: string, answered: boolean): Promise<boolean> {
    return this.#write(() => this.#seams.markAnswered(questionId, answered));
  }

  /** Take a question back. The row stays, blanked, which is what the record keeps. */
  async redact(questionId: string): Promise<boolean> {
    return this.#write(() => this.#seams.redact(questionId));
  }

  async #write(act: () => Promise<MeetingWrite<MeetingQuestionView>>): Promise<boolean> {
    this.writeFailure = null;
    const outcome = await act();
    if (outcome.kind !== "ok") {
      this.writeFailure = outcome.failure;
      return false;
    }
    this.#adopt([outcome.value], "kept", "higher");
    return true;
  }

  /** A question the room relayed as it was asked. */
  noteQuestionAsked(question: MeetingQuestionView): void {
    this.#adopt([question], "kept", "higher");
  }

  /**
   * A question the room says was answered, unmarked or taken back — the whole question again, and
   * the mark and the redaction on it always apply. Its COUNT is a reading taken when that act
   * committed, which may be older than a tally frame already here, so the higher is kept. Whether
   * this member upvoted it is the one thing a relayed copy cannot say, so that is kept too.
   */
  noteQuestionUpdated(question: MeetingQuestionView): void {
    this.#adopt([question], "kept", "higher");
  }

  /**
   * The room's once-a-second upvote counts. The order moves here, without a read.
   *
   * A TALLY FRAME IS TAKEN AS STATED, AND IT IS THE WAY A COUNT COMES DOWN. An upvote can be taken
   * back, so a count is not monotone the way a poll's is, and every other door here keeps the higher
   * of two counts it cannot place in time. The frames can be placed: they reach this socket in the
   * order the room sent them, and the room keeps a high-water mark per question — the instant the
   * route read the count it last sent — and drops any tally at or behind it, so no frame states an
   * older reading than one before it. The next frame after a withdrawal therefore states the count
   * after it. A whole read is the other way down: on reconnect and while the socket is down.
   */
  noteQuestionTally(upvotes: ReadonlyMap<string, number>): void {
    if (upvotes.size === 0) return;
    this.#tallies += 1;
    const changed: MeetingQuestionView[] = [];
    for (const question of this.questions) {
      const count = upvotes.get(question.questionId);
      if (count === undefined) continue;
      this.#talliedAt.set(question.questionId, this.#tallies);
      if (count !== question.upvotes) changed.push({ ...question, upvotes: count });
    }
    this.#adopt(changed, "kept", "stated");
  }

  /**
   * Take what arrived, merged by handle and kept in the record's order.
   *
   * `stated` rows come from the read or from this member's own write, and say whether this member
   * has upvoted; `kept` rows come from the relay, which never does, so the control keeps what it
   * already knew. A redaction never goes backwards either: a row once taken back stays blank
   * whichever door a later copy of it came through. The count follows `counts` — see `CountRule`.
   */
  #adopt(
    arriving: readonly MeetingQuestionView[],
    mine: "stated" | "kept",
    counts: CountRule,
  ): void {
    if (arriving.length === 0) return;
    const held = new Map(
      this.questions.map((question) => [question.questionId, question] as const),
    );
    for (const question of arriving) {
      const before = held.get(question.questionId);
      if (before === undefined) {
        held.set(question.questionId, question);
        continue;
      }
      const redactedAt = question.redactedAt ?? before.redactedAt;
      held.set(question.questionId, {
        ...question,
        body: redactedAt === null ? question.body : "",
        redactedAt,
        upvotes:
          counts === "stated" ? question.upvotes : Math.max(before.upvotes, question.upvotes),
        upvotedByMe: mine === "stated" ? question.upvotedByMe : before.upvotedByMe,
      });
    }
    this.questions = [...held.values()].toSorted(inOrderAsked);
  }
}

/** A row's place on the record's own key. */
function asPosition(question: MeetingQuestionView): MeetingQuestionPosition {
  return { askedAt: question.askedAt, questionId: question.questionId };
}

/** The order the record states: oldest first, and by the row's own handle within one instant. */
function inOrderAsked(first: MeetingQuestionPosition, second: MeetingQuestionPosition): number {
  if (first.askedAt !== second.askedAt) return first.askedAt < second.askedAt ? -1 : 1;
  if (first.questionId === second.questionId) return 0;
  return first.questionId < second.questionId ? -1 : 1;
}
