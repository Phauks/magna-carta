import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MeetingAttendanceId } from "@magna-carta/identifiers/types";
import { endedFrame, NORMAL_CLOSE_CODE, welcomeFrame } from "@magna-carta/meeting-protocol/frames";
import { closeAttendanceAfterSocketLoss } from "@magna-carta/meetings/meeting-service";
import { firmDatabaseFor } from "../../firm-database/firm-database-proxy.ts";
import { releaseMedia, releaseParticipant } from "./room-media.ts";
import { flushDeferredPresence, presenceFlushDeadlineOf } from "./room-presence.ts";
import { announceRoster, rosterEntryFor, rosterFrom } from "./room-roster.ts";
import {
  attachmentOf,
  broadcast,
  connectedAttendanceIds,
  deleteEndedMarker,
  deleteEveryKey,
  deleteParticipant,
  putEndedAt,
  putParticipant,
  putRoom,
  readEndedAt,
  readParticipant,
  readRoom,
  recordRoomFailure,
  refuseAndClose,
  socketExistsFor,
  socketsFor,
  storedParticipants,
  type MeetingSocketAttachment,
  type RoomContext,
  type StoredParticipant,
} from "./room-state.ts";

// ARRIVING, DROPPING, AND ENDING — every transition of a stay that is not about one frame.
//
// The three are one module because they share one deadline mechanism. A Durable Object has exactly
// ONE alarm; what it can have is several deadlines in storage and a re-arm to the nearest one left.
// Three are reconciled in `armAlarm`: each dropped connection's own grace, the retirement of the
// ended marker, and the end of a presence throttle's window with a transition waiting behind it
// (room-presence.ts). The third is sub-second where the other two are minutes and a day, which is
// the point — it is armed only while somebody is mid-burst, and a room where nobody is toggling
// anything holds no presence deadline at all.

// HOW LONG A DROPPED CONNECTION IS GIVEN before the room writes down that the member left.
//
// A minute is chosen from what it is protecting against on each side. Shorter, and an ordinary
// network hiccup — a phone moving between cells, a laptop waking — becomes a closed stay and a
// second arrival in the record for somebody who never noticed anything. Longer, and a member who
// shut their laptop at noon has a record saying they were still in the meeting at five past, which
// is the failure this exists to fix: before it, the stay stayed open forever.
//
// IT IS A MINUTE EACH, MEASURED FROM EACH PERSON'S OWN DROP. The deadline lives on the participant
// (`socketLostAt`) rather than as one pending sweep for the room, because one shared deadline is a
// grace period only for whoever armed it: a sweep armed when the first person dropped fires while
// the second is twenty seconds into a sixty-second window, and closes them both.
export const SOCKET_LOSS_GRACE_SECONDS = 60;

// How long the ended marker is kept. A browser that was open when the meeting ended learns so within
// seconds; a day is far past any reconnect anybody will attempt, and past it the marker is a key
// held for a room nobody will ever address again.
const ENDED_RETENTION_HOURS = 24;

/**
 * A socket has been accepted for this stay: take the stay over, tell the room, and retire whatever
 * socket was holding it.
 *
 * ONE LIVE SOCKET PER STAY, AND THE NEWEST WINS. This is forced by WebRTC, not chosen: a browser
 * that reconnects builds a NEW peer connection, with new ICE credentials and a new DTLS
 * fingerprint, so it cannot resume the routing session its predecessor opened — and two tabs
 * cannot share one session at all. Carrying the old session forward therefore produced the worst
 * of both: the returning member published into a session nobody was subscribed to, and every
 * other browser — which keys its subscriptions by (session, track) — went on subscribing to a
 * session that would never send again, so the rejoined member stayed a black tile.
 *
 * So an upgrade RESETS the participant to a session that does not exist yet, tells the room, and
 * hangs up on whatever socket was there before. The new socket then publishes into a fresh
 * session and everybody re-subscribes by its id, which is the only sequence that actually
 * reconnects somebody. Read-modify-write under the gate, because two sockets arriving together
 * would otherwise both read the same predecessor and both try to retire it.
 */
