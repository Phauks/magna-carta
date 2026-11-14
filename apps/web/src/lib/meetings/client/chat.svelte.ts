/*
 * What is being said in the room, held where the room is drawn from.
 *
 * THE RECORD IS THE ROUTE, AND THIS FOLLOWS IT. A message is written by a POST and read back by a
 * paged GET; the room will later relay a copy of a committed row so a message reaches the other
 * browsers as it is said rather than on the next tick, and `noteMessageFrame` is where that copy
 * lands when it does. Nothing here writes through the socket — a record that existed only where a
 * Durable Object's transient storage holds it would be a record that empties when the room does.
 *
 * THE POLL CONTINUES FROM THE CURSOR, NEVER FROM A TIMESTAMP. Each page answers with the key of its
 * own last row, and that key is where the next page starts. An instant cannot do this job: two
 * messages written in the same millisecond are ordered by the row's own handle, so a poller asking
 * "everything since 15:04:07.912" either skips the second of them or reads the first one twice.
 * A page with nothing in it carries no cursor, and leaves the one we hold exactly where it was.
 *
 * WHAT IS NEW IS COUNTED ONLY ONCE THE TRANSCRIPT IS IN HAND. The first page is what was said
 * before this member opened the panel, which for somebody joining at the twentieth minute is the
 * whole conversation — a badge reading forty on arrival is noise, not news. So the count starts
 * after the first page settles, and counts what somebody else said while the panel was closed.
 *
 * EVERY EDGE IS A SEAM, like every other module in this directory: the three calls and the ticking.
 * Nothing here touches `window`, so a case about what three seconds of polling does is a unit test
 * rather than a rehearsal.
 */
import type { MeetingMessage, MeetingMessagePage } from "@magna-carta/api-client";
import {
  readMeetingMessages,
  redactMeetingMessage,
  sendMeetingMessage,
  type MeetingWrite,
} from "../meetings-api.ts";
import type { Failure } from "$lib/api/problem.ts";

/**
 * How often the transcript is asked for what it has gained, BEFORE the room has relayed anything.
 *
 * Short, because a message nobody sees for a quarter of a minute is a message answered after the
 * subject changed — and the read is a keyset walk from a cursor, which is index-covered and returns
 * an empty page when nothing has been said. This is the pace of a browser that has no evidence the
 * relay reaches it: a room on an older build, a socket that has not carried one yet, a member who
 * joined a conversation nobody has added to since.
 */
export const CHAT_POLL_INTERVAL_MILLISECONDS = 3_000;

/**
 * And how often once a relayed message HAS arrived, which is when the poll stops being the path.
 *
 * THE POLL IS NEVER TURNED OFF, only stretched, and the difference is the whole reason it is still
 * here. A frame reaches a socket that is open and has not missed anything; the read is what catches
 * a browser up on the frames it did not get — a socket that dropped and came back, a room that
 * relayed while this tab was asleep, a message whose frame was lost behind a `sync`. The transcript
 * is a RECORD, so being three seconds late is a nuisance and being silently wrong is not
 * acceptable, which is what a poll-free client would be the first time a frame went missing.
 *
 * Fifteen seconds rather than a minute because that is a quarter of what a stretched interval costs
 * over an hour-long meeting and still bounds how long a missed message can be invisible.
 */
export const CHAT_BACKSTOP_POLL_INTERVAL_MILLISECONDS = 15_000;

/** The edges this module reaches the outside world through. */
export interface MeetingChatSeams {
  /** One page of the transcript, continuing from the cursor the last page answered with. */
  list: (cursor: string | null) => Promise<MeetingWrite<MeetingMessagePage>>;
  /** Say something, pointing at one of the meeting's matter's files where one is shared. */
  send: (body: string, attachedFileId: string | null) => Promise<MeetingWrite<MeetingMessage>>;
  redact: (messageId: string) => Promise<MeetingWrite<MeetingMessage>>;
  /** Start ticking, and answer with the way to stop. A seam for the reason the sampling tick is. */
  every: (milliseconds: number, tick: () => void) => () => void;
}

