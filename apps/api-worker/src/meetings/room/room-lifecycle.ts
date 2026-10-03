import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MeetingAttendanceId } from "@magna-carta/identifiers/types";
import { endedFrame, NORMAL_CLOSE_CODE, welcomeFrame } from "@magna-carta/meeting-protocol/frames";
import { closeAttendanceAfterSocketLoss } from "@magna-carta/meetings/meeting-service";
import { firmDatabaseFor } from "../../firm-database/firm-database-proxy.ts";
import {
  broadcastToWaiting,
  sweepWaitingPastTheirGrace,
  waitingParticipantsFrom,
} from "./room-lobby.ts";
import {
  recordAlarmRan,
  recordEnded,
  recordJoined,
  recordPresenceRelayed,
  recordSocketLost,
  recordSuperseded,
  recordSwept,
  recordWelcomed,
} from "./room-diagnostics.ts";
import {
  abandonAnsweredOpening,
  closeUnrecordedSession,
  releaseMedia,
  releaseParticipant,
} from "./room-media.ts";
import { flushDeferredPresence, presenceFlushDeadlineOf } from "./room-presence.ts";
import { flushReactions, reactionFlushDeadlineOf } from "./room-reactions.ts";
import { captionsEndedWithMeeting } from "./room-captions.ts";
import { recordingForWelcome } from "./room-recording.ts";
import { announceRoster, rosterEntryFor, rosterFrom } from "./room-roster.ts";
import {
  attachmentOf,
  broadcast,
  clearSpotlightFor,
  connectedAttendanceIds,
  deleteEndedMarker,
  deleteEveryKey,
  deleteParticipant,
  putEndedAt,
  putParticipant,
  putRoom,
  putWaiting,
  readEndedAt,
  readParticipant,
  readRoom,
  readWaiting,
  recordRoomFailure,
  refuseAndClose,
  roomStateOf,
  socketExistsFor,
  socketsFor,
  storedParticipants,
  storedWaiting,
  trySend,
  viewerKindOf,
  type MeetingSocketAttachment,
  type RoomContext,
  type StoredParticipant,
  type StoredWaiting,
} from "./room-state.ts";

// ARRIVING, DROPPING, AND ENDING — every transition of a stay that is not about one frame.
//
// The three are one module because they share one deadline mechanism. A Durable Object has exactly
// ONE alarm; what it can have is several deadlines in storage and a re-arm to the nearest one left.
// Four are reconciled in `armAlarm`: each dropped connection's own grace, the retirement of the
// ended marker, the end of a presence throttle's window with a transition waiting behind it
// (room-presence.ts), and the flush of a second's reactions (room-reactions.ts). The last two are
// sub-second where the other two are minutes and a day, which is the point — each is armed only
// while somebody is toggling or reacting, and a quiet room holds neither.
//
// THE SUB-SECOND DEADLINES ARE AFFORDABLE FOR DIFFERENT REASONS, and the reactions one is the
// cheaper: a presence deadline is per PERSON and a reaction bucket is one for the whole room, so a
// burst of applause from three hundred people arms this at most once a second however loud it is —
// and during that burst the room is already being woken by the inbound frames themselves.

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
 *
 * THE SESSION BEING OPENED FOR THE OLD SOCKET IS RESET WITH THE RECORD, in the same gate. The record
 * is not the only place a session can be: `room-media.ts` keeps, per stay, the session the service
 * has answered and no record names yet, and one the old connection offered into would otherwise
 * greet the returning browser's first publish as somebody else's and refuse it.
 */
