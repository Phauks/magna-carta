import {
  refusedFrame,
  UNSERVICEABLE_CLOSE_CODE,
  type MeetingRefusalReason,
} from "@magna-carta/meeting-protocol/frames";
import type { MeetingMedium } from "@magna-carta/meetings/types";
import type { Bindings } from "../../app.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "../sfu/realtime-failure.ts";

// WHAT ONE MEETING'S ROOM HOLDS BETWEEN FRAMES, and the two places it can be held.
//
// The room hibernates: the runtime owns every socket's server end, so the object is evicted while
// people sit in the meeting and re-constructed when the next frame arrives. Class properties do not
// survive that, so nothing about a participant may live on the instance. There are exactly two
// places a fact can go instead, and this module owns both:
//
//   * the object's own STORAGE — the roster, the room's identity, the ended marker; read back by
//     every module that needs it, never cached on the instance;
//   * the per-socket ATTACHMENT — who this socket is — which the runtime serializes with the socket
//     and hands back on the far side of an eviction.
//
// Everything else in room/ is written over these two, which is why each of those modules takes a
// `RoomContext` rather than reaching for anything of its own.

const PARTICIPANT_PREFIX = "participant:";

// The instant the meeting closed, and the ONE thing this object keeps after it. It is what lets a
// frame arriving on a socket that had not yet noticed be answered with the truth — the meeting is
// over — rather than with "the room does not know who you are", which is what a bare missing roster
// entry would otherwise say and would send a browser reconnecting forever.
const ENDED_KEY = "ended";

// Which meeting this room is, in the firm's own record. The attachment carries both on every socket,
// but the grace sweep runs from an alarm with no socket and no request, and a sweep that could not
// name the firm could not close anybody's stay.
const ROOM_KEY = "room";

/**
 * What a room module is given: the Durable Object's own context and the deployment's environment,
 * and nothing else.
 *
 * Passed explicitly rather than reached for, which is what makes each module testable without the
 * runtime — and what keeps the orchestrating class free of behaviour it would otherwise accumulate
 * one slice at a time.
 */
export interface RoomContext {
  readonly ctx: DurableObjectState;
  readonly env: Bindings;
}

/**
 * One track this participant is publishing, as the room holds it.
 *
 * `mid` is the media section the routing service put it in, and it is kept because it is the ONLY
 * handle that service accepts for closing a track. A roster that recorded names alone left the room
 * unable to stop anything it had started: a participant who vanished kept being forwarded, billed,
 * and offered to everybody else, with the record of their leaving already written. Null only for an
 * answer that named the track and not the section, which is a shape the service should not produce
 * and which this must not throw over.
 */
export interface StoredTrack {
  readonly trackName: string;
  readonly kind: string;
  readonly mid: string | null;
}

/** One connected participant, as the room holds them between frames. */
export interface StoredParticipant {
  readonly userId: string;
  readonly displayName: string;
  // The routing-service session this browser publishes through. Null until its first publish: a
  // session costs nothing to have and something to make, and somebody who joined to listen may never
  // make one.
  readonly sfuSessionId: string | null;
  readonly tracks: readonly StoredTrack[];
  // When this participant's last socket went away, or null while one is open. THE GRACE PERIOD IS
  // MEASURED FROM HERE, per person, which is the only place it can be measured from: a deadline kept
  // for the room is one person's grace spent on everybody.
  readonly socketLostAt: string | null;
  // The two facts every other browser draws on this person's tile, measured by their own browser
  // and relayed by the room. Kept here rather than derived from anything the room can see: once a
  // browser stops pulling three hundred audio tracks, nothing but that browser knows whether its
  // own microphone is carrying a voice.
  readonly speaking: boolean;
  readonly muted: boolean;
  // When the room last RELAYED this participant's presence — not when it last changed. It is half
  // the throttle's state: a transition arriving inside the window updates the two booleans above and
  // leaves this alone, so the next one out of the window is relayed immediately.
  readonly presenceAt: string | null;
  // THE OTHER HALF, and the reason a held-back transition is not a lost one. A frame suppressed by
  // the window leaves the booleans above current and this flag raised; the room's alarm, armed for
  // the end of that window, relays what is stored and lowers it. Without it the LAST transition of a
  // burst was dropped outright — a one-word answer left somebody speaking on every other screen
  // until they spoke again, and a quick mute-unmute left them muted for the rest of the meeting.
  readonly presenceDirty: boolean;
  // When this participant's last whole-roster request was answered, and their last layer change
  // forwarded. Both are throttles on frames that cost the ROOM rather than the sender: a sync is a
  // list of every key the room holds, and a layer change is a call to the routing service. A browser
  // can send either as fast as it can write to a socket, so what bounds them is here.
  readonly syncAt: string | null;
  readonly layerAt: string | null;
  // The media sections the room subscribed on THIS participant's behalf, which is the whole of what
  // they may later ask to change the layer of. A section number is the routing service's handle for
  // a track inside one session, so a browser naming a section the room never subscribed for it is
  // naming a part of its own session it does not own — and the service, which has no notion of a
  // meeting, would honour the change.
  readonly subscribedMids: readonly string[];
}

