import {
  NORMAL_CLOSE_CODE,
  parseMeetingClientFrame,
  PONG_FRAME,
  refusedFrame,
  rosterFrame,
  TRACK_NAME_SEPARATOR,
  type MeetingClientFrame,
  type MeetingRefusalReason,
} from "@magna-carta/meeting-protocol/frames";
import { sfuClientForEnv, SfuUnavailableError, type SfuClient } from "../sfu/sfu-client.ts";
import {
  changeLayers,
  closePublishedTracks,
  publishTracks,
  releaseParticipant,
  renegotiateSession,
  sessionFor,
  subscribeTracks,
} from "./room-media.ts";
import { relayPresence } from "./room-presence.ts";
import { namesOnlyRosterTracks, rosterFrom } from "./room-roster.ts";
import {
  attachmentOf,
  readEndedAt,
  readParticipant,
  readRoom,
  recordRoomFailure,
  refuseAndClose,
  storedParticipants,
  type MeetingSocketAttachment,
  type RoomContext,
  type StoredParticipant,
} from "./room-state.ts";

// EVERY FRAME A BROWSER SENDS ARRIVES HERE, and this module decides only three things about it: what
// it is, whether the room will act on it, and which module acts. Nothing here talks to the routing
// service or to storage except to answer those three questions.
//
// The order is deliberate and is the room's whole defence. Parse, then identify the socket, then the
// two frames the roster can answer alone, then the refusals the roster can decide, and only then a
// routing-service session. A frame the room will not act on must not cost a session at the service
// and — for a subscription or a layer change — must not be forwarded even once: the service would
// honour it, because it has no idea which meeting a session belongs to.

// THE MOST TRACKS ONE PARTICIPANT MAY OFFER. A camera, a microphone and a screen share is three; the
// headroom is for a second camera and for a browser that renegotiates without retiring what it
// replaced. What the ceiling actually stops is a browser — or something wearing one's credentials —
// opening tracks in a loop: every one of them is a forwarding cost billed to this account and a
// subscription every other participant in the room is invited to make.
const MAX_TRACKS_PER_PARTICIPANT = 8;

/** The frames that reach the routing service, which is every one the room does not answer itself. */
type SignalingFrame = Exclude<
  MeetingClientFrame,
  { type: "ping" } | { type: "leave" } | { type: "sync" } | { type: "presence" }
>;

// The track kinds that carry a picture, which is what a call does not have. A camera and a screen
// share are both video to the routing service and are named apart here only because a browser names
// them apart; anything that is not sound is treated as a picture, so a kind nobody has thought of
// yet is refused from a call rather than admitted into one.
function isPicture(kind: string): boolean {
  return kind !== "audio";
}

/** One frame off one socket, from the bytes to whichever module owns what it asks for. */
export async function dispatchClientFrame(
  room: RoomContext,
  socket: WebSocket,
  message: string | ArrayBuffer,
): Promise<void> {
  const parsed = parseMeetingClientFrame(message);
  if ("refusal" in parsed) {
    // The socket STAYS OPEN. A frame this room could not read is a bug in one message, not a
    // reason to drop somebody out of a meeting they are otherwise in — and a browser that
    // reconnects has to renegotiate every track from nothing.
    socket.send(refusedFrame(parsed.refusal));
    return;
  }

  // A ping reaching here means the browser did not send the byte-exact auto-response frame. Answer
  // it anyway: the contract is the frame, not the optimization.
  if (parsed.frame.type === "ping") {
    socket.send(PONG_FRAME);
    return;
  }

  const attachment = attachmentOf(socket);
  if (attachment === null) {
    // The room cannot say who this is, so it cannot route anything on their behalf. Unlike a bad
    // frame this does not improve by trying again on the same socket.
    refuseAndClose(socket, "not-a-participant");
    return;
  }

  if (parsed.frame.type === "leave") {
    await releaseParticipant(room, attachment.attendanceId);
    socket.close(NORMAL_CLOSE_CODE, "left the meeting");
    return;
  }

  // THE TWO FRAMES THAT ASK NOTHING OF THE ROUTING SERVICE, answered before it is even resolved.
  // A browser that has lost track of who is in the room, and a browser saying whether its own
  // microphone is carrying a voice, are both about the roster alone — and both must go on working
  // in a deployment whose media credentials went away under an open meeting.
  if (parsed.frame.type === "sync") {
    // ONE SOCKET, and the whole list. This is the way back to the truth for a client that has been
    // applying differences: without it, a browser that suspects a gap could only reconnect, which
    // costs it every track it holds.
    socket.send(rosterFrame(rosterFrom(await storedParticipants(room))));
    return;
  }

  if (parsed.frame.type === "presence") {
    await relayPresence(
      room,
      socket,
      attachment.attendanceId,
      parsed.frame.speaking,
      parsed.frame.muted,
    );
    return;
  }

  const sfu = sfuClientForEnv(room.env);
  if (sfu === null) {
    // The upgrade route refuses before a socket exists when meetings are unconfigured, so this is
    // reachable only if the credentials went away under an open meeting. Said plainly rather than
    // left to a timeout inside the browser's connection. No Error ID: nothing failed, the
    // deployment simply cannot route media, and a handle would send somebody looking for a trace
    // that does not exist.
    socket.send(refusedFrame("sfu-unavailable"));
    return;
  }

  try {
    await handleSignalingFrame(room, socket, attachment, parsed.frame, sfu);
  } catch (caught) {
    if (caught instanceof SfuUnavailableError) {
      // Carries no word of what the routing service said: that text can name the application the
      // whole fleet's meetings run on. What it does carry is the handle that joins what this
      // member saw to the redacted trace of what actually happened.
      socket.send(refusedFrame("sfu-unavailable", recordRoomFailure(room, "signaling", caught)));
      return;
    }
    throw caught;
  }
}