export async function admitParticipant(
  room: RoomContext,
  attachment: MeetingSocketAttachment,
  server: WebSocket,
): Promise<void> {
  const superseded = socketsFor(room, attachment.attendanceId, server);
  const { previous, unrecordedSession } = await room.ctx.blockConcurrencyWhile(async () => {
    await putRoom(room, {
      firmId: attachment.firmId,
      meetingId: attachment.meetingId,
      medium: attachment.medium,
      // Read off the meeting row by the socket route, like the medium beside it, so the room never
      // has to ask the firm's database what state it is in.
      locked: attachment.locked ?? false,
      lobby: attachment.lobby ?? "off",
    });
    const existing = await readParticipant(room, attachment.attendanceId);
    await putParticipant(room, attachment.attendanceId, {
      userId: attachment.userId,
      participantKind: viewerKindOf(attachment),
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
      // The windows on what a frame costs the routing service start again for the same reason: a
      // returning browser republishes and re-subscribes everything the moment it is welcomed, and
      // charging it for what the connection that is already gone spent would refuse the first act
      // of the reconnection this path exists to perform.
      publishAt: null,
      subscribeAt: null,
      renegotiateAt: null,
      closeAt: null,
      // Carried forward rather than reset, because it is a fact about the PERSON being asked rather
      // than about their connection: a member who reconnects has not stopped having just been asked
      // to unmute, and clearing it would make reconnecting the way to ask somebody again.
      unmuteAskedAt: existing?.unmuteAskedAt ?? null,
      // A new socket is a NEW routing session (see above), so every subscription the old one held
      // is gone with it and none of its media sections means anything any more.
      subscribedMids: [],
      // SEEDED FROM THE UPGRADE ONLY WHEN THERE IS NOTHING TO SEED, and read from this record for
      // every frame afterwards. The socket route has just read the live grants to decide the caller
      // may be in the room at all, so the seed costs nothing; what it must not do is become the
      // authority, because a frozen attachment cannot say that a grant was withdrawn ten minutes
      // into a meeting. The hosting routes rewrite this field when they commit (room-hosting.ts).
      //
      // WHICH IS WHY A RECORD THAT ALREADY EXISTS KEEPS ITS OWN ROLE. The route reads the grants a
      // moment before the upgrade, and a withdrawal landing in between commits to the record and
      // then tells the room — so a reconnect that wrote the attachment's seed over the stored role
      // would put the grant back for as long as that socket stayed open, undoing the revocation with
      // no act of anybody's. `hostingChanged` is the only writer of truth here once the first
      // welcome has been sent.
      hostRole:
        existing === undefined ? (attachment.hostRole ?? null) : (existing.hostRole ?? null),
    });
    // After the reset and before the gate opens, so no frame can find the old opening against the
    // new record.
    return {
      previous: existing,
      unrecordedSession: abandonAnsweredOpening(room, attachment.attendanceId),
    };
  });

  // Told BEFORE anything else, so the displaced browser learns why rather than watching a socket
  // go quiet. Its close handler finds this newer socket and arms nothing.
  for (const older of superseded) refuseAndClose(older, "superseded");
  if (superseded.length > 0) {
    await recordSuperseded(room, attachment, attachment.attendanceId, superseded.length);
  }
  // WHAT THIS SOCKET IS ACTUALLY RUNNING THE MEETING AS, which is the stored record's answer and
  // not the attachment's whenever the two can differ. Taken once here and used by everything below
  // that asks the question, so the record, the event and the door list cannot give three answers.
  const hostRole =
    previous === undefined ? (attachment.hostRole ?? null) : (previous.hostRole ?? null);
  await recordJoined(room, attachment, attachment.attendanceId, {
    medium: attachment.medium,
    hostRole,
    waiting: false,
    // A rejoin and an arrival are the same code path and a different event to whoever is reading
    // it: one of them is somebody's connection failing, and it is the one behind most reports of a
    // tile that went black.
    rejoined: previous !== undefined,
  });

  const stored = await storedParticipants(room);
  // A SOCKET THAT HAS JUST ARRIVED HOLDS NOTHING TO APPLY A DIFFERENCE TO, so the welcome carries
  // the whole list however large the room is, and the room's own state with it. It is the one frame
  // in the protocol that always does.
  //
  // The lobby list rides along on the same reasoning and only for a socket that is RUNNING the
  // meeting: who is at the door is a list of people a host has not yet decided about, and telling
  // the room who is outside it is the leak the door was shut to prevent. What decides is the role
  // the record ends up holding — a grant withdrawn between the route's read and this welcome must
  // not still open the door, which is the same reason the record keeps its own role above.
  const doorList = hostRole === null ? [] : waitingParticipantsFrom(await storedWaiting(room));
  // Built for WHO IS ARRIVING: a guest's welcome carries the same roster with the identifiers taken
  // out, which is the rule every later roster frame to their socket follows too.
  //
  // AND THE RECORDING RUNNING AS THEY ARRIVE, if one is — the "and on arrival" half of the consent
  // ruling, told in the same vocabulary the room was told in at the start, with an `arrival` notice
  // written for this stay (room-recording.ts). A reconnect is another arrival, and is told again. The
  // notice is written only once the welcome was actually handed to the socket: it records that this
  // person was told, and a welcome swallowed by a socket closing under it told nobody.
  const recording = await recordingForWelcome(room, attachment);
  const welcomed = trySend(
    server,
    welcomeFrame(
      attachment.attendanceId,
      rosterFrom(stored, viewerKindOf(attachment)),
      await roomStateOf(room),
      doorList,
      recording?.announcement ?? null,
    ),
  );
  if (welcomed) recording?.welcomeSent();
  await recordWelcomed(room, attachment, attachment.attendanceId, stored.size, doorList.length);
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
  // on forwarding and billing it until it is told otherwise — and so is one the service opened for
  // the old connection that no record ever named.
  if (previous !== undefined) await releaseMedia(room, [previous]);
  if (unrecordedSession !== null) await closeUnrecordedSession(room, unrecordedSession);
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
  //
  // A SOCKET AT THE DOOR IS TIMED ON EXACTLY THE SAME TERMS, because a waiter's stay is a stay: a
  // browser closed while somebody stood outside would otherwise leave an open row in the firm's
  // record forever, which is the failure this whole path exists to fix.
  const timed = await room.ctx.blockConcurrencyWhile(async () => {
    const lostAt = new Date().toISOString();
    const participant = await readParticipant(room, attachment.attendanceId);
    if (participant !== undefined) {
      await putParticipant(room, attachment.attendanceId, {
        ...participant,
        socketLostAt: lostAt,
      });
      return true;
    }
    const waiting = await readWaiting(room, attachment.attendanceId);
    if (waiting === undefined) return false;
    await putWaiting(room, attachment.attendanceId, { ...waiting, socketLostAt: lostAt });
    return true;
  });
  if (!timed) return;
  await recordSocketLost(room, attachment, attachment.attendanceId, attachment.waiting === true);
  await armAlarm(room);
}

