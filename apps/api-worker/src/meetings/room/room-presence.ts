import { presenceDeltaFrame } from "@magna-carta/meeting-protocol/frames";
import { announceRoster, rosterEntryFor } from "./room-roster.ts";
import {
  broadcast,
  broadcastExcludingStay,
  putParticipant,
  readParticipant,
  storedParticipants,
  type RoomContext,
  type StoredParticipant,
} from "./room-state.ts";

// WHO IS TALKING, RELAYED — and the throttle that makes relaying it affordable in a room of three
// hundred.

// HOW OFTEN ONE PARTICIPANT'S SPEAKING AND MUTED STATE IS RELAYED TO THE REST OF THE ROOM.
//
// A browser sends these on transitions only, but a transition is cheap to produce: somebody tapping
// their microphone, or a voice moving across the detector's threshold, can transition several times
// a second, and every one of them would be a frame to everybody else in a room of three hundred.
//
// A TRANSITION INSIDE THE WINDOW IS DEFERRED, NOT DROPPED. The stored state is kept current either
// way — a presence frame carries the WHOLE of what it is about rather than a change to it, so the
// participant record always holds the latest values from the instant they arrive. What dropping the
// frame outright cost was the LAST transition of a burst, which is the one that is still true: a
// one-word answer inside the window left somebody `speaking: true` on every other screen until they
// next spoke, and a quick mute-unmute left them shown muted for the rest of the meeting. Both are
// wrong for as long as nothing else happens, which is exactly how long nobody is going to notice.
//
// So a suppressed transition raises `presenceDirty` and arms the room's alarm for the end of the
// window, and the alarm relays what is stored then. That costs one wake per burst per person rather
// than one frame per transition — the alarm is armed for a deadline that is already in the future
// and re-arming it to the same instant is free — and it keeps the room's one alarm doing what it
// already does for the grace period and the ended marker: holding several deadlines and firing at
// the nearest (room-lifecycle.ts).
export const PRESENCE_RELAY_INTERVAL_MILLISECONDS = 1000;

/**
 * Records what a browser says about its own microphone, and relays it to the rest of the room.
 *
 * THE STORE ALWAYS HAPPENS; THE RELAY IS THROTTLED. Which of the two the window governs is the
 * whole design: the participant record is what `welcome`, a `sync` answer and every roster frame
 * read, so holding the store back would make the throttle a source of wrong answers rather than
 * of fewer frames.
 *
 * Answers WHEN a held-back transition is due, or null when nothing is waiting — so the caller arms
 * the alarm for that instant — and whether `speaking` itself moved, which is the one fact live captions
 * are opened and closed on (room-captions.ts). Whether it moved is answered from the record, so a frame
 * restating what is stored moves nothing, and a held-back transition moved it the moment it was stored. The arming is the caller's rather than this module's because a room
 * has exactly one alarm and one module that reconciles deadlines into it.
 *
 * THE DEADLINE IS ANSWERED RATHER THAN THE FACT, and that is a cost rather than a nicety. A bare
 * "something is waiting" forces the caller into the full reconciliation, which reads the whole
 * roster and the whole door to find the nearest deadline — and the load harness measured that at
 * two list reads for every deferred transition, on the one frame a room of three hundred sends most.
 * The deadline is already known here, and arming for a known instant needs neither read: the alarm
 * is never pushed LATER, and the full reconciliation runs at the end of every wake anyway.
 *
 * The sender is not told what it just said.
 */
