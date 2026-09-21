import {
  closedFrame,
  mutedFrame,
  unmuteRequestedFrame,
} from "@magna-carta/meeting-protocol/frames";
import type { MeetingHostRole } from "@magna-carta/meeting-protocol/types";
import { sfuClientForEnv, SfuUnavailableError, type SfuClient } from "../sfu/sfu-client.ts";
import { recordLocked, recordMuted, recordRemoved, refuseAndRecord } from "./room-diagnostics.ts";
import { announceLobbyToNewHosts } from "./room-lobby.ts";
import { forgetTracks, releaseParticipant } from "./room-media.ts";
import { announceRoster, rosterEntryFor } from "./room-roster.ts";
import {
  announceRoomState,
  clearSpotlightFor,
  putParticipant,
  putSpotlight,
  readParticipant,
  recordRoomFailure,
  refuseAndClose,
  setRoomLocked,
  socketsFor,
  storedParticipants,
  trySend,
  type RoomContext,
  type StoredParticipant,
} from "./room-state.ts";

// RUNNING THE ROOM FROM INSIDE IT — the four acts a host performs as a frame rather than as a
// request, and the three the hosting routes call back into the room to finish.
//
// The split between a frame and a route is not about where the code is easiest to put. An act is a
// ROUTE with an audit row when somebody could later ask who did it: a member put out of a meeting on
// a matter's record, a door somebody shut, a room that changed hands. An act is a FRAME when it is
// about this moment and leaves nothing behind — a mute is undone by the member a second later, a
// spotlight dies with the room, a request to unmute is a tap on the shoulder. An audit row for each
// of those would fill a matter's log with the mechanics of a conversation, which is the one thing
// this subsystem has been careful not to record, and it would put a round trip and the idempotency
// gate between a host pressing Mute and the microphone going quiet.
//
// THE AUTHORITY COMES FROM THE STORED PARTICIPANT RECORD, NEVER FROM THE SOCKET'S ATTACHMENT. The
// attachment is frozen at upgrade, which is right for the firm, the meeting and the medium and wrong
// for hosting: a co-host whose grant was withdrawn ten minutes ago would go on muting people for as
// long as their socket stayed open. The routes rewrite the stored records after they commit, so the
// next frame off that socket is decided on what is true now.

// HOW MANY OF THE ROOM'S MICROPHONES ARE CLOSED AT ONCE.
//
// Mute-everyone is one frame and up to three hundred calls to the routing service. Making them
// serially inside a frame handler is exactly the hot-path work golden rule 10 forbids — the room
// would sit in one handler for the length of three hundred round trips while every other
// participant's frames queued behind it — and making them all at once would open three hundred
// sockets to the service in one instant. Eight is a lane wide enough that the room is quiet in about
// the time a host expects and narrow enough that nothing upstream sees a burst.
export const MUTE_ALL_CONCURRENCY = 8;

/** The four frames a host may send, as the dispatch hands them over. */
export type MeetingHostFrame =
  | { readonly type: "mute"; readonly participantId: string }
  | { readonly type: "mute-all" }
  | { readonly type: "ask-to-unmute"; readonly participantId: string }
  | { readonly type: "spotlight"; readonly participantId: string | null };

/**
 * One host frame, from the authority question to the act.
 *
 * The roster is read ONCE here and handed to whichever act needs it, on the module's standing rule:
 * in a room of three hundred that read is three hundred keys, and a second one for the same frame
 * doubles the cost of the busiest thing the room does.
 */