/**
 * The seams as the app supplies them.
 *
 * The meeting arrives as an accessor rather than a value because the room screen is reused across
 * an address change — a member walking from one meeting to another keeps the same component, and a
 * meeting captured when the module was built would have this reading the previous room's messages.
 */
export function meetingChatSeams(meetingId: () => string): MeetingChatSeams {
  return {
    list: (cursor) => readMeetingMessages(meetingId(), cursor),
    send: (body, attachedFileId) => sendMeetingMessage(meetingId(), body, attachedFileId),
    redact: (messageId) => redactMeetingMessage(meetingId(), messageId),
    every: (milliseconds, tick) => {
      const ticking = setInterval(tick, milliseconds);
      return () => clearInterval(ticking);
    },
  };
}

/**
 * Where the room's relay lands.
 *
 * THE TRANSCRIPT IS NOT THE CLIENT'S, and this seam is why. The socket belongs to the state machine
 * and the record belongs to the screen that reads it — a meeting's messages are a route and a row,
 * and folding them into the client would put the one stored thing in this subsystem inside the
 * object that is torn down when a connection drops. So the client relays through an interface with
 * a no-op default, exactly as it emits diagnostics through one, and neither knows what the other
 * is.
 */
export interface MeetingChatRelay {
  noteMessageFrame: (message: MeetingMessage) => void;
  noteMessageRedacted: (messageId: string, redactedAt: string) => void;
}

/** Whether a message has been taken back, which is a blanked body and a stamped redaction. */
export function wasTakenBack(message: MeetingMessage): boolean {
  return message.redactedAt !== null;
}

export class MeetingChat {
  /** Everything said in this room that this browser has read, oldest first. */
  messages = $state<readonly MeetingMessage[]>([]);
  /** True while the FIRST page is in flight. A later poll is not a region that has not arrived. */
  reading = $state(false);
  /** Why the transcript could not be read. Null while nothing has refused one. */
  readFailure = $state<Failure | null>(null);
  /** Why the last thing this member tried to do did not happen. Null while nothing has. */
  writeFailure = $state<Failure | null>(null);
  /** True while a message is on its way, so the composer cannot send the same one twice. */
  sending = $state(false);
  /** How much has been said since the panel was last open. Zero while it is open. */
  unread = $state(0);

  readonly #seams: MeetingChatSeams;
  #stopTicking: (() => void) | null = null;
  /** Where the next page starts: the key of the last row of the last page that had any. */
  #cursor: string | null = null;
  /** True while a read is in flight, so a slow answer cannot stack polls on itself. */
  #polling = false;
  /** True once the first page has settled, which is when a new message becomes news. */
  #caughtUp = false;
  /** True while the panel is showing, which is what stops a message counting as unread. */
  #open = false;
  /**
   * True once the ROOM has relayed something, which is the evidence that stretches the poll.
   *
   * It is evidence rather than a setting: nothing tells this browser whether the room it is in
   * relays messages, so the first frame that arrives is what says so, and until one does the short
   * interval is what makes chat work at all.
   */
  #relayed = false;

  constructor(seams: MeetingChatSeams) {
    this.#seams = seams;
  }

  /**
   * Start following the transcript: read what is there, then ask again on the tick.
   *
   * Starting a running one restarts it rather than leaving two tickers, on the rule the sampling
   * timer keeps.
   */
  start(): void {
    this.stop();
    this.reading = true;
    this.#tick(CHAT_POLL_INTERVAL_MILLISECONDS);
    void this.refresh();
  }

  /**
   * Stop following it, and let go of what was read.
   *
   * The transcript is on the record and is read again from the beginning next time, so nothing is
   * lost by forgetting it; what would be wrong is a client joining a second meeting holding the
   * first one's conversation.
   */
  stop(): void {
    this.#stopTicking?.();
    this.#stopTicking = null;
    this.messages = [];
    this.#cursor = null;
    this.#polling = false;
    this.#caughtUp = false;
    this.#relayed = false;
    this.reading = false;
    this.sending = false;
    this.unread = 0;
    this.readFailure = null;
    this.writeFailure = null;
  }

