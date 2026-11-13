/*
 * One open conversation: its turns, the message being written, and the poll that watches a pending
 * answer settle.
 *
 * WHY A POLL AND NOT THE SOCKET. The server offers both, and documents them as returning identical
 * state, so the choice changes the transport and not the surface. The socket earns its place when a
 * frame carries something a poll cannot -- a partial answer, once token streaming lands -- and
 * until then it would be a second transport for one screen. Moving to it later touches this file
 * and nothing else.
 *
 * NOTHING HERE IS EVER LOGGED. No console line, no diagnostics record, no error report carries a
 * turn's text: a failed poll reports the turn identifier and the problem the server sent, which is
 * how the rest of the platform treats this record too (packages/magnus/CLAUDE.md).
 *
 * THE TRANSCRIPT READS OLDEST FIRST. The server pages newest first, because that is the page a
 * reader of a long conversation wants; a transcript is read downward, so each page is reversed as
 * it lands and an earlier page is prepended.
 */
import {
  ANSWER_SLOW_AFTER_MILLISECONDS,
  readConversation,
  readTurn,
  submitTurn,
  newWriteKey,
  type MagnusAttachment,
  type MagnusConversation,
  type MagnusModelChoice,
  type MagnusTurn,
  type MagnusTurnProgress,
} from "./magnus-api.ts";
import { LatestOnly, type ReadAttempt } from "../api/latest-only.ts";
import type { ApiOutcome, Failure } from "$lib/api/request.ts";

/** How long between polls while an answer is pending. */
const POLL_INTERVAL_MILLISECONDS = 1000;

/**
 * How many polls in a row may fail before the surface says so. A pending answer outlives a blip in
 * the connection, so a single failed poll is not news; a run of them is, and the reader gets the
 * failure with a way to resume rather than a shape that never settles.
 */
const POLL_FAILURES_BEFORE_REPORTING = 5;

/** True once a turn can no longer change. */
function settled(turn: MagnusTurn): boolean {
  return turn.status !== "pending";
}

export class ConversationSession {
  /** The conversation on screen. Null until the first read lands. */
  conversation = $state<MagnusConversation | null>(null);
  /** Its turns, oldest first. Null until the first read lands, which is the loading state. */
  turns = $state<readonly MagnusTurn[] | null>(null);
  /**
   * The files attached to it, by reference, with what became of each one's text on the most recent
   * question. Read with the conversation, and replaced whole by an attach or a detach, which both
   * answer with the list after the write.
   */
  attachments = $state<readonly MagnusAttachment[]>([]);
  /** Non-null while the conversation has earlier turns than are on screen. */
  earlierCursor = $state<string | null>(null);
  /** The failed read, whole, so the Error ID and the remedy reach the screen from the record. */
  failure = $state<Failure | null>(null);
  /** The failed submit, kept apart from the read: they are different acts with different words. */
  submitFailure = $state<Failure | null>(null);
  /** True while a message is on its way to the server. */
  sending = $state(false);
  /** True while an earlier page is in flight. */
  loadingEarlier = $state(false);
  /**
   * True once a pending answer has been waiting longer than an ordinary one takes.
   *
   * It is not a loading flag and it drives no placeholder: the turn is on the record, and this is
   * the surface owing its reader the same promise a stalled read makes, in the turn's own words.
   * It clears the moment the turn settles, and again whenever the conversation changes.
   */
  answerIsSlow = $state(false);

  readonly #fetchImpl: typeof fetch;
  #conversationId: string | null = null;
  readonly #latest = new LatestOnly();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #slowTimer: ReturnType<typeof setTimeout> | undefined;
  #consecutivePollFailures = 0;

  constructor(fetchImpl: typeof fetch) {
    this.#fetchImpl = fetchImpl;
  }

  /** Which conversation the turns on screen belong to. */
  get conversationId(): string | null {
    return this.#conversationId;
  }