export async function relayPresence(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  speaking: boolean,
  muted: boolean,
): Promise<{ readonly dueAt: number | null; readonly speakingMoved: boolean }> {
  const now = Date.now();
  const outcome = await room.ctx.blockConcurrencyWhile(
    async (): Promise<{
      relayAt: string | null;
      dueAt: number | null;
      hand: boolean;
      speakingMoved: boolean;
    }> => {
      const participant = await readParticipant(room, attendanceId);
      if (participant === undefined) {
        return { relayAt: null, dueAt: null, hand: false, speakingMoved: false };
      }
      // A frame restating what the room already holds is not a transition, whatever the browser
      // believes, and relaying it would spend a frame on every other socket to say nothing. It also
      // clears nothing: a deferred transition is deferred because the room has not said it yet, and
      // a restatement of what is stored is not the room having said it.
      if (participant.speaking === speaking && participant.muted === muted) {
        return { relayAt: null, dueAt: null, hand: false, speakingMoved: false };
      }
      // Read rather than taken from the frame: the hand is settled by its own path before this runs,
      // and the record is the one authority on it — a frame relaying what the browser CLAIMED would
      // be a second answer that disagrees the first time the change was refused.
      const hand = (participant.handRaisedAt ?? null) !== null;
      const due = relayIsDue(participant, now);
      const at = new Date(now).toISOString();
      await putParticipant(room, attendanceId, {
        ...participant,
        speaking,
        muted,
        presenceAt: due ? at : participant.presenceAt,
        presenceDirty: !due,
      });
      return {
        hand,
        speakingMoved: participant.speaking !== speaking,
        relayAt: due ? at : null,
        // The window this transition is waiting on, measured from the last relay — which is exactly
        // what `presenceFlushDeadlineOf` would answer for the record just written.
        dueAt: due
          ? null
          : presenceFlushDeadlineOf({ ...participant, presenceDirty: true, speaking, muted }),
      };
    },
  );
  if (outcome.relayAt === null) {
    return { dueAt: outcome.dueAt, speakingMoved: outcome.speakingMoved };
  }
  // Its own frame rather than a roster difference: this is the one change to a participant that
  // happens while nothing else about them has, and wrapping two booleans in a roster entry would
  // carry their name, their session and every track they publish to say one of them moved.
  // The hand rides here as well as on the roster, because this frame is what a browser applies to a
  // tile between roster changes and a reader with two sources for one fact is a reader that can hold
  // them apart. Always present, never optional: the room is the one writing it, and a client
  // branching on its presence is a client with two code paths.
  broadcast(
    room,
    presenceDeltaFrame(attendanceId, speaking, muted, outcome.hand, outcome.relayAt),
    socket,
  );
  return { dueAt: null, speakingMoved: outcome.speakingMoved };
}

/**
 * The instant a participant's held-back transition is due to be relayed, or null when none is.
 *
 * Exported for the alarm's nearest-deadline reconciliation, which is what decides when the room
 * wakes. A record carrying the flag and no instant has never been relayed at all — which cannot
 * arise, because the first transition of a stay is always due — and is treated as due now rather
 * than as a deadline that never arrives.
 */
export function presenceFlushDeadlineOf(participant: StoredParticipant): number | null {
  if (!participant.presenceDirty) return null;
  const relayedAt =
    participant.presenceAt === null ? Number.NaN : Date.parse(participant.presenceAt);
  return Number.isNaN(relayedAt) ? 0 : relayedAt + PRESENCE_RELAY_INTERVAL_MILLISECONDS;
}

/**
 * Every transition the throttle held back and whose window has now closed, relayed at last.
 *
 * WHAT IS RELAYED IS WHAT IS STORED, never what the suppressed frame said: the record holds the
 * latest of the burst, and the whole point of deferring rather than queueing is that only the latest
 * is worth sending. Each participant is relayed to everybody but themselves, for the reason the live
 * path leaves the sender out — a browser is the authority on its own microphone and has nothing to
 * learn from being told about it.
 *
 * The write happens whether or not anybody is left to send to: the flag is the room's state, and a
 * flag nobody lowered would arm the alarm again on the next reconciliation, forever.
 *
 * Answers how many transitions this flush covered, which is the only number that says whether the
 * throttle is earning its place: one is a quiet meeting, forty is a discussion in which forty
 * separate broadcasts were collapsed into one wake. It is recorded per FLUSH and never per
 * transition — an event for each would cost more than the relaying does.
 */
export async function flushDeferredPresence(room: RoomContext, now: number): Promise<number> {
  const stored = await storedParticipants(room);
  let relayed = 0;
  for (const [attendanceId, participant] of stored) {
    const deadline = presenceFlushDeadlineOf(participant);
    if (deadline === null || deadline > now) continue;
    relayed += 1;
    const at = new Date(now).toISOString();
    await putParticipant(room, attendanceId, {
      ...participant,
      presenceAt: at,
      presenceDirty: false,
    });
    broadcastExcludingStay(
      room,
      presenceDeltaFrame(
        attendanceId,
        participant.speaking,
        participant.muted,
        (participant.handRaisedAt ?? null) !== null,
        at,
      ),
      attendanceId,
    );
  }
  return relayed;
}

// Whether this participant's window has closed. A stay that has never had a presence relayed has no
// window at all, which is why the first transition of one always goes out immediately: the returning
// browser's first statement about itself is the one the room most wants relayed.
function relayIsDue(participant: StoredParticipant, now: number): boolean {
  const relayedAt =
    participant.presenceAt === null ? Number.NaN : Date.parse(participant.presenceAt);
  return Number.isNaN(relayedAt) || now - relayedAt >= PRESENCE_RELAY_INTERVAL_MILLISECONDS;
}