export async function admitParticipant(
  room: RoomContext,
  attachment: MeetingSocketAttachment,
  server: WebSocket,
): Promise<void> {
  const superseded = socketsFor(room, attachment.attendanceId, server);
  const previous = await room.ctx.blockConcurrencyWhile(async () => {
    await putRoom(room, {
      firmId: attachment.firmId,
      meetingId: attachment.meetingId,
      medium: attachment.medium,
    });
    const existing = await readParticipant(room, attachment.attendanceId);
    await putParticipant(room, attachment.attendanceId, {
      userId: attachment.userId,
      displayName: attachment.displayName,
      sfuSessionId: null,
      tracks: [],
      // A socket is open again, so whatever grace was running for this stay is over. Left set, the
      // sweep would close the record of somebody who is sitting in the meeting.
      socketLostAt: null,
      // CARRIED FORWARD RATHER THAN RESET, because these are facts about the PERSON and the person
      // has not changed — only their connection has. A member who was muted when their tunnel
      // dropped is still muted, and blanking it would show them as open microphones to everybody
      // until they next happened to toggle something.
      speaking: existing?.speaking ?? false,
      muted: existing?.muted ?? false,
      // The throttle does start again: the returning browser's first statement about itself is
      // the one the room most wants relayed, not the one it most wants to hold back — and a
      // transition the previous socket left waiting is about a connection that is gone.
      presenceAt: null,
      presenceDirty: false,
      syncAt: null,
      layerAt: null,
      // A new socket is a NEW routing session (see above), so every subscription the old one held
      // is gone with it and none of its media sections means anything any more.
      subscribedMids: [],
    });
    return existing;
  });

  // Told BEFORE anything else, so the displaced browser learns why rather than watching a socket
  // go quiet. Its close handler finds this newer socket and arms nothing.
  for (const older of superseded) refuseAndClose(older, "superseded");

  const stored = await storedParticipants(room);
  // A SOCKET THAT HAS JUST ARRIVED HOLDS NOTHING TO APPLY A DIFFERENCE TO, so the welcome carries
  // the whole list however large the room is. It is the one frame in the protocol that always does.
  server.send(welcomeFrame(attachment.attendanceId, rosterFrom(stored)));
  // IN THE ROOM FROM HERE, and not before: until this frame is on the wire the browser holds no
  // roster, so a difference broadcast at it is a gap it can only close by asking for the whole list.
  // Raised after the send rather than before it so the window can only ever be too long by nothing.
  server.serializeAttachment({ ...attachment, welcomed: true });

  // Everybody else learns there is a new tile to draw — and, on a rejoin, that the tracks they were
  // subscribed to are gone, which is what stops them holding a subscription to a session that will
  // never send again. The arriving socket already has the roster on its welcome, so it is not told
  // about itself twice.
  const arrived = stored.get(attachment.attendanceId);
  if (arrived !== undefined) {
    const entry = rosterEntryFor(attachment.attendanceId, arrived);
    announceRoster(
      room,
      stored,
      // A rejoin is not an arrival: everybody else already has this tile and is holding
      // subscriptions against it, and what they need is the reset, not a second copy.
      previous === undefined ? { joined: [entry] } : { updated: [entry] },
      server,
    );
  }

  // Last, and best-effort: the predecessor's session is nobody's now, and the routing service goes
  // on forwarding and billing it until it is told otherwise.
  if (previous !== undefined) await releaseMedia(room, [previous]);
}

/**
 * A socket has gone away. Time the grace, or find that there is nothing to time.
 *
 * A DROPPED SOCKET DOES NOT CLOSE ATTENDANCE — not immediately. The member is very likely about to
 * reconnect, and a stay closed here would either cut their record in half or be reopened as a second
 * arrival they never made. So what is written down is WHEN it went, on the participant itself; the
 * sweep an alarm runs a minute later is what decides. What is NOT deferred is the question: before
 * this, nothing asked it at all, and a closed laptop left a stay open in the firm's record for as
 * long as the record lasted.
 */
export async function noteSocketLost(room: RoomContext, socket: WebSocket): Promise<void> {
  const attachment = attachmentOf(socket);
  if (attachment === null) return;

  // A NEWER SOCKET HAS ALREADY TAKEN THIS STAY OVER — the supersede above, or a reconnect that
  // overlapped its predecessor. The member is sitting in the meeting on the other socket, so there
  // is nothing lost and nothing to time.
  if (socketExistsFor(room, attachment.attendanceId, socket)) return;

  // A socket closing under a participant the room has ALREADY let go of has nothing to time. Both
  // ways that happens are acts somebody took: the leave route closed the stay, or the host ended
  // the meeting and every stay with it.
  const timed = await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attachment.attendanceId);
    if (participant === undefined) return false;
    await putParticipant(room, attachment.attendanceId, {
      ...participant,
      socketLostAt: new Date().toISOString(),
    });
    return true;
  });
  if (timed) await armAlarm(room);
}