  /** True when this session is already showing (or reading) the given conversation. */
  showing(conversationId: string): boolean {
    return this.#conversationId === conversationId;
  }

  /** The pending answer, if one is in flight. */
  get pendingTurn(): MagnusTurn | null {
    return this.turns?.find((turn) => !settled(turn)) ?? null;
  }

  /** Discard everything, adopt a conversation, and read its newest page. */
  open(conversationId: string): void {
    this.#stopPolling();
    this.#conversationId = conversationId;
    this.#latest.supersede();
    this.conversation = null;
    this.turns = null;
    this.attachments = [];
    this.earlierCursor = null;
    this.failure = null;
    this.submitFailure = null;
    this.sending = false;
    this.loadingEarlier = false;
    this.#consecutivePollFailures = 0;
    void this.#read(conversationId, this.#latest.attempt());
  }

  /** Adopt the attachments an attach or a detach answered with, without a re-read. */
  adoptAttachments(attachments: readonly MagnusAttachment[]): void {
    this.attachments = attachments;
  }

  /**
   * Adopt a conversation that was just started, with no read.
   *
   * A conversation the server has only this moment created holds no turns, so reading it back
   * would cost a round trip to be told so. The first `send` re-reads it and fills the record.
   */
  adopt(conversationId: string): void {
    this.#stopPolling();
    this.#conversationId = conversationId;
    this.#latest.supersede();
    this.conversation = null;
    this.turns = [];
    this.attachments = [];
    this.earlierCursor = null;
    this.failure = null;
    this.submitFailure = null;
    this.sending = false;
    this.#consecutivePollFailures = 0;
  }

  /** Leave every conversation, holding nothing on screen. */
  close(): void {
    this.#stopPolling();
    this.#conversationId = null;
    this.#latest.supersede();
    this.conversation = null;
    this.turns = null;
    this.attachments = [];
    this.earlierCursor = null;
    this.failure = null;
    this.submitFailure = null;
  }

  /** Read the conversation again from the top. */
  reload(): void {
    const conversationId = this.#conversationId;
    if (conversationId === null) return;
    this.open(conversationId);
  }

