import {
  reactionRelayFrame,
  ROSTER_DELTA_THRESHOLD,
  SIGNAL_INTERVAL_MILLISECONDS,
  type MeetingReaction,
} from "@magna-carta/meeting-protocol/frames";
import {
  bucketDeadlineOf,
  COALESCE_INTERVAL_MILLISECONDS,
  coalesce,
  flushDueBucket,
} from "./room-coalescing.ts";
import { recordReactionsRelayed } from "./room-diagnostics.ts";
import {
  broadcast,
  putParticipant,
  readParticipant,
  welcomedSocketCount,
  type RoomContext,
} from "./room-state.ts";

// SOMETHING THROWN ON A TILE, RELAYED — and the coalescing that makes relaying it affordable when
// three hundred people throw it at the same sentence.
//
// NOTHING HERE IS STORED IN THE FIRM'S RECORD, and that is the whole claim of the slice this module
// belongs to rather than an omission to be filled in later. A reaction says somebody agreed with a
// sentence four seconds ago; when the meeting ends there is nothing left anybody would ask about.
// So there is no table, no migration, no personal-data registration and no audit row — the bucket
// is transient room state on exactly the terms the roster is, deleted when the meeting ends. The
// bucket itself is `room-coalescing.ts`, which the poll and question tallies share.
// If a firm ever needs "who reacted" on the record, that is a different design and a different
// decision, not a column added here.
//
// THIS MODULE ALSO OWNS THE ONE WINDOW A HAND AND A REACTION SHARE. The two frames are the only ones
// in this protocol that are REFUSED for arriving too fast rather than dropped, because neither
// restates itself, and a single window over both is what stops a browser spending its allowance
// twice in the same second.

// HOW LONG ONE COALESCING BUCKET IS OPEN — the room's own number, and deliberately not on the wire.
//
// A browser draws whatever arrives and divides by nothing, so this is a fact only the server reads,
// which is the test the protocol package applies to what belongs in it. It is the same thousand
// milliseconds as the signal window beside it and it is a different number: that one bounds what ONE
// participant may send, and this one bounds what the ROOM says about all of them. It is the shared
// bucket's own interval, named here as well because the reactions are what a reader looks for.
export const REACTION_COALESCE_INTERVAL_MILLISECONDS = COALESCE_INTERVAL_MILLISECONDS;

/**
 * Claims this participant's signal slot, answering whether the act may go ahead.
 *
 * THE ONE THROTTLE IN THIS ROOM THAT REFUSES RATHER THAN DROPS. The presence throttle next door
 * discards a transition inside its window and keeps the stored booleans current, which is safe
 * because a presence frame carries the WHOLE of what it is about: an unsent one loses nothing a
 * later one restates. That reasoning does not carry here, and applying it anyway would be a real
 * defect — a raised hand may be the last thing a participant does for ten minutes, and dropped it is
 * never relayed at all, so the host never learns somebody wants the floor; a reaction is a single
 * act with no later frame to carry it. So the caller refuses `rate-limited` on a false answer, the
 * socket stays open, and the browser re-sends the settled state when the window passes.
 *
 * Read-modify-write under the gate, for the reason every other throttle in this room is: two frames
 * arriving together would otherwise both read the same instant and both pass, which is precisely the
 * burst this bounds. A stay with no roster entry claims nothing and is answered true — the frame is
 * refused a little further on by the path that can say whether the meeting ended or the stay closed.
 */
export async function claimSignalSlot(
  room: RoomContext,
  attendanceId: string,
  now: number,
): Promise<boolean> {
  return await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return true;
    const previous =
      participant.signalAt === undefined || participant.signalAt === null
        ? Number.NaN
        : Date.parse(participant.signalAt);
    if (!Number.isNaN(previous) && now - previous < SIGNAL_INTERVAL_MILLISECONDS) return false;
    await putParticipant(room, attendanceId, {
      ...participant,
      signalAt: new Date(now).toISOString(),
    });
    return true;
  });
}

/**
 * One reaction, relayed — named in a small room, counted in a large one.
 *
 * THE BRANCH IS THE WHOLE DESIGN. Naively a reaction is the worst shape in this subsystem: three
 * hundred people applauding one sentence is three hundred inbound frames and, relayed one by one,
 * ninety thousand outbound in a single second — the same quadratic the roster difference exists to
 * avoid, arriving all at once. So above the room's own threshold the individual reactions are
 * accumulated into a per-name count and flushed as ONE frame a second for the whole room.
 *
 * What coalescing costs is attribution, and that is the honest trade: above sixteen participants
 * nobody can see three hundred tiles anyway — the gallery draws sixteen — so a bubble on the right
 * face is a promise the screen cannot keep for most of the room, and the count is the thing that is
 * actually true at that size.
 *
 * THE SIZE IS COUNTED OVER THE WELCOMED SOCKETS RATHER THAN OVER THE ROSTER, and that is a cost
 * decision rather than a different question: the fan-out this branch chooses between is over
 * sockets, and reading the roster here would spend three hundred keys on every reaction in exactly
 * the room the coalescing exists for. A stay inside its grace period with no socket open receives
 * nothing either way.
 *
 * Answers whether a bucket is now open and when it was opened, so the caller can arm the room's
 * alarm for its flush — the arming is the caller's because a room has one alarm and one module that
 * reconciles deadlines into it.
 */
export async function relayReaction(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  name: MeetingReaction,
  now: number,
): Promise<number | null> {
  if (welcomedSocketCount(room) <= ROSTER_DELTA_THRESHOLD) {
    // THE SENDER IS LEFT OUT, like a presence transition and for the same reason: their own screen
    // drew the bubble the moment the button was pressed, which is what makes the control feel like a
    // button rather than a request.
    broadcast(room, reactionRelayFrame(attendanceId, name, new Date(now).toISOString()), socket);
    await recordReactionsRelayed(room, undefined, 1, false);
    return null;
  }
  return await accumulate(room, name, now);
}

/**
 * Adds one reaction to the room's per-second bucket — the shared one in `room-coalescing.ts`, which
 * opens a window on the first fact, flushes it with the fact that arrives after it has run, and
 * answers the deadline of a window this call opened so the caller can arm the alarm for it.
 *
 * A reaction is SUMMED into its name's count: each is an act, and the frame says how many happened.
 */
async function accumulate(
  room: RoomContext,
  name: MeetingReaction,
  now: number,
): Promise<number | null> {
  return await coalesce(room, now, (bucket) => ({
    ...bucket,
    counts: { ...bucket.counts, [name]: (bucket.counts[name] ?? 0) + 1 },
  }));
}

/**
 * The bucket the alarm found waiting, sent at last — or nothing, when none was.
 *
 * THE ALARM'S ENTRY POINT FOR THE WHOLE SHARED BUCKET, named for the reactions because they are what
 * it was built for: a flush sends the poll and question tallies the same bucket is holding too, each
 * recorded under its own event. What it ANSWERS is the reactions alone — the count the alarm's own
 * event records as `reactionsFlushed` — so that field keeps meaning what it says.
 *
 * One reaction is somebody agreeing on their own, and eleven is the room applauding.
 */
export async function flushReactions(room: RoomContext, now: number): Promise<number> {
  return (await flushDueBucket(room, now)).reactions;
}

/**
 * When the room's per-second bucket is due to be flushed, or null when it is holding none — whatever
 * kinds of fact it holds, since one flush sends all of them.
 */
export async function reactionFlushDeadlineOf(room: RoomContext): Promise<number | null> {
  return await bucketDeadlineOf(room);
}
