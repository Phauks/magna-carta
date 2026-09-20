import { DurableObject } from "cloudflare:workers";
import {
  MEETING_PROTOCOL_VERSION,
  NORMAL_CLOSE_CODE,
  PING_FRAME,
  PONG_FRAME,
} from "@magna-carta/meeting-protocol/frames";
import { isMeetingMedium } from "@magna-carta/meetings/types";
import type { Bindings } from "../app.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";
import { dispatchClientFrame } from "./room/room-frames.ts";
import {
  admitParticipant,
  endMeeting,
  noteSocketLost,
  participantLeft,
  runAlarm,
  SOCKET_LOSS_GRACE_SECONDS,
} from "./room/room-lifecycle.ts";
import type { MeetingSocketAttachment, RoomContext } from "./room/room-state.ts";

// One meeting's signaling room, keyed `${firmId}:${meetingId}` and addressed by the SESSION firm id
// at the route — never by a path value, so a firm can no more signal into another firm's meeting
// than it can read one.
//
// THIS FILE IS AN ORCHESTRATOR AND NOTHING ELSE. Every concern the room has lives in its own module
// under room/ — what storage holds and what a socket carries (room-state), who is in the room
// (room-roster), who is talking (room-presence), the routing-service session and the tracks on it
// (room-media), arriving, dropping and ending (room-lifecycle), and what one frame means
// (room-frames). Each takes the object's context explicitly, so each is testable without the
// runtime; the class below is the wiring and the door the routes knock on.
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
// object does, and that is the entire reason a subscription is checked against the roster in
// room-frames.ts rather than forwarded. A pair this room cannot find is refused, never asked about.
//
// Hibernating WebSockets, on the assistant's push-object pattern: the runtime owns the server end,
// so the room can be evicted while every socket stays open and is re-constructed when a frame
// arrives. An idle meeting therefore bills nothing while people sit in it. The consequence is the
// rule every module here obeys — NOTHING about a participant may live on the instance, because class
// properties do not survive hibernation. Everything a frame needs rides on the per-socket
// attachment, which does, and everything the ROOM needs is read back out of storage.
//
// THE RECORD IS NOT KEPT HERE, but the room is what closes it when nobody else will. Who was in the
// meeting and when is attendance in the firm's own database, written by the routes through the
// firm-scoped data-access layer. This object's roster is a view of who is connected right now, which
// is a different question and a shorter-lived one — and when a browser simply goes away, the grace
// sweep in room-lifecycle.ts is the only thing that ever turns that into an ending in the record.

export { SOCKET_LOSS_GRACE_SECONDS };
export type { MeetingSocketAttachment };

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

export class MeetingRoom extends DurableObject<Bindings> {
  /**
   * What every room module is given. Built per call rather than held as a field, for the same
   * reason nothing else is held: class properties do not survive hibernation, and a two-field
   * object costs nothing to make.
   */
  private get room(): RoomContext {
    return { ctx: this.ctx, env: this.env };
  }

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

    await admitParticipant(this.room, attachment, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await dispatchClientFrame(this.room, socket, message);
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    // A fixed normal code rather than the peer's: 1005 and 1006 are reported to a close handler but
    // are not valid to send back.
    socket.close(NORMAL_CLOSE_CODE, "peer closed");
    await noteSocketLost(this.room, socket);
  }

  override async alarm(): Promise<void> {
    await runAlarm(this.room);
  }

  /** The meeting is over — called by the end route AFTER the record has committed. */
  async end(endedAt: string): Promise<void> {
    await endMeeting(this.room, endedAt);
  }

  /** One person's stay has been closed by the leave route. */
  async participantLeft(attendanceId: string): Promise<void> {
    await participantLeft(this.room, attendanceId);
  }
}
