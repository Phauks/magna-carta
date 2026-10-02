/*
 * A raised hand and a thrown reaction: the two signals in this room that are relayed and never
 * stored.
 *
 * WHY THEY ARE ONE MODULE. They are the same kind of fact — something a person says about the next
 * few seconds, which the meeting's record does not keep — and they are paced by the same window on
 * the wire. `SIGNAL_INTERVAL_MILLISECONDS` governs a change of hand AND a reaction together,
 * because the room counts them together: one act per participant per window, and the next inside it
 * is refused rather than dropped. Two modules would be two clocks, and the room would refuse the
 * browser for behaving correctly.
 *
 * THE ROOM REFUSES, IT DOES NOT DROP, AND THAT IS WHY THIS PACES ITSELF. A presence frame carrying
 * only `speaking` and `muted` states the whole of what it is about, so the room may discard one and
 * lose nothing a later frame does not restate. A hand and a reaction are single acts with nothing
 * behind them: dropped, a raised hand is never relayed and the host never learns somebody wants the
 * floor. So the room answers `rate-limited` with the socket open, and the browser's half of that
 * bargain is here — it paces what it sends, and where it is refused anyway it SENDS THE SETTLED
 * HAND AGAIN once the window has passed. A reaction is not re-sent: it was a thing somebody threw
 * at a moment, and throwing it a second later is a different act nobody asked for.
 *
 * WHAT IS DRAWN IS HELD HERE AND NOWHERE ELSE. A bubble on a tile and the coalesced counts strip
 * both live for `REACTION_DWELL_MILLISECONDS` and then are not drawn at all — there is no closed
 * state, nothing fades back to, and no record of any of it. The dwell is a CLIENT constant because
 * only the browser reads it: the room relays an instant and says nothing about how long anybody
 * should look at it.
 *
 * EVERY EDGE IS A SEAM, like every other module in this directory. The socket, the clock and the
 * waiting are supplied, so a case about what four seconds does is a unit test rather than a
 * rehearsal.
 */
import { SIGNAL_INTERVAL_MILLISECONDS } from "@magna-carta/meeting-protocol/frames";
import { MEETING_REACTIONS, type MeetingReaction } from "@magna-carta/meeting-protocol/types";

export { MEETING_REACTIONS, SIGNAL_INTERVAL_MILLISECONDS };
export type { MeetingReaction };

/**
 * How long a reaction is worth looking at.
 *
 * Long enough that somebody glancing up from a document sees it, short enough that a tile is not
 * permanently decorated. It is the client's own number — the room relays the instant and has no
 * opinion about the dwell — and it is the LENGTH OF THE ANIMATION as well as the length of the
 * bubble's life, which is why it reaches the stylesheet through the declaration below rather than
 * being written down a second time in CSS.
 */
export const REACTION_DWELL_MILLISECONDS = 4_000;

/**
 * The dwell as the design system's motion recipe reads it.
 *
 * `mc-reaction-rise` declares `--mc-reaction-dwell` as a token default and animates over whatever
 * it resolves to, so the ONE home for the number stays the constant above; a recipe that wrote four
 * seconds into the stylesheet would be a second copy that drifts the first time either moves. The
 * multiplication-free composition is the same shape the data table's scale uses, and for the same
 * reason: the recipe layer takes token references and structural keywords, and a length composed at
 * a call site is neither.
 */
export const REACTION_DWELL_STYLE = `--mc-reaction-dwell: ${String(REACTION_DWELL_MILLISECONDS)}ms`;

/**
 * How many reactions one tile carries at once.
 *
 * Several reactions stack rather than replace — three people agreeing in the same second is three
 * facts, and a tile that showed only the last of them would say one person agreed. Bounded because
 * a burst must not cover a face: past this the oldest goes, which is also the one closest to
 * leaving on its own.
 */
export const MAX_REACTIONS_ON_ONE_TILE = 3;

/** What each reaction MEANS, which is what a reader and a screen reader are given. */
const REACTION_WORDS: Readonly<Record<MeetingReaction, string>> = Object.freeze({
  "thumbs-up": "Agree",
  "thumbs-down": "Disagree",
  heart: "Thank you",
  laugh: "That is funny",
  applause: "Well said",
  celebrate: "Congratulations",
});

/**
 * What somebody with no name on their stay is CALLED in a spoken sentence.
 *
 * Deliberately not the tile's own word: a tile drawn over an empty name says "Joining", which
 * describes what the tile is showing, and a sentence read out needs a subject. Both are the same
 * rare case — a roster row that has arrived before the name has.
 */