export async function handleHostFrame(
  room: RoomContext,
  socket: WebSocket,
  attendanceId: string,
  frame: MeetingHostFrame,
): Promise<void> {
  const stored = await storedParticipants(room);
  const caller = stored.get(attendanceId);
  if (hostRoleOf(caller) === null) {
    // THE SOCKET STAYS OPEN. The member is in the meeting and everything else they can do still
    // works; what they cannot do is run it. Closing here would drop somebody out of a meeting over
    // a menu item they should not have been shown.
    //
    // It is also the one refusal here worth reading after the fact: a host frame from a socket
    // holding no grant is either a menu that should not have been drawn or somebody trying the
    // directive by hand, and the record is where those two become distinguishable.
    await refuseAndRecord(room, socket, undefined, attendanceId, "not-host", frame.type);
    return;
  }

  if (frame.type === "spotlight") {
    await setSpotlight(room, attendanceId, frame.participantId, stored);
    return;
  }

  if (frame.type === "ask-to-unmute") {
    // NOTHING ELSE HAPPENS, and the absence is the whole design. A platform that could open a
    // member's microphone from another member's click is a listening device in a law firm: the
    // member may be in a room with a client, on a call they muted themselves for precisely so that
    // the next two minutes were not in the meeting. Their screen offers Unmute and Stay muted, and
    // the host sees no acknowledgement because there is nothing to acknowledge — they asked.
    if (!stored.has(frame.participantId)) {
      await refuseAndRecord(room, socket, undefined, attendanceId, "unknown-track", frame.type);
      return;
    }
    sendToStay(
      room,
      frame.participantId,
      unmuteRequestedFrame(attendanceId, new Date().toISOString()),
    );
    return;
  }

  const sfu = sfuClientForEnv(room.env);
  if (sfu === null) {
    // A mute is the one host act that reaches the routing service, and it cannot be honoured by
    // asking the browser nicely — see `closeAudio` below. Said plainly rather than left looking
    // like it worked. No Error ID: nothing failed, the deployment simply cannot route media.
    await refuseAndRecord(room, socket, undefined, attendanceId, "sfu-unavailable", frame.type);
    return;
  }

  if (frame.type === "mute") {
    const target = stored.get(frame.participantId);
    if (target === undefined) {
      await refuseAndRecord(room, socket, undefined, attendanceId, "unknown-track", frame.type);
      return;
    }
    await closeAudio(room, attendanceId, frame.participantId, target, sfu, true);
    await recordMuted(room, undefined, {
      attendanceId: frame.participantId,
      byAttendanceId: attendanceId,
      scope: "one",
      mutedCount: 1,
    });
    return;
  }

  await muteEveryoneElse(room, attendanceId, stored, sfu);
}

/**
 * ONE MICROPHONE CLOSED, and a mute is two halves because the room cannot silence a microphone: the
 * media never crosses it.
 *
 * The room closes that participant's audio track at the routing service, which stops the sound
 * reaching anybody whatever their browser does, and sends them `muted` so their screen says what
 * happened and by whom. Un-muting afterwards is the member's own act and REPUBLISHES the microphone
 * rather than flipping a local flag, because the track is genuinely gone — which is more client work
 * than a flag and is the point: a mute that only asks the browser nicely is not a mute.
 *
 * The track leaves the roster the way any stopped track does, so nobody re-subscribes to silence.
 * `announce` is what lets mute-everyone spend ONE roster broadcast rather than one per person.
 */
async function closeAudio(
  room: RoomContext,
  byAttendanceId: string,
  attendanceId: string,
  target: StoredParticipant,
  sfu: SfuClient,
  announce: boolean,
): Promise<void> {
  const at = new Date().toISOString();
  const mids = target.tracks.flatMap((track) =>
    track.kind === "audio" && track.mid !== null ? [{ mid: track.mid }] : [],
  );

  // The flag every other tile draws, moved by the room rather than relayed from the muted browser:
  // that browser is about to discover its track is gone, and the room already knows. Written before
  // the roster is announced so one broadcast carries both facts.
  await markMuted(room, attendanceId);

  if (target.sfuSessionId !== null && mids.length > 0) {
    try {
      const closed = await sfu.closeTracks(target.sfuSessionId, {
        tracks: mids,
        // The browser is still there and would ordinarily answer a renegotiation — but a mute that
        // waited on the muted party's cooperation would be a mute they could decline by not
        // answering, which is the one thing this must not be.
        force: true,
      });
      await forgetTracks(room, attendanceId, new Set(mids.map((track) => track.mid)), announce);
      // The service's own description, handed to the target as the ordinary `closed` frame their
      // client already applies to a track it stopped itself. Nothing new for a browser to learn.
      sendToStay(room, attendanceId, closedFrame(closed.sessionDescription));
    } catch (caught) {
      if (!(caught instanceof SfuUnavailableError)) throw caught;
      // Recorded and carried on with. The member is still told they were muted and their own
      // browser stops sending, which is most of the effect; a failure swallowed here would leave a
      // host believing a line is quiet when it is not, so it goes on the record with an Error ID.
      recordRoomFailure(room, "mute", caught);
      if (announce) await announceOne(room, attendanceId);
    }
  } else if (announce) {
    // Nothing to close upstream — somebody who joined to listen, or who is muted already. The room
    // still has to say so, because the flag moved.
    await announceOne(room, attendanceId);
  }

  sendToStay(room, attendanceId, mutedFrame(byAttendanceId, at));
}