// ---------------------------------------------------------------------------------------------
// The hand, which rides the same frame and answers to a different rule
// ---------------------------------------------------------------------------------------------

/**
 * Raises or lowers this participant's own hand, answering whether anything moved.
 *
 * THE ROOM STAMPS THE CLOCK AND THE PERSON DECIDES THE BOOLEAN. What is stored is the instant alone;
 * the roster projects it into the two fields the wire carries. The instant is the room's for the
 * reason a chat message's is — a queue ordered by what each participant's own machine said is not
 * one ordering, and the disagreement is invisible to the host reading it.
 *
 * IT IS RELAYED ON A ROSTER CHANGE RATHER THAN ON THE PRESENCE FRAME, which is what keeps a host's
 * queue right: the roster is what a late arrival, a `sync` answer and every browser applying
 * differences all read, so a hand that travelled only as its own frame would be invisible to the
 * browser that joined a minute after it went up. A room above the threshold pays one `updated` entry
 * for it, which is the same arithmetic the difference was built for.
 *
 * Nothing is relayed for a frame that restates the hand the room already holds: a browser stating a
 * fact that has not moved is not a transition, and announcing it would spend a roster frame on every
 * socket to say nothing.
 */
export async function changeHand(
  room: RoomContext,
  attendanceId: string,
  raised: boolean,
  now: number,
): Promise<boolean> {
  const moved = await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return false;
    const raisedAt = participant.handRaisedAt ?? null;
    if ((raisedAt !== null) === raised) return false;
    await putParticipant(room, attendanceId, {
      ...participant,
      handRaisedAt: raised ? new Date(now).toISOString() : null,
    });
    return true;
  });
  if (!moved) return false;
  await announceHands(room, [attendanceId]);
  return true;
}

/**
 * A host puts a hand down — one, or every one in the room.
 *
 * NOBODY IS SPARED BY "LOWER ALL", including the host who pressed it. A host clearing the floor is
 * clearing it, and a control that skipped the person pressing it would leave the queue saying
 * something the panel does not. That is the opposite of the mute-all rule and deliberately so:
 * mute-all exists so a host can speak, and this exists so a host can start the queue again.
 *
 * THE WHOLE ROOM COSTS ONE FRAME. Three hundred cleared hands travel as one roster change carrying
 * the entries that moved, rather than as three hundred presence frames — the same arithmetic the
 * roster difference was built for. The caller has already read the roster to decide the authority,
 * so this takes that map rather than reading three hundred keys again.
 *
 * The authority is NOT asked here: a host frame is authorized from the stored participant record in
 * room-hosting.ts, which is the one place that question is answered in this room.
 */
export async function lowerHands(
  room: RoomContext,
  stored: ReadonlyMap<string, StoredParticipant>,
  participantId: string | null,
): Promise<string[]> {
  const targets =
    participantId === null
      ? [...stored]
          .filter(([, participant]) => (participant.handRaisedAt ?? null) !== null)
          .map(([attendanceId]) => attendanceId)
      : // A hand that is already down, and a stay that is not in the room, are both nothing to do.
        // Announcing either would tell every browser to redraw a tile over a fact that did not move.
        (stored.get(participantId)?.handRaisedAt ?? null) === null
        ? []
        : [participantId];
  if (targets.length === 0) return [];
  await room.ctx.blockConcurrencyWhile(async () => {
    for (const attendanceId of targets) {
      const participant = await readParticipant(room, attendanceId);
      if (participant === undefined) continue;
      await putParticipant(room, attendanceId, { ...participant, handRaisedAt: null });
    }
  });
  await announceHands(room, targets);
  return targets;
}

/**
 * The hands that moved, as ONE roster change.
 *
 * Read after the writes so the entries announced are the ones the room ended with — the same
 * arrangement mute-everyone takes, and for the same reason: a projection built from what the caller
 * intended can disagree with what committed.
 */
async function announceHands(room: RoomContext, moved: readonly string[]): Promise<void> {
  const stored = await storedParticipants(room);
  const updated = moved.flatMap((attendanceId) => {
    const participant = stored.get(attendanceId);
    // Gone between the write and this read — they left, or the meeting ended under them. Their
    // departure is announced by whichever path removed them.
    return participant === undefined ? [] : [rosterEntryFor(attendanceId, participant)];
  });
  if (updated.length === 0) return;
  announceRoster(room, stored, { updated });
}
