import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../app.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";
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
// Hibernating WebSockets, on the assistant's push-object pattern: the runtime owns the server end,
// so the room can be evicted while every socket stays open and is re-constructed when a frame
// arrives. An idle meeting therefore bills nothing while people sit in it. The consequence is the
// rule the whole file obeys — NOTHING about a participant may live on the instance, because class
// properties do not survive hibernation. Everything a frame needs rides on the per-socket
// attachment, which does, and everything the ROOM needs is read back out of storage.
//
// THE RECORD IS NOT KEPT HERE. Who was in the meeting and when is attendance in the firm's own
// database, written by the routes through the firm-scoped data-access layer. This object's roster is
// a view of who is connected right now, which is a different question and a shorter-lived one.

const PARTICIPANT_PREFIX = "participant:";

// The instant the meeting closed, and the ONE thing this object keeps after it. It is what lets a
// frame arriving on a socket that had not yet noticed be answered with the truth — the meeting is
// over — rather than with "the room does not know who you are", which is what a bare missing roster
// entry would otherwise say and would send a browser reconnecting forever.
const ENDED_KEY = "ended";

/** The subscription context, established at upgrade and carried for the life of the socket. */
export interface MeetingSocketAttachment {
  readonly protocolVersion: number;
  readonly firmId: string;
  readonly meetingId: string;
  readonly userId: string;
  readonly attendanceId: string;
  readonly displayName: string;
}

/** One connected participant, as the room holds them between frames. */
interface StoredParticipant {
  readonly userId: string;
  readonly displayName: string;
  // The routing-service session this browser publishes through. Null until its first publish: a
  // session costs nothing to have and something to make, and somebody who joined to listen may never
  // make one.
  sfuSessionId: string | null;
  tracks: { trackName: string; kind: string }[];
}

const FIRM_PARAMETER = "firm";
const MEETING_PARAMETER = "meeting";
const USER_PARAMETER = "user";
const ATTENDANCE_PARAMETER = "attendance";
const DISPLAY_NAME_PARAMETER = "displayName";

/** The internal URL the upgrade is addressed to. Exported so a test can build the same request. */
export function meetingSocketRequestUrl(attachment: {
  readonly firmId: string;
  readonly meetingId: string;
  readonly userId: string;
  readonly attendanceId: string;
  readonly displayName: string;
}): string {
  const parameters = new URLSearchParams({
    [FIRM_PARAMETER]: attachment.firmId,
    [MEETING_PARAMETER]: attachment.meetingId,
    [USER_PARAMETER]: attachment.userId,
    [ATTENDANCE_PARAMETER]: attachment.attendanceId,
    [DISPLAY_NAME_PARAMETER]: attachment.displayName,
  });
  return `https://meeting-room.invalid/socket?${parameters.toString()}`;
}

/**
 * The whole request the route sends inward — built from scratch rather than by re-wrapping the
 * caller's, so no cookie and no caller-supplied header travels on to the object. Every value on it
 * is server-derived: the firm from the session, the meeting after the caller was authorized against
 * it, and the attendance and the name from the firm's own rows.
 */
export function meetingSocketRequest(attachment: {
  readonly firmId: string;
  readonly meetingId: string;
  readonly userId: string;
  readonly attendanceId: string;
  readonly displayName: string;
}): Request {
  return new Request(meetingSocketRequestUrl(attachment), { headers: { Upgrade: "websocket" } });
}