async function handleSignalingFrame(
  room: RoomContext,
  socket: WebSocket,
  attachment: MeetingSocketAttachment,
  frame: SignalingFrame,
  sfu: SfuClient,
): Promise<void> {
  // EVERYTHING THE ROSTER CAN DECIDE IS DECIDED FIRST, before a routing session exists.
  //
  // THE ROSTER IS READ AT MOST ONCE PER FRAME, and only by the two frames that name somebody
  // else's tracks. In a room of three hundred that read is three hundred keys, so a second one for
  // the same frame doubles the cost of the busiest thing the room does.
  const namesOthersTracks = frame.type === "subscribe" || frame.type === "layer";
  const stored = namesOthersTracks ? await storedParticipants(room) : null;
  const refusal = await refuseFrame(room, attachment.attendanceId, frame, stored);
  if (refusal !== null) {
    socket.send(refusedFrame(refusal));
    return;
  }

  // Every signaling frame acts on this participant's routing-service session, so it is resolved
  // once here — and its absence is one answer rather than four.
  const outcome = await sessionFor(room, attachment.attendanceId, sfu);
  if (outcome.kind === "unavailable") {
    socket.send(
      refusedFrame("sfu-unavailable", recordRoomFailure(room, "create-session", outcome.caught)),
    );
    return;
  }
  if (outcome.kind === "absent") {
    // No roster entry, and the two ways that happens lead somewhere different: the meeting ended
    // under this socket, or this participant's stay was closed. A browser retries the second and
    // must not retry the first.
    const endedAt = await readEndedAt(room);
    refuseAndClose(socket, endedAt === undefined ? "not-a-participant" : "meeting-ended");
    return;
  }
  const sessionId = outcome.sessionId;

  if (frame.type === "publish") {
    await publishTracks(room, socket, attachment.attendanceId, sessionId, frame, sfu);
    return;
  }
  if (frame.type === "layer") {
    await changeLayers(socket, sessionId, frame, sfu);
    return;
  }
  if (frame.type === "subscribe") {
    await subscribeTracks(socket, sessionId, frame, sfu);
    return;
  }
  if (frame.type === "renegotiate") {
    await renegotiateSession(socket, sessionId, frame.sessionDescription, sfu);
    return;
  }
  if (frame.type === "close") {
    await closePublishedTracks(room, socket, attachment.attendanceId, sessionId, frame.mids, sfu);
  }
}

/**
 * Why this room will not act on this frame, or null.
 *
 * Everything here is answerable from the roster alone, which is what lets it run before a routing
 * session exists.
 */
async function refuseFrame(
  room: RoomContext,
  attendanceId: string,
  frame: SignalingFrame,
  stored: ReadonlyMap<string, StoredParticipant> | null,
): Promise<MeetingRefusalReason | null> {
  if (frame.type === "publish") {
    // A CALL IS SOUND, AND THE ROOM IS WHERE THAT HOLDS. The medium is chosen when the meeting is
    // started and never changed, so the people who joined a call agreed to sound — a modified
    // client publishing a camera into one would turn it into a video meeting for all of them, on
    // one person's decision. Read off the room rather than the frame's own socket, so a socket
    // that arrived with the wrong label cannot widen it.
    const stayedRoom = await readRoom(room);
    if (stayedRoom?.medium === "audio" && frame.tracks.some((track) => isPicture(track.kind))) {
      return "track-kind-refused";
    }
    // A TRACK NAME CARRIES ITS PUBLISHER, and every browser in the room resolves a tile from it.
    // A name prefixed with somebody else's handle would put this participant's camera under that
    // member's face on every screen — an impersonation that needs no credential at all, only a
    // string.
    const ownPrefix = `${attendanceId}${TRACK_NAME_SEPARATOR}`;
    if (frame.tracks.some((track) => !track.trackName.startsWith(ownPrefix))) {
      return "foreign-track-name";
    }
    const participant = await readParticipant(room, attendanceId);
    // Counted over the UNION with what is already held, because republishing a track under the
    // same name replaces it rather than adding one — a camera switched off and on must not spend
    // a seat.
    const names = new Set(participant?.tracks.map((track) => track.trackName) ?? []);
    for (const track of frame.tracks) names.add(track.trackName);
    return names.size > MAX_TRACKS_PER_PARTICIPANT ? "track-limit-reached" : null;
  }

  // A subscription and a layer change both name somebody ELSE's track, so both answer to the
  // roster and both answer to it the same way — one check, so the two can never drift into
  // disagreeing about what may be asked for.
  if (frame.type !== "subscribe" && frame.type !== "layer") return null;
  if (stored === null) return "unknown-track";
  return namesOnlyRosterTracks(attendanceId, stored, frame.tracks) ? null : "unknown-track";
}