export const UNNAMED_REACTOR = "Somebody";

/** The word for one reaction. The vocabulary is closed, so there is no fallback to write. */
export function reactionWord(name: MeetingReaction): string {
  return REACTION_WORDS[name];
}

/** Whether a string off the wire names a reaction this browser knows how to draw. */
export function isMeetingReaction(value: unknown): value is MeetingReaction {
  return typeof value === "string" && (MEETING_REACTIONS as readonly string[]).includes(value);
}

/** One reaction being drawn on a tile right now. */
export interface ShownReaction {
  /** Stable for as long as the bubble lives, so a re-render does not restart its rise. */
  readonly key: string;
  readonly name: MeetingReaction;
}

/** One entry of the coalesced strip a large room draws instead of bubbles. */
export interface ReactionCount {
  readonly name: MeetingReaction;
  readonly count: number;
}

/** A hand up, as the queue is ordered by. */
export interface RaisedHand {
  readonly participantId: string;
  /**
   * When the hand went up. The room stamps it on the roster row; a hand learned from a presence
   * frame carries none, and the client stamps the moment it learned instead — see `handRaisedAt`
   * in the client's own presence map for why that is the honest fallback rather than a gap.
   */
  readonly handRaisedAt: string | null;
}

/**
 * The hands in the order they went up.
 *
 * A PURE DERIVATION OF WHAT EVERY BROWSER ALREADY HOLDS, which is the whole reason the room does not
 * keep a sorted list: a room of three hundred must not be asked to rewrite one on every change. A
 * hand with no instant sorts last rather than first — an unstamped hand is one this browser learned
 * about without being told when, and putting it at the head of the queue would hand the floor to
 * whoever the room said least about.
 */
export function handsInRaisedOrder<T extends RaisedHand>(hands: readonly T[]): T[] {
  return hands.toSorted((first, second) => {
    if (first.handRaisedAt === second.handRaisedAt) {
      return first.participantId < second.participantId ? -1 : 1;
    }
    if (first.handRaisedAt === null) return 1;
    if (second.handRaisedAt === null) return -1;
    return first.handRaisedAt < second.handRaisedAt ? -1 : 1;
  });
}

/** The counts a `reactions` frame carries, in the vocabulary's own order and never a zero. */
export function readReactionCounts(value: unknown): ReactionCount[] {
  if (typeof value !== "object" || value === null) return [];
  const stated = value as Record<string, unknown>;
  const counts: ReactionCount[] = [];
  for (const name of MEETING_REACTIONS) {
    const count = stated[name];
    if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
    counts.push({ name, count: Math.floor(count) });
  }
  return counts;
}

/** The edges this module reaches the outside world through. */
export interface MeetingReactionSeams {
  /** Put a frame on the signaling socket. */
  send: (frame: Record<string, unknown>) => void;
  /** What this browser's own microphone is doing, which a presence frame has to carry whole. */
  microphone: () => { readonly speaking: boolean; readonly muted: boolean };
  /** The clock the outgoing window is measured on. */
  now: () => number;
  /** Wait, then run. Answers with the way to call it off. */
  after: (milliseconds: number, run: () => void) => () => void;
}

/** The seams as the app supplies them. */
export function browserReactionSeams(
  send: (frame: Record<string, unknown>) => void,
  microphone: () => { readonly speaking: boolean; readonly muted: boolean },
): MeetingReactionSeams {
  return {
    send,
    microphone,
    now: () => Date.now(),
    after: (milliseconds, run) => {
      const waiting = setTimeout(run, milliseconds);
      return () => {
        clearTimeout(waiting);
      };
    },
  };
}

export class MeetingReactions {
  /**
   * Whether THIS browser's hand is up, as it has asked the room to see it.
   *
   * Held here rather than read back off the roster, because the control has to answer the press
   * immediately: a toggle that waited for the room to relay the member's own hand back to them
   * would read as a button that does nothing for a round trip. The roster is still the truth for
   * everybody else's hand, and a host lowering this one clears it through the room like any other.
   */
  hand = $state(false);

  /** What is rising off each tile right now, oldest first. */
  shown = $state<ReadonlyMap<string, readonly ShownReaction[]>>(new Map());

  /** The coalesced counts a large room sends instead of bubbles. Empty once the dwell passes. */
  counts = $state<readonly ReactionCount[]>([]);