/**
 * The one alarm, doing whichever of its two jobs is due.
 *
 * Both are deadlines rather than schedules — a grace period after a connection dropped, and the
 * retirement of the ended marker — so they share one alarm and are told apart by the stored state
 * that armed them.
 */
export async function runAlarm(room: RoomContext): Promise<void> {
  const now = Date.now();
  await sweepParticipantsPastTheirGrace(room, now);

  // AFTER the sweep, so a transition is never relayed about somebody the same alarm has just
  // removed from the roster: their departure is the frame everybody needs, and a presence delta
  // arriving behind it would ask every browser to draw a tile that is gone.
  await flushDeferredPresence(room, now);

  const purgeAt = await endedPurgeDeadline(room);
  if (purgeAt !== null && purgeAt <= now) await deleteEndedMarker(room);

  // The re-arm is what makes one alarm serve several graces: whoever is still inside theirs when
  // this fires gets their own deadline set here.
  await armAlarm(room);
}

/**
 * The meeting is over — called by the end route AFTER the record has committed, so a participant
 * is never told the meeting ended by a write that then failed.
 *
 * Every socket is closed normally rather than left open with a final frame: there is nothing more
 * this room will ever say, and a browser holding an open socket to a finished meeting would keep
 * a connection alive waiting for it.
 */
export async function endMeeting(room: RoomContext, endedAt: string): Promise<void> {
  broadcast(room, endedFrame(endedAt));

  // Read BEFORE the roster goes, because the media outlives it: the routing service is still
  // forwarding every track these sessions hold, and after the delete there is nothing left naming
  // them.
  const departing = await storedParticipants(room);

  // ONE GATE OVER BOTH WRITES. Between the delete and the put there is an instant where the room
  // holds neither a roster entry nor an ended marker, and a frame arriving in it is answered "the
  // room does not know who you are" — which tells a browser to RECONNECT, into a meeting that has
  // ended, forever. The gate is what makes the pair one transition.
  await room.ctx.blockConcurrencyWhile(async () => {
    // The roster goes; the instant stays. Nothing anybody said was ever in this object to delete —
    // the media is routed between browsers and never reaches it at all.
    await deleteEveryKey(room);
    await putEndedAt(room, endedAt);
  });
  // The marker is kept for a day and then retired, so an ended room does not hold a key for the
  // life of the deployment.
  await armAlarm(room);

  for (const socket of room.ctx.getWebSockets()) {
    socket.close(NORMAL_CLOSE_CODE, "meeting ended");
  }

  // Last, and best-effort: the record is already right, and a routing service that will not answer
  // must not be able to make it wrong.
  await releaseMedia(room, [...departing.values()]);
}

/**
 * One person's stay has been closed by the leave route. The roster entry goes and everybody else
 * is told; their socket is closed too, because the record now says they are not in the meeting and
 * a socket that outlived that would let them keep signaling into it.
 */