/**
 * The same over everybody who is neither the caller nor a host or co-host.
 *
 * HOSTS ARE LEFT ALONE. A host muting the room is clearing the floor in order to speak, and a
 * control that silences the person pressing it is a control that does not work; co-hosts are left
 * alone because they are running the meeting with the host.
 *
 * Bounded concurrency, a failure on one microphone that does not stop the rest, and ONE roster
 * broadcast at the end rather than one per person — three hundred roster frames to three hundred
 * sockets is the shape this room exists to avoid.
 */
async function muteEveryoneElse(
  room: RoomContext,
  byAttendanceId: string,
  stored: ReadonlyMap<string, StoredParticipant>,
  sfu: SfuClient,
): Promise<void> {
  const queue = [...stored].filter(
    ([attendanceId, participant]) =>
      attendanceId !== byAttendanceId && hostRoleOf(participant) === null && !participant.muted,
  );
  if (queue.length === 0) return;

  const pending = [...queue];
  await Promise.all(
    Array.from({ length: Math.min(MUTE_ALL_CONCURRENCY, pending.length) }, async () => {
      for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
        const [attendanceId, participant] = next;
        try {
          await closeAudio(room, byAttendanceId, attendanceId, participant, sfu, false);
        } catch (caught) {
          recordRoomFailure(room, "mute-all", caught);
        }
      }
    }),
  );

  // Read once, after the whole pass, so the entries the room announces are the ones it ended with.
  const after = await storedParticipants(room);
  announceRoster(room, after, {
    updated: queue.flatMap(([attendanceId]) => {
      const participant = after.get(attendanceId);
      return participant === undefined ? [] : [rosterEntryFor(attendanceId, participant)];
    }),
  });
  // ONE EVENT FOR THE ACT, carrying its count — the same arrangement as the one broadcast above,
  // and for the same reason: a host clearing the floor in a room of three hundred did one thing.
  // `attendanceId` is null because this is not about a person; the count is what it is about.
  await recordMuted(room, undefined, {
    attendanceId: null,
    byAttendanceId,
    scope: "everyone",
    mutedCount: queue.length,
  });
}

/**
 * The spotlight, set or cleared — the one room-level fact a participant can change.
 *
 * It ranks FIRST in every browser's subscription order, above pins, which is the whole difference
 * between a spotlight and a pin and the reason it is a room fact rather than a per-browser one: a
 * pin is one member arranging their own screen and says nothing to anybody.
 */
async function setSpotlight(
  room: RoomContext,
  byAttendanceId: string,
  participantId: string | null,
  stored: ReadonlyMap<string, StoredParticipant>,
): Promise<void> {
  if (participantId !== null && !stored.has(participantId)) {
    // Spotlighting somebody who is not in the room would put every browser in the meeting onto a
    // tile that does not exist, and ask the routing service for its full layer.
    return;
  }
  await putSpotlight(
    room,
    participantId === null
      ? null
      : { participantId, by: byAttendanceId, at: new Date().toISOString() },
  );
  await announceRoomState(room);
}

// ---------------------------------------------------------------------------------------------
// What the routes call back into, AFTER their own write commits
//
// The `participantLeft` / `end` precedent, and in that order for the same reason: nobody is told the
// room changed by a write that then failed.
// ---------------------------------------------------------------------------------------------

/**
 * A member a host removed: the media stops, the roster loses them, and their socket is refused
 * fatally and closed.
 *
 * THE REASON GOES OUT BEFORE THE CLOSE, always, so the browser learns why rather than inferring it
 * from a code — and `removed` is in the client's fatal set, so it offers no Rejoin. The join path
 * would refuse one anyway, for as long as this meeting runs.
 */
