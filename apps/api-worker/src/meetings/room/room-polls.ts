import {
  pollClosedFrame,
  pollOpenedFrame,
  questionAskedFrame,
  questionUpdatedFrame,
  type MeetingPollOptionCount,
  type MeetingPollSnapshot,
  type MeetingQuestionSnapshot,
} from "@magna-carta/meeting-protocol/frames";
import {
  closePollTally,
  coalesce,
  isPollTallyAhead,
  isQuestionTallyAhead,
} from "./room-coalescing.ts";
import { recordPollRelayed, recordQuestionRelayed } from "./room-diagnostics.ts";
import { armAlarmFor } from "./room-lifecycle.ts";
import {
  broadcast,
  broadcastPerViewer,
  welcomedSocketCount,
  type RoomContext,
} from "./room-state.ts";

// A POLL AND THE QUESTION QUEUE, CARRIED TO THE PEOPLE IN THE ROOM — six relays of rows that have
// already committed.
//
// THE ROUTES ARE THE RECORD, AND THIS MODULE HAS NO STORAGE OF ITS OWN. Every poll act and every
// question act is a route (`routes/meeting-polls.ts`, `routes/meeting-questions.ts`) that writes
// through the firm-scoped data-access layer and then tells the room, AFTER the commit, so nobody is
// shown a poll or a question by a write that then failed. The browser sends nothing new on the
// socket. A browser that misses any of these frames is caught up by the paged read.
//
// THE TWO TALLIES GO THROUGH THE SHARED PER-SECOND BUCKET (`room-coalescing.ts`), because three
// hundred people answering a poll in one second is three hundred facts nobody is waiting on
// individually. The route hands over the count it has just read off the record; the bucket keeps the
// latest, and a flush sends the current truth once a second. The room never reads the firm's record
// to build any of this.
//
// IT REACHES WELCOMED SOCKETS AND NEVER THE LOBBY, structurally, as chat does: `broadcast` skips a
// socket that has not been welcomed. And a GUEST'S COPY names no firm user: every user identifier on
// a poll or a question is null on the payload a guest's socket receives.

/** A poll as a guest's socket may see it: the same poll, with no firm user named on it. */
function pollForGuest(poll: MeetingPollSnapshot): MeetingPollSnapshot {
  return { ...poll, askedByUserId: null, closedByUserId: null };
}

/** A question as a guest's socket may see it. */
function questionForGuest(question: MeetingQuestionSnapshot): MeetingQuestionSnapshot {
  return { ...question, userId: null, answeredByUserId: null, redactedByUserId: null };
}

/** A host asked the room: the poll whole, to every welcomed socket. */
export async function relayPollOpened(room: RoomContext, poll: MeetingPollSnapshot): Promise<void> {
  const recipientCount = broadcastPerViewer(room, (viewer) =>
    pollOpenedFrame(viewer === "guest" ? pollForGuest(poll) : poll),
  );
  await recordPollRelayed(room, undefined, "opened", recipientCount, 1);
}

/**
 * A host closed a poll: the instant and the final tally.
 *
 * Any tally the bucket is still holding for this poll is DROPPED first, and the poll's high-water
 * mark raised to the final count — the close carries it, and a tally frame flushed a moment later, or
 * handed in later by a route that committed before the close, would say something older than what
 * every browser has just been told.
 */
export async function relayPollClosed(
  room: RoomContext,
  pollId: string,
  closedAt: string,
  counts: readonly MeetingPollOptionCount[],
  respondents: number,
): Promise<void> {
  await closePollTally(room, pollId, respondents);
  const recipientCount = broadcast(room, pollClosedFrame(pollId, closedAt, counts, respondents));
  await recordPollRelayed(room, undefined, "closed", recipientCount, 1);
}

/**
 * Somebody answered a poll: the tally the route read afterwards, into the bucket.
 *
 * LATEST WINS, by how many have answered — respondents only grow, because an answer cannot be
 * withdrawn — and against what the room has already SENT as well as what it holds, since two routes
 * can reach the room in the other order from the one they committed in and the newer one's bucket may
 * already have gone out. A bucket this call opened arms the alarm for its flush, so the last answer
 * of a burst is not held forever.
 */
export async function relayPollAnswered(
  room: RoomContext,
  pollId: string,
  tally: {
    readonly counts: readonly MeetingPollOptionCount[];
    readonly respondents: number;
    readonly readAt: string;
  },
  now: number,
): Promise<void> {
  // A room nobody is in has nobody to tell, and a bucket opened there would arm an alarm to send a
  // frame to no socket — the ordinary case for an answer long after everybody else left.
  if (welcomedSocketCount(room) === 0) return;
  const dueAt = await coalesce(room, now, (bucket, marks) => {
    const held = bucket.pollTallies?.[pollId];
    if (!isPollTallyAhead(tally.respondents, held?.respondents, marks.polls[pollId])) return bucket;
    return {
      ...bucket,
      pollTallies: {
        ...bucket.pollTallies,
        [pollId]: { counts: tally.counts, respondents: tally.respondents, readAt: tally.readAt },
      },
    };
  });
  if (dueAt !== null) await armAlarmFor(room, dueAt);
}

/** Somebody put a question to the room: the question whole, to every welcomed socket. */
export async function relayQuestionAsked(
  room: RoomContext,
  question: MeetingQuestionSnapshot,
): Promise<void> {
  const recipientCount = broadcastPerViewer(room, (viewer) =>
    questionAskedFrame(viewer === "guest" ? questionForGuest(question) : question),
  );
  await recordQuestionRelayed(room, undefined, "asked", recipientCount, 1);
}

/**
 * A question's state moved — answered, unanswered, taken back. The whole question again, so a
 * browser replaces what it holds; a redacted one arrives with the empty body the record holds.
 */
export async function relayQuestionUpdated(
  room: RoomContext,
  question: MeetingQuestionSnapshot,
): Promise<void> {
  const recipientCount = broadcastPerViewer(room, (viewer) =>
    questionUpdatedFrame(viewer === "guest" ? questionForGuest(question) : question),
  );
  await recordQuestionRelayed(room, undefined, "updated", recipientCount, 1);
}

/**
 * Somebody upvoted a question or took an upvote back: the count the route read, into the bucket.
 *
 * A count can go down, so there is nothing that only grows to order by; the instant the route read it
 * is the order, held against both the bucket and the mark the last flush left for this question.
 */
export async function relayQuestionUpvoted(
  room: RoomContext,
  questionId: string,
  tally: { readonly upvotes: number; readonly readAt: string },
  now: number,
): Promise<void> {
  if (welcomedSocketCount(room) === 0) return;
  const dueAt = await coalesce(room, now, (bucket, marks) => {
    const held = bucket.questionTallies?.[questionId];
    if (!isQuestionTallyAhead(tally.readAt, held?.readAt, marks.questions[questionId])) {
      return bucket;
    }
    return {
      ...bucket,
      questionTallies: {
        ...bucket.questionTallies,
        [questionId]: { upvotes: tally.upvotes, readAt: tally.readAt },
      },
    };
  });
  if (dueAt !== null) await armAlarmFor(room, dueAt);
}
