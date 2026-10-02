import {
  closedFrame,
  layeredFrame,
  publishedFrame,
  renegotiatedFrame,
  subscribedFrame,
} from "@magna-carta/meeting-protocol/frames";
import {
  sfuClientForEnv,
  SfuUnavailableError,
  simulcastPreferenceFor,
  type SfuClient,
} from "../sfu/sfu-client.ts";
import { announceParticipantUpdated, announceRoster } from "./room-roster.ts";
import {
  clearSpotlightFor,
  deleteParticipant,
  putParticipant,
  readParticipant,
  recordRoomFailure,
  storedParticipants,
  trySend,
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

/**
 * What an act at the routing service actually amounted to, for the module that records it.
 *
 * The counts are returned rather than recorded here, because this module is where the service is
 * spoken to and room-frames.ts is where a frame's whole story is known — it holds the socket's
 * attachment, and therefore the meeting a count belongs to. Counting here and recording there also
 * keeps the media path free of telemetry, which is the arrangement every refusal in this room
 * already has.
 */
export interface PublishOutcome {
  readonly trackCount: number;
  readonly audioCount: number;
  readonly videoCount: number;
  readonly refusedCount: number;
}

export interface SubscribeOutcome {
  readonly requestedCount: number;
  readonly forwardedCount: number;
}

export interface LayerOutcome {
  readonly trackCount: number;
  readonly refusedCount: number;
}

/** The routing session this participant publishes through, or why there is none to resolve. */
export type SessionOutcome =
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable"; readonly caught: unknown };

/**
 * A routing session the room has asked the service for, from the moment it asks until the session
 * is on the participant's record.
 *
 * IN MEMORY, AND ONLY FOR AS LONG AS A FRAME IS WORKING ON IT. The rule in this directory is that
 * nothing about a participant lives on the instance, because hibernation empties it — and that is
 * exactly why this may: a room cannot hibernate while a frame is still being served, and a publish or
 * a subscription writes the session to the record, or gives it up, before its frame is done. The one
 * way an opening outlives its frame is an act the service refused, or one that writes nothing (a
 * layer change, a renegotiation, a close); it is then this participant's next frame that finds it —
 * until a reconnect of the stay (`abandonAnsweredOpening`) or hibernation clears it. A room that
 * wakes without it reads no session on the record and opens another; the one it lost had either
 * nothing negotiated into it, or an act the service refused, and the next frame starts clean.
 */
interface SessionOpening {
  /** The answer every frame from this participant that arrives while the call is out waits on. */
  readonly outcome: Promise<SessionOutcome>;
  /** The session the service answered with, while it is not yet on the record. */
  sessionId: string | null;
  /**
   * The socket whose browser has offered media into the session. A routing session belongs to ONE
   * peer connection from its first offer on, so this is what tells the frames of a browser that
   * reconnected apart from those of the connection it replaced.
   */
  boundTo: WebSocket | null;
  /** Raised when the stay was let go while the session was unrecorded; nothing may use it after. */
  abandoned: boolean;
}

// Keyed by the Durable Object's own state, which is one object for the life of one instance — so each
// room holds its own openings without the class carrying a field, and an instance that goes away
// takes its entry with it. Module state rather than instance state on the terms the storage counters
// in room-state.ts are: it does not survive hibernation, and nothing in it needs to.
const openingsByRoom = new WeakMap<DurableObjectState, Map<string, SessionOpening>>();

function openingsIn(room: RoomContext): Map<string, SessionOpening> {
  let openings = openingsByRoom.get(room.ctx);
  if (openings === undefined) {
    openings = new Map();
    openingsByRoom.set(room.ctx, openings);
  }
  return openings;
}

/** The opening this session came from, while it is not yet on the record — or undefined. */
function unrecordedOpening(
  room: RoomContext,
  attendanceId: string,
  sessionId: string,
): SessionOpening | undefined {
  const opening = openingsByRoom.get(room.ctx)?.get(attendanceId);
  return opening?.sessionId === sessionId ? opening : undefined;
}

// Removed only if it is still the entry under this stay: a later opening for the same person must
// not be forgotten on behalf of an earlier one.
function forgetOpening(room: RoomContext, attendanceId: string, opening: SessionOpening): void {
  const openings = openingsByRoom.get(room.ctx);
  if (openings?.get(attendanceId) === opening) openings.delete(attendanceId);
}

/**
 * This participant's routing-service session, opened on first use.
 *
 * NO LOCK IS HELD ACROSS THE CALL TO THE SERVICE. At the top of the hour three hundred people arrive
 * and publish within seconds of each other; a `blockConcurrencyWhile` around the network call opened
 * their sessions one at a time, and held every other frame in the room behind the slowest answer the
 * service gave. What that lock bought — one participant's two frames cannot both open a session — is
 * kept by a narrower means: the first frame to find no session puts its call in `openingsIn(room)`
 * before it yields, and every later frame from the same participant waits on that one call. Frames
 * from anybody else go straight past.
 *
 * WHY THE LOOK-AND-CLAIM NEEDS NO LOCK. Between the read of the record and the claim there is no
 * await at all, so no other code runs between them — and while the read itself is outstanding
 * workerd holds the input gate closed, so neither a new frame nor the answer to anybody's call to the
 * service is delivered until it resolves. The map is looked in again after the read because a frame
 * already past its own await can still claim first; it cannot claim in between the look and the set.
 * The gate opens only at a NON-storage await, and the call to the service is one: that is why the
 * session is not written here from the record read before it.
 *
 * NOT WRITTEN HERE AT ALL, in fact. The act the frame performs next — a publish or a subscription —
 * already reads this participant's record after the service has answered it and writes it back, and
 * the session goes into that same write (`writeAgainstSession`). A write here as well would be a
 * second read of the record after the call, spent on the frame a whole room sends at once. Until
 * then, the opening is where this participant's other frames find the session.
 *
 * AND THE NETWORK CALL IS WRAPPED, because a throw out of here does not fail one frame — Cloudflare
 * terminates and resets the object, which drops every socket in the meeting. So a failure is carried
 * out as a value to every frame that was waiting on the call, each answers its own socket with an
 * Error ID, and the opening is forgotten so that the next frame asks the service again.
 */
export async function sessionFor(
  room: RoomContext,
  attendanceId: string,
  sfu: SfuClient,
): Promise<SessionOutcome> {
  const openings = openingsIn(room);
  // Being opened, or opened and not yet written: the answer is that call's, and it costs this frame
  // no read of its own.
  const pending = openings.get(attendanceId);
  if (pending !== undefined && !pending.abandoned) return await pending.outcome;
  // `absent` rather than a throw: no roster entry means the room has already removed this
  // participant — they left, or the meeting ended under them — and that is a state the caller
  // reports as such, not an outage of the routing service.
  const participant = await readParticipant(room, attendanceId);
  if (participant === undefined) return { kind: "absent" };
  if (participant.sfuSessionId !== null) {
    return { kind: "session", sessionId: participant.sfuSessionId };
  }
  const claimed = openings.get(attendanceId);
  if (claimed !== undefined && !claimed.abandoned) return await claimed.outcome;
  return await openSession(openings, attendanceId, sfu);
}

/**
 * Asks the service for a session, with the ask recorded where this participant's next frame will
 * find it. The entry is set BEFORE the first await, so there is no moment at which another frame
 * could see neither the session on the record nor the call that is opening it.
 */
async function openSession(
  openings: Map<string, SessionOpening>,
  attendanceId: string,
  sfu: SfuClient,
): Promise<SessionOutcome> {
  // Assigned by the promise's executor, which runs before the constructor returns.
  let answer!: (outcome: SessionOutcome) => void;
  const opening: SessionOpening = {
    outcome: new Promise<SessionOutcome>((resolve) => {
      answer = resolve;
    }),
    sessionId: null,
    boundTo: null,
    abandoned: false,
  };
  openings.set(attendanceId, opening);
  try {
    const { sessionId } = await sfu.createSession();
    if (opening.abandoned) {
      // Let go while the call was out — they left, or were removed. The session has nothing in it,
      // which costs nothing, and there is nobody left to hand it to.
      if (openings.get(attendanceId) === opening) openings.delete(attendanceId);
      answer({ kind: "absent" });
    } else {
      opening.sessionId = sessionId;
      answer({ kind: "session", sessionId });
    }
  } catch (caught) {
    // Forgotten, so the NEXT frame asks again rather than inheriting this answer: a service that did
    // not answer once has not refused for good. Every frame already waiting gets the failure, and
    // each is refused on its own socket with an Error ID of its own.
    if (openings.get(attendanceId) === opening) openings.delete(attendanceId);
    answer({ kind: "unavailable", caught });
  }
  return await opening.outcome;
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.READY_STATE_OPEN;
}

// Best effort, for the reason `releaseMedia` is: what is being stopped is a cost, and a failure here
// is money rather than a record being wrong.
async function closeSessionQuietly(
  room: RoomContext,
  sfu: SfuClient,
  sessionId: string,
): Promise<void> {
  try {
    await sfu.closeSession(sessionId);
  } catch (caught) {
    recordRoomFailure(room, "close-tracks", caught);
  }
}

/**
 * Whether an act may go on in the session it was handed, when that session is not on the record yet.
 * A session that IS on the record has nothing to decide here, and asking costs no read.
 *
 * TWO CONNECTIONS CAN WAIT ON ONE OPENING. It is keyed by the stay, and a browser that reconnects
 * while its session is being opened — somebody reloading at a spinner, which is what a slow service
 * invites — replaces its socket without replacing its stay (room-lifecycle.ts). A routing session
 * belongs to one peer connection from its first offer, so:
 *
 * - a socket that has already gone offers nothing into it (`skip`), which leaves the session
 *   untouched for the connection that replaced it;
 * - a live socket that finds it already carrying a connection that has gone gives it up, closes it,
 *   and is refused like any other failure to open one — its browser asks again, and that frame opens
 *   a session of its own.
 */
async function claimOpening(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  sessionId: string,
  sfu: SfuClient,
): Promise<"proceed" | "skip"> {
  const opening = unrecordedOpening(room, attendanceId, sessionId);
  if (opening === undefined) return "proceed";
  if (opening.abandoned) {
    forgetOpening(room, attendanceId, opening);
    return "skip";
  }
  if (!isOpen(socket)) return "skip";
  if (opening.boundTo === null || opening.boundTo === socket) {
    opening.boundTo = socket;
    return "proceed";
  }
  opening.abandoned = true;
  forgetOpening(room, attendanceId, opening);
  await closeSessionQuietly(room, sfu, sessionId);
  throw new SfuUnavailableError("create-session");
}

/**
 * Writes what an act learned onto the participant's record — and, when the session it acted in is
 * not on the record yet, the session with it, in the SAME write.
 *
 * UNDER THE GATE, WITH NOTHING BUT STORAGE INSIDE IT. The service has already answered by the time
 * this runs, so the gate spans one read and one write: it is the input gate's own guarantee said out
 * loud, and it holds the room for the length of a cached read rather than a round trip.
 *
 * WHAT WAS LEARNED IN ONE SESSION BELONGS ONLY ON A RECORD NAMING THAT SESSION. A browser that
 * reconnected while this act was out has had its record reset to a session that does not exist yet,
 * and tracks or sections from the connection it replaced would put a tile on every screen for media
 * nobody is sending. And a session nobody's record will name is closed, because the service would
 * otherwise go on forwarding whatever the act put into it.
 */
async function writeAgainstSession(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  sessionId: string,
  sfu: SfuClient,
  change: (participant: StoredParticipant) => StoredParticipant | null,
): Promise<void> {
  const opening = unrecordedOpening(room, attendanceId, sessionId);
  if (opening !== undefined && (opening.abandoned || !isOpen(socket))) {
    opening.abandoned = true;
    forgetOpening(room, attendanceId, opening);
    await closeSessionQuietly(room, sfu, sessionId);
    return;
  }
  const written = await room.ctx.blockConcurrencyWhile(async (): Promise<boolean> => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return false;
    const current = participant.sfuSessionId ?? (opening === undefined ? null : sessionId);
    if (current !== sessionId) return false;
    const changed = change(participant);
    // Nothing learned and nothing owed: the record already says everything this act would write.
    if (changed === null && opening === undefined) return true;
    await putParticipant(room, attendanceId, {
      ...(changed ?? participant),
      sfuSessionId: sessionId,
    });
    return true;
  });
  if (opening === undefined) return;
  // After the write rather than before it: a frame whose read began before the write saw no session,
  // and it resolves ahead of this line, so it still finds the opening. One whose read began after sees
  // the session on the record.
  forgetOpening(room, attendanceId, opening);
  if (!written) await closeSessionQuietly(room, sfu, sessionId);
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
): Promise<PublishOutcome> {
  if ((await claimOpening(room, socket, attendanceId, sessionId, sfu)) === "skip") {
    return { trackCount: 0, audioCount: 0, videoCount: 0, refusedCount: 0 };
  }
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
  trySend(
    socket,
    publishedFrame(
      answer.sessionDescription,
      confirmed.map((track) => ({ trackName: track.trackName, mid: track.mid })),
    ),
  );
  // The roster is what tells everybody else there is something new to ask for — and the session
  // this participant now publishes through, which a first publish is what creates.
  await recordPublishedTracks(room, socket, attendanceId, sessionId, confirmed, sfu);
  await announceParticipantUpdated(room, attendanceId);
  return {
    trackCount: confirmed.length,
    // Counted by kind rather than named: how many cameras and microphones a room is carrying is the
    // shape of the meeting, and a track NAME carries the handle of whoever published it.
    audioCount: confirmed.filter((track) => track.kind === "audio").length,
    videoCount: confirmed.filter((track) => track.kind !== "audio").length,
    // What the browser offered and the service would not carry — the difference between "nobody can
    // see them" and "they never offered a camera".
    refusedCount: frame.tracks.length - confirmed.length,
  };
}

