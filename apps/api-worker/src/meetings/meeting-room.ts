import { DurableObject } from "cloudflare:workers";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { MeetingAttendanceId } from "@magna-carta/identifiers/types";
import { closeAttendanceAfterSocketLoss } from "@magna-carta/meetings/meeting-service";
import { isMeetingMedium, type MeetingMedium } from "@magna-carta/meetings/types";
import type { Bindings } from "../bindings.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "../realtime/realtime-failure.ts";
import {
  closedFrame,
  endedFrame,
  MEETING_PROTOCOL_VERSION,
  NORMAL_CLOSE_CODE,
  parseMeetingClientFrame,
  PONG_FRAME,
  PING_FRAME,
  publishedFrame,
  refusedFrame,
  renegotiatedFrame,
  rosterFrame,
  subscribedFrame,
  UNSERVICEABLE_CLOSE_CODE,
  welcomeFrame,
  type MeetingClientFrame,
  type MeetingRefusalReason,
  type RosterParticipant,
} from "./meeting-room-protocol.ts";
import { sfuClientForEnv, SfuUnavailableError, type SfuClient } from "./sfu-client.ts";

// One meeting's signaling room, keyed `${firmId}:${meetingId}` and addressed by the SESSION firm id
// at the route — never by a path value, so a firm can no more signal into another firm's meeting
// than it can read one.
//
// WHAT IS IN HERE, AND WHAT COULD NEVER BE. The room brokers each browser's session with the media
// routing service and keeps the roster. The audio, the video and the screen share go directly
// between a browser and that service: they do not cross this object, this Worker, or this platform's
// storage at all. So nothing anybody said is here to protect, and the transient state that IS here —
// who is connected, which routing session they publish through, which tracks they are offering — is
// signaling, deleted when they leave and when the meeting ends.
//
// THE ROOM IS THE ONLY THING STANDING BETWEEN ONE MEETING AND EVERY OTHER. The whole fleet's
// meetings run inside ONE routing application, so a session handle is meaningful to that service
// whoever presents it: it does not know which meeting, or which firm, a session belongs to. This
// object does, and that is the entire reason a subscription is checked against the roster here
// rather than forwarded. A pair this room cannot find is refused, never asked about.
//
// Hibernating WebSockets, on the assistant's push-object pattern: the runtime owns the server end,
// so the room can be evicted while every socket stays open and is re-constructed when a frame
// arrives. An idle meeting therefore bills nothing while people sit in it. The consequence is the
// rule the whole file obeys — NOTHING about a participant may live on the instance, because class
// properties do not survive hibernation. Everything a frame needs rides on the per-socket
// attachment, which does, and everything the ROOM needs is read back out of storage.
//
// ONE LIVE SOCKET PER STAY, NEWEST WINS. A stay is a person in a room, and a person in a room has
// one browser sending their camera; the rule is forced by WebRTC rather than chosen. A reconnecting
// browser brings a new peer connection — new ICE credentials, new DTLS fingerprint — so it cannot
// resume the routing session its predecessor opened, and two tabs cannot share one session at all.
// An upgrade therefore RETIRES whatever socket was on that stay (`refused: superseded`, then a
// close), resets the participant to no session and no tracks, and tells the room — so every other
// browser drops the subscriptions it was holding by the old session id and re-subscribes to the new
// one. Anything gentler leaves the returning member a black tile on everybody else's screen.
//
// THE RECORD IS NOT KEPT HERE, but the room is what closes it when nobody else will. Who was in the
// meeting and when is attendance in the firm's own database, written by the routes through the
// firm-scoped data-access layer. This object's roster is a view of who is connected right now, which
// is a different question and a shorter-lived one — and when a browser simply goes away, the grace
// sweep below is the only thing that ever turns that into an ending in the record. Each person's
// grace is timed from their OWN drop, on their own roster entry.

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

// THE MOST TRACKS ONE PARTICIPANT MAY OFFER. A camera, a microphone and a screen share is three; the
// headroom is for a second camera and for a browser that renegotiates without retiring what it
// replaced. What the ceiling actually stops is a browser — or something wearing one's credentials —
// opening tracks in a loop: every one of them is a forwarding cost billed to this account and a
// subscription every other participant in the room is invited to make.
const MAX_TRACKS_PER_PARTICIPANT = 8;

