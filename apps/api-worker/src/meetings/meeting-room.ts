import { DurableObject } from "cloudflare:workers";
import {
  MEETING_PROTOCOL_VERSION,
  NORMAL_CLOSE_CODE,
  PING_FRAME,
  PONG_FRAME,
} from "@magna-carta/meeting-protocol/frames";
import type {
  MeetingChatMessage,
  MeetingHostRole,
  MeetingLobbyMode,
  MeetingPollOptionCount,
  MeetingPollSnapshot,
  MeetingQuestionSnapshot,
} from "@magna-carta/meeting-protocol/types";
import { isMeetingMedium } from "@magna-carta/meetings/types";
import type { Bindings } from "../app.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";
import { relayMessage, relayMessageRedaction } from "./room/room-chat.ts";
import { dispatchClientFrame } from "./room/room-frames.ts";
import {
  relayPollAnswered,
  relayPollClosed,
  relayPollOpened,
  relayQuestionAsked,
  relayQuestionUpdated,
  relayQuestionUpvoted,
} from "./room/room-polls.ts";
import { inspectRoom, type MeetingRoomInspection } from "./room/room-inspect.ts";
import {
  guestCredentialReplaced,
  hostingChanged,
  participantRemoved,
  roomStateChanged,
} from "./room/room-hosting.ts";
import {
  admitToLobby,
  lobbyChanged,
  participantsAdmitted,
  participantsDenied,
} from "./room/room-lobby.ts";
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
const HOST_ROLE_PARAMETER = "hostRole";
const LOCKED_PARAMETER = "locked";
const LOBBY_PARAMETER = "lobby";
const WAITING_PARAMETER = "waiting";
const WAITING_FROM_PARAMETER = "waitingFrom";
const KIND_PARAMETER = "kind";
const INVITED_NAME_PARAMETER = "invitedName";

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
    // Both read off the meeting record by the route. The role SEEDS the room's stored participant
    // and is never the authority for a frame — see `hostRole` on `StoredParticipant` — and the lock
    // is the room's copy of the door so a welcome can say what is true without a database read.
    [HOST_ROLE_PARAMETER]: attachment.hostRole ?? "",
    [LOCKED_PARAMETER]: attachment.locked === true ? "true" : "false",
    [LOBBY_PARAMETER]: attachment.lobby ?? "off",
    // Derived by the route off the stay it just authorized the upgrade against — the row says
    // whether this person is at the door or in the room, and a browser never gets to name it.
    [WAITING_PARAMETER]: attachment.waiting === true ? "true" : "false",
    // Off the stay, so the room never stamps a second instant for a fact the record already holds.
    [WAITING_FROM_PARAMETER]: attachment.waitingFrom ?? "",
    // WHICH KIND OF STAY THIS SOCKET HOLDS, decided by the route that authorized it — the guest
    // route for a guest, every member route for a member — and never named by the browser. It is
    // what the room redacts every roster frame by, so it must not be a thing a caller can choose.
    [KIND_PARAMETER]: attachment.participantKind ?? "member",
    // A guest's Directory name at mint, which the hosts read beside the name typed at the door.
    [INVITED_NAME_PARAMETER]: attachment.invitedName ?? "",
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
  const hostRole = parameters.get(HOST_ROLE_PARAMETER);
  // A value this build does not recognise reads as a MEMBER only where a user id came with it; a
  // socket naming neither kind of person is refused below rather than guessed at.
  const participantKind = parameters.get(KIND_PARAMETER) === "guest" ? "guest" : "member";
  if (
    firmId === null ||
    firmId === "" ||
    meetingId === null ||
    meetingId === "" ||
    userId === null ||
    // A GUEST HAS NO USER ID, and that is the one socket that may arrive without one. A member's
    // socket without one is a socket the room cannot say who it belongs to.
    (userId === "" && participantKind === "member") ||
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
    // A value this build does not recognise, or none at all, reads as NOBODY — the safe direction
    // for an authority seed, and what a socket opened by an older build carries.
    hostRole: hostRole === "host" || hostRole === "co-host" ? hostRole : null,
    locked: parameters.get(LOCKED_PARAMETER) === "true",
    // A value this build does not recognise, or none at all, reads as `off` — the state every room
    // was in before the door existed, and the safe direction: a lobby the room forgot about would
    // put nobody at a door, where a door invented out of a bad label would strand the meeting.
    lobby: parameters.get(LOBBY_PARAMETER) === "on" ? "on" : "off",
    // And an unreadable one reads as NOT waiting, which is what every socket opened before the door
    // existed was. The route derives it from the stay, so the only way to reach this default is a
    // socket from an older build.
    waiting: parameters.get(WAITING_PARAMETER) === "true",
    // Absent on a socket from a build that predated the door; `admitToLobby` then falls back to the
    // instant it is reading this at, which is the closest thing it can know.
    waitingFrom: parameters.get(WAITING_FROM_PARAMETER) ?? "",
    participantKind,
    // A guest's only; a member carries none.
    ...(participantKind === "guest"
      ? { invitedName: parameters.get(INVITED_NAME_PARAMETER) ?? "" }
      : {}),
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

    // THE TWO STATES A SOCKET MAY BE ADMITTED INTO. A stay that is at the door goes to the LOBBY:
    // stored under `waiting:` where no roster can reach it, sent `lobby` rather than `welcome`, and
    // refused every signaling frame until a host lets it in.
    if (attachment.waiting === true) await admitToLobby(this.room, attachment, server);
    else await admitParticipant(this.room, attachment, server);
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

  /**
   * The grants on this meeting have changed — the hosting route calls this AFTER its own write
   * commits, on the `participantLeft` / `end` precedent.
   *
   * The room rewrites the role on each stored participant and broadcasts the roster change, which is
   * what makes a withdrawn co-host stop being able to mute people on their NEXT frame rather than
   * whenever their socket happens to close.
   */
  async hostingChanged(
    grants: readonly { readonly userId: string; readonly role: MeetingHostRole }[],
  ): Promise<void> {
    await hostingChanged(this.room, grants);
  }

  /** A host removed somebody: the roster, the media and their socket all go. */
  async participantRemoved(attendanceId: string): Promise<void> {
    await participantRemoved(this.room, attendanceId);
  }

  /**
   * A guest's link was ROTATED, and every socket holding their stay was opened on the old one.
   *
   * Called by the rotation route after its write commits. The grant that socket's upgrade carried no
   * longer verifies, and a socket is authorized once, at upgrade — so without this a guest the firm
   * believes it has cut off would go on working for as long as their socket stayed open. The socket
   * is refused `superseded` and closed; the stay is left to the ordinary grace, so the person the
   * fresh mail reached can arrive on the new link and take their own place back.
   */
  async guestCredentialReplaced(
    stayId: string,
    reason: "superseded" | "withdrawn" = "superseded",
  ): Promise<void> {
    await guestCredentialReplaced(this.room, stayId, reason);
  }

  /**
   * SOMEBODY SAID SOMETHING — called by the chat route AFTER its own write commits, on the
   * `participantLeft` / `end` precedent and for the same reason: nobody is shown a message by a
   * write that then failed.
   *
   * THE ROOM STORES NOTHING ABOUT IT. The transcript is rows in the firm's own database and this is
   * a relay of one that has already committed, so a browser reaches it as it is said rather than on
   * a poller's next tick — and a browser that misses one is caught up by the read. A room nobody
   * holds a socket on is a no-op.
   */
  async messageSent(message: MeetingChatMessage): Promise<void> {
    await relayMessage(this.room, message);
  }

  /** A message was taken back: every browser blanks the copy it is holding. */
  async messageRedacted(messageId: string, redactedAt: string): Promise<void> {
    await relayMessageRedaction(this.room, messageId, redactedAt);
  }

  // THE POLL AND THE QUESTION QUEUE — six relays, each called by a route AFTER its own write
  // commits, on the chat's precedent: the route is the record, and the room stores nothing about a
  // poll or a question beyond the second's tally it is about to send. The work is
  // room/room-polls.ts; the two tallies go through the shared per-second bucket.

  /** A host asked the room: the poll whole, to every welcomed socket. */
  async pollOpened(poll: MeetingPollSnapshot): Promise<void> {
    await relayPollOpened(this.room, poll);
  }

  /** A host closed a poll: the instant and the final tally. */
  async pollClosed(
    pollId: string,
    closedAt: string,
    tally: {
      readonly counts: readonly MeetingPollOptionCount[];
      readonly respondents: number;
    },
  ): Promise<void> {
    await relayPollClosed(this.room, pollId, closedAt, tally.counts, tally.respondents);
  }

  /** Somebody answered: the tally the route read afterwards, coalesced to one frame a second. */
  async pollAnswered(
    pollId: string,
    tally: {
      readonly counts: readonly MeetingPollOptionCount[];
      readonly respondents: number;
      readonly readAt: string;
    },
  ): Promise<void> {
    await relayPollAnswered(this.room, pollId, tally, Date.now());
  }

  /** Somebody put a question to the room: the question whole. */
  async questionAsked(question: MeetingQuestionSnapshot): Promise<void> {
    await relayQuestionAsked(this.room, question);
  }

  /** A question was marked answered, unmarked or taken back: its new state whole. */
  async questionUpdated(question: MeetingQuestionSnapshot): Promise<void> {
    await relayQuestionUpdated(this.room, question);
  }

  /** An upvote was cast or withdrawn: the count the route read, coalesced to one frame a second. */
  async questionUpvoted(questionId: string, upvotes: number, readAt: string): Promise<void> {
    await relayQuestionUpvoted(this.room, questionId, { upvotes, readAt }, Date.now());
  }

  /** The door moved. */
  async roomStateChanged(locked: boolean): Promise<void> {
    await roomStateChanged(this.room, locked);
  }

  /**
   * A host let these stays in — called by the admissions route AFTER its own write commits.
   *
   * Each record moves from `waiting:` to `participant:`, their socket gets `admitted` and then the
   * ordinary `welcome`, and the room learns of a roster join.
   */
  async participantsAdmitted(attendanceIds: readonly string[]): Promise<void> {
    await participantsAdmitted(this.room, attendanceIds);
  }

  /** A host turned these stays away: `refused: denied`, a close, and the hosts told. */
  async participantsDenied(attendanceIds: readonly string[]): Promise<void> {
    await participantsDenied(this.room, attendanceIds);
  }

  /** The lobby setting moved. Nobody at the door is admitted by it. */
  async lobbyChanged(lobby: MeetingLobbyMode): Promise<void> {
    await lobbyChanged(this.room, lobby);
  }

  /**
   * Everything this room is holding — for a platform operator, and for nobody else.
   *
   * The read is `room/room-inspect.ts`, which is where what it may and may not carry is argued out:
   * handles, counts, instants and the browsers' own measurements, and never a session description,
   * a display name or a track name. The route is behind the platform-operator guard
   * (`routes/meeting-inspect.ts`), and this method does nothing about authority itself — the
   * firm-scoped door every other read of a meeting goes through cannot serve a caller who belongs to
   * no firm, which is exactly what a platform operator is.
   */
  async inspect(): Promise<MeetingRoomInspection> {
    return await inspectRoom(this.room);
  }
}