export async function participantLeft(room: RoomContext, attendanceId: string): Promise<void> {
  await releaseParticipant(room, attendanceId);
  for (const socket of room.ctx.getWebSockets()) {
    if (attachmentOf(socket)?.attendanceId === attendanceId) {
      socket.close(NORMAL_CLOSE_CODE, "left the meeting");
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The deadlines
// ---------------------------------------------------------------------------------------------

/**
 * When this participant's grace runs out, or null while they are connected.
 *
 * `connected` is the set of stays holding a socket, resolved ONCE by the caller. It used to ask the
 * sockets directly, per participant — and reading a socket's attachment deserializes it, so a room
 * of three hundred paid ninety thousand deserializations every time anybody's connection dropped.
 */
function graceDeadlineOf(
  attendanceId: string,
  participant: { readonly socketLostAt: string | null },
  connected: ReadonlySet<string>,
): number | null {
  if (participant.socketLostAt === null) return null;
  if (connected.has(attendanceId)) return null;
  const lostAt = Date.parse(participant.socketLostAt);
  return Number.isNaN(lostAt) ? null : lostAt + SOCKET_LOSS_GRACE_SECONDS * 1000;
}

/** The soonest deadline the roster is holding — a grace, or a presence flush — or null. */
function nextRosterDeadline(
  stored: ReadonlyMap<string, StoredParticipant>,
  connected: ReadonlySet<string>,
): number | null {
  let nearest: number | null = null;
  const consider = (deadline: number | null): void => {
    if (deadline !== null && (nearest === null || deadline < nearest)) nearest = deadline;
  };
  for (const [attendanceId, participant] of stored) {
    consider(graceDeadlineOf(attendanceId, participant, connected));
    consider(presenceFlushDeadlineOf(participant));
  }
  return nearest;
}

/** When the ended marker should be retired, or null when there is none. */
async function endedPurgeDeadline(room: RoomContext): Promise<number | null> {
  const endedAt = await readEndedAt(room);
  if (endedAt === undefined) return null;
  const ended = Date.parse(endedAt);
  return Number.isNaN(ended) ? null : ended + ENDED_RETENTION_HOURS * 60 * 60 * 1000;
}

// One alarm, set to the nearest deadline the room is holding. Never pushed later: an alarm already
// due sooner is doing a job this one would delay.
export async function armAlarm(room: RoomContext): Promise<void> {
  const deadlines: number[] = [];
  // ONE roster read and ONE pass over the sockets, whatever the room is holding deadlines for: both
  // are proportional to the size of the meeting, and this runs on every socket loss and every
  // deferred transition.
  const rosterAt = nextRosterDeadline(await storedParticipants(room), connectedAttendanceIds(room));
  if (rosterAt !== null) deadlines.push(rosterAt);
  const purgeAt = await endedPurgeDeadline(room);
  if (purgeAt !== null) deadlines.push(purgeAt);
  if (deadlines.length === 0) return;

  const nearest = Math.min(...deadlines);
  const current = await room.ctx.storage.getAlarm();
  if (current === null || current > nearest) await room.ctx.storage.setAlarm(nearest);
}

/**
 * Everybody whose OWN grace has run out — never simply everybody without a socket.
 *
 * The alarm fires once for the soonest deadline in the room, so at that instant somebody else may
 * be twenty seconds into their own minute. Closing them too would spend one member's grace on
 * another's record, which is the whole thing the grace exists to prevent; they are left, and the
 * re-arm at the end of the alarm comes back for them.
 *
 * THE MEETING IS NOT ENDED HERE, however empty the room gets. Ending a meeting is the host's act
 * and it writes who ended it; a room that closed itself because the last connection dropped would
 * put an ending in the record that nobody decided on — and a host whose laptop slept would come
 * back to a meeting they cannot resume.
 */
async function sweepParticipantsPastTheirGrace(room: RoomContext, now: number): Promise<void> {
  const stored = await storedParticipants(room);
  const connected = connectedAttendanceIds(room);
  const lost = [...stored].filter(([attendanceId, participant]) => {
    const deadline = graceDeadlineOf(attendanceId, participant, connected);
    return deadline !== null && deadline <= now;
  });
  if (lost.length === 0) return;

  // THE RECORD FIRST, then the roster, then the media. The record is the only durable one of the
  // three, so it is written while there is still something naming who it is about; the media is
  // last because a routing service that will not answer must not leave a stay open.
  for (const [attendanceId] of lost) await closeStay(room, attendanceId);
  const remaining = new Map(stored);
  for (const [attendanceId] of lost) {
    await deleteParticipant(room, attendanceId);
    remaining.delete(attendanceId);
  }
  // What is left is derived from the read this sweep already made rather than read again: the
  // sweep knows exactly who it removed, which is the whole of what the room has to be told.
  announceRoster(room, remaining, { left: lost.map(([attendanceId]) => attendanceId) });
  await releaseMedia(
    room,
    lost.map(([, participant]) => participant),
  );
}

/** Closes one stay in the firm's own record, through the firm-scoped data-access layer. */
async function closeStay(room: RoomContext, attendanceId: string): Promise<void> {
  const stored = await readRoom(room);
  if (stored === undefined) return;
  try {
    const database = firmDatabaseFor(room.env.FIRM_DATABASE, stored.firmId);
    const now = () => new Date().toISOString();
    const { closed, effect } = await closeAttendanceAfterSocketLoss(
      database,
      attendanceId as MeetingAttendanceId,
      { clock: { now }, randomSource: cryptoRandomSource },
    );
    if (closed) await commitEffectBatch(database, effect, { now });
  } catch (caught) {
    // Recorded and carried on with. The next participant's stay is a separate write and a separate
    // record; failing the whole sweep over one of them would leave the rest open too.
    recordRoomFailure(room, "close-attendance", caught);
  }
}