/**
 * Somebody else's tracks, forwarded to this browser.
 *
 * No offer of our own: the browser is asking to RECEIVE, so the routing service is the side with
 * something to describe and its answer carries the offer the browser replies to.
 */
export async function subscribeTracks(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  sessionId: string,
  frame: {
    readonly tracks: readonly {
      readonly sessionId: string;
      readonly trackName: string;
      readonly preferredRid?: string;
    }[];
  },
  sfu: SfuClient,
): Promise<SubscribeOutcome> {
  if ((await claimOpening(room, socket, attendanceId, sessionId, sfu)) === "skip") {
    return { requestedCount: frame.tracks.length, forwardedCount: 0 };
  }
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
  const forwarded = answer.tracks.flatMap((track) =>
    track.sessionId === undefined || track.trackName === undefined || track.mid === undefined
      ? []
      : [{ sessionId: track.sessionId, trackName: track.trackName, mid: track.mid }],
  );
  trySend(
    socket,
    subscribedFrame(answer.sessionDescription, forwarded, answer.requiresImmediateRenegotiation),
  );
  // THE SECTIONS THE ROOM OPENED FOR THIS BROWSER, remembered because they are the whole of what it
  // may later ask to change the layer of. A layer change names a media section inside the asking
  // browser's OWN session, and the routing service will change any section it holds for that
  // session — including the ones this browser publishes through — so the roster check a layer frame
  // passes says nothing at all unless the room also knows which sections it subscribed.
  await recordSubscribedSections(
    room,
    socket,
    attendanceId,
    sessionId,
    forwarded.map((track) => track.mid),
    sfu,
  );
  return { requestedCount: frame.tracks.length, forwardedCount: forwarded.length };
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
): Promise<LayerOutcome> {
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
  trySend(
    socket,
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
  return { trackCount: frame.tracks.length, refusedCount: refusedByMid.size };
}

/** The browser's answer to a description the service offered. Nothing comes back but the ack. */
export async function renegotiateSession(
  socket: WebSocket,
  sessionId: string,
  sessionDescription: { readonly type: string; readonly sdp: string },
  sfu: SfuClient,
): Promise<void> {
  await sfu.renegotiate(sessionId, { sessionDescription });
  trySend(socket, renegotiatedFrame());
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
  trySend(socket, closedFrame(closed.sessionDescription));
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
  socket: WebSocket,
  attendanceId: string,
  sessionId: string,
  tracks: readonly StoredTrack[],
  sfu: SfuClient,
): Promise<void> {
  // Nothing confirmed and no session owed to the record: nothing to write, and no read to spend.
  if (tracks.length === 0 && unrecordedOpening(room, attendanceId, sessionId) === undefined) return;
  await writeAgainstSession(room, socket, attendanceId, sessionId, sfu, (participant) => {
    if (tracks.length === 0) return null;
    const merged = new Map(participant.tracks.map((track) => [track.trackName, track]));
    for (const track of tracks) merged.set(track.trackName, track);
    return { ...participant, tracks: [...merged.values()] };
  });
}

// Merged as a set: the service answers with the section it used, and a browser re-subscribing to a
// track it already holds is told the same section again.
async function recordSubscribedSections(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  sessionId: string,
  mids: readonly string[],
  sfu: SfuClient,
): Promise<void> {
  if (mids.length === 0 && unrecordedOpening(room, attendanceId, sessionId) === undefined) return;
  await writeAgainstSession(room, socket, attendanceId, sessionId, sfu, (participant) => {
    if (mids.length === 0) return null;
    const merged = new Set([...participant.subscribedMids, ...mids]);
    return { ...participant, subscribedMids: [...merged] };
  });
}

/**
 * Drops the tracks whose media sections have stopped, and tells the room if any had.
 *
 * `announce` is false for exactly one caller: muting the whole room, which closes up to three
 * hundred microphones in one frame and spends ONE roster broadcast at the end rather than one per
 * person. Every other caller leaves it alone.
 */
export async function forgetTracks(
  room: RoomContext,
  attendanceId: string,
  mids: ReadonlySet<string>,
  announce = true,
): Promise<void> {
  const changed = await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return false;
    const kept = participant.tracks.filter((track) => track.mid === null || !mids.has(track.mid));
    // A section that has closed is not one a layer change may name any more, whichever side opened
    // it: the same numbering is the service's handle for both halves of one session.
    const keptSubscriptions = participant.subscribedMids.filter((mid) => !mids.has(mid));
    const unchanged =
      kept.length === participant.tracks.length &&
      keptSubscriptions.length === participant.subscribedMids.length;
    if (unchanged) return false;
    await putParticipant(room, attendanceId, {
      ...participant,
      tracks: kept,
      subscribedMids: keptSubscriptions,
    });
    return kept.length !== participant.tracks.length;
  });
  if (changed && announce) await announceParticipantUpdated(room, attendanceId);
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
  // A SESSION STILL BEING OPENED FOR THEM IS GIVEN UP, whether or not there was a record to remove:
  // the call answers `absent` to whoever is waiting on it, and an act already under way finds the
  // opening abandoned when it comes to write and closes what it put into the session.
  const unrecorded = abandonOpening(room, attendanceId);
  if (!removed) {
    // No roster entry to remove — the grace sweep, or an earlier act, took it — but a session the
    // service opened for this stay and no record names is still being billed. It is closed either
    // way; with a record it goes out below with the rest of their media.
    if (unrecorded !== null) await closeUnrecordedSession(room, unrecorded);
    return;
  }
  announceRoster(room, await storedParticipants(room), { left: [attendanceId] });
  // A spotlight on an empty chair would leave every browser drawing the large tile for somebody who
  // is not here and asking the routing service for their full layer.
  await clearSpotlightFor(room, [attendanceId]);
  if (participant !== undefined) {
    await releaseMedia(
      room,
      // The session the service opened for them and no record names yet is released with the rest.
      unrecorded === null || participant.sfuSessionId !== null
        ? [participant]
        : [{ ...participant, sfuSessionId: unrecorded }],
    );
  }
}