/**
 * The one alarm, doing whichever of its jobs are due.
 *
 * Every one of them is a DEADLINE rather than a schedule — a grace period after a connection
 * dropped, the retirement of the ended marker, a presence transition the throttle held back, a
 * second's reactions waiting to go out as one frame — so they share one alarm and are told apart by
 * the stored state that armed them.
 */
export async function runAlarm(room: RoomContext): Promise<void> {
  const now = Date.now();
  const sweptParticipants = await sweepParticipantsPastTheirGrace(room, now);
  const sweptWaiting = await sweepTheDoorPastItsGrace(room, now);

  // AFTER the sweep, so a transition is never relayed about somebody the same alarm has just
  // removed from the roster: their departure is the frame everybody needs, and a presence delta
  // arriving behind it would ask every browser to draw a tile that is gone.
  const presenceFlushed = await flushDeferredPresence(room, now);
  // AND THE SECOND'S REACTIONS, on the same terms: a bucket with no frame behind it would otherwise
  // sit unsent until somebody reacted again, which for the last clap of a burst is forever.
  const reactionsFlushed = await flushReactions(room, now);

  const purgeAt = await endedPurgeDeadline(room);
  const endedMarkerRetired = purgeAt !== null && purgeAt <= now;
  if (endedMarkerRetired) await deleteEndedMarker(room);

  // The re-arm is what makes one alarm serve several graces: whoever is still inside theirs when
  // this fires gets their own deadline set here.
  const rearmed = await armAlarm(room);

  // ONE EVENT FOR THE WAKE, naming which of the four jobs were due — an alarm that ran and did none
  // of them, and re-armed anyway, is the only shape in which this mechanism can spin, and it is
  // invisible from outside without this. The room's own record is read once and handed to both, so
  // an alarm costs one read to say where it happened rather than one per event; a room whose record
  // is gone has just been ended and there is nothing left to correlate by.
  const identity = await readRoom(room);
  await recordSwept(room, identity, sweptParticipants, sweptWaiting);
  await recordPresenceRelayed(room, identity, presenceFlushed);
  await recordAlarmRan(room, identity, {
    sweptParticipants,
    sweptWaiting,
    presenceFlushed,
    reactionsFlushed,
    endedMarkerRetired,
    rearmed,
  });
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
  // Read before anything is deleted, and before the broadcast, so the event can say the size the
  // meeting actually ended at — which is the one moment that number exists anywhere.
  const identity = await readRoom(room);
  const atTheDoor = await storedWaiting(room);

  broadcast(room, endedFrame(endedAt));
  // AND EVERYBODY AT THE DOOR, who share exactly this one piece of news with the room. `broadcast`
  // cannot reach them: it skips every socket that has not been welcomed, and a waiting socket never
  // is. Without this, somebody standing outside a meeting that finished would sit there until their
  // socket closed under them with no word of why.
  broadcastToWaiting(room, endedFrame(endedAt));

  // Read BEFORE the roster goes, because the media outlives it: the routing service is still
  // forwarding every track these sessions hold, and after the delete there is nothing left naming
  // them.
  const departing = await storedParticipants(room);
  // And the captioner, for the same reason: whether captions were on is a key the delete takes, and
  // the captioner's adapters are still pulling audio for a meeting that has ended.
  await captionsEndedWithMeeting(room);

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
  await recordEnded(room, identity, departing.size, atTheDoor.size);

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

/** The soonest grace deadline anybody at the door is holding, or null. */
function nextWaitingDeadline(
  waiting: ReadonlyMap<string, StoredWaiting>,
  connected: ReadonlySet<string>,
): number | null {
  let nearest: number | null = null;
  for (const [attendanceId, one] of waiting) {
    const deadline = graceDeadlineOf(attendanceId, one, connected);
    if (deadline !== null && (nearest === null || deadline < nearest)) nearest = deadline;
  }
  return nearest;
}

/**
 * Everybody at the door whose own grace has run out: the record first, then the key.
 *
 * The roster sweep's twin, in the same order and for the same reason — the record is the only
 * durable one of the two, so it is written while there is still something naming who it is about.
 * There is no media to release and no spotlight to clear, because a waiter has published nothing and
 * cannot be spotlit.
 */
async function sweepTheDoorPastItsGrace(room: RoomContext, now: number): Promise<number> {
  const waiting = await storedWaiting(room);
  if (waiting.size === 0) return 0;
  const connected = connectedAttendanceIds(room);
  const gone = [...waiting]
    .filter(([attendanceId, one]) => {
      const deadline = graceDeadlineOf(attendanceId, one, connected);
      return deadline !== null && deadline <= now;
    })
    .map(([attendanceId]) => attendanceId);
  if (gone.length === 0) return 0;

  for (const attendanceId of gone) await closeStay(room, attendanceId);
  await sweepWaitingPastTheirGrace(room, gone);
  return gone.length;
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
//
// Answers whether the room is now holding a deadline at all — which the alarm's own event records,
// because an alarm that finds nothing due and re-arms anyway is the one shape in which this can
// spin, and it cannot be told from a quiet room without the answer.
/**
 * The alarm, set for ONE deadline the caller already knows — no reconciliation, no reads.
 *
 * Safe precisely because `armAlarm` never pushes an alarm later either: the only thing a re-arm can
 * do is bring it forward, and every wake ends by reconciling the whole room again. What it saves is
 * the two list reads the full reconciliation spends — which, on a deferred presence transition, is
 * the most frequent frame in a large meeting paying for a read of every key the room holds.
 */
export async function armAlarmFor(room: RoomContext, deadline: number): Promise<void> {
  const current = await room.ctx.storage.getAlarm();
  if (current === null || current > deadline) await room.ctx.storage.setAlarm(deadline);
}

export async function armAlarm(room: RoomContext): Promise<boolean> {
  const deadlines: number[] = [];
  // ONE roster read and ONE pass over the sockets, whatever the room is holding deadlines for: both
  // are proportional to the size of the meeting, and this runs on every socket loss and every
  // deferred transition.
  const connected = connectedAttendanceIds(room);
  const rosterAt = nextRosterDeadline(await storedParticipants(room), connected);
  if (rosterAt !== null) deadlines.push(rosterAt);
  // The door's own graces, over the SAME pass of the sockets: a waiter's stay is a stay, and the
  // deadline that closes it is the roster's, measured from each person's own drop.
  const doorAt = nextWaitingDeadline(await storedWaiting(room), connected);
  if (doorAt !== null) deadlines.push(doorAt);
  const purgeAt = await endedPurgeDeadline(room);
  if (purgeAt !== null) deadlines.push(purgeAt);
  // ONE key rather than a pass over anything: the coalescing bucket is a fact about the room, so the
  // reconciliation pays a single get for it however large the meeting is. It has to be here and not
  // only on `armAlarmFor`: a wake for some other deadline re-arms from this set alone, and a bucket
  // missing from it would be a second's applause the room never sent.
  const reactionsAt = await reactionFlushDeadlineOf(room);
  if (reactionsAt !== null) deadlines.push(reactionsAt);
  if (deadlines.length === 0) return false;

  const nearest = Math.min(...deadlines);
  const current = await room.ctx.storage.getAlarm();
  if (current === null || current > nearest) await room.ctx.storage.setAlarm(nearest);
  return true;
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
async function sweepParticipantsPastTheirGrace(room: RoomContext, now: number): Promise<number> {
  const stored = await storedParticipants(room);
  const connected = connectedAttendanceIds(room);
  const lost = [...stored].filter(([attendanceId, participant]) => {
    const deadline = graceDeadlineOf(attendanceId, participant, connected);
    return deadline !== null && deadline <= now;
  });
  if (lost.length === 0) return 0;

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
  // The spotlight dies with whoever it named. A large tile drawn for somebody the sweep has just
  // removed is a tile that will never fill.
  await clearSpotlightFor(
    room,
    lost.map(([attendanceId]) => attendanceId),
  );
  await releaseMedia(
    room,
    lost.map(([, participant]) => participant),
  );
  return lost.length;
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
