import {
  pollTallyFrame,
  questionTallyFrame,
  reactionsFrame,
  type MeetingPollOptionCount,
} from "@magna-carta/meeting-protocol/frames";
import {
  recordPollRelayed,
  recordQuestionRelayed,
  recordReactionsRelayed,
} from "./room-diagnostics.ts";
import {
  broadcast,
  deleteReactionBucket,
  putReactionBucket,
  readReactionBucket,
  type RoomContext,
  type StoredReactionBucket,
} from "./room-state.ts";

// THE ROOM'S ONE PER-SECOND BUCKET, and the three kinds of fact it holds: a large room's reactions,
// and the tallies of the polls and the question queue.
//
// ONE MECHANISM, THREE KINDS, because all three are the same arithmetic. Three hundred people
// applauding one sentence, answering one poll or upvoting one question in the same second is three
// hundred facts nobody is waiting on individually, and relayed one by one it is ninety thousand
// outbound frames. So each is accumulated and flushed as ONE frame per kind per second for the whole
// room. A second bucket beside the first would be a second answer to "when does the room speak", and
// the alarm would have two sub-second deadlines to reconcile where it has one.
//
// THE TWO KINDS DIFFER IN WHAT THEY ACCUMULATE. Reactions are SUMMED: each is an act, and the frame
// says how many happened this second. A tally is REPLACED: the route that wrote an answer or an
// upvote read the new count off the record and handed it here, so the bucket keeps the LATEST — by the
// instant the route read it, since two routes can reach the room in the other order from the one they
// committed in — and a flush sends the current truth rather than a replay.
//
// ONE STORAGE KEY, the one the reactions bucket already had, so the alarm's reconciliation pays one
// `get` for the whole thing, the operator's read sees a pending flush as the job it already names,
// and a room holds nothing at all between bursts. It dies with the room.
//
// THE ROOM NEVER READS THE FIRM'S RECORD TO FILL IT. The counts arrive from the routes, which had them
// in hand; a room computing a tally every second would be a read per second for a number the writer
// already knew.

// HOW LONG ONE BUCKET IS OPEN — the room's own number, deliberately not on the wire: a browser draws
// whatever arrives and divides by nothing.
export const COALESCE_INTERVAL_MILLISECONDS = 1000;

/** One poll's latest tally, and the instant the route read it off the record. */
export interface StoredPollTally {
  readonly counts: readonly MeetingPollOptionCount[];
  readonly respondents: number;
  readonly readAt: string;
}

/** One question's latest upvote count, and the instant the route read it. */
export interface StoredQuestionTally {
  readonly upvotes: number;
  readonly readAt: string;
}

/**
 * The bucket as stored. It EXTENDS the reactions bucket's shape rather than replacing it: both tally
 * maps are optional, so a bucket written by a build that knew only reactions reads as one holding no
 * tallies, and one written here reads as a reactions bucket to anything that asks only about those.
 */
export interface StoredCoalescingBucket extends StoredReactionBucket {
  readonly pollTallies?: Readonly<Record<string, StoredPollTally>>;
  readonly questionTallies?: Readonly<Record<string, StoredQuestionTally>>;
}

/** What one flush sent, per kind — the counts each kind's event records. */
export interface CoalescedFlush {
  readonly reactions: number;
  readonly polls: number;
  readonly questions: number;
}

const NOTHING_FLUSHED: CoalescedFlush = { reactions: 0, polls: 0, questions: 0 };

function emptyBucket(now: number): StoredCoalescingBucket {
  return { openedAt: new Date(now).toISOString(), counts: {} };
}

/**
 * Adds one fact to the open bucket — opening one if none is, and flushing first if its window has run.
 *
 * A bucket opens on the first fact in a window; a fact arriving after that window has closed flushes
 * the bucket INCLUDING ITSELF and leaves none open, so the next one opens the next window. A bucket
 * with nothing after it would otherwise sit unsent, which is what the alarm is the backstop for.
 *
 * Read-modify-write under the gate, because two facts arriving together would otherwise both read the
 * same bucket and one would write the other's away — in a room of three hundred that is the ordinary
 * case rather than a rare race.
 *
 * Answers the deadline of a bucket this call OPENED, so the caller arms the alarm for a known instant;
 * null when it joined an open one or flushed.
 */