/** Which meeting, in which firm, this room is the signaling side of. */
export interface StoredRoom {
  readonly firmId: string;
  readonly meetingId: string;
  // What kind of gathering this is. Kept here rather than read off each socket, so the answer is the
  // room's and not one browser's — and so the alarm, which has no socket, could read it too.
  readonly medium: MeetingMedium;
}

/** The subscription context, established at upgrade and carried for the life of the socket. */
export interface MeetingSocketAttachment {
  readonly protocolVersion: number;
  readonly firmId: string;
  readonly meetingId: string;
  readonly userId: string;
  readonly attendanceId: string;
  readonly displayName: string;
  // Sound alone, or sound and pictures — read off the meeting row by the route, like every other
  // value here, so the room never has to ask the database what kind of gathering it is.
  readonly medium: MeetingMedium;
  // Whether this socket has been given its welcome. A socket is ACCEPTED before it is admitted —
  // the runtime has to own it before the roster can be written — and in that window it is already
  // in `getWebSockets()`, so a broadcast raised by somebody else's arrival reached a browser that
  // had not yet been told who is in the room. It read a roster difference against nothing, decided
  // it had missed something, and asked for the whole list; three hundred people joining at the top
  // of the hour made that a storm the room answered one list of three hundred keys at a time.
  // Raised by `admitParticipant` the moment the welcome is on the wire.
  readonly welcomed?: boolean;
}

// ---------------------------------------------------------------------------------------------
// The roster, in storage
// ---------------------------------------------------------------------------------------------

export async function readParticipant(
  room: RoomContext,
  attendanceId: string,
): Promise<StoredParticipant | undefined> {
  return await room.ctx.storage.get<StoredParticipant>(`${PARTICIPANT_PREFIX}${attendanceId}`);
}

export async function putParticipant(
  room: RoomContext,
  attendanceId: string,
  participant: StoredParticipant,
): Promise<void> {
  await room.ctx.storage.put(`${PARTICIPANT_PREFIX}${attendanceId}`, participant);
}

/** Removes one roster entry, answering whether there was one to remove. */
export async function deleteParticipant(room: RoomContext, attendanceId: string): Promise<boolean> {
  return await room.ctx.storage.delete(`${PARTICIPANT_PREFIX}${attendanceId}`);
}

/**
 * Every roster entry, keyed by the stay it belongs to.
 *
 * THE ONE EXPENSIVE READ IN THE ROOM, and the reason every caller is written to take the result
 * rather than to call this again: in a room of three hundred it is three hundred keys, and a
 * frame that read it twice would double the cost of the thing the room does most.
 */
export async function storedParticipants(
  room: RoomContext,
): Promise<Map<string, StoredParticipant>> {
  const stored = await room.ctx.storage.list<StoredParticipant>({ prefix: PARTICIPANT_PREFIX });
  return new Map(
    [...stored].map(([key, participant]) => [key.slice(PARTICIPANT_PREFIX.length), participant]),
  );
}

/** Drops every roster entry at once — the one act that is about the room rather than a person. */
export async function deleteEveryKey(room: RoomContext): Promise<void> {
  await room.ctx.storage.deleteAll();
}

export async function readRoom(room: RoomContext): Promise<StoredRoom | undefined> {
  return await room.ctx.storage.get<StoredRoom>(ROOM_KEY);
}

export async function putRoom(room: RoomContext, stored: StoredRoom): Promise<void> {
  await room.ctx.storage.put<StoredRoom>(ROOM_KEY, stored);
}

export async function readEndedAt(room: RoomContext): Promise<string | undefined> {
  return await room.ctx.storage.get<string>(ENDED_KEY);
}

export async function putEndedAt(room: RoomContext, endedAt: string): Promise<void> {
  await room.ctx.storage.put(ENDED_KEY, endedAt);
}