/**
 * Marks this stay's opening abandoned, answering the session it had already been given, if any.
 *
 * Left in place rather than removed, so an act holding the session finds the mark when it comes to
 * write; that act, or the call itself if it is still out, is what removes it.
 */
function abandonOpening(room: RoomContext, attendanceId: string): string | null {
  const opening = openingsByRoom.get(room.ctx)?.get(attendanceId);
  if (opening === undefined || opening.abandoned) return null;
  opening.abandoned = true;
  return opening.sessionId;
}

/**
 * A NEW SOCKET HAS TAKEN THIS STAY OVER: the opening the old one left behind is given up if the
 * service has already ANSWERED it, and its session is returned for the caller to close.
 *
 * An answered opening is a session the old connection could have offered into — and if it did, and
 * the act was refused or wrote nothing, the opening is still here, bound to a socket that has gone.
 * Left in place, the returning browser's first publish would find it, see it bound to somebody else,
 * give it up and be refused, with nothing to tell it to publish again. Given up here, that first
 * frame finds the mark, reads no session on the freshly reset record, and opens one of its own.
 *
 * An opening the service has NOT answered yet is kept, deliberately: no session exists for the old
 * connection to have put anything into, the old socket is closed before the answer can arrive (so it
 * cannot claim it), and the returning browser inherits the call rather than paying for a second one —
 * which is what somebody reloading at a spinner while the service is slow most needs.
 *
 * Synchronous, so the caller runs it inside the same gate that resets the record: no frame can find
 * the old opening against the new record.
 */
export function abandonAnsweredOpening(room: RoomContext, attendanceId: string): string | null {
  const opening = openingsByRoom.get(room.ctx)?.get(attendanceId);
  if (opening === undefined || opening.abandoned || opening.sessionId === null) return null;
  return abandonOpening(room, attendanceId);
}

/**
 * Closes a session the service opened and no record names — best effort, for the reason
 * `releaseMedia` is: what is being stopped is a cost, and a failure is money rather than a record
 * being wrong.
 */
export async function closeUnrecordedSession(room: RoomContext, sessionId: string): Promise<void> {
  const sfu = sfuClientForEnv(room.env);
  if (sfu === null) return;
  await closeSessionQuietly(room, sfu, sessionId);
}

/**
 * Empties this room's openings as hibernation would. For the tests that hold a room in exactly that
 * state; nothing in the room calls it, because the runtime does it by discarding the instance.
 */
export function forgetSessionOpeningsForTests(state: DurableObjectState): void {
  openingsByRoom.delete(state);
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