  /**
   * What a screen reader is told, politely.
   *
   * A reaction is announced at or below the threshold, where it can honestly be attributed; above
   * it a stream of changing counts is noise, so the strip is not announced at all and the count is
   * reachable from the reactions control's own label. A raised hand is announced either way — it is
   * a request for the floor, and somebody running the meeting by ear has to hear it.
   */
  announcement = $state("");

  readonly #seams: MeetingReactionSeams;
  /** When the last signal this browser sent left, so the next one is paced against the window. */
  #lastSignalAt = 0;
  /** True while a re-statement of the settled hand is waiting for the window to pass. */
  #handOwing = false;
  /** The ways to call off every wait in flight: the bubbles, the counts, the re-send. */
  readonly #waiting = new Map<number, () => void>();
  /** A ticket per wait, so one that has run can forget itself without holding onto its own caller. */
  #nextWait = 0;
  /** A fresh key per bubble, so two of the same reaction on one tile are two bubbles. */
  #nextBubble = 0;

  constructor(seams: MeetingReactionSeams) {
    this.#seams = seams;
  }

  /**
   * Put this member's hand up or down.
   *
   * The hand rides the ORDINARY presence frame — it is one of the three things a tile says about a
   * person, measured by the same browser at the same moment — and the frame states all three,
   * because a presence frame carries the whole of what it is about.
   *
   * THE PRESS ALWAYS LANDS, whether or not the frame leaves now. A hand raised inside the window is
   * paced rather than sent, and the window is a second — so a browser that simply dropped it would
   * leave the member's own tile saying one thing and the host's queue saying another, with nothing
   * on either screen to explain it. It is owed instead, exactly as a hand the ROOM refused is, and
   * the settled answer goes out when the window passes. Answers whether the frame left now, so a
   * caller that wants to know can.
   */
  setHand(hand: boolean): boolean {
    if (this.hand === hand) return true;
    this.hand = hand;
    if (this.#statePresence(hand)) return true;
    this.#oweTheHand();
    return false;
  }

  /** Put this member's hand up. */
  raiseHand(): boolean {
    return this.setHand(true);
  }

  /** Put this member's own hand down. Everybody lowers their own with the ordinary frame. */
  lowerHand(): boolean {
    return this.setHand(false);
  }

  /**
   * Throw a reaction on this member's own tile.
   *
   * The sender's own bubble is drawn HERE rather than waited for: the room does not echo a
   * `reaction` back to whoever sent it, which is what makes the control feel like a button rather
   * than a request. Answers false where the window has not passed — the act did not happen, and a
   * menu that closed on it would have told the reader it did.
   */
  react(name: MeetingReaction, self: string | null): boolean {
    if (!this.#mayEmit()) return false;
    this.#seams.send({ type: "reaction", name });
    if (self !== null) this.noteReaction(self, name, null);
    return true;
  }

  /**
   * A host putting a hand down: one, or the whole room's.
   *
   * One frame with different arguments rather than two, on the hosting frames' own precedent. A
   * host's OWN hand is not spared by the whole-room form — clearing the floor is clearing it — so
   * this browser's own hand goes down with the rest rather than waiting for the room to say so.
   */
  lowerHands(participantId: string | null, self: string | null): void {
    this.#seams.send({ type: "lower-hands", participantId });
    if (participantId === null || participantId === self) this.hand = false;
  }

  /**
   * A reaction the room relayed, or this browser's own.
   *
   * `nameOfSender` is what the announcement reads; null for this member's own, which is not
   * announced at all — they pressed the control and are looking at the result.
   */
  noteReaction(participantId: string, name: MeetingReaction, nameOfSender: string | null): void {
    const key = `${participantId}:${String(this.#nextBubble)}`;
    this.#nextBubble += 1;
    const held = this.shown.get(participantId) ?? [];
    const next = new Map(this.shown);
    next.set(participantId, [...held, { key, name }].slice(-MAX_REACTIONS_ON_ONE_TILE));
    this.shown = next;
    if (nameOfSender !== null) {
      this.announcement = `${nameOfSender} reacted: ${reactionWord(name)}`;
    }
    this.#wait(REACTION_DWELL_MILLISECONDS, () => {
      this.#clearBubble(participantId, key);
    });
  }

