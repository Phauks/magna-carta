import { z } from "zod";
import { PING_FRAME, PONG_FRAME } from "../progress/job-progress-protocol.ts";

// The wire contract for a meeting's signaling socket, in ONE home so the room that sends, the route
// that upgrades, and the browser that subscribes cannot drift on a field name.
//
// WHAT TRAVELS HERE AND WHAT DOES NOT. Every frame is signaling: session descriptions, track names,
// the identifiers the routing service hands back, and the roster. The audio, video and screen share
// go directly between a browser and the routing service and never cross this socket, this Worker or
// this platform's storage at all. That is a property of the architecture rather than a rule this
// module enforces, which is why nothing here has a redaction step.
//
// Frames are JSON text. A binary frame is refused: there is nothing in this protocol that needs one,
// and refusing keeps the parse surface one function wide.
//
// The keepalive pair is imported rather than restated. Those two strings are registered with the
// runtime's WebSocket auto-response, which matches the request frame BYTE-FOR-BYTE and answers it
// without waking a hibernating object — two copies of a byte-exact literal is exactly the kind of
// thing that drifts by one character and silently costs every idle participant a wake.
export { PING_FRAME, PONG_FRAME };

// Bumped when a frame's shape changes incompatibly. It rides on every frame in both directions, so a
// browser left open across a deploy can tell it is talking to a protocol it does not know rather
// than mis-reading a field. The server never negotiates: it states the version it speaks.
export const MEETING_PROTOCOL_VERSION = 1;

// THE FRAME CEILING, and it is deliberately not the progress protocol's.
//
// ../progress/job-progress-protocol.ts caps a client frame at 256 bytes, which is right for a
// vocabulary of two nullary control frames. This protocol carries session descriptions — a browser's
// offer with several media sections runs to a few kilobytes, and one describing a screen share on a
// machine with a long codec list runs further. A cap that refused them would refuse the protocol's
// whole purpose. Sixty-four kilobytes is far above any offer observed and far below anything that
// would make a room's parse a cost worth thinking about; it is applied BEFORE parsing, so a
// participant cannot make the room parse arbitrary volume.
export const MAX_MEETING_FRAME_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------------------------
// Client -> room
// ---------------------------------------------------------------------------------------------

const sessionDescription = z.object({
  type: z.string().min(1).max(32),
  sdp: z.string().min(1),
});

const versioned = { v: z.literal(MEETING_PROTOCOL_VERSION) };

// What the browser is publishing, carried on its own offer. `mid` is the media section the track
// rides in — the browser's own numbering, which the routing service answers against.
const publishFrame = z.object({
  ...versioned,
  type: z.literal("publish"),
  sessionDescription,
  tracks: z
    .array(
      z.object({
        trackName: z.string().min(1).max(200),
        mid: z.string().min(1).max(32),
        kind: z.string().min(1).max(32),
      }),
    )
    .min(1)
    .max(8),
});

