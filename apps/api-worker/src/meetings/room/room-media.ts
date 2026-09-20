import {
  closedFrame,
  layeredFrame,
  publishedFrame,
  renegotiatedFrame,
  subscribedFrame,
} from "@magna-carta/meeting-protocol/frames";
import { sfuClientForEnv, simulcastPreferenceFor, type SfuClient } from "../sfu/sfu-client.ts";
import { announceParticipantUpdated, announceRoster } from "./room-roster.ts";
import {
  deleteParticipant,
  putParticipant,
  readParticipant,
  recordRoomFailure,
  storedParticipants,
  type RoomContext,
  type StoredParticipant,
  type StoredTrack,
} from "./room-state.ts";

// THE MEDIA SIDE OF THE ROOM: the routing-service session each participant publishes through, the
// four acts that reach that service, the tracks the roster remembers because of them, and the
// release that stops the service forwarding when somebody is gone.
//
// Nothing here decides whether a frame is ALLOWED — that is answered from the roster alone, before a
// session exists, in room-frames.ts. By the time anything here runs the frame has been accepted and
// the only remaining question is what the service says.

/** The routing session this participant publishes through, or why there is none to resolve. */
export type SessionOutcome =
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable"; readonly caught: unknown };

/**
 * This participant's routing-service session, opened on first use.
 *
 * Under `blockConcurrencyWhile` because the decision is read-then-write across a NETWORK call:
 * workerd holds the input gate closed only while a storage operation is outstanding, so without
 * this a second frame arriving mid-call would read the same null, open a second session, and leave
 * the participant publishing into one session while the roster named the other.
 *
 * AND THE NETWORK CALL IS WRAPPED, because a throw out of this callback does not fail one frame —
 * Cloudflare terminates and resets the object, which drops every socket in the meeting. One
 * participant's publish meeting a routing service that will not answer would end the meeting for
 * everybody in it. So the failure is carried out as a value and answered on the one socket that
 * asked.
 */
export async function sessionFor(
  room: RoomContext,
  attendanceId: string,
  sfu: SfuClient,
): Promise<SessionOutcome> {
  return await room.ctx.blockConcurrencyWhile(async (): Promise<SessionOutcome> => {
    // `absent` rather than a throw: no roster entry means the room has already removed this
    // participant — they left, or the meeting ended under them — and that is a state the caller
    // reports as such, not an outage of the routing service.
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return { kind: "absent" };
    if (participant.sfuSessionId !== null) {
      return { kind: "session", sessionId: participant.sfuSessionId };
    }
    try {
      const { sessionId } = await sfu.createSession();
      await putParticipant(room, attendanceId, { ...participant, sfuSessionId: sessionId });
      return { kind: "session", sessionId };
    } catch (caught) {
      return { kind: "unavailable", caught };
    }
  });
}

/**
 * The browser's own tracks, offered to the routing service and then remembered on the roster.
 *
 * WHAT THE SERVICE CONFIRMED IS WHAT IS RECORDED, which is not what the browser offered. A track
 * the service refused comes back carrying an error code, and recording it would put a tile on every
 * other participant's screen for media that is not being forwarded — each of them then subscribing
 * to something that will never arrive.
 */
export async function publishTracks(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  sessionId: string,
  frame: {
    readonly sessionDescription: { readonly type: string; readonly sdp: string };
    readonly tracks: readonly {
      readonly trackName: string;
      readonly mid: string;
      readonly kind: string;
    }[];
  },
  sfu: SfuClient,
): Promise<void> {
  const answer = await sfu.addTracks(sessionId, {
    sessionDescription: frame.sessionDescription,
    tracks: frame.tracks.map((track) => ({
      location: "local" as const,
      trackName: track.trackName,
      mid: track.mid,
      kind: track.kind,
    })),
  });
  const kindByName = new Map(frame.tracks.map((track) => [track.trackName, track.kind]));
  const confirmed = answer.tracks.flatMap((track) =>
    track.errorCode !== undefined || track.trackName === undefined || track.mid === undefined
      ? []
      : [
          {
            trackName: track.trackName,
            mid: track.mid,
            kind: kindByName.get(track.trackName) ?? "",
          },
        ],
  );
  socket.send(
    publishedFrame(
      answer.sessionDescription,
      confirmed.map((track) => ({ trackName: track.trackName, mid: track.mid })),
    ),
  );
  // The roster is what tells everybody else there is something new to ask for — and the session
  // this participant now publishes through, which a first publish is what creates.
  await recordPublishedTracks(room, attendanceId, confirmed);
  await announceParticipantUpdated(room, attendanceId);
}