  /** Read the page of turns before the ones on screen and put them above. */
  async loadEarlier(): Promise<void> {
    const conversationId = this.#conversationId;
    const cursor = this.earlierCursor;
    if (conversationId === null || cursor === null || this.loadingEarlier) return;
    this.loadingEarlier = true;
    const attempt = this.#latest.attempt();
    const outcome = await readConversation(this.#fetchImpl, conversationId, cursor);
    if (!attempt.current) return;
    this.loadingEarlier = false;
    if (outcome.kind !== "ok") {
      this.failure = outcome.failure;
      return;
    }
    const earlier = outcome.value.turns.data.toReversed();
    this.turns = [...earlier, ...(this.turns ?? [])];
    this.earlierCursor = outcome.value.turns.nextCursor;
    this.failure = null;
  }

  /**
   * Send a message. The transcript is re-read rather than guessed at: the server writes the member
   * turn and the pending answer as one pair, and reading them back is what keeps the sequence on
   * screen the sequence on the record.
   */
  async send(content: string, choice: MagnusModelChoice | null = null): Promise<boolean> {
    const conversationId = this.#conversationId;
    if (conversationId === null || this.sending) return false;
    const message = content.trim();
    if (message === "") return false;
    this.sending = true;
    this.submitFailure = null;
    const attempt = this.#latest.attempt();
    const outcome = await submitTurn(
      this.#fetchImpl,
      conversationId,
      message,
      newWriteKey(),
      choice,
    );
    if (!attempt.current) return false;
    this.sending = false;
    if (outcome.kind !== "ok") {
      this.submitFailure = outcome.failure;
      return false;
    }
    await this.#read(conversationId, attempt);
    return true;
  }

  /** Resume watching a pending answer after a run of failed polls. */
  resumePolling(): void {
    this.failure = null;
    this.#consecutivePollFailures = 0;
    this.#schedulePoll();
  }

  /** Stop every timer. Called when the surface holding this session goes away. */
  dispose(): void {
    this.#stopPolling();
    this.#latest.supersede();
  }

  async #read(conversationId: string, attempt: ReadAttempt): Promise<void> {
    const outcome = await readConversation(this.#fetchImpl, conversationId);
    if (!attempt.current) return;
    if (outcome.kind !== "ok") {
      this.turns = this.turns ?? [];
      this.failure = outcome.failure;
      return;
    }
    this.conversation = outcome.value.conversation;
    this.turns = outcome.value.turns.data.toReversed();
    this.attachments = outcome.value.attachments;
    this.earlierCursor = outcome.value.turns.nextCursor;
    this.failure = null;
    this.#schedulePoll();
  }

  #schedulePoll(): void {
    this.#clearPollTimer();
    const pending = this.pendingTurn;
    const conversationId = this.#conversationId;
    // Nothing is pending, so nothing is being waited on: the wait ends with the turn it timed.
    if (pending === null || conversationId === null) {
      this.#stopSlowWatch();
      return;
    }
    this.#startSlowWatch();
    const attempt = this.#latest.attempt();
    this.#timer = setTimeout(() => {
      void this.#poll(conversationId, pending.id, attempt);
    }, POLL_INTERVAL_MILLISECONDS);
  }

  async #poll(conversationId: string, turnId: string, attempt: ReadAttempt): Promise<void> {
    const outcome: ApiOutcome<MagnusTurnProgress> = await readTurn(
      this.#fetchImpl,
      conversationId,
      turnId,
    );
    if (!attempt.current) return;
    if (outcome.kind !== "ok") {
      this.#consecutivePollFailures += 1;
      if (this.#consecutivePollFailures >= POLL_FAILURES_BEFORE_REPORTING) {
        this.failure = outcome.failure;
        return;
      }
      this.#schedulePoll();
      return;
    }
    this.#consecutivePollFailures = 0;
    this.#absorbProgress(turnId, outcome.value);
    this.#schedulePoll();
  }

  /**
   * Fold one poll's answer into the turn it describes.
   *
   * `unknown` is the server saying it cannot report on this turn; the turn stays as it is and the
   * poll keeps asking, because a turn that has not been written yet answers this way and settles a
   * moment later.
   */
  #absorbProgress(turnId: string, progress: MagnusTurnProgress): void {
    if (progress.status === "unknown") return;
    const current = this.turns;
    if (current === null) return;
    this.turns = current.map((turn) =>
      turn.id === turnId
        ? {
            ...turn,
            status: progress.status === "unknown" ? turn.status : progress.status,
            content: progress.content ?? turn.content,
            failureLabel: progress.failureLabel ?? turn.failureLabel,
            contextTruncated: progress.truncatedContext ?? turn.contextTruncated,
          }
        : turn,
    );
  }

  /** Stop the poll AND the wait it was timing. Every path that leaves a conversation calls this. */
  #stopPolling(): void {
    this.#clearPollTimer();
    this.#stopSlowWatch();
  }

  #clearPollTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /**
   * Start timing the wait, once. It is deliberately NOT restarted on each poll: the reader is
   * waiting on one answer, and a timer that reset every second would never reach its threshold.
   */
  #startSlowWatch(): void {
    if (this.#slowTimer !== undefined || this.answerIsSlow) return;
    this.#slowTimer = setTimeout(() => {
      this.#slowTimer = undefined;
      this.answerIsSlow = true;
    }, ANSWER_SLOW_AFTER_MILLISECONDS);
  }

  #stopSlowWatch(): void {
    if (this.#slowTimer !== undefined) clearTimeout(this.#slowTimer);
    this.#slowTimer = undefined;
    this.answerIsSlow = false;
  }
}
