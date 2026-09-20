import {
  admittedFrame,
  lobbyFrame,
  waitingFrame,
  welcomeFrame,
  type WaitingParticipant,
} from "@magna-carta/meeting-protocol/frames";
import type { MeetingLobbyMode } from "@magna-carta/meeting-protocol/types";
import { announceRoster, rosterEntryFor, rosterFrom } from "./room-roster.ts";
import {
  announceRoomState,
  attachmentOf,
  deleteWaiting,
  putParticipant,
  putRoom,
  putWaiting,
  readWaiting,
  refuseAndClose,
  roomStateOf,
  setRoomLobby,
  socketsFor,
  storedParticipants,
  storedWaiting,
  type MeetingSocketAttachment,
  type RoomContext,
  type StoredWaiting,
} from "./room-state.ts";

// THE DOOR, FROM THE SIGNALING SIDE: a socket that has a stay and is not yet in the room.
//
// THE STRUCTURAL GUARANTEE IS THE STORAGE PREFIX, and everything else here follows from it. A
// waiting participant is stored under `waiting:<attendanceId>` and never under `participant:`, so
// `storedParticipants()` — the one read every roster, delta, subscription check and broadcast is
// built from — cannot include them. A waiter is not omitted from the roster by a filter somebody has
// to remember; they are not in the set the roster is made of. The second half of the same guarantee
// is `broadcast`, which skips any socket that has not been welcomed: a waiting socket never is, so a
// roster frame cannot reach it even by accident.
//
// What a waiting socket receives, and nothing else: `lobby` on arrival and whenever the queue in
// front of it moves, `admitted` when a host lets it in, `refused: denied` (then a close) when a host
// turns it away, and `ended` if the meeting finishes while it waits. What it may SEND is `ping` and
// `leave`; every other frame is refused `not-admitted` with the socket kept open, decided in
// room-frames.ts before the routing client is even resolved — so a waiter's frame never costs a
// session at the routing service.

/**
 * A socket has been accepted for a stay that is WAITING: store it at the door, tell it where it
 * stands, and tell the hosts somebody has arrived.
 *
 * The twin of `admitParticipant` in room-lifecycle.ts, and superseding works the same way: one live
 * socket per stay, the newest wins. There is no media to release here, because a waiter has never
 * published anything.
 *
 * NO WELCOME. There is nothing this socket is welcome to yet, and a welcome carrying an empty roster
 * is a shape every future reader has to remember to keep empty.
 */
export async function admitToLobby(
  room: RoomContext,
  attachment: MeetingSocketAttachment,
  server: WebSocket,
): Promise<void> {
  const superseded = socketsFor(room, attachment.attendanceId, server);
  await room.ctx.blockConcurrencyWhile(async () => {
    await putRoom(room, {
      firmId: attachment.firmId,
      meetingId: attachment.meetingId,
      medium: attachment.medium,
      locked: attachment.locked ?? false,
      lobby: attachment.lobby ?? "off",
    });
    const existing = await readWaiting(room, attachment.attendanceId);
    await putWaiting(room, attachment.attendanceId, {
      userId: attachment.userId,
      displayName: attachment.displayName,
      // OFF THE RECORD, which is where the instant actually lives — the route reads it from the
      // stay the upgrade was authorized against, so the lobby route and this frame cannot show a
      // host two different waiting times for one person. Carried forward from an existing entry
      // first, so a browser reconnecting at the door keeps its place in the queue: losing a
      // connection is not giving up and going to the back of the line.
      waitingFrom:
        existing?.waitingFrom ??
        (attachment.waitingFrom !== undefined && attachment.waitingFrom !== ""
          ? attachment.waitingFrom
          : new Date().toISOString()),
      socketLostAt: null,
    });
  });

  for (const older of superseded) refuseAndClose(older, "superseded");

  const waiting = await storedWaiting(room);
  server.send(lobbyStateFrameFor(waiting, attachment.attendanceId));
  await announceLobbyToHosts(room, waiting);
}

/**
 * Where one person stands in the queue, as the frame says it.
 *
 * One-based, and carrying the size of the queue beside it so a screen can say "second of three"
 * without a second frame. Somebody the map no longer holds reads as first of none, which is the
 * shape a socket sees for the instant between a denial and its close.
 */
function lobbyStateFrameFor(
  waiting: ReadonlyMap<string, StoredWaiting>,
  attendanceId: string,
): string {
  const order = [...waiting.keys()];
  const index = order.indexOf(attendanceId);
  return lobbyFrame(index < 0 ? 0 : index + 1, waiting.size, new Date().toISOString());
}