function attachmentFromRequest(request: Request): MeetingSocketAttachment | null {
  const parameters = new URL(request.url).searchParams;
  const firmId = parameters.get(FIRM_PARAMETER);
  const meetingId = parameters.get(MEETING_PARAMETER);
  const userId = parameters.get(USER_PARAMETER);
  const attendanceId = parameters.get(ATTENDANCE_PARAMETER);
  const displayName = parameters.get(DISPLAY_NAME_PARAMETER);
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

    await this.putParticipant(attachment.attendanceId, {
      userId: attachment.userId,
      displayName: attachment.displayName,
      sfuSessionId: null,
      tracks: [],
    });

    const roster = await this.roster();
    server.send(welcomeFrame(attachment.attendanceId, roster));
    // Everybody else learns there is a new tile to draw. The arriving socket already has the roster
    // on its welcome, so it is not sent the same list twice.
    this.broadcast(rosterFrame(roster), server);
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
      await this.removeParticipant(attachment.attendanceId);
      socket.close(NORMAL_CLOSE_CODE, "left the meeting");
      return;
    }

    const sfu = sfuClientForEnv(this.env);
    if (sfu === null) {
      // The upgrade route refuses before a socket exists when meetings are unconfigured, so this is
      // reachable only if the credentials went away under an open meeting. Said plainly rather than
      // left to a timeout inside the browser's connection.
      socket.send(refusedFrame("sfu-unavailable"));
      return;
    }

    try {
      await this.handleSignalingFrame(socket, attachment, parsed.frame, sfu);
    } catch (caught) {
      if (caught instanceof SfuUnavailableError) {
        // Carries no word of what the routing service said: that text can name the application the
        // whole fleet's meetings run on (sfu-client.ts).
        socket.send(refusedFrame("sfu-unavailable"));
        return;
      }
      throw caught;
    }
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = attachmentOf(socket);
    // A DROPPED SOCKET DOES NOT CLOSE ATTENDANCE. The record of who was in the room is closed by the
    // leave route when somebody leaves, and by the host ending the meeting — both of which are acts
    // somebody took. A connection that died in a tunnel is not one: the member is very likely about
    // to reconnect, and a stay closed here would either cut their record in half or, worse, be
    // reopened as a second arrival they never made. What this removes is the roster entry, which is
    // about who is connected right now and is exactly the question a dropped socket answers.
    if (attachment !== null) await this.removeParticipant(attachment.attendanceId);
    // A fixed normal code rather than the peer's: 1005 and 1006 are reported to a close handler but
    // are not valid to send back.
    socket.close(NORMAL_CLOSE_CODE, "peer closed");
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
    // The roster goes; the instant stays. Nothing anybody said was ever in this object to delete —
    // the media is routed between browsers and never reaches it at all.
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put(ENDED_KEY, endedAt);
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(NORMAL_CLOSE_CODE, "meeting ended");
    }
  }

  /**
   * One person's stay has been closed by the leave route. The roster entry goes and everybody else
   * is told; their socket is closed too, because the record now says they are not in the meeting and
   * a socket that outlived that would let them keep signaling into it.
   */
  async participantLeft(attendanceId: string): Promise<void> {
    await this.removeParticipant(attendanceId);
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
    // Every signaling frame acts on this participant's routing-service session, so it is resolved
    // once here — and its absence is one answer rather than four.
    const sessionId = await this.sessionFor(attachment.attendanceId, sfu);
    if (sessionId === null) {
      // No roster entry, and the two ways that happens lead somewhere different: the meeting ended
      // under this socket, or this participant's stay was closed. A browser retries the second and
      // must not retry the first.
      const endedAt = await this.ctx.storage.get<string>(ENDED_KEY);
      this.refuseAndClose(socket, endedAt === undefined ? "not-a-participant" : "meeting-ended");
      return;
    }

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
      socket.send(
        publishedFrame(
          answer.sessionDescription,
          answer.tracks.flatMap((track) =>
            track.trackName === undefined || track.mid === undefined
              ? []
              : [{ trackName: track.trackName, mid: track.mid }],
          ),
        ),
      );
      // The roster is what tells everybody else there is something new to ask for, so it is updated
      // from what the service CONFIRMED rather than from what the browser offered.
      await this.recordPublishedTracks(
        attachment.attendanceId,
        frame.tracks.map((track) => ({ trackName: track.trackName, kind: track.kind })),
      );
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
   */
  private async sessionFor(attendanceId: string, sfu: SfuClient): Promise<string | null> {
    return await this.ctx.blockConcurrencyWhile(async () => {
      // Null rather than a throw: no roster entry means the room has already removed this
      // participant — they left, or the meeting ended under them — and that is a state the caller
      // reports as such, not an outage of the routing service.
      const participant = await this.readParticipant(attendanceId);
      if (participant === undefined) return null;
      if (participant.sfuSessionId !== null) return participant.sfuSessionId;
      const { sessionId } = await sfu.createSession();
      await this.putParticipant(attendanceId, { ...participant, sfuSessionId: sessionId });
      return sessionId;
    });
  }

  // Merges by track name rather than appending: a browser that republishes a track it already has —
  // a camera switched off and on — is offering the same track again, not a second one, and a roster
  // listing it twice makes every other browser subscribe to it twice.
  private async recordPublishedTracks(
    attendanceId: string,
    tracks: readonly { readonly trackName: string; readonly kind: string }[],
  ): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const participant = await this.readParticipant(attendanceId);
      if (participant === undefined) return;
      const merged = new Map(participant.tracks.map((track) => [track.trackName, track]));
      for (const track of tracks) merged.set(track.trackName, { ...track });
      await this.putParticipant(attendanceId, { ...participant, tracks: [...merged.values()] });
    });
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

  // The broadcast rides on whether a roster entry was ACTUALLY removed. A socket closing under a
  // meeting that has already ended finds nothing to remove, and announcing an unchanged roster there
  // would send a roster frame after the `ended` frame — telling a browser who is in a room that is
  // over.
  private async removeParticipant(attendanceId: string): Promise<void> {
    const removed = await this.ctx.storage.delete(`${PARTICIPANT_PREFIX}${attendanceId}`);
    if (removed) this.broadcast(rosterFrame(await this.roster()));
  }

  private async roster(): Promise<RosterParticipant[]> {
    const stored = await this.ctx.storage.list<StoredParticipant>({ prefix: PARTICIPANT_PREFIX });
    return [...stored].map(([key, participant]) => ({
      participantId: key.slice(PARTICIPANT_PREFIX.length),
      userId: participant.userId,
      displayName: participant.displayName,
      sfuSessionId: participant.sfuSessionId,
      tracks: participant.tracks,
    }));
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
}