export async function coalesce(
  room: RoomContext,
  now: number,
  add: (bucket: StoredCoalescingBucket) => StoredCoalescingBucket,
): Promise<number | null> {
  const outcome = await room.ctx.blockConcurrencyWhile(
    async (): Promise<{ flush: StoredCoalescingBucket | null; openedAt: number | null }> => {
      const stored: StoredCoalescingBucket | undefined = await readReactionBucket(room);
      if (stored === undefined) {
        await putReactionBucket(room, add(emptyBucket(now)));
        return { flush: null, openedAt: now };
      }
      const next = add(stored);
      const openedAt = Date.parse(stored.openedAt);
      // A bucket whose instant cannot be read is flushed rather than kept: it can never reach a
      // deadline, so keeping it would hold facts the room never sends.
      if (!Number.isNaN(openedAt) && now - openedAt < COALESCE_INTERVAL_MILLISECONDS) {
        await putReactionBucket(room, next);
        return { flush: null, openedAt: null };
      }
      await deleteReactionBucket(room);
      return { flush: next, openedAt: null };
    },
  );
  if (outcome.flush !== null) {
    await send(room, outcome.flush, now);
    return null;
  }
  return outcome.openedAt === null ? null : outcome.openedAt + COALESCE_INTERVAL_MILLISECONDS;
}

/**
 * The bucket the alarm found waiting, sent at last — or nothing, when none was due.
 *
 * Answers what the flush covered, per kind: one reaction is somebody agreeing on their own, eleven is
 * the room applauding, and a tally flush covering one poll is a room answering at a pace that did not
 * need a bucket.
 */
export async function flushDueBucket(room: RoomContext, now: number): Promise<CoalescedFlush> {
  const due = await room.ctx.blockConcurrencyWhile(
    async (): Promise<StoredCoalescingBucket | null> => {
      const bucket: StoredCoalescingBucket | undefined = await readReactionBucket(room);
      if (bucket === undefined) return null;
      const openedAt = Date.parse(bucket.openedAt);
      // An unreadable instant is treated as due now rather than as a deadline that never arrives.
      if (!Number.isNaN(openedAt) && openedAt + COALESCE_INTERVAL_MILLISECONDS > now) return null;
      await deleteReactionBucket(room);
      return bucket;
    },
  );
  if (due === null) return NOTHING_FLUSHED;
  return await send(room, due, now);
}

/** When the open bucket is due to be flushed, or null when the room is holding none. */
export async function bucketDeadlineOf(room: RoomContext): Promise<number | null> {
  const bucket = await readReactionBucket(room);
  if (bucket === undefined) return null;
  const openedAt = Date.parse(bucket.openedAt);
  return Number.isNaN(openedAt) ? 0 : openedAt + COALESCE_INTERVAL_MILLISECONDS;
}

/**
 * A poll's pending tally, dropped — called when the poll closes, because the close frame carries the
 * final tally and a tally frame arriving after it would say something older than what every browser
 * has just been told.
 */
export async function dropPollTally(room: RoomContext, pollId: string): Promise<void> {
  await room.ctx.blockConcurrencyWhile(async () => {
    const bucket: StoredCoalescingBucket | undefined = await readReactionBucket(room);
    if (bucket?.pollTallies?.[pollId] === undefined) return;
    const remaining = Object.fromEntries(
      Object.entries(bucket.pollTallies).filter(([pending]) => pending !== pollId),
    );
    const next: StoredCoalescingBucket = { ...bucket, pollTallies: remaining };
    await putReactionBucket(room, next);
  });
}

/** Whether `incoming` is at least as recent as what the bucket already holds for the same subject. */
export function isNewer(incoming: string, held: string | undefined): boolean {
  return held === undefined || Date.parse(incoming) >= Date.parse(held);
}

/**
 * Everything the bucket held, on the wire, to EVERY socket — the reactors and the answerers included.
 *
 * A count that excluded the reader would be a different number per socket, and the room would be
 * building three hundred frames to avoid one double-count. One frame per kind, and one per poll:
 * each poll's card listens for its own.
 */
async function send(
  room: RoomContext,
  bucket: StoredCoalescingBucket,
  now: number,
): Promise<CoalescedFlush> {
  const at = new Date(now).toISOString();

  const reactions = Object.values(bucket.counts).reduce((sum, count) => sum + count, 0);
  if (reactions > 0) {
    broadcast(room, reactionsFrame(bucket.counts, at));
    await recordReactionsRelayed(room, undefined, reactions, true);
  }

  const polls = Object.entries(bucket.pollTallies ?? {});
  if (polls.length > 0) {
    let recipientCount = 0;
    for (const [pollId, tally] of polls) {
      recipientCount = broadcast(room, pollTallyFrame(pollId, tally.counts, tally.respondents, at));
    }
    await recordPollRelayed(room, undefined, "tally", recipientCount, polls.length);
  }

  const questions = Object.entries(bucket.questionTallies ?? {});
  if (questions.length > 0) {
    const recipientCount = broadcast(
      room,
      questionTallyFrame(
        questions.map(([questionId, tally]) => ({ questionId, upvotes: tally.upvotes })),
        at,
      ),
    );
    await recordQuestionRelayed(room, undefined, "tally", recipientCount, questions.length);
  }

  return { reactions, polls: polls.length, questions: questions.length };
}