/** The door as the hosts' own frame carries it. */
export function waitingParticipantsFrom(
  waiting: ReadonlyMap<string, StoredWaiting>,
): WaitingParticipant[] {
  return [...waiting].map(([participantId, one]) => ({
    participantId,
    userId: one.userId,
    displayName: one.displayName,
    waitingFrom: one.waitingFrom,
  }));
}

/**
 * The lobby list, to the sockets holding a grant and to nobody else.
 *
 * WHO IS AT THE DOOR IS NOT SOMETHING THE ROOM MAY SEE. It is a list of people a host has not yet
 * decided about, and in a lobby that exists because somebody might arrive who should not, telling
 * everybody inside who is outside is the leak the door was shut to prevent. So the roster is read to
 * learn who is a host — one read, one pass over the sockets — and the frame goes only to them.
 *
 * Sent whole rather than as a difference: the door is bounded at a hundred and is usually one or two
 * people, so the bookkeeping a difference costs on both ends is more than the list.
 */
export async function announceLobbyToHosts(
  room: RoomContext,
  waiting?: ReadonlyMap<string, StoredWaiting>,
): Promise<void> {
  const atTheDoor = waiting ?? (await storedWaiting(room));
  const stored = await storedParticipants(room);
  const payload = waitingFrame(waitingParticipantsFrom(atTheDoor));
  for (const socket of room.ctx.getWebSockets()) {
    const attendanceId = attachmentOf(socket)?.attendanceId;
    if (attendanceId === undefined) continue;
    if ((stored.get(attendanceId)?.hostRole ?? null) === null) continue;
    trySend(socket, payload);
  }
}

/**
 * Everybody at the door, told something. The one broadcast that deliberately reaches nobody in the
 * room — used for the end of the meeting, which is the only news a waiter shares with it.
 *
 * `broadcast` cannot serve this: it skips every socket that has not been welcomed, and a waiting
 * socket never is.
 */
export function broadcastToWaiting(room: RoomContext, payload: string): void {
  for (const socket of room.ctx.getWebSockets()) {
    if (attachmentOf(socket)?.waiting === true) trySend(socket, payload);
  }
}

/**
 * A host let these people in — called by the admissions route AFTER its own write commits, on the
 * standing `participantLeft` / `end` precedent: nobody is admitted on the wire by a write that
 * then failed.
 *
 * For each: the record moves from `waiting:` to `participant:`, their socket is sent `admitted` and
 * then `welcome`, the room learns of an ordinary roster join, and the hosts get a fresh lobby list.
 * `admitted` and `welcome` are two frames with one job each, so the client's welcome handler is the
 * same handler it has always been — and the admitted browser builds its peer connection from the
 * relay credentials its join already answered with.
 */
export async function participantsAdmitted(
  room: RoomContext,
  attendanceIds: readonly string[],
): Promise<void> {
  const admitted: string[] = [];
  for (const attendanceId of attendanceIds) {
    const moved = await room.ctx.blockConcurrencyWhile(async () => {
      const waiting = await readWaiting(room, attendanceId);
      // Already moved, or never at this door. A second admission of one stay must not reset the
      // participant record a browser is already publishing through.
      if (waiting === undefined) return false;
      await deleteWaiting(room, attendanceId);
      await putParticipant(room, attendanceId, {
        userId: waiting.userId,
        displayName: waiting.displayName,
        sfuSessionId: null,
        tracks: [],
        socketLostAt: waiting.socketLostAt,
        speaking: false,
        muted: false,
        presenceAt: null,
        presenceDirty: false,
        syncAt: null,
        layerAt: null,
        subscribedMids: [],
        // NOBODY, whoever they turn out to be. An admission says somebody may come in; the hosting
        // routes say who is running the room, and they call `hostingChanged` after their own commit
        // — which is what seats a claimer's own grant on the record this room authorizes from.
        hostRole: null,
      });
      return true;
    });
    if (moved) admitted.push(attendanceId);
  }
  if (admitted.length === 0) return;

  const at = new Date().toISOString();
  const stored = await storedParticipants(room);
  const roster = rosterFrom(stored);
  const roomState = await roomStateOf(room);
  for (const attendanceId of admitted) {
    for (const socket of socketsFor(room, attendanceId)) {
      const attachment = attachmentOf(socket);
      if (attachment === null) continue;
      trySend(socket, admittedFrame(at));
      // A HOST'S OWN LOBBY LIST IS EMPTY HERE, and correctly: somebody who has just been let in is
      // not running the meeting yet. The hosting route's `hostingChanged` is what changes that, and
      // the lobby frame that follows it is where a claimer learns who is still at the door.
      trySend(socket, welcomeFrame(attendanceId, roster, roomState, []));
      // IN THE ROOM FROM HERE, and `waiting` lowered in the same write: the attachment is what
      // room-frames.ts reads to decide whether this socket may signal at all.
      socket.serializeAttachment({ ...attachment, waiting: false, welcomed: true });
    }
  }

  // ONE BROADCAST FOR THE WHOLE BATCH rather than one per person — a host admitting twenty people
  // must not cost the room twenty roster frames to every socket in it.
  announceRoster(room, stored, {
    joined: admitted.flatMap((attendanceId) => {
      const participant = stored.get(attendanceId);
      return participant === undefined ? [] : [rosterEntryFor(attendanceId, participant)];
    }),
  });
  await tellTheDoorItMoved(room);
}