/**
 * Somebody else's tracks, forwarded to this browser.
 *
 * No offer of our own: the browser is asking to RECEIVE, so the routing service is the side with
 * something to describe and its answer carries the offer the browser replies to.
 */
export async function subscribeTracks(
  socket: WebSocket,
  sessionId: string,
  frame: {
    readonly tracks: readonly {
      readonly sessionId: string;
      readonly trackName: string;
      readonly preferredRid?: string;
    }[];
  },
  sfu: SfuClient,
): Promise<void> {
  const answer = await sfu.addTracks(sessionId, {
    tracks: frame.tracks.map((track) => ({
      location: "remote" as const,
      sessionId: track.sessionId,
      trackName: track.trackName,
      // OMITTED WHEN THE BROWSER NAMED NONE, rather than defaulted to a layer: a microphone and
      // a screen share publish one layer each, and stating a preference between layers that do
      // not exist would be an instruction the service has to reconcile for no reason.
      ...(track.preferredRid === undefined
        ? {}
        : { simulcast: simulcastPreferenceFor(track.preferredRid) }),
    })),
  });
  socket.send(
    subscribedFrame(
      answer.sessionDescription,
      answer.tracks.flatMap((track) =>
        track.sessionId === undefined || track.trackName === undefined || track.mid === undefined
          ? []
          : [{ sessionId: track.sessionId, trackName: track.trackName, mid: track.mid }],
      ),
      answer.requiresImmediateRenegotiation,
    ),
  );
}

/**
 * A different layer of what is already coming in — NOT a second subscription.
 *
 * The media is already flowing to this browser; what has changed is how large it is drawing the
 * tile. Asking for the track again would build a second media section for a stream it is already
 * receiving, and renegotiate the connection to do it — so a gallery page turning would cost every
 * tile on the page a renegotiation.
 */
export async function changeLayers(
  socket: WebSocket,
  sessionId: string,
  frame: {
    readonly tracks: readonly {
      readonly mid: string;
      readonly preferredRid: "f" | "h" | "q";
    }[];
  },
  sfu: SfuClient,
): Promise<void> {
  const answer = await sfu.updateTracks(sessionId, {
    tracks: frame.tracks.map((track) => ({
      mid: track.mid,
      simulcast: simulcastPreferenceFor(track.preferredRid),
    })),
  });
  // Answered from what the browser ASKED, with the service's refusals matched onto it, so there
  // is one reply entry per request in request order. The service names the sections it could not
  // change and says nothing about the rest, which is not a list a client can pair up by itself.
  const refusedByMid = new Map(
    answer.tracks.flatMap((track) =>
      track.mid === undefined || track.errorCode === undefined
        ? []
        : [[track.mid, track.errorCode] as const],
    ),
  );
  socket.send(
    layeredFrame(
      frame.tracks.map((track) => {
        const errorCode = refusedByMid.get(track.mid);
        return {
          mid: track.mid,
          preferredRid: track.preferredRid,
          ...(errorCode === undefined ? {} : { errorCode }),
        };
      }),
    ),
  );
}

/** The browser's answer to a description the service offered. Nothing comes back but the ack. */
export async function renegotiateSession(
  socket: WebSocket,
  sessionId: string,
  sessionDescription: { readonly type: string; readonly sdp: string },
  sfu: SfuClient,
): Promise<void> {
  await sfu.renegotiate(sessionId, { sessionDescription });
  socket.send(renegotiatedFrame());
}

/**
 * Tracks this browser has stopped sending, closed at the service and dropped from the roster.
 *
 * A TRACK THAT STOPPED LEAVES THE ROSTER. Without this, a member who stopped sharing their screen
 * went on offering it to everybody who joined afterwards — each of them subscribing to a track the
 * service no longer forwards, and seeing a black tile they cannot get rid of.
 */
