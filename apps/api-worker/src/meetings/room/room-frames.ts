import {
  NORMAL_CLOSE_CODE,
  parseMeetingClientFrame,
  PONG_FRAME,
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
import { handleHostFrame } from "./room-hosting.ts";
import { giveUpWaiting } from "./room-lobby.ts";
import { armAlarmFor } from "./room-lifecycle.ts";
import { changeHand, relayPresence } from "./room-presence.ts";
import { claimSignalSlot, relayReaction } from "./room-reactions.ts";
import { namesOnlyRosterTracks, rosterFrom } from "./room-roster.ts";
import {
  acceptClientReport,
  beginFrameBudget,
  recordClientReport,
  recordFrameBudget,
  recordLayerChanged,
  recordPublished,
  recordSubscribed,
  refuseAndCloseRecorded,
  refuseAndRecord,
  storedSampleOf,
} from "./room-diagnostics.ts";
import {
  attachmentOf,
  putParticipant,
  readEndedAt,
  readParticipant,
  readRoom,
  recordRoomFailure,
  storedParticipants,
  trySend,
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

// HOW OFTEN ONE PARTICIPANT MAY ASK FOR THE WHOLE ROSTER, and how often they may change a layer.
//
// Both frames cost the ROOM rather than the sender, which is what makes them worth bounding: a sync
// is a list of every key the room holds — three hundred of them in a full meeting — and a layer
// change is a call to the routing service. Everything else a browser sends is either answered from
// what the frame already carries or already bounded by something else (a publish by the track
// ceiling, a subscribe by the roster it has to name). A browser can send either of these as fast as
// it can write to a socket, and one doing so stalls every other person's frames behind it.
//
// A FRAME INSIDE THE WINDOW IS DROPPED, NOT DEFERRED, and this is deliberately the opposite choice
// from the presence throttle next door. A deferred presence transition is a fact about somebody that
// stays wrong until it is sent, so it is worth an alarm. These two are not facts: a sync is a
// REQUEST, and a browser that does not get an answer asks again a moment later — while the room goes
// on announcing every roster change to it unprompted, so the list it is missing is the recovery path
// and not the ordinary one. A layer change is a preference about how large a tile is drawn, and one
// dropped inside a quarter of a second is superseded by whatever the browser asks for next. Neither
// is refused on the wire: a refusal reason is a vocabulary every browser has to learn to treat as
// non-fatal, which is a larger change than a frame nobody sent on purpose is worth.
const SYNC_INTERVAL_MILLISECONDS = 1000;
const LAYER_INTERVAL_MILLISECONDS = 250;

/** The frames that reach the routing service, which is every one the room does not answer itself. */
type SignalingFrame = Exclude<
  MeetingClientFrame,
  | { type: "ping" }
  | { type: "leave" }
  | { type: "sync" }
  | { type: "presence" }
  | { type: "mute" }
  | { type: "mute-all" }
  | { type: "ask-to-unmute" }
  | { type: "spotlight" }
  | { type: "lower-hands" }
  | { type: "reaction" }
  | { type: "diagnostic-report" }
>;

// The track kinds that carry a picture, which is what a call does not have. A camera and a screen
// share are both video to the routing service and are named apart here only because a browser names
// them apart; anything that is not sound is treated as a picture, so a kind nobody has thought of
// yet is refused from a call rather than admitted into one.
function isPicture(kind: string): boolean {
  return kind !== "audio";
}

/**
 * One frame off one socket, from the bytes to whichever module owns what it asks for.
 *
 * The routing is `routeClientFrame` below; what this adds is the STORAGE BUDGET, opened around the
 * whole of it and closed however the frame ends. The room's economy is one rule — the roster is read
 * at most once per frame — and a rule nothing measures is a rule that has already been broken
 * somewhere. It is sampled rather than taken on every frame (room-diagnostics.ts), so a frame that
 * is not being watched pays a counter increment and nothing else.
 */
export async function dispatchClientFrame(
  room: RoomContext,
  socket: WebSocket,
  message: string | ArrayBuffer,
): Promise<void> {
  const budget = beginFrameBudget();
  let frameType: MeetingClientFrame["type"] | "" = "";
  try {
    frameType = await routeClientFrame(room, socket, message);
  } finally {
    // The attachment is read again HERE rather than carried out of the routing, and only for a
    // frame that is being watched: reading one deserializes it, so paying for a second read on
    // every frame to fill in a field on one in twenty would cost more than the measurement is
    // worth. A socket whose attachment cannot be read has no meeting to charge the spend to.
    if (budget !== null) {
      await recordFrameBudget(room, attachmentOf(socket) ?? undefined, frameType, budget);
    }
  }
}

/** The routing itself, answering what kind of frame it turned out to be. */
async function routeClientFrame(
  room: RoomContext,
  socket: WebSocket,
  message: string | ArrayBuffer,
): Promise<MeetingClientFrame["type"] | ""> {
  const parsed = parseMeetingClientFrame(message);
  if ("refusal" in parsed) {
    // The socket STAYS OPEN. A frame this room could not read is a bug in one message, not a
    // reason to drop somebody out of a meeting they are otherwise in — and a browser that
    // reconnects has to renegotiate every track from nothing.
    //
    // The frame type recorded is the empty string, because there genuinely is not one: a frame this
    // parse refused either named no type this room speaks or could not be read at all.
    await refuseAndRecord(
      room,
      socket,
      attachmentOf(socket) ?? undefined,
      attachmentOf(socket)?.attendanceId ?? null,
      parsed.refusal,
      "",
    );
    return "";
  }

  // A ping reaching here means the browser did not send the byte-exact auto-response frame. Answer
  // it anyway: the contract is the frame, not the optimization.
  if (parsed.frame.type === "ping") {
    trySend(socket, PONG_FRAME);
    return "ping";
  }

  const attachment = attachmentOf(socket);
  if (attachment === null) {
    // The room cannot say who this is, so it cannot route anything on their behalf. Unlike a bad
    // frame this does not improve by trying again on the same socket.
    await refuseAndCloseRecorded(
      room,
      socket,
      undefined,
      null,
      "not-a-participant",
      parsed.frame.type,
    );
    return parsed.frame.type;
  }

  if (parsed.frame.type === "leave") {
    // GIVING UP AT THE DOOR is the same act with nothing to release: a waiter holds no routing
    // session and publishes nothing, so the whole of it is dropping the `waiting:` record.
    if (attachment.waiting === true) await giveUpWaiting(room, attachment.attendanceId);
    else await releaseParticipant(room, attachment.attendanceId);
    socket.close(NORMAL_CLOSE_CODE, "left the meeting");
    return "leave";
  }

  // A SOCKET THAT IS STILL AT THE DOOR MAY SEND `ping` AND `leave` AND NOTHING ELSE, and both are
  // already answered above. Decided HERE — before the throttles, before the roster is read and
  // before a routing session is so much as resolved — so a waiter's frame never costs the room a
  // read or the routing service a session. The service has no notion of a meeting and would honour
  // a subscription to any session in the fleet, which is exactly what somebody standing outside a
  // confidential matter discussion must not be able to reach.
  //
  // THE SOCKET STAYS OPEN: they are at the door, and the door may open. Closing here would make a
  // misbehaving client's first frame the end of their place in the queue.
  if (attachment.waiting === true) {
    await refuseAndRecord(
      room,
      socket,
      attachment,
      attachment.attendanceId,
      "not-admitted",
      parsed.frame.type,
    );
    return parsed.frame.type;
  }

  // THE TWO FRAMES THAT ASK NOTHING OF THE ROUTING SERVICE, answered before it is even resolved.
  // A browser that has lost track of who is in the room, and a browser saying whether its own
  // microphone is carrying a voice, are both about the roster alone — and both must go on working
  // in a deployment whose media credentials went away under an open meeting.
  if (parsed.frame.type === "sync") {
    // The throttle is claimed BEFORE the roster is read, which is the whole point of it: the read
    // is what this frame costs.
    if (
      !(await claimThrottleSlot(
        room,
        attachment.attendanceId,
        "syncAt",
        SYNC_INTERVAL_MILLISECONDS,
      ))
    ) {
      return "sync";
    }
    // ONE SOCKET, and the whole list. This is the way back to the truth for a client that has been
    // applying differences: without it, a browser that suspects a gap could only reconnect, which
    // costs it every track it holds.
    trySend(socket, rosterFrame(rosterFrom(await storedParticipants(room))));
    return "sync";
  }

  if (parsed.frame.type === "presence") {
    // ONE FRAME, TWO RULES, DECIDED BY WHICH FIELD MOVED — and that is legible precisely because the
    // frame states its whole subject rather than a difference. `speaking` and `muted` keep the
    // drop-throttle below: a suppressed transition loses nothing a later one restates. A change to
    // the HAND does not restate itself — it may be the last thing somebody does for ten minutes — so
    // it answers to the signal window instead and is refused rather than dropped.
    //
    // An ABSENT `hand` is a browser with nothing to say about one, which is what every browser left
    // open across the deploy that added it sends. Reading absence as `false` would lower the hand of
    // every participant who had not reloaded.
    if (parsed.frame.hand !== undefined) {
      const refusal = await changeHandWithinWindow(
        room,
        attachment.attendanceId,
        parsed.frame.hand,
      );
      if (refusal) {
        // THE WHOLE FRAME IS REFUSED, not its hand alone. The browser sends its three facts
        // together and re-sends them together, so half-applying one would leave the two ends
        // disagreeing about a fact neither of them said had changed.
        await refuseAndRecord(
          room,
          socket,
          attachment,
          attachment.attendanceId,
          "rate-limited",
          "presence",
        );
        return "presence";
      }
    }
    const dueAt = await relayPresence(
      room,
      socket,
      attachment.attendanceId,
      parsed.frame.speaking,
      parsed.frame.muted,
    );
    // A transition the throttle held back is relayed by the alarm instead. Armed from here rather
    // than from inside the presence module because a room has ONE alarm and one place that
    // reconciles every deadline into it.
    // Armed for the deadline the presence module already knows rather than through the full
    // reconciliation: this is the frame a room of three hundred sends most, and reconciling would
    // read every key the room holds, twice, for a window that is a second away.
    if (dueAt !== null) await armAlarmFor(room, dueAt);
    return "presence";
  }

  // WHAT THIS BROWSER SAYS ABOUT ITS OWN CONNECTION, answered here for the reason the two above are:
  // it asks nothing of the routing service, and a room whose media credentials went away under an
  // open meeting must still be able to hear that a connection is the reason a tile is black.
  //
  // Nothing is sent back. A report is a statement, not a request, and a client that had to be
  // acknowledged would be a client the room owes a frame to every five seconds per participant.
  // Inside the window it is dropped silently — a sample is a restatement and the browser takes
  // another in a moment — so a client is never refused for reporting too often.
  if (parsed.frame.type === "diagnostic-report") {
    const at = new Date().toISOString();
    if (await acceptClientReport(room, attachment.attendanceId, parsed.frame.sample)) {
      await recordClientReport(
        room,
        attachment,
        attachment.attendanceId,
        storedSampleOf(parsed.frame.sample, at),
      );
    }
    return "diagnostic-report";
  }

  // THE HOST'S OWN FRAMES, answered before a routing session for the SENDER is resolved — none of
  // them acts on the sender's session. A mute acts on somebody else's, and the other three touch
  // the service not at all.
  //
  // Not throttled, deliberately, unlike the sync and the layer change above: a host act is a
  // deliberate press rather than something a browser emits as its window resizes, and the acts that
  // could cost the room something — mute-everyone most of all — are bounded inside the module by
  // their own concurrency lane rather than by a window that would make a second press vanish.
  if (
    parsed.frame.type === "mute" ||
    parsed.frame.type === "mute-all" ||
    parsed.frame.type === "ask-to-unmute" ||
    parsed.frame.type === "spotlight" ||
    parsed.frame.type === "lower-hands"
  ) {
    await handleHostFrame(room, socket, attachment.attendanceId, parsed.frame);
    return parsed.frame.type;
  }

  // SOMETHING THROWN ON A TILE, answered here for the reason presence is: it asks nothing of the
  // routing service, and a room whose media credentials went away under an open meeting must still
  // carry what people are saying to each other about what is being said.
  //
  // REFUSED RATHER THAN DROPPED inside the window, which is the opposite of every other throttle in
  // this room. A reaction is a single act with no later frame to restate it, so one held back simply
  // did not happen for anybody but its sender.
  if (parsed.frame.type === "reaction") {
    const now = Date.now();
    if (!(await claimSignalSlot(room, attachment.attendanceId, now))) {
      await refuseAndRecord(
        room,
        socket,
        attachment,
        attachment.attendanceId,
        "rate-limited",
        "reaction",
      );
      return "reaction";
    }
    const dueAt = await relayReaction(
      room,
      socket,
      attachment.attendanceId,
      parsed.frame.name,
      now,
    );
    // A bucket with nothing after it would sit unsent, so opening one arms the room's existing alarm
    // for its flush instant — armed from HERE rather than from inside the reactions module because a
    // room has ONE alarm and one place that reconciles every deadline into it, and armed for the
    // known deadline rather than through the full reconciliation for the reason the presence flush
    // is: that reconciliation reads every key the room holds, twice, for a window a second away.
    if (dueAt !== null) await armAlarmFor(room, dueAt);
    return "reaction";
  }

  // Same claim, one frame earlier than the roster read and the upstream call it would make.
  if (
    parsed.frame.type === "layer" &&
    !(await claimThrottleSlot(
      room,
      attachment.attendanceId,
      "layerAt",
      LAYER_INTERVAL_MILLISECONDS,
    ))
  ) {
    return "layer";
  }

  const sfu = sfuClientForEnv(room.env);
  if (sfu === null) {
    // The upgrade route refuses before a socket exists when meetings are unconfigured, so this is
    // reachable only if the credentials went away under an open meeting. Said plainly rather than
    // left to a timeout inside the browser's connection. No Error ID: nothing failed, the
    // deployment simply cannot route media, and a handle would send somebody looking for a trace
    // that does not exist.
    await refuseAndRecord(
      room,
      socket,
      attachment,
      attachment.attendanceId,
      "sfu-unavailable",
      parsed.frame.type,
    );
    return parsed.frame.type;
  }

  try {
    await handleSignalingFrame(room, socket, attachment, parsed.frame, sfu);
  } catch (caught) {
    if (caught instanceof SfuUnavailableError) {
      // Carries no word of what the routing service said: that text can name the application the
      // whole fleet's meetings run on. What it does carry is the handle that joins what this
      // member saw to the redacted trace of what actually happened — the SAME handle on the record
      // and on the wire, which is what the one refusal call is for.
      await refuseAndRecord(
        room,
        socket,
        attachment,
        attachment.attendanceId,
        "sfu-unavailable",
        parsed.frame.type,
        recordRoomFailure(room, "signaling", caught),
      );
      return parsed.frame.type;
    }
    throw caught;
  }
  return parsed.frame.type;
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
    await refuseAndRecord(room, socket, attachment, attachment.attendanceId, refusal, frame.type);
    return;
  }

  // Every signaling frame acts on this participant's routing-service session, so it is resolved
  // once here — and its absence is one answer rather than four.
  const outcome = await sessionFor(room, attachment.attendanceId, sfu);
  if (outcome.kind === "unavailable") {
    await refuseAndRecord(
      room,
      socket,
      attachment,
      attachment.attendanceId,
      "sfu-unavailable",
      frame.type,
      recordRoomFailure(room, "create-session", outcome.caught),
    );
    return;
  }
  if (outcome.kind === "absent") {
    // No roster entry, and the two ways that happens lead somewhere different: the meeting ended
    // under this socket, or this participant's stay was closed. A browser retries the second and
    // must not retry the first.
    const endedAt = await readEndedAt(room);
    await refuseAndCloseRecorded(
      room,
      socket,
      attachment,
      attachment.attendanceId,
      endedAt === undefined ? "not-a-participant" : "meeting-ended",
      frame.type,
    );
    return;
  }
  const sessionId = outcome.sessionId;

  if (frame.type === "publish") {
    const published = await publishTracks(
      room,
      socket,
      attachment.attendanceId,
      sessionId,
      frame,
      sfu,
    );
    await recordPublished(room, attachment, attachment.attendanceId, published);
    return;
  }
  if (frame.type === "layer") {
    const layered = await changeLayers(socket, sessionId, frame, sfu);
    await recordLayerChanged(
      room,
      attachment,
      attachment.attendanceId,
      layered.trackCount,
      layered.refusedCount,
    );
    return;
  }
  if (frame.type === "subscribe") {
    const subscribed = await subscribeTracks(
      room,
      socket,
      attachment.attendanceId,
      sessionId,
      frame,
      sfu,
    );
    await recordSubscribed(
      room,
      attachment,
      attachment.attendanceId,
      subscribed.requestedCount,
      subscribed.forwardedCount,
    );
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
  if (!namesOnlyRosterTracks(attendanceId, stored, frame.tracks)) return "unknown-track";
  if (frame.type === "subscribe") return null;

  // AND A LAYER CHANGE ANSWERS TO ONE MORE THING, because the roster check alone constrains nothing
  // about what it actually does. The (session, track) pair on a layer frame says what the browser
  // believes it is adjusting; what is SENT upstream is the media section, inside the asking
  // browser's own session — and the routing service will change any section that session holds,
  // including the ones this browser publishes through. So the room refuses a section it did not
  // subscribe for this participant itself, which is the only version of this check that decides
  // anything.
  const mine = new Set(stored.get(attendanceId)?.subscribedMids ?? []);
  return frame.tracks.every((track) => mine.has(track.mid)) ? null : "unknown-track";
}

/**
 * Moves this participant's hand if the window allows it, answering whether it was REFUSED.
 *
 * The order is what makes the rule readable: whether the hand actually moved is asked first, so a
 * browser restating a hand that is already up spends no allowance and is never refused for saying
 * nothing. Only a real change claims the window, and only a claim that fails is a refusal.
 */
async function changeHandWithinWindow(
  room: RoomContext,
  attendanceId: string,
  raised: boolean,
): Promise<boolean> {
  const participant = await readParticipant(room, attendanceId);
  // No roster entry: nothing to move, and the frame is answered a little further on by the path that
  // can tell a closed stay from a meeting that ended.
  if (participant === undefined) return false;
  if (((participant.handRaisedAt ?? null) !== null) === raised) return false;
  const now = Date.now();
  if (!(await claimSignalSlot(room, attendanceId, now))) return true;
  await changeHand(room, attendanceId, raised, now);
  return false;
}

/**
 * Claims this participant's slot for a throttled frame, answering whether it may proceed.
 *
 * Read-modify-write under the gate, because two frames arriving together would otherwise both read
 * the same instant and both pass — which is precisely the burst this bounds. A stay that has never
 * sent one has no window at all, so the first is always answered.
 */
async function claimThrottleSlot(
  room: RoomContext,
  attendanceId: string,
  field: "syncAt" | "layerAt",
  intervalMilliseconds: number,
): Promise<boolean> {
  const now = Date.now();
  return await room.ctx.blockConcurrencyWhile(async () => {
    const participant = await readParticipant(room, attendanceId);
    // No roster entry: the frame is refused a little further on, by the path that can tell a member
    // whose stay has closed from a meeting that has ended. Nothing to claim, and nothing to say.
    if (participant === undefined) return true;
    const previous =
      participant[field] === null ? Number.NaN : Date.parse(participant[field] ?? "");
    if (!Number.isNaN(previous) && now - previous < intervalMilliseconds) return false;
    await putParticipant(room, attendanceId, {
      ...participant,
      [field]: new Date(now).toISOString(),
    });
    return true;
  });
}
