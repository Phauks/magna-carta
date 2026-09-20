import { presenceDeltaFrame } from "@magna-carta/meeting-protocol/frames";
import { broadcast, putParticipant, readParticipant, type RoomContext } from "./room-state.ts";

// WHO IS TALKING, RELAYED — and the throttle that makes relaying it affordable in a room of three
// hundred.

// HOW OFTEN ONE PARTICIPANT'S SPEAKING AND MUTED STATE IS RELAYED TO THE REST OF THE ROOM.
//
// A browser sends these on transitions only, but a transition is cheap to produce: somebody tapping
// their microphone, or a voice moving across the detector's threshold, can transition several times
// a second, and every one of them would be a frame to everybody else in a room of three hundred.
//
// A TRANSITION INSIDE THE WINDOW IS DROPPED, NOT DEFERRED, and the stored state is kept current
// either way. That is safe because a presence frame carries the WHOLE of what it is about rather
// than a change to it: a frame that is not sent loses nothing a later one does not restate, and the
// participant record — which `welcome`, a `sync` answer and any roster frame carrying this person
// all read — holds the latest values from the instant they arrive. Deferring instead would mean
// arming this object's one alarm at sub-second range, on a room that otherwise sleeps between a
// minute-long grace and a day-long marker; every suppressed transition would re-arm it, so a room
// of three hundred would be woken about as often as simply relaying everything. What the drop costs
// is the last transition of a burst arriving late — the tile ordering is a moment stale — which is
// the cheaper of the two mistakes for a fact that exists to rank tiles.
const PRESENCE_RELAY_INTERVAL_MILLISECONDS = 1000;

/**
 * Records what a browser says about its own microphone, and relays it to the rest of the room.
 *
 * THE STORE ALWAYS HAPPENS; THE RELAY IS THROTTLED. Which of the two the window governs is the
 * whole design: the participant record is what `welcome`, a `sync` answer and every roster frame
 * read, so holding the store back would make the throttle a source of wrong answers rather than
 * of fewer frames.
 *
 * The sender is not told what it just said.
 */
export async function relayPresence(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  speaking: boolean,
  muted: boolean,
): Promise<void> {
  const now = Date.now();
  const relayAt = await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return null;
    // A frame restating what the room already holds is not a transition, whatever the browser
    // believes, and relaying it would spend a frame on every other socket to say nothing.
    if (participant.speaking === speaking && participant.muted === muted) return null;
    const lastRelay =
      participant.presenceAt === null ? Number.NaN : Date.parse(participant.presenceAt);
    const due = Number.isNaN(lastRelay) || now - lastRelay >= PRESENCE_RELAY_INTERVAL_MILLISECONDS;
    const at = new Date(now).toISOString();
    await putParticipant(room, attendanceId, {
      ...participant,
      speaking,
      muted,
      presenceAt: due ? at : participant.presenceAt,
    });
    return due ? at : null;
  });
  if (relayAt === null) return;
  // Its own frame rather than a roster difference: this is the one change to a participant that
  // happens while nothing else about them has, and wrapping two booleans in a roster entry would
  // carry their name, their session and every track they publish to say one of them moved.
  broadcast(room, presenceDeltaFrame(attendanceId, speaking, muted, relayAt), socket);
}