  /** The panel is showing: what has arrived has been seen. */
  noteOpened(): void {
    this.#open = true;
    this.unread = 0;
  }

  /** The panel is closed, so what arrives next is worth a mark on the control. */
  noteClosed(): void {
    this.#open = false;
  }

  /**
   * Read whatever the transcript has gained since the last page.
   *
   * A refusal leaves what is already on screen exactly where it is: a conversation replaced by an
   * error because one poll in twenty failed is a surface that loses a member's place for nothing,
   * and the next tick asks again. The notice is only raised where there is nothing to show.
   */
  async refresh(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    const outcome = await this.#seams.list(this.#cursor);
    this.#polling = false;
    this.reading = false;
    if (outcome.kind !== "ok") {
      this.readFailure = outcome.failure;
      this.#caughtUp = true;
      return;
    }
    this.readFailure = null;
    // Read rather than trusted, because this one runs unattended for the length of a meeting: an
    // answer shaped differently from the contract would otherwise throw out of a tick nobody is
    // awaiting, and take the next three seconds' poll with it.
    const arrived = Array.isArray(outcome.value.data) ? outcome.value.data : [];
    this.#adopt(arrived);
    /*
     * WHAT WAS TAKEN BACK BEHIND THE CURSOR, which the forward walk cannot reach on its own. A
     * redaction does not move a row — the instant it was said at is unchanged — so a poller reading
     * forward from where it left off would never see it, and a browser that had the message on
     * screen before it was withdrawn would be the only one still showing the words. So the page
     * carries the handles and the instants of what has been redacted since the cursor, and they are
     * applied to whatever this browser is still holding.
     */
    const redacted = Array.isArray(outcome.value.redacted) ? outcome.value.redacted : [];
    for (const row of redacted) {
      if (typeof row.id !== "string" || typeof row.redactedAt !== "string") continue;
      this.#markRedacted(row.id, row.redactedAt);
    }
    // A page with nothing in it carries no cursor, so the one we hold is still where to continue.
    if (typeof outcome.value.nextCursor === "string") this.#cursor = outcome.value.nextCursor;
    this.#caughtUp = true;
  }

  /**
   * Say something. Answers whether it reached the record, so a composer clears only what was sent.
   *
   * The body is trimmed here because the record is what somebody said, and trailing newlines from
   * a field are not part of that. An empty one is not a message and never leaves the browser,
   * unless it shares a file: the file is then what was said, and the record names it.
   */
  async send(body: string, attachedFileId: string | null = null): Promise<boolean> {
    const stated = body.trim();
    if ((stated === "" && attachedFileId === null) || this.sending) return false;
    this.sending = true;
    this.writeFailure = null;
    const outcome = await this.#seams.send(stated, attachedFileId);
    this.sending = false;
    if (outcome.kind !== "ok") {
      this.writeFailure = outcome.failure;
      return false;
    }
    // Shown the moment the record has it, rather than on the next tick: the person who typed it is
    // watching, and a message that takes three seconds to appear reads as one that did not send.
    // Never news — it is this member's own, and they are looking at it.
    this.#adopt([outcome.value], false);
    return true;
  }

  /**
   * Take a message back: the body is blanked and the row stays, which is what the answer carries.
   *
   * The row this browser holds is replaced by the one that came back rather than edited here, so
   * what is drawn is what the record says — including who took it back and when.
   */
  async redact(messageId: string): Promise<boolean> {
    this.writeFailure = null;
    const outcome = await this.#seams.redact(messageId);
    if (outcome.kind !== "ok") {
      this.writeFailure = outcome.failure;
      return false;
    }
    this.#adopt([outcome.value], false);
    return true;
  }

  /**
   * A message the ROOM relayed, rather than one a page answered with.
   *
   * The seam for the relay frame: the room will send a copy of a row it has already committed, so
   * a message reaches the other browsers as it is said. It goes through the same merge as a page
   * does, which is what makes a browser that misses the frame no worse off than one that gets it —
   * the poll behind it reads the same row and the two collapse into one.
   */
  noteMessageFrame(message: MeetingMessage): void {
    this.#noteRelayReaches();
    this.#adopt([message]);
  }

