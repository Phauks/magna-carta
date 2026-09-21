import {
  reactionRelayFrame,
  reactionsFrame,
  ROSTER_DELTA_THRESHOLD,
  SIGNAL_INTERVAL_MILLISECONDS,
  type MeetingReaction,
} from "@magna-carta/meeting-protocol/frames";
import { recordReactionsRelayed } from "./room-diagnostics.ts";
import {
  broadcast,
  deleteReactionBucket,
  putParticipant,
  putReactionBucket,
  readParticipant,
  readReactionBucket,
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
// below is transient room state on exactly the terms the roster is, deleted when the meeting ends.
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
// participant may send, and this one bounds what the ROOM says about all of them.
export const REACTION_COALESCE_INTERVAL_MILLISECONDS = 1000;

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
 * Adds one reaction to the open bucket, flushing first if its window has run.
 *
 * A bucket opens on the first reaction in a window; a reaction arriving after that window has closed
 * flushes the bucket INCLUDING ITSELF and leaves none open, so the next one opens the next window.
 * A bucket with nothing after it would otherwise sit unsent, which is what the alarm is the backstop
 * for.
 *
 * Read-modify-write under the gate, because two reactions arriving together would otherwise both
 * read the same bucket and one would write the other's count away — which in a room of three hundred
 * is not a rare race but the ordinary case.
 */
async function accumulate(
  room: RoomContext,
  name: MeetingReaction,
  now: number,
): Promise<number | null> {
  const outcome = await room.ctx.blockConcurrencyWhile(
    async (): Promise<{
      flush: Readonly<Record<string, number>> | null;
      openedAt: number | null;
    }> => {
      const bucket = await readReactionBucket(room);
      if (bucket === undefined) {
        await putReactionBucket(room, {
          openedAt: new Date(now).toISOString(),
          counts: { [name]: 1 },
        });
        return { flush: null, openedAt: now };
      }
      const counts = { ...bucket.counts, [name]: (bucket.counts[name] ?? 0) + 1 };
      const openedAt = Date.parse(bucket.openedAt);
      // A bucket whose instant cannot be read is flushed rather than kept: it can never reach a
      // deadline, so keeping it would hold reactions the room never sends.
      if (!Number.isNaN(openedAt) && now - openedAt < REACTION_COALESCE_INTERVAL_MILLISECONDS) {
        await putReactionBucket(room, { openedAt: bucket.openedAt, counts });
        return { flush: null, openedAt: null };
      }
      await deleteReactionBucket(room);
      return { flush: counts, openedAt: null };
    },
  );
  if (outcome.flush !== null) {
    await sendCounts(room, outcome.flush, now);
    return null;
  }
  // The deadline this bucket is waiting on, answered rather than the bare fact that one exists — so
  // the caller arms for a known instant rather than reconciling the whole room for a window that is
  // a second away. The presence throttle beside it answers the same way, for the same measurement.
  return outcome.openedAt === null
    ? null
    : outcome.openedAt + REACTION_COALESCE_INTERVAL_MILLISECONDS;
}

/**
 * The bucket the alarm found waiting, sent at last — or nothing, when none was.
 *
 * Answers how many reactions the flush covered, which is the number that says whether the coalescing
 * is earning its place: one is somebody agreeing on their own, and eleven is the room applauding.
 */
export async function flushReactions(room: RoomContext, now: number): Promise<number> {
  const counts = await room.ctx.blockConcurrencyWhile(
    async (): Promise<Readonly<Record<string, number>> | null> => {
      const bucket = await readReactionBucket(room);
      if (bucket === undefined) return null;
      const openedAt = Date.parse(bucket.openedAt);
      // An unreadable instant is treated as due now rather than as a deadline that never arrives,
      // which is how the presence flush reads its own.
      if (!Number.isNaN(openedAt) && openedAt + REACTION_COALESCE_INTERVAL_MILLISECONDS > now) {
        return null;
      }
      await deleteReactionBucket(room);
      return bucket.counts;
    },
  );
  if (counts === null) return 0;
  return await sendCounts(room, counts, now);
}

/** When the open bucket is due to be flushed, or null when the room is holding none. */
export async function reactionFlushDeadlineOf(room: RoomContext): Promise<number | null> {
  const bucket = await readReactionBucket(room);
  if (bucket === undefined) return null;
  const openedAt = Date.parse(bucket.openedAt);
  return Number.isNaN(openedAt) ? 0 : openedAt + REACTION_COALESCE_INTERVAL_MILLISECONDS;
}

/**
 * The counts, on the wire, to EVERY socket including the people who reacted.
 *
 * A count that excluded the reader would be a different number per socket, and the room would be
 * building three hundred frames to avoid one double-count. The client draws its own glyph on its own
 * tile and the counts in the strip, so nothing is counted twice on any screen.
 */
async function sendCounts(
  room: RoomContext,
  counts: Readonly<Record<string, number>>,
  now: number,
): Promise<number> {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  broadcast(room, reactionsFrame(counts, new Date(now).toISOString()));
  await recordReactionsRelayed(room, undefined, total, true);
  return total;
}