  /**
   * The counts a room too large to attribute sends instead.
   *
   * It REPLACES what is held rather than adding to it: the frame carries the whole of the second it
   * covers, and a strip that accumulated would be counting the same applause twice a second.
   */
  noteCounts(counts: readonly ReactionCount[]): void {
    this.counts = counts;
    if (counts.length === 0) return;
    this.#wait(REACTION_DWELL_MILLISECONDS, () => {
      this.counts = [];
    });
  }

  /**
   * Say that somebody's hand went up, for a reader who cannot see the mark.
   *
   * Announced at every room size, unlike a reaction: a raised hand is a request for the floor, and
   * a host running the meeting by ear has no other way to learn about it.
   */
  noteHandRaised(nameOfParticipant: string): void {
    this.announcement = `${nameOfParticipant} raised their hand`;
  }

  /**
   * The room refused a signal for arriving too fast.
   *
   * A REACTION IS LET GO and a HAND IS SENT AGAIN, which is the difference between the two acts: a
   * reaction was thrown at a moment that has passed, and a hand is a standing state the room is now
   * wrong about. The re-send carries whatever the hand settled at by the time the window passes, so
   * somebody who raised and lowered it inside one second ends with the room agreeing with them.
   */
  noteRateLimited(): void {
    this.#oweTheHand();
  }

  /**
   * Owe the room this browser's settled hand, once the window has passed.
   *
   * ONE DOOR FOR TWO ROUTES: a hand this browser PACED and a hand the room REFUSED are the same
   * situation — the room's idea of the hand and this browser's have come apart, and the fix is to
   * state the settled one rather than to replay the press. So a member who raised and lowered
   * their hand inside one second ends with the room agreeing with them, and a browser that is
   * already owing sends once rather than once per press.
   */
  #oweTheHand(): void {
    // Already owing: the one wait in flight will read whatever the hand has settled at, so a second
    // press inside the same window costs nothing and does not earn a second frame.
    if (this.#handOwing) return;
    this.#handOwing = true;
    const waited = Math.max(
      0,
      SIGNAL_INTERVAL_MILLISECONDS - (this.#seams.now() - this.#lastSignalAt),
    );
    this.#wait(waited, () => {
      this.#handOwing = false;
      // The SETTLED hand, whatever it settled at — not a replay of the press that was refused.
      // A window that has still not passed (something else went out in the meantime) is owed
      // again rather than dropped, which is the one thing this whole path exists to prevent.
      if (!this.#statePresence(this.hand)) this.#oweTheHand();
    });
  }

  /** Let go of everything: the bubbles, the counts, the waits and this browser's own hand. */
  clear(): void {
    for (const stop of this.#waiting.values()) stop();
    this.#waiting.clear();
    this.hand = false;
    this.shown = new Map();
    this.counts = [];
    this.announcement = "";
    this.#lastSignalAt = 0;
    this.#handOwing = false;
    this.#nextBubble = 0;
    this.#nextWait = 0;
  }

  /**
   * Whether the outgoing window has passed, and the stamp if it has.
   *
   * The browser paces itself so that the ordinary case never meets a refusal at all; the refusal
   * handling above is for the case this cannot cover, which is a second tab or a clock that
   * disagrees with the room's.
   */
  #mayEmit(): boolean {
    const now = this.#seams.now();
    if (now - this.#lastSignalAt < SIGNAL_INTERVAL_MILLISECONDS) return false;
    this.#lastSignalAt = now;
    return true;
  }

  /** The presence frame that states all three facts, with the hand as the one that moved. */
  #statePresence(hand: boolean): boolean {
    if (!this.#mayEmit()) return false;
    const microphone = this.#seams.microphone();
    this.#seams.send({
      type: "presence",
      speaking: microphone.speaking,
      muted: microphone.muted,
      hand,
    });
    return true;
  }

  #clearBubble(participantId: string, key: string): void {
    const held = this.shown.get(participantId);
    if (held === undefined) return;
    const left = held.filter((bubble) => bubble.key !== key);
    const next = new Map(this.shown);
    if (left.length === 0) next.delete(participantId);
    else next.set(participantId, left);
    this.shown = next;
  }

  /** Wait, and forget the way to call it off once it has run. */
  #wait(milliseconds: number, run: () => void): void {
    const ticket = this.#nextWait;
    this.#nextWait += 1;
    this.#waiting.set(
      ticket,
      this.#seams.after(milliseconds, () => {
        this.#waiting.delete(ticket);
        run();
      }),
    );
  }
}