// The separator between a participant's handle and the name they gave a track. A track name is the
// pair, and the roster is how every other browser resolves one to a tile.
const TRACK_NAME_SEPARATOR = ":";

// The track kinds that carry a picture, which is what a call does not have. A camera and a screen
// share are both video to the routing service and are named apart here only because a browser names
// them apart; anything that is not sound is treated as a picture, so a kind nobody has thought of
// yet is refused from a call rather than admitted into one.
function isPicture(kind: string): boolean {
  return kind !== "audio";
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
interface StoredTrack {
  readonly trackName: string;
  readonly kind: string;
  readonly mid: string | null;
}

/** One connected participant, as the room holds them between frames. */
interface StoredParticipant {
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
}

/** Which meeting, in which firm, this room is the signaling side of. */
interface StoredRoom {
  readonly firmId: string;
  readonly meetingId: string;
  // What kind of gathering this is. Kept here rather than read off each socket, so the answer is the
  // room's and not one browser's — and so the alarm, which has no socket, could read it too.
  readonly medium: MeetingMedium;
}

const FIRM_PARAMETER = "firm";
const MEETING_PARAMETER = "meeting";
const USER_PARAMETER = "user";
const ATTENDANCE_PARAMETER = "attendance";
const DISPLAY_NAME_PARAMETER = "displayName";
const MEDIUM_PARAMETER = "medium";

/** What the route resolves before it addresses the room — every value of it server-derived. */
export type MeetingSocketContext = Omit<MeetingSocketAttachment, "protocolVersion">;

/** The internal URL the upgrade is addressed to. Exported so a test can build the same request. */
export function meetingSocketRequestUrl(attachment: MeetingSocketContext): string {
  const parameters = new URLSearchParams({
    [FIRM_PARAMETER]: attachment.firmId,
    [MEETING_PARAMETER]: attachment.meetingId,
    [USER_PARAMETER]: attachment.userId,
    [ATTENDANCE_PARAMETER]: attachment.attendanceId,
    [DISPLAY_NAME_PARAMETER]: attachment.displayName,
    [MEDIUM_PARAMETER]: attachment.medium,
  });
  return `https://meeting-room.invalid/socket?${parameters.toString()}`;
}

/**
 * The whole request the route sends inward — built from scratch rather than by re-wrapping the
 * caller's, so no cookie and no caller-supplied header travels on to the object. Every value on it
 * is server-derived: the firm from the session, the meeting after the caller was authorized against
 * it, and the attendance and the name from the firm's own rows.
 */
export function meetingSocketRequest(attachment: MeetingSocketContext): Request {
  return new Request(meetingSocketRequestUrl(attachment), { headers: { Upgrade: "websocket" } });
}

function attachmentFromRequest(request: Request): MeetingSocketAttachment | null {
  const parameters = new URL(request.url).searchParams;
  const firmId = parameters.get(FIRM_PARAMETER);
  const meetingId = parameters.get(MEETING_PARAMETER);
  const userId = parameters.get(USER_PARAMETER);
  const attendanceId = parameters.get(ATTENDANCE_PARAMETER);
  const displayName = parameters.get(DISPLAY_NAME_PARAMETER);
  const medium = parameters.get(MEDIUM_PARAMETER);
  if (
    firmId === null ||
    firmId === "" ||
    meetingId === null ||
    meetingId === "" ||
    userId === null ||
    userId === "" ||
    attendanceId === null ||
    attendanceId === ""
  ) {
    return null;
  }
  return {
    protocolVersion: MEETING_PROTOCOL_VERSION,
    firmId,
    meetingId,
    userId,
    attendanceId,
    // A member who has never set a name still has a socket and still belongs on the roster; an empty
    // tile with no label is worse than a placeholder nobody chose.
    displayName: displayName ?? "",
    // A value the room does not recognise is read as the WIDER medium, which is the safe direction:
    // an unrecognised label must not silently turn a video meeting into one where no camera works.
    // A socket opened by an older build carries none, and those meetings were all video.
    medium: medium !== null && isMeetingMedium(medium) ? medium : "video",
  };
}

function attachmentOf(socket: WebSocket): MeetingSocketAttachment | null {
  const attachment = socket.deserializeAttachment() as MeetingSocketAttachment | null;
  if (attachment === null || attachment === undefined) return null;
  return typeof attachment.attendanceId === "string" &&
    attachment.attendanceId !== "" &&
    typeof attachment.meetingId === "string" &&
    attachment.meetingId !== ""
    ? attachment
    : null;
}

/** The routing session this participant publishes through, or why there is none to resolve. */
type SessionOutcome =
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable"; readonly caught: unknown };

export class MeetingRoom extends DurableObject<Bindings> {
  override async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) {
      return new Response("this endpoint serves WebSocket signaling only", { status: 426 });
    }
    const attachment = attachmentFromRequest(request);
    if (attachment === null) {
      return new Response("signaling requires the resolved participant", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation, not `server.accept()`: the runtime owns the server end, so this object can be
    // evicted while people sit in the meeting and re-constructed when the next frame arrives.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME));

    // ONE LIVE SOCKET PER STAY, AND THE NEWEST WINS. This is forced by WebRTC, not chosen: a browser
    // that reconnects builds a NEW peer connection, with new ICE credentials and a new DTLS
    // fingerprint, so it cannot resume the routing session its predecessor opened — and two tabs
    // cannot share one session at all. Carrying the old session forward therefore produced the worst
    // of both: the returning member published into a session nobody was subscribed to, and every
    // other browser — which keys its subscriptions by (session, track) — went on subscribing to a
    // session that would never send again, so the rejoined member stayed a black tile.
    //
    // So an upgrade RESETS the participant to a session that does not exist yet, tells the room, and
    // hangs up on whatever socket was there before. The new socket then publishes into a fresh
    // session and everybody re-subscribes by its id, which is the only sequence that actually
    // reconnects somebody. Read-modify-write under the gate, because two sockets arriving together
    // would otherwise both read the same predecessor and both try to retire it.
    const superseded = this.socketsFor(attachment.attendanceId, server);
    const previous = await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.put<StoredRoom>(ROOM_KEY, {
        firmId: attachment.firmId,
        meetingId: attachment.meetingId,
        medium: attachment.medium,
      });
      const existing = await this.readParticipant(attachment.attendanceId);
      await this.putParticipant(attachment.attendanceId, {
        userId: attachment.userId,
        displayName: attachment.displayName,
        sfuSessionId: null,
        tracks: [],
        // A socket is open again, so whatever grace was running for this stay is over. Left set, the
        // sweep would close the record of somebody who is sitting in the meeting.
        socketLostAt: null,
      });
      return existing;
    });

    // Told BEFORE anything else, so the displaced browser learns why rather than watching a socket
    // go quiet. Its close handler finds this newer socket and arms nothing.
    for (const older of superseded) this.refuseAndClose(older, "superseded");

    const roster = await this.roster();
    server.send(welcomeFrame(attachment.attendanceId, roster));
    // Everybody else learns there is a new tile to draw — and, on a rejoin, that the tracks they were
    // subscribed to are gone, which is what stops them holding a subscription to a session that will
    // never send again. The arriving socket already has the roster on its welcome, so it is not sent
    // the same list twice.
    this.broadcast(rosterFrame(roster), server);

    // Last, and best-effort: the predecessor's session is nobody's now, and the routing service goes
    // on forwarding and billing it until it is told otherwise.
    if (previous !== undefined) await this.releaseMedia([previous]);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
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
      this.refuseAndClose(socket, "not-a-participant");
      return;
    }

    if (parsed.frame.type === "leave") {
      await this.releaseParticipant(attachment.attendanceId);
      socket.close(NORMAL_CLOSE_CODE, "left the meeting");
      return;
    }

    const sfu = sfuClientForEnv(this.env);
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
      await this.handleSignalingFrame(socket, attachment, parsed.frame, sfu);
    } catch (caught) {
      if (caught instanceof SfuUnavailableError) {
        // Carries no word of what the routing service said: that text can name the application the
        // whole fleet's meetings run on (sfu-client.ts). What it does carry is the handle that joins
        // what this member saw to the redacted trace of what actually happened.
        socket.send(refusedFrame("sfu-unavailable", this.recordFailure("signaling", caught)));
        return;
      }
      throw caught;
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    // A fixed normal code rather than the peer's: 1005 and 1006 are reported to a close handler but
    // are not valid to send back.
    socket.close(NORMAL_CLOSE_CODE, "peer closed");
    const attachment = attachmentOf(socket);
    if (attachment === null) return;

    // A NEWER SOCKET HAS ALREADY TAKEN THIS STAY OVER — the supersede above, or a reconnect that
    // overlapped its predecessor. The member is sitting in the meeting on the other socket, so there
    // is nothing lost and nothing to time.
    if (this.socketExistsFor(attachment.attendanceId, socket)) return;

    // A socket closing under a participant the room has ALREADY let go of has nothing to time. Both
    // ways that happens are acts somebody took: the leave route closed the stay, or the host ended
    // the meeting and every stay with it.
    //
    // A DROPPED SOCKET STILL DOES NOT CLOSE ATTENDANCE — not immediately. The member is very likely
    // about to reconnect, and a stay closed here would either cut their record in half or be
    // reopened as a second arrival they never made. So what is written down is WHEN it went, on the
    // participant itself; the sweep an alarm runs a minute later is what decides. What is NOT
    // deferred is the question: before this, nothing asked it at all, and a closed laptop left a
    // stay open in the firm's record for as long as the record lasted.
    const timed = await this.ctx.blockConcurrencyWhile(async () => {
      const participant = await this.readParticipant(attachment.attendanceId);
      if (participant === undefined) return false;
      await this.putParticipant(attachment.attendanceId, {
        ...participant,
        socketLostAt: new Date().toISOString(),
      });
      return true;
    });
    if (timed) await this.armAlarm();
  }

  /**
   * The one alarm, doing whichever of its two jobs is due.
   *
   * Both are deadlines rather than schedules — a grace period after a connection dropped, and the
   * retirement of the ended marker — so they share one alarm and are told apart by the stored state
   * that armed them. A Durable Object has exactly one alarm, so a second job cannot have a second
   * one; what it can have is its own deadline in storage and a re-arm to the nearest one left.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    await this.sweepParticipantsPastTheirGrace(now);

    const purgeAt = await this.endedPurgeDeadline();
    if (purgeAt !== null && purgeAt <= now) await this.ctx.storage.delete(ENDED_KEY);

    // The re-arm is what makes one alarm serve several graces: whoever is still inside theirs when
    // this fires gets their own deadline set here.
    await this.armAlarm();
  }

  /**
   * The meeting is over — called by the end route AFTER the record has committed, so a participant
   * is never told the meeting ended by a write that then failed.
   *
   * Every socket is closed normally rather than left open with a final frame: there is nothing more
   * this room will ever say, and a browser holding an open socket to a finished meeting would keep
   * a connection alive waiting for it.
   */
  async end(endedAt: string): Promise<void> {
    this.broadcast(endedFrame(endedAt));

    // Read BEFORE the roster goes, because the media outlives it: the routing service is still
    // forwarding every track these sessions hold, and after the delete there is nothing left naming
    // them.
    const departing = await this.storedParticipants();

    // ONE GATE OVER BOTH WRITES. Between the delete and the put there is an instant where the room
    // holds neither a roster entry nor an ended marker, and a frame arriving in it is answered "the
    // room does not know who you are" — which tells a browser to RECONNECT, into a meeting that has
    // ended, forever. The gate is what makes the pair one transition.
    await this.ctx.blockConcurrencyWhile(async () => {
      // The roster goes; the instant stays. Nothing anybody said was ever in this object to delete —
      // the media is routed between browsers and never reaches it at all.
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.put(ENDED_KEY, endedAt);
    });
    // The marker is kept for a day and then retired, so an ended room does not hold a key for the
    // life of the deployment.
    await this.armAlarm();

    for (const socket of this.ctx.getWebSockets()) {
      socket.close(NORMAL_CLOSE_CODE, "meeting ended");
    }

    // Last, and best-effort: the record is already right, and a routing service that will not answer
    // must not be able to make it wrong.
    await this.releaseMedia(departing.map(([, participant]) => participant));
  }

  /**
   * One person's stay has been closed by the leave route. The roster entry goes and everybody else
   * is told; their socket is closed too, because the record now says they are not in the meeting and
   * a socket that outlived that would let them keep signaling into it.
   */
  async participantLeft(attendanceId: string): Promise<void> {
    await this.releaseParticipant(attendanceId);
    for (const socket of this.ctx.getWebSockets()) {
      if (attachmentOf(socket)?.attendanceId === attendanceId) {
        socket.close(NORMAL_CLOSE_CODE, "left the meeting");
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Frame handling
  // ---------------------------------------------------------------------------------------------

  private async handleSignalingFrame(
    socket: WebSocket,
    attachment: MeetingSocketAttachment,
    frame: Exclude<MeetingClientFrame, { type: "ping" } | { type: "leave" }>,
    sfu: SfuClient,
  ): Promise<void> {
    // EVERYTHING THE ROSTER CAN DECIDE IS DECIDED FIRST, before a routing session exists and before
    // anything is asked of the service. A frame the room will not act on must not cost a session at
    // the service, and — for a subscription — must not be forwarded even once: the service would
    // honour it, because it has no idea which meeting a session belongs to.
    const refusal = await this.refuseFrame(attachment.attendanceId, frame);
    if (refusal !== null) {
      socket.send(refusedFrame(refusal));
      return;
    }

    // Every signaling frame acts on this participant's routing-service session, so it is resolved
    // once here — and its absence is one answer rather than four.
    const outcome = await this.sessionFor(attachment.attendanceId, sfu);
    if (outcome.kind === "unavailable") {
      socket.send(
        refusedFrame("sfu-unavailable", this.recordFailure("create-session", outcome.caught)),
      );
      return;
    }
    if (outcome.kind === "absent") {
      // No roster entry, and the two ways that happens lead somewhere different: the meeting ended
      // under this socket, or this participant's stay was closed. A browser retries the second and
      // must not retry the first.
      const endedAt = await this.ctx.storage.get<string>(ENDED_KEY);
      this.refuseAndClose(socket, endedAt === undefined ? "not-a-participant" : "meeting-ended");
      return;
    }
    const sessionId = outcome.sessionId;

    if (frame.type === "publish") {
      const answer = await sfu.addTracks(sessionId, {
        sessionDescription: frame.sessionDescription,
        tracks: frame.tracks.map((track) => ({
          location: "local" as const,
          trackName: track.trackName,
          mid: track.mid,
          kind: track.kind,
        })),
      });
      // WHAT THE SERVICE CONFIRMED, which is not what the browser offered. A track the service
      // refused comes back carrying an error code, and recording it would put a tile on every other
      // participant's screen for media that is not being forwarded — each of them then subscribing
      // to something that will never arrive.
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
      // The roster is what tells everybody else there is something new to ask for.
      await this.recordPublishedTracks(attachment.attendanceId, confirmed);
      this.broadcast(rosterFrame(await this.roster()));
      return;
    }

    if (frame.type === "subscribe") {
      // No offer of our own: the browser is asking to RECEIVE, so the routing service is the side
      // with something to describe and its answer carries the offer the browser replies to.
      const answer = await sfu.addTracks(sessionId, {
        tracks: frame.tracks.map((track) => ({
          location: "remote" as const,
          sessionId: track.sessionId,
          trackName: track.trackName,
        })),
      });
      socket.send(
        subscribedFrame(
          answer.sessionDescription,
          answer.tracks.flatMap((track) =>
            track.sessionId === undefined ||
            track.trackName === undefined ||
            track.mid === undefined
              ? []
              : [{ sessionId: track.sessionId, trackName: track.trackName, mid: track.mid }],
          ),
          answer.requiresImmediateRenegotiation,
        ),
      );
      return;
    }

    if (frame.type === "renegotiate") {
      await sfu.renegotiate(sessionId, { sessionDescription: frame.sessionDescription });
      socket.send(renegotiatedFrame());
      return;
    }

    const closed = await sfu.closeTracks(sessionId, {
      tracks: frame.mids.map((mid) => ({ mid })),
    });
    socket.send(closedFrame(closed.sessionDescription));
    // A TRACK THAT STOPPED LEAVES THE ROSTER. Without this, a member who stopped sharing their
    // screen went on offering it to everybody who joined afterwards — each of them subscribing to a
    // track the service no longer forwards, and seeing a black tile they cannot get rid of.
    //
    // The service's own answer is what says which sections actually closed; an answer that names
    // none is not a statement that nothing did, so the requested set stands in for it.
    const confirmedMids = closed.tracks.flatMap((track) =>
      track.errorCode !== undefined || track.mid === undefined ? [] : [track.mid],
    );
    await this.forgetTracks(
      attachment.attendanceId,
      new Set(closed.tracks.length === 0 ? frame.mids : confirmedMids),
    );
  }

  /**
   * Why this room will not act on this frame, or null.
   *
   * Everything here is answerable from the roster alone, which is what lets it run before a routing
   * session exists.
   */
  private async refuseFrame(
    attendanceId: string,
    frame: Exclude<MeetingClientFrame, { type: "ping" } | { type: "leave" }>,
  ): Promise<MeetingRefusalReason | null> {
    if (frame.type === "publish") {
      // A CALL IS SOUND, AND THE ROOM IS WHERE THAT HOLDS. The medium is chosen when the meeting is
      // started and never changed, so the people who joined a call agreed to sound — a modified
      // client publishing a camera into one would turn it into a video meeting for all of them, on
      // one person's decision. Read off the room rather than the frame's own socket, so a socket
      // that arrived with the wrong label cannot widen it.
      const room = await this.ctx.storage.get<StoredRoom>(ROOM_KEY);
      if (room?.medium === "audio" && frame.tracks.some((track) => isPicture(track.kind))) {
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
      const participant = await this.readParticipant(attendanceId);
      // Counted over the UNION with what is already held, because republishing a track under the
      // same name replaces it rather than adding one — a camera switched off and on must not spend
      // a seat.
      const names = new Set(participant?.tracks.map((track) => track.trackName) ?? []);
      for (const track of frame.tracks) names.add(track.trackName);
      return names.size > MAX_TRACKS_PER_PARTICIPANT ? "track-limit-reached" : null;
    }

    if (frame.type !== "subscribe") return null;

    // THE ROSTER IS THE WHOLE OF WHAT MAY BE ASKED FOR. The routing service takes any session handle
    // from any caller holding this application's credential — it has no notion of a meeting — so a
    // pair that is not on THIS room's roster is either a browser working from a roster that has
    // moved on, or an attempt to pull somebody else's meeting into this one. Both are refused the
    // same way, and the whole frame is refused rather than the offending pair: a browser that got
    // some of what it asked for and no word about the rest has no way to tell which tile is
    // missing.
    const stored = await this.storedParticipants();
    const publishedTracks = new Map<string, Set<string>>();
    for (const [, participant] of stored) {
      if (participant.sfuSessionId === null) continue;
      publishedTracks.set(
        participant.sfuSessionId,
        new Set(participant.tracks.map((track) => track.trackName)),
      );
    }
    const ownSession = (await this.readParticipant(attendanceId))?.sfuSessionId;
    for (const track of frame.tracks) {
      // Subscribing to one's own session is not a leak and is still refused: the browser already has
      // that media, the service answers it with a loop, and the only thing it can produce is echo.
      if (ownSession !== null && ownSession !== undefined && track.sessionId === ownSession) {
        return "unknown-track";
      }
      if (publishedTracks.get(track.sessionId)?.has(track.trackName) !== true) {
        return "unknown-track";
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // The roster, in storage
  // ---------------------------------------------------------------------------------------------

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
  private async sessionFor(attendanceId: string, sfu: SfuClient): Promise<SessionOutcome> {
    return await this.ctx.blockConcurrencyWhile(async (): Promise<SessionOutcome> => {
      // `absent` rather than a throw: no roster entry means the room has already removed this
      // participant — they left, or the meeting ended under them — and that is a state the caller
      // reports as such, not an outage of the routing service.
      const participant = await this.readParticipant(attendanceId);
      if (participant === undefined) return { kind: "absent" };
      if (participant.sfuSessionId !== null) {
        return { kind: "session", sessionId: participant.sfuSessionId };
      }
      try {
        const { sessionId } = await sfu.createSession();
        await this.putParticipant(attendanceId, { ...participant, sfuSessionId: sessionId });
        return { kind: "session", sessionId };
      } catch (caught) {
        return { kind: "unavailable", caught };
      }
    });
  }

  // Merges by track name rather than appending: a browser that republishes a track it already has —
  // a camera switched off and on — is offering the same track again, not a second one, and a roster
  // listing it twice makes every other browser subscribe to it twice.
  private async recordPublishedTracks(
    attendanceId: string,
    tracks: readonly StoredTrack[],
  ): Promise<void> {
    if (tracks.length === 0) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      const participant = await this.readParticipant(attendanceId);
      if (participant === undefined) return;
      const merged = new Map(participant.tracks.map((track) => [track.trackName, track]));
      for (const track of tracks) merged.set(track.trackName, track);
      await this.putParticipant(attendanceId, { ...participant, tracks: [...merged.values()] });
    });
  }

  /** Drops the tracks whose media sections have stopped, and tells the room if any had. */
  private async forgetTracks(attendanceId: string, mids: ReadonlySet<string>): Promise<void> {
    const changed = await this.ctx.blockConcurrencyWhile(async () => {
      const participant = await this.readParticipant(attendanceId);
      if (participant === undefined) return false;
      const kept = participant.tracks.filter((track) => track.mid === null || !mids.has(track.mid));
      if (kept.length === participant.tracks.length) return false;
      await this.putParticipant(attendanceId, { ...participant, tracks: kept });
      return true;
    });
    if (changed) this.broadcast(rosterFrame(await this.roster()));
  }

  private async readParticipant(attendanceId: string): Promise<StoredParticipant | undefined> {
    return await this.ctx.storage.get<StoredParticipant>(`${PARTICIPANT_PREFIX}${attendanceId}`);
  }

  private async putParticipant(
    attendanceId: string,
    participant: StoredParticipant,
  ): Promise<void> {
    await this.ctx.storage.put(`${PARTICIPANT_PREFIX}${attendanceId}`, participant);
  }

  /** Every roster entry, paired with the stay it belongs to. */
  private async storedParticipants(): Promise<[string, StoredParticipant][]> {
    const stored = await this.ctx.storage.list<StoredParticipant>({ prefix: PARTICIPANT_PREFIX });
    return [...stored].map(([key, participant]) => [
      key.slice(PARTICIPANT_PREFIX.length),
      participant,
    ]);
  }

  // A participant the room is letting go of on purpose — they pressed Leave, or the route closed
  // their stay. The roster entry goes, everybody is told, and the media they were publishing is
  // stopped: the record already says they are not in the meeting, and forwarding that outlived it
  // would be billed against a stay that has ended.
  //
  // The broadcast rides on whether a roster entry was ACTUALLY removed. A socket closing under a
  // meeting that has already ended finds nothing to remove, and announcing an unchanged roster there
  // would send a roster frame after the `ended` frame — telling a browser who is in a room that is
  // over.
  private async releaseParticipant(attendanceId: string): Promise<void> {
    const participant = await this.readParticipant(attendanceId);
    const removed = await this.ctx.storage.delete(`${PARTICIPANT_PREFIX}${attendanceId}`);
    if (!removed) return;
    this.broadcast(rosterFrame(await this.roster()));
    if (participant !== undefined) await this.releaseMedia([participant]);
  }

  private async roster(): Promise<RosterParticipant[]> {
    return (await this.storedParticipants()).map(([participantId, participant]) => ({
      participantId,
      userId: participant.userId,
      displayName: participant.displayName,
      sfuSessionId: participant.sfuSessionId,
      // The media section is the room's own handle for closing a track and is deliberately not on
      // the wire: a subscriber names a track by its publisher's session and its name, so a section
      // number would be a field every browser could read and none could use.
      tracks: participant.tracks.map((track) => ({
        trackName: track.trackName,
        kind: track.kind,
      })),
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // The grace sweep, and the media that outlives a browser
  // ---------------------------------------------------------------------------------------------

  /** Every socket carrying this stay, other than the one that is asking. */
  private socketsFor(attendanceId: string, except?: WebSocket): WebSocket[] {
    const found: WebSocket[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      if (attachmentOf(socket)?.attendanceId === attendanceId) found.push(socket);
    }
    return found;
  }

  /** True when some OTHER socket is still carrying this stay. */
  private socketExistsFor(attendanceId: string, except?: WebSocket): boolean {
    return this.socketsFor(attendanceId, except).length > 0;
  }

  /** When this participant's grace runs out, or null while they are connected. */
  private graceDeadlineOf(attendanceId: string, participant: StoredParticipant): number | null {
    if (participant.socketLostAt === null) return null;
    if (this.socketExistsFor(attendanceId)) return null;
    const lostAt = Date.parse(participant.socketLostAt);
    return Number.isNaN(lostAt) ? null : lostAt + SOCKET_LOSS_GRACE_SECONDS * 1000;
  }

  /** The soonest grace still running in this room, or null when nobody is inside one. */
  private async nextGraceDeadline(): Promise<number | null> {
    let nearest: number | null = null;
    for (const [attendanceId, participant] of await this.storedParticipants()) {
      const deadline = this.graceDeadlineOf(attendanceId, participant);
      if (deadline !== null && (nearest === null || deadline < nearest)) nearest = deadline;
    }
    return nearest;
  }

  /** When the ended marker should be retired, or null when there is none. */
  private async endedPurgeDeadline(): Promise<number | null> {
    const endedAt = await this.ctx.storage.get<string>(ENDED_KEY);
    if (endedAt === undefined) return null;
    const ended = Date.parse(endedAt);
    return Number.isNaN(ended) ? null : ended + ENDED_RETENTION_HOURS * 60 * 60 * 1000;
  }

  // One alarm, set to the nearest deadline the room is holding. Never pushed later: an alarm already
  // due sooner is doing a job this one would delay.
  private async armAlarm(): Promise<void> {
    const deadlines: number[] = [];
    const graceAt = await this.nextGraceDeadline();
    if (graceAt !== null) deadlines.push(graceAt);
    const purgeAt = await this.endedPurgeDeadline();
    if (purgeAt !== null) deadlines.push(purgeAt);
    if (deadlines.length === 0) return;

    const nearest = Math.min(...deadlines);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > nearest) await this.ctx.storage.setAlarm(nearest);
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
  private async sweepParticipantsPastTheirGrace(now: number): Promise<void> {
    const stored = await this.storedParticipants();
    const lost = stored.filter(([attendanceId, participant]) => {
      const deadline = this.graceDeadlineOf(attendanceId, participant);
      return deadline !== null && deadline <= now;
    });
    if (lost.length === 0) return;

    // THE RECORD FIRST, then the roster, then the media. The record is the only durable one of the
    // three, so it is written while there is still something naming who it is about; the media is
    // last because a routing service that will not answer must not leave a stay open.
    for (const [attendanceId] of lost) await this.closeStay(attendanceId);
    for (const [attendanceId] of lost) {
      await this.ctx.storage.delete(`${PARTICIPANT_PREFIX}${attendanceId}`);
    }
    this.broadcast(rosterFrame(await this.roster()));
    await this.releaseMedia(lost.map(([, participant]) => participant));
  }

  /** Closes one stay in the firm's own record, through the firm-scoped data-access layer. */
  private async closeStay(attendanceId: string): Promise<void> {
    const room = await this.ctx.storage.get<StoredRoom>(ROOM_KEY);
    if (room === undefined) return;
    try {
      const database = firmDatabaseFor(this.env.FIRM_DATABASE, room.firmId);
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
      this.recordFailure("close-attendance", caught);
    }
  }

  /**
   * Stops the routing service forwarding what these participants were publishing.
   *
   * BEST EFFORT, ALWAYS, AND NEVER BLOCKING THE RECORD. What is being cleaned up is a cost and a
   * subscription target, not a fact anybody is owed: a failure here means the service keeps
   * forwarding for a while, which is money, where a failure that propagated would mean a stay left
   * open in a firm's record of a gathering, which is the record being wrong.
   */
  private async releaseMedia(participants: readonly StoredParticipant[]): Promise<void> {
    const sessions = participants.filter((participant) => participant.sfuSessionId !== null);
    if (sessions.length === 0) return;
    const sfu = sfuClientForEnv(this.env);
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
        this.recordFailure("close-tracks", caught);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------------

  private broadcast(payload: string, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(payload);
      } catch {
        // A socket that went away between the list and the send is exactly the case a roster
        // broadcast exists to announce, so failing the whole broadcast over it would stop everybody
        // else learning. The close handler removes it from the roster on its own.
      }
    }
  }

  private refuseAndClose(socket: WebSocket, reason: MeetingRefusalReason): void {
    // The reason goes out BEFORE the close, so a browser always learns why rather than inferring it
    // from a code. The code is from the private-use range, the only range an application may define.
    socket.send(refusedFrame(reason));
    socket.close(UNSERVICEABLE_CLOSE_CODE, "reconnect required");
  }

  // One failure, through the standard pipeline, answering with the handle a member is shown. The
  // logger is built per call because class properties do not survive hibernation.
  private recordFailure(operation: string, caught: unknown): string {
    return recordRealtimeFailure(realtimeLoggerFor(this.env), `meetings.room.${operation}`, caught);
  }
}