  /**
   * A message the room says was taken back.
   *
   * The frame carries the handle and the instant alone — the body is already blank on the record,
   * and sending it again would be sending the words back down the wire that were just removed. So
   * the row this browser holds is blanked here and STAMPED, which is what the panel reads to draw
   * the mark where the words were; who took it back arrives with the next page, because only the
   * read carries it and nothing on screen depends on the name.
   *
   * A row nobody holds is not invented: the page that first carries the message will carry it
   * already redacted, so a browser that missed the message and the redaction alike ends up with the
   * same transcript as one that saw both.
   */
  noteMessageRedacted(messageId: string, redactedAt: string): void {
    this.#noteRelayReaches();
    this.#markRedacted(messageId, redactedAt);
  }

  /**
   * Blank a row this browser holds and stamp it, whichever door the redaction arrived through.
   *
   * ONE DOOR FOR TWO ROUTES: the room's frame and the page's own `redacted` list say the same
   * thing, so a browser that saw the frame and a browser that only ever polls end up with the same
   * transcript. A row already stamped is left exactly as it is — the read carries who took it back
   * and the frame does not, and overwriting the fuller answer with the emptier one would lose it.
   */
  #markRedacted(messageId: string, redactedAt: string): void {
    const held = this.messages.find((message) => message.id === messageId);
    if (held === undefined || held.redactedAt !== null) return;
    this.#adopt([{ ...held, body: "", redactedAt }], false);
  }

  /**
   * The room relays, so the poll becomes the backstop it was always meant to be.
   *
   * The ticker is restarted rather than left alone, because the interval is decided when it is
   * armed; a browser that learned the room relays and went on asking every three seconds would be
   * paying for a path it is no longer on. Done once — the second frame changes nothing.
   */
  #noteRelayReaches(): void {
    if (this.#relayed || this.#stopTicking === null) return;
    this.#relayed = true;
    this.#tick(CHAT_BACKSTOP_POLL_INTERVAL_MILLISECONDS);
  }

  /** Arm the poll at one interval, replacing whatever was armed before. */
  #tick(milliseconds: number): void {
    this.#stopTicking?.();
    this.#stopTicking = this.#seams.every(milliseconds, () => {
      void this.refresh();
    });
  }

  /**
   * Take what arrived, keeping the transcript in the order the record states it.
   *
   * Merged by handle rather than appended, because the same row reaches this browser by two routes:
   * the answer to this member's own write, and the page that follows it. Appending would draw a
   * message twice, and a transcript that repeats itself is one nobody trusts about anything else.
   */
  #adopt(arriving: readonly MeetingMessage[], news = true): void {
    if (arriving.length === 0) return;
    const held = new Map(this.messages.map((message) => [message.id, message] as const));
    let arrivedUnseen = 0;
    for (const message of arriving) {
      if (news && !held.has(message.id) && this.#countsAsNews(message)) arrivedUnseen += 1;
      held.set(message.id, message);
    }
    this.messages = [...held.values()].toSorted(inOrderSaid);
    if (arrivedUnseen > 0) this.unread += arrivedUnseen;
  }

  /**
   * Whether a message arriving is something to mark the control with.
   *
   * Three ways it is not: it came in the first page, which is the conversation rather than news;
   * the panel is open, so it is already on screen; or it has been taken back, and a mark inviting
   * somebody to go and read a blank row is a mark that lies about what is there.
   */
  #countsAsNews(message: MeetingMessage): boolean {
    return this.#caughtUp && !this.#open && !wasTakenBack(message);
  }
}

/** The order the record states: oldest first, and by the row's own handle within one instant. */
function inOrderSaid(first: MeetingMessage, second: MeetingMessage): number {
  if (first.sentAt !== second.sentAt) return first.sentAt < second.sentAt ? -1 : 1;
  return first.id < second.id ? -1 : 1;
}