export async function deleteEndedMarker(room: RoomContext): Promise<void> {
  await room.ctx.storage.delete(ENDED_KEY);
}

// ---------------------------------------------------------------------------------------------
// The sockets, which are the other half of what the room holds
//
// A hibernating socket carries its own context, so reading an attachment is a read of room state in
// exactly the sense the storage reads above are — it is the fact that survived the eviction. Nothing
// here keeps a socket on the instance either.
// ---------------------------------------------------------------------------------------------

export function attachmentOf(socket: WebSocket): MeetingSocketAttachment | null {
  const attachment = socket.deserializeAttachment() as MeetingSocketAttachment | null;
  if (attachment === null || attachment === undefined) return null;
  return typeof attachment.attendanceId === "string" &&
    attachment.attendanceId !== "" &&
    typeof attachment.meetingId === "string" &&
    attachment.meetingId !== ""
    ? attachment
    : null;
}

/** Every socket carrying this stay, other than the one that is asking. */
export function socketsFor(
  room: RoomContext,
  attendanceId: string,
  except?: WebSocket,
): WebSocket[] {
  const found: WebSocket[] = [];
  for (const socket of room.ctx.getWebSockets()) {
    if (socket === except) continue;
    if (attachmentOf(socket)?.attendanceId === attendanceId) found.push(socket);
  }
  return found;
}

/** True when some OTHER socket is still carrying this stay. */
export function socketExistsFor(
  room: RoomContext,
  attendanceId: string,
  except?: WebSocket,
): boolean {
  return socketsFor(room, attendanceId, except).length > 0;
}

/**
 * Every stay with a socket open, resolved in ONE pass over the sockets.
 *
 * Reading an attachment deserializes it, so asking "is this person connected" once per participant
 * costs the room a deserialization per participant per socket — ninety thousand of them in a room of
 * three hundred, on a call the alarm makes every time anybody's connection drops. Every caller that
 * needs the answer about more than one person takes this set instead.
 */
export function connectedAttendanceIds(room: RoomContext): Set<string> {
  const connected = new Set<string>();
  for (const socket of room.ctx.getWebSockets()) {
    const attendanceId = attachmentOf(socket)?.attendanceId;
    if (attendanceId !== undefined) connected.add(attendanceId);
  }
  return connected;
}

export function broadcast(room: RoomContext, payload: string, except?: WebSocket): void {
  sendToRoom(room, payload, (socket) => socket === except);
}

/**
 * The same, to everybody except the stay it is ABOUT — for a frame the room sends on somebody's
 * behalf rather than in answer to a socket, where there is no one socket to leave out.
 */
export function broadcastExcludingStay(
  room: RoomContext,
  payload: string,
  attendanceId: string,
): void {
  sendToRoom(room, payload, (socket) => attachmentOf(socket)?.attendanceId === attendanceId);
}

function sendToRoom(
  room: RoomContext,
  payload: string,
  skip: (socket: WebSocket) => boolean,
): void {
  for (const socket of room.ctx.getWebSockets()) {
    if (skip(socket)) continue;
    // A SOCKET THAT HAS NOT BEEN WELCOMED IS NOT YET IN THE ROOM, and sending to it is worse than
    // sending nothing: a difference applied against a roster the browser does not have is a gap it
    // can only resolve by asking for the whole list. Its own welcome carries everything this frame
    // would have said, and it is already being built.
    if (attachmentOf(socket)?.welcomed !== true) continue;
    try {
      socket.send(payload);
    } catch {
      // A socket that went away between the list and the send is exactly the case a roster
      // broadcast exists to announce, so failing the whole broadcast over it would stop everybody
      // else learning. The close handler removes it from the roster on its own.
    }
  }
}

export function refuseAndClose(socket: WebSocket, reason: MeetingRefusalReason): void {
  // The reason goes out BEFORE the close, so a browser always learns why rather than inferring it
  // from a code. The code is from the private-use range, the only range an application may define.
  socket.send(refusedFrame(reason));
  socket.close(UNSERVICEABLE_CLOSE_CODE, "reconnect required");
}

/**
 * One failure, through the standard pipeline, answering with the handle a member is shown.
 *
 * The logger is built per call because class properties do not survive hibernation, and an
 * Analytics Engine logger costs nothing to construct.
 */
export function recordRoomFailure(room: RoomContext, operation: string, caught: unknown): string {
  return recordRealtimeFailure(realtimeLoggerFor(room.env), `meetings.room.${operation}`, caught);
}