export async function closePublishedTracks(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  sessionId: string,
  mids: readonly string[],
  sfu: SfuClient,
): Promise<void> {
  const closed = await sfu.closeTracks(sessionId, { tracks: mids.map((mid) => ({ mid })) });
  socket.send(closedFrame(closed.sessionDescription));
  // The service's own answer is what says which sections actually closed; an answer that names
  // none is not a statement that nothing did, so the requested set stands in for it.
  const confirmedMids = closed.tracks.flatMap((track) =>
    track.errorCode !== undefined || track.mid === undefined ? [] : [track.mid],
  );
  await forgetTracks(
    room,
    attendanceId,
    new Set(closed.tracks.length === 0 ? mids : confirmedMids),
  );
}

// Merges by track name rather than appending: a browser that republishes a track it already has —
// a camera switched off and on — is offering the same track again, not a second one, and a roster
// listing it twice makes every other browser subscribe to it twice.
export async function recordPublishedTracks(
  room: RoomContext,
  attendanceId: string,
  tracks: readonly StoredTrack[],
): Promise<void> {
  if (tracks.length === 0) return;
  await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return;
    const merged = new Map(participant.tracks.map((track) => [track.trackName, track]));
    for (const track of tracks) merged.set(track.trackName, track);
    await putParticipant(room, attendanceId, { ...participant, tracks: [...merged.values()] });
  });
}

/** Drops the tracks whose media sections have stopped, and tells the room if any had. */
export async function forgetTracks(
  room: RoomContext,
  attendanceId: string,
  mids: ReadonlySet<string>,
): Promise<void> {
  const changed = await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return false;
    const kept = participant.tracks.filter((track) => track.mid === null || !mids.has(track.mid));
    if (kept.length === participant.tracks.length) return false;
    await putParticipant(room, attendanceId, { ...participant, tracks: kept });
    return true;
  });
  if (changed) await announceParticipantUpdated(room, attendanceId);
}

/**
 * A participant the room is letting go of on purpose — they pressed Leave, or the route closed
 * their stay. The roster entry goes, everybody is told, and the media they were publishing is
 * stopped: the record already says they are not in the meeting, and forwarding that outlived it
 * would be billed against a stay that has ended.
 *
 * The broadcast rides on whether a roster entry was ACTUALLY removed. A socket closing under a
 * meeting that has already ended finds nothing to remove, and announcing an unchanged roster there
 * would send a roster frame after the `ended` frame — telling a browser who is in a room that is
 * over.
 */
export async function releaseParticipant(room: RoomContext, attendanceId: string): Promise<void> {
  const participant = await readParticipant(room, attendanceId);
  const removed = await deleteParticipant(room, attendanceId);
  if (!removed) return;
  announceRoster(room, await storedParticipants(room), { left: [attendanceId] });
  if (participant !== undefined) await releaseMedia(room, [participant]);
}

/**
 * Stops the routing service forwarding what these participants were publishing.
 *
 * BEST EFFORT, ALWAYS, AND NEVER BLOCKING THE RECORD. What is being cleaned up is a cost and a
 * subscription target, not a fact anybody is owed: a failure here means the service keeps
 * forwarding for a while, which is money, where a failure that propagated would mean a stay left
 * open in a firm's record of a gathering, which is the record being wrong.
 */
export async function releaseMedia(
  room: RoomContext,
  participants: readonly StoredParticipant[],
): Promise<void> {
  const sessions = participants.filter((participant) => participant.sfuSessionId !== null);
  if (sessions.length === 0) return;
  const sfu = sfuClientForEnv(room.env);
  if (sfu === null) return;

  for (const participant of sessions) {
    const sessionId = participant.sfuSessionId ?? "";
    const mids = participant.tracks.flatMap((track) =>
      track.mid === null ? [] : [{ mid: track.mid }],
    );
    try {
      // With no media section recorded there is nothing to name, so the service is asked what it
      // is holding and that is what is closed. `force`, because the browser is already gone and
      // there is nobody left to answer a renegotiation.
      if (mids.length === 0) await sfu.closeSession(sessionId);
      else await sfu.closeTracks(sessionId, { tracks: mids, force: true });
    } catch (caught) {
      recordRoomFailure(room, "close-tracks", caught);
    }
  }
}