// What the browser wants forwarded to it, named by the session that published it. The session id
// comes off the roster the room sent, so a browser can only ever ask for a track of somebody who is
// in the same room.
const subscribeFrame = z.object({
  ...versioned,
  type: z.literal("subscribe"),
  tracks: z
    .array(
      z.object({
        sessionId: z.string().min(1).max(200),
        trackName: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(64),
});

const renegotiateFrame = z.object({
  ...versioned,
  type: z.literal("renegotiate"),
  sessionDescription,
});

const closeFrame = z.object({
  ...versioned,
  type: z.literal("close"),
  mids: z.array(z.string().min(1).max(32)).min(1).max(64),
});

const leaveFrame = z.object({ ...versioned, type: z.literal("leave") });

// The ping is the byte-exact frame the runtime answers without waking the room, and it carries no
// version field for that reason: the auto-response matches the bytes, so adding one would make every
// keepalive a wake. Accepted here as well, because a browser that pretty-printed its ping still
// deserves a pong — the contract is the frame, not the optimization.
const pingFrame = z.object({ type: z.literal("ping") });

export const MeetingClientFrame = z.union([
  publishFrame,
  subscribeFrame,
  renegotiateFrame,
  closeFrame,
  leaveFrame,
  pingFrame,
]);

export type MeetingClientFrame = z.infer<typeof MeetingClientFrame>;

/**
 * Why a frame was refused. A CLOSED vocabulary: these are labels a browser branches on, never prose
 * to show somebody. The first eight are about the FRAME that arrived and leave the socket open; the
 * last four are about the room, and the three that name a state the socket cannot recover from are
 * followed by a close.
 *
 * `superseded` is the one the room sends without any frame having arrived: it is the answer to
 * somebody else's upgrade, not to anything this socket said.
 */
export type MeetingRefusalReason =
  | "frame-too-large"
  | "binary-unsupported"
  | "malformed-frame"
  | "unknown-frame"
  // A subscription named a (session, track) pair that nobody in THIS room is publishing, or named
  // the asking participant's own session. The fleet shares one routing application, so a session
  // handle is only meaningful against the roster it came off — a pair that is not on it is either a
  // browser working from a roster that has moved on, or an attempt to pull a track out of a meeting
  // the asker is not in.
  | "unknown-track"
  // A publish offered a track name that is not the caller's own. A track name carries the publisher's
  // participant handle, and every other browser resolves a tile from it, so a name belonging to
  // somebody else would put one member's media under another member's face.
  | "foreign-track-name"
  // This participant already offers as many tracks as the room will carry for one person.
  | "track-limit-reached"
  // A picture offered into a meeting that is a CALL. The medium is chosen when the meeting is
  // started and never changed, so a modified client cannot turn a call into a video meeting for the
  // people who joined one — they agreed to sound.
  | "track-kind-refused"
  // The routing service did not answer, or answered something unreadable. Never carries a word of
  // what it said — see sfu-client.ts, where the reason that text is withheld is written out.
  | "sfu-unavailable"
  // The socket's attachment cannot be read, so the room cannot say who this is. A socket accepted by
  // an older build, or one that predates a protocol change.
  | "not-a-participant"
  // A NEWER SOCKET FOR THIS SAME STAY HAS TAKEN OVER, and this one is finished. One live socket per
  // stay is the rule, and it is forced by WebRTC rather than chosen: a reconnecting browser arrives
  // with a new peer connection, which means new ICE credentials and a new DTLS fingerprint, so it
  // cannot resume the routing session the old one opened — and two tabs cannot share one session at
  // all. Whoever connected last is the one holding the media. Nothing about this improves by
  // retrying on this socket, so it is followed by a close.
  | "superseded"
  // The meeting closed while this socket was open.
  | "meeting-ended";

/**
 * The refusals a PARSE can produce — the four that are about the frame that arrived rather than
 * about the room. Named so the parser's signature says which half of the vocabulary it can return,
 * and so a caller handling the other three knows the parser will never hand it one.
 */
export type MeetingFrameRefusal = Extract<
  MeetingRefusalReason,
  "frame-too-large" | "binary-unsupported" | "malformed-frame" | "unknown-frame"
>;

/**
 * Parses one client frame, or gives the reason it was refused.
 *
 * The size check comes first and is measured in ENCODED BYTES rather than characters, because that
 * is what the room actually read off the socket — a cap counted in characters is a cap a
 * multi-byte payload walks straight through.
 */
export function parseMeetingClientFrame(
  message: string | ArrayBuffer,
): { readonly frame: MeetingClientFrame } | { readonly refusal: MeetingFrameRefusal } {
  if (typeof message !== "string") return { refusal: "binary-unsupported" };
  if (new TextEncoder().encode(message).byteLength > MAX_MEETING_FRAME_BYTES) {
    return { refusal: "frame-too-large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return { refusal: "malformed-frame" };
  }
  if (parsed === null || typeof parsed !== "object") return { refusal: "malformed-frame" };
  const result = MeetingClientFrame.safeParse(parsed);
  if (result.success) return { frame: result.data };
  // A frame naming no type this room speaks is told apart from one whose type is right and whose
  // fields are wrong: the first is a browser from another protocol, the second is a bug in this one,
  // and a client that cannot tell them apart retries the wrong one.
  const type = (parsed as { type?: unknown }).type;
  const known =
    type === "publish" ||
    type === "subscribe" ||
    type === "renegotiate" ||
    type === "close" ||
    type === "leave" ||
    type === "ping";
  return { refusal: known ? "malformed-frame" : "unknown-frame" };
}

// ---------------------------------------------------------------------------------------------
// Room -> client
//
// Built rather than hand-written at each call site, so every frame carries the version and nothing
// composes a field name by hand.
// ---------------------------------------------------------------------------------------------

/** One person in the room, as every other participant sees them. */
export interface RosterParticipant {
  readonly participantId: string;
  readonly userId: string;
  readonly displayName: string;
  // The routing-service session they publish through, or null until they have published anything.
  // A browser needs it to ask for their tracks, and there is nothing to ask for until it exists.
  readonly sfuSessionId: string | null;
  readonly tracks: readonly { readonly trackName: string; readonly kind: string }[];
}

function frame(body: Record<string, unknown>): string {
  return JSON.stringify({ v: MEETING_PROTOCOL_VERSION, ...body });
}

/** Sent once, on connect: who this socket is, and who is already here. */
export function welcomeFrame(participantId: string, roster: readonly RosterParticipant[]): string {
  return frame({ type: "welcome", participantId, roster });
}

/** The answer to the browser's offer, and where each published track landed. */
export function publishedFrame(
  sessionDescriptionValue: { readonly type: string; readonly sdp: string } | undefined,
  tracks: readonly { readonly trackName: string; readonly mid: string }[],
): string {
  return frame({ type: "published", sessionDescription: sessionDescriptionValue ?? null, tracks });
}

/**
 * The routing service's OWN offer for the tracks being forwarded, which the browser answers.
 *
 * `requiresImmediateRenegotiation` is forwarded rather than decided here, for the reason the client
 * module gives: only the browser's own peer connection knows what it has already applied. It is also
 * what makes a null description readable — no description AND no renegotiation means the service had
 * nothing new to say, where no description and a renegotiation flag would be an answer the browser
 * cannot act on and should report rather than wait on.
 */
export function subscribedFrame(
  sessionDescriptionValue: { readonly type: string; readonly sdp: string } | undefined,
  tracks: readonly {
    readonly sessionId: string;
    readonly trackName: string;
    readonly mid: string;
  }[],
  requiresImmediateRenegotiation: boolean,
): string {
  return frame({
    type: "subscribed",
    sessionDescription: sessionDescriptionValue ?? null,
    tracks,
    requiresImmediateRenegotiation,
  });
}

/** The browser's answer was accepted. Nothing to carry back — the exchange is closed. */
export function renegotiatedFrame(): string {
  return frame({ type: "renegotiated" });
}

/** Tracks stopped. A description rides along when the service needs the connection reshaped. */
export function closedFrame(
  sessionDescriptionValue: { readonly type: string; readonly sdp: string } | undefined,
): string {
  return frame({ type: "closed", sessionDescription: sessionDescriptionValue ?? null });
}

/** Who is in the room now — sent to everybody after any change to it. */
export function rosterFrame(participants: readonly RosterParticipant[]): string {
  return frame({ type: "roster", participants });
}

/** The meeting is over. Sent to every socket, which then closes normally. */
export function endedFrame(endedAt: string): string {
  return frame({ type: "ended", endedAt });
}

/**
 * A refusal. Whether the socket survives it is the ROOM's decision and not this frame's: a
 * malformed frame leaves a working socket working, while a state the room cannot serve is followed
 * by a close. Both cases send this first, so a browser always learns why before the socket moves.
 *
 * `errorId` rides along only where the room actually recorded a failure — an outage of the routing
 * service is the case — so the screen can show the handle that joins what the member saw to the
 * redacted server trace. It is absent on every refusal that is about the frame the browser sent,
 * because there is no server-side fault to look up.
 */
export function refusedFrame(reason: MeetingRefusalReason, errorId?: string): string {
  return frame({ type: "refused", reason, ...(errorId === undefined ? {} : { errorId }) });
}

// The close code for a socket the room cannot serve — an attachment it cannot read, a meeting that
// has ended under it. From the private-use range (3000-4999), the only range an application may
// define, and the same code the assistant's push surface uses for the same meaning.
export const UNSERVICEABLE_CLOSE_CODE = 4000;
export const NORMAL_CLOSE_CODE = 1000;