/**
 * A host turned these people away — called by the denials route after its own write commits.
 *
 * `refused: denied` and then a close, the reason first so a browser always learns why rather than
 * inferring it from a code. NOTHING IS ANNOUNCED TO THE ROOM: the people in it never knew somebody
 * was at the door.
 */
export async function participantsDenied(
  room: RoomContext,
  attendanceIds: readonly string[],
): Promise<void> {
  let removed = false;
  for (const attendanceId of attendanceIds) {
    if (await deleteWaiting(room, attendanceId)) removed = true;
    for (const socket of socketsFor(room, attendanceId)) {
      refuseAndClose(socket, "denied");
    }
  }
  if (removed) await tellTheDoorItMoved(room);
}

/**
 * Somebody gave up and closed their own socket from the door.
 *
 * The waiter's half of `leave`: there is no `participant:` record to release and no media to stop,
 * so the whole of it is dropping the key and telling the hosts. The STAY is closed by the leave
 * route, which is where every other departure is written.
 */
export async function giveUpWaiting(room: RoomContext, attendanceId: string): Promise<void> {
  if (await deleteWaiting(room, attendanceId)) await tellTheDoorItMoved(room);
}

/**
 * The door's own setting moved — called by the lobby route after its own write commits.
 *
 * TURNING THE LOBBY OFF ADMITS NOBODY. The people already at the door stay there until a host
 * decides about each of them, so this writes the setting, tells the room what is now true of it, and
 * touches no `waiting:` record at all.
 */
export async function lobbyChanged(room: RoomContext, lobby: MeetingLobbyMode): Promise<void> {
  await setRoomLobby(room, lobby);
  await announceRoomState(room);
}

/**
 * Everybody whose OWN grace has run out at the door, swept exactly as the roster's is.
 *
 * A browser closed while somebody stood at a door would otherwise leave an open stay in the firm's
 * record forever — the failure the roster's own grace sweep exists to fix, and the door inherits it
 * because a waiter's stay is a stay. The record is closed by the caller (room-lifecycle.ts owns the
 * write, because it owns the firm-database seam); this drops the key and answers who went.
 */
export async function sweepWaitingPastTheirGrace(
  room: RoomContext,
  past: readonly string[],
): Promise<void> {
  for (const attendanceId of past) await deleteWaiting(room, attendanceId);
  if (past.length > 0) await tellTheDoorItMoved(room);
}

/**
 * The door changed: everybody still at it learns where they now stand, and the hosts get the list.
 *
 * Both frames are re-sent whole. A queue of at most a hundred, one frame each, is far cheaper than
 * the bookkeeping either side would need to apply a difference — and a position is a number that is
 * wrong the moment somebody in front of it leaves, so it has to be restated anyway.
 */
async function tellTheDoorItMoved(room: RoomContext): Promise<void> {
  const waiting = await storedWaiting(room);
  for (const socket of room.ctx.getWebSockets()) {
    const attachment = attachmentOf(socket);
    if (attachment?.waiting !== true) continue;
    if (!waiting.has(attachment.attendanceId)) continue;
    trySend(socket, lobbyStateFrameFor(waiting, attachment.attendanceId));
  }
  await announceLobbyToHosts(room, waiting);
}

// A socket that went away between the walk and the send is one whose close handler is already
// running; the door and the record are that path's to fix, not this one's.
function trySend(socket: WebSocket, payload: string): void {
  try {
    socket.send(payload);
  } catch {
    // Deliberately empty — see above.
  }
}