export async function participantRemoved(room: RoomContext, attendanceId: string): Promise<void> {
  await releaseParticipant(room, attendanceId);
  await clearSpotlightFor(room, [attendanceId]);
  for (const socket of socketsFor(room, attendanceId)) {
    refuseAndClose(socket, "removed");
  }
  // WHO did it is the hosting route's audit row, on the firm's own record, because a member put out
  // of a meeting is something somebody could later ask about. What this adds is that the room
  // carried it out, which is the half the audit row cannot say.
  await recordRemoved(room, undefined, attendanceId);
}

/**
 * The grants changed — rewrite the roles on the stored participants and tell the room.
 *
 * This is the other half of the stored-record rule: the record the room authorizes from has to be
 * rewritten by the act that changed it, or a withdrawn co-host goes on muting people until their
 * socket happens to close. One roster read, a write only for each participant whose role actually
 * moved, and one broadcast — a room of three hundred where one person was made a co-host must not
 * cost three hundred writes.
 */
export async function hostingChanged(
  room: RoomContext,
  grants: readonly { readonly userId: string; readonly role: MeetingHostRole }[],
): Promise<void> {
  const roleByUser = new Map(grants.map((grant) => [grant.userId, grant.role]));
  const stored = await storedParticipants(room);
  const moved: string[] = [];
  const newlyGranted: string[] = [];
  for (const [attendanceId, participant] of stored) {
    const role = roleByUser.get(participant.userId) ?? null;
    if (hostRoleOf(participant) === role) continue;
    const rewritten = { ...participant, hostRole: role };
    await putParticipant(room, attendanceId, rewritten);
    stored.set(attendanceId, rewritten);
    moved.push(attendanceId);
    if (role !== null) newlyGranted.push(attendanceId);
  }
  if (moved.length === 0) return;
  announceRoster(room, stored, {
    updated: moved.flatMap((attendanceId) => {
      const participant = stored.get(attendanceId);
      return participant === undefined ? [] : [rosterEntryFor(attendanceId, participant)];
    }),
  });
  // AND THE DOOR, to whoever has just been given the grant that lets them open it. A roster frame
  // says their role moved; it says nothing about the people already standing outside, because
  // nobody arrived and nobody was decided about — so without this a member made co-host at the
  // twentieth minute sees an empty lobby panel while somebody waits in it.
  await announceLobbyToNewHosts(room, newlyGranted);
}

/** The door moved. The room's own copy is rewritten and everybody is told what is now true. */
export async function roomStateChanged(room: RoomContext, locked: boolean): Promise<void> {
  await setRoomLocked(room, locked);
  await announceRoomState(room);
  await recordLocked(room, undefined, locked);
}

// ---------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------

// A record written before hosting existed carries nothing, which reads as nobody. Asked in one place
// so the two spellings of "not a host" cannot drift.
function hostRoleOf(participant: StoredParticipant | undefined): MeetingHostRole | null {
  return participant?.hostRole ?? null;
}

// The muted flag on the record everybody else's tile is drawn from. Written under the gate for the
// reason every other read-modify-write here is: two frames arriving together would otherwise read
// the same record and one of them would write the other's state back.
async function markMuted(room: RoomContext, attendanceId: string): Promise<void> {
  await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    if (participant === undefined) return;
    await putParticipant(room, attendanceId, { ...participant, speaking: false, muted: true });
  });
}

// One participant's entry, re-read and announced — the path for a mute with no track to close, where
// nothing else would tell the room the flag moved.
async function announceOne(room: RoomContext, attendanceId: string): Promise<void> {
  const stored = await storedParticipants(room);
  const participant = stored.get(attendanceId);
  if (participant === undefined) return;
  announceRoster(room, stored, { updated: [rosterEntryFor(attendanceId, participant)] });
}

/** Sends one frame to every socket carrying one stay — a directive addressed to one person. */
function sendToStay(room: RoomContext, attendanceId: string, payload: string): void {
  // A socket that went away between the walk and the send is one whose close handler is already
  // running; the roster and the record are that path's to fix, not this one's.
  for (const socket of socketsFor(room, attendanceId)) trySend(socket, payload);
}
