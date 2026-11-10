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
// upvote read the new count off the record and handed it here, so the bucket keeps the LATEST and a
// flush sends the current truth rather than a replay. Latest is decided by what only grows where
// there is such a thing — a poll's RESPONDENTS, since an answer cannot be withdrawn — and by the
// instant the route read the count where there is not, since an upvote can be.
//
// AND "LATEST" OUTLIVES THE FLUSH. Two routes can reach the room in the other order from the one they
// committed in, and the late one may land after the bucket that held the newer count has gone out: on
// its own it would open the next bucket and send every browser a count older than the one it has
// just drawn. So each flush leaves a HIGH-WATER MARK per subject under its own key — the respondents
// sent for each poll, the read instant sent for each question — written in the same turn that clears
// the bucket, and a tally at or behind its mark is dropped on arrival. A poll's close sets its mark to
// the final count for the same reason. The marks die with the room, as everything here does.
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

/**
 * What the room has already SENT for each subject, kept past the flush that sent it: a poll's
 * respondents, a question's read instant. One key for the room, read under the same gate as the
 * bucket, and bounded by the queue's and the meeting's own ceilings on how many subjects there are.
 */
export interface StoredTallyMarks {
  readonly polls: Readonly<Record<string, number>>;
  readonly questions: Readonly<Record<string, string>>;
}

// Its own key beside the bucket's rather than a field on it: the bucket's existence is what the
// alarm reads as a flush still owed, and the marks have to survive exactly the moment it stops
// existing.
const TALLY_MARKS_KEY = "tally-marks";

const NO_MARKS: StoredTallyMarks = { polls: {}, questions: {} };

async function readTallyMarks(room: RoomContext): Promise<StoredTallyMarks> {
  return (await room.ctx.storage.get<StoredTallyMarks>(TALLY_MARKS_KEY)) ?? NO_MARKS;
}

/** The marks after a flush of this bucket: each subject it carried, at what it carried. */
function marksAfter(marks: StoredTallyMarks, bucket: StoredCoalescingBucket): StoredTallyMarks {
  const polls = { ...marks.polls };
  for (const [pollId, tally] of Object.entries(bucket.pollTallies ?? {})) {
    polls[pollId] = Math.max(polls[pollId] ?? 0, tally.respondents);
  }
  const questions = { ...marks.questions };
  for (const [questionId, tally] of Object.entries(bucket.questionTallies ?? {})) {
    const held = questions[questionId];
    if (held === undefined || isNewer(tally.readAt, held)) questions[questionId] = tally.readAt;
  }
  return { polls, questions };
}

function carriesTallies(bucket: StoredCoalescingBucket): boolean {
  return (
    Object.keys(bucket.pollTallies ?? {}).length > 0 ||
    Object.keys(bucket.questionTallies ?? {}).length > 0
  );
}

/**
 * Clears the bucket that is going out, and — when it carried a tally — moves the marks up to what it
 * carried. Both writes are issued before either is awaited, so the storage layer commits them as one
 * and no instant holds a cleared bucket without its marks.
 */
async function clearForFlush(
  room: RoomContext,
  bucket: StoredCoalescingBucket,
  marks: StoredTallyMarks,
): Promise<void> {
  const writes: Promise<unknown>[] = [deleteReactionBucket(room)];
  if (carriesTallies(bucket)) {
    writes.push(room.ctx.storage.put(TALLY_MARKS_KEY, marksAfter(marks, bucket)));
  }
  await Promise.all(writes);
}

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
 *
 * `add` is handed the high-water marks as well as the bucket, read under the same gate, so a tally
 * can be compared with what the room has already sent and not only with what it is holding. A fact
 * `add` declines — it hands the bucket back unchanged — opens no bucket and arms nothing.
 */
export async function coalesce(
  room: RoomContext,
  now: number,
  add: (bucket: StoredCoalescingBucket, marks: StoredTallyMarks) => StoredCoalescingBucket,
): Promise<number | null> {
  const outcome = await room.ctx.blockConcurrencyWhile(
    async (): Promise<{ flush: StoredCoalescingBucket | null; openedAt: number | null }> => {
      const stored: StoredCoalescingBucket | undefined = await readReactionBucket(room);
      const marks = await readTallyMarks(room);
      if (stored === undefined) {
        const empty = emptyBucket(now);
        const opened = add(empty, marks);
        if (opened === empty) return { flush: null, openedAt: null };
        await putReactionBucket(room, opened);
        return { flush: null, openedAt: now };
      }
      const next = add(stored, marks);
      const openedAt = Date.parse(stored.openedAt);
      // A bucket whose instant cannot be read is flushed rather than kept: it can never reach a
      // deadline, so keeping it would hold facts the room never sends.
      if (!Number.isNaN(openedAt) && now - openedAt < COALESCE_INTERVAL_MILLISECONDS) {
        if (next !== stored) await putReactionBucket(room, next);
        return { flush: null, openedAt: null };
      }
      await clearForFlush(room, next, marks);
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
      await clearForFlush(room, bucket, await readTallyMarks(room));
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
 * A poll's pending tally, dropped, and its mark raised to the FINAL count — called when the poll
 * closes, because the close frame carries the final tally and a tally frame arriving after it, from
 * a route that committed before the close and reached the room after it, would say something older
 * than what every browser has just been told. No answer commits after a close, so nothing newer than
 * the final count can come.
 */
export async function closePollTally(
  room: RoomContext,
  pollId: string,
  finalRespondents: number,
): Promise<void> {
  await room.ctx.blockConcurrencyWhile(async () => {
    const bucket: StoredCoalescingBucket | undefined = await readReactionBucket(room);
    const marks = await readTallyMarks(room);
    const writes: Promise<unknown>[] = [
      room.ctx.storage.put(TALLY_MARKS_KEY, {
        ...marks,
        polls: {
          ...marks.polls,
          [pollId]: Math.max(marks.polls[pollId] ?? 0, finalRespondents),
        },
      }),
    ];
    if (bucket?.pollTallies?.[pollId] !== undefined) {
      const remaining = Object.fromEntries(
        Object.entries(bucket.pollTallies).filter(([pending]) => pending !== pollId),
      );
      const next: StoredCoalescingBucket = { ...bucket, pollTallies: remaining };
      writes.push(putReactionBucket(room, next));
    }
    await Promise.all(writes);
  });
}

/** Whether `incoming` is at least as recent as what the bucket already holds for the same subject. */
function isNewer(incoming: string, held: string | undefined): boolean {
  return held === undefined || Date.parse(incoming) >= Date.parse(held);
}

/**
 * Whether a poll's tally is ahead of what the room holds and has sent. Respondents only grow — an
 * answer cannot be withdrawn, and one participation's answers commit in one batch — so two tallies
 * with the same respondents are the same tally, and one with fewer is older whatever instant it
 * carries.
 */
export function isPollTallyAhead(
  respondents: number,
  held: number | undefined,
  sent: number | undefined,
): boolean {
  return (held === undefined || respondents >= held) && (sent === undefined || respondents > sent);
}

/** Whether a question's count is at least as recent as both what is held and what has been sent. */
export function isQuestionTallyAhead(
  readAt: string,
  held: string | undefined,
  sent: string | undefined,
): boolean {
  return isNewer(readAt, held) && isNewer(readAt, sent);
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
