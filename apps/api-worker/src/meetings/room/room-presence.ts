import { presenceDeltaFrame } from "@magna-carta/meeting-protocol/frames";
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
 * Answers whether a transition is now waiting on the alarm, so the caller arms it. The arming is the
 * caller's rather than this module's because reconciling deadlines is the lifecycle module's job and
 * a room has exactly one alarm to reconcile them into.
 *
 * The sender is not told what it just said.
 */
export async function relayPresence(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  speaking: boolean,
  muted: boolean,
): Promise<boolean> {
  const now = Date.now();
  const outcome = await room.ctx.blockConcurrencyWhile(
    async (): Promise<{ relayAt: string | null; deferred: boolean }> => {
      const participant = await readParticipant(room, attendanceId);
      if (participant === undefined) return { relayAt: null, deferred: false };
      // A frame restating what the room already holds is not a transition, whatever the browser
      // believes, and relaying it would spend a frame on every other socket to say nothing. It also
      // clears nothing: a deferred transition is deferred because the room has not said it yet, and
      // a restatement of what is stored is not the room having said it.
      if (participant.speaking === speaking && participant.muted === muted) {
        return { relayAt: null, deferred: false };
      }
      const due = relayIsDue(participant, now);
      const at = new Date(now).toISOString();
      await putParticipant(room, attendanceId, {
        ...participant,
        speaking,
        muted,
        presenceAt: due ? at : participant.presenceAt,
        presenceDirty: !due,
      });
      return { relayAt: due ? at : null, deferred: !due };
    },
  );
  if (outcome.relayAt === null) return outcome.deferred;
  // Its own frame rather than a roster difference: this is the one change to a participant that
  // happens while nothing else about them has, and wrapping two booleans in a roster entry would
  // carry their name, their session and every track they publish to say one of them moved.
  broadcast(room, presenceDeltaFrame(attendanceId, speaking, muted, outcome.relayAt), socket);
  return false;
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
 */
export async function flushDeferredPresence(room: RoomContext, now: number): Promise<void> {
  const stored = await storedParticipants(room);
  for (const [attendanceId, participant] of stored) {
    const deadline = presenceFlushDeadlineOf(participant);
    if (deadline === null || deadline > now) continue;
    const at = new Date(now).toISOString();
    await putParticipant(room, attendanceId, {
      ...participant,
      presenceAt: at,
      presenceDirty: false,
    });
    broadcastExcludingStay(
      room,
      presenceDeltaFrame(attendanceId, participant.speaking, participant.muted, at),
      attendanceId,
    );
  }
}

// Whether this participant's window has closed. A stay that has never had a presence relayed has no
// window at all, which is why the first transition of one always goes out immediately: the returning
// browser's first statement about itself is the one the room most wants relayed.
function relayIsDue(participant: StoredParticipant, now: number): boolean {
  const relayedAt =
    participant.presenceAt === null ? Number.NaN : Date.parse(participant.presenceAt);
  return Number.isNaN(relayedAt) || now - relayedAt >= PRESENCE_RELAY_INTERVAL_MILLISECONDS;
}
