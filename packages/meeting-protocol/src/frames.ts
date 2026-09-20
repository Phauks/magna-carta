import { z } from "zod";
import { PREFERRED_RIDS, type PreferredRid, type RosterParticipant } from "./types.ts";

// The wire contract for a meeting's signaling socket, in ONE home so the room that sends, the route
// that upgrades, and the browser that subscribes cannot drift on a field name.
//
// IT IS A PACKAGE BECAUSE A BROWSER BUNDLE CANNOT IMPORT FROM A WORKER. Before this, the frames were
// declared twice — with zod in the Durable Object and by hand in the browser client — and every
// slice added frames to both by prose agreement. Two declarations of one contract drift, and the
// drift shows up as a tile that never arrives rather than as a type error. Both ends now import
// this, and a fitness function in this package's own test directory holds that every frame type
// declared here has a handler at each end.
//
// WHAT TRAVELS HERE AND WHAT DOES NOT. Every frame is signaling: session descriptions, track names,
// the identifiers the routing service hands back, and the roster. The audio, video and screen share
// go directly between a browser and the routing service and never cross this socket, a Worker or
// this platform's storage at all. That is a property of the architecture rather than a rule this
// module enforces, which is why nothing here has a redaction step.
//
// Frames are JSON text. A binary frame is refused: there is nothing in this protocol that needs one,
// and refusing keeps the parse surface one function wide.

// THE KEEPALIVE PAIR, BYTE FOR BYTE, and it has a twin.
//
// These two strings are registered with the runtime's WebSocket auto-response, which matches the
// request frame BYTE-FOR-BYTE and answers it without waking a hibernating Durable Object. A ping
// written any other way — a space after the colon, a pretty-printed object — costs a full wake of
// the room for every idle participant instead of being answered for free.
//
// The twin is `PING_FRAME`/`PONG_FRAME` in apps/api-worker/src/progress/job-progress-protocol.ts,
// which is the job-progress control protocol's own pair and the origin of these bytes. They are
// restated rather than imported because that module lives inside a Worker and this package is
// consumed by a browser bundle; a cross-package test cannot compare them either, since the Worker's
// module is not importable from the node pool. So the equality is asserted where both are reachable
// — apps/api-worker/test/meeting-room.test.ts — and that assertion is what stops one of them being
// edited alone.
export const PING_FRAME = '{"type":"ping"}';
export const PONG_FRAME = '{"type":"pong"}';

// Bumped when a frame's shape changes incompatibly. It rides on every frame in both directions, so a
// browser left open across a deploy can tell it is talking to a protocol it does not know rather
// than mis-reading a field. The server never negotiates: it states the version it speaks.
export const MEETING_PROTOCOL_VERSION = 1;

// THE FRAME CEILING, and it is deliberately not the progress protocol's.
//
// That protocol caps a client frame at 256 bytes, which is right for a vocabulary of two nullary
// control frames. This one carries session descriptions — a browser's offer with several media
// sections runs to a few kilobytes, and one describing a screen share on a machine with a long codec
// list runs further. A cap that refused them would refuse the protocol's whole purpose. Sixty-four
// kilobytes is far above any offer observed and far below anything that would make a room's parse a
// cost worth thinking about; it is applied BEFORE parsing, so a participant cannot make the room
// parse arbitrary volume.
export const MAX_MEETING_FRAME_BYTES = 64 * 1024;

// WHEN A ROSTER IS CHEAPER WHOLE THAN AS A DIFFERENCE. Below this many participants the full list
// is smaller than the bookkeeping a difference costs on both ends, and a browser that has the whole
// list cannot be wrong about it. Above it, a full roster on every arrival is quadratic in the room:
// three hundred people each joining and each telling three hundred sockets is ninety thousand
// frames of the whole list, for three hundred facts. So the room sends what changed instead.
//
// Sixteen is the tile count a gallery page shows, which is the size at which a browser stops being
// able to draw everybody anyway.
export const ROSTER_DELTA_THRESHOLD = 16;

// The most layer changes one frame may carry. A browser re-chooses layers when its gallery page
// turns or its window resizes, so a frame is naturally the size of a page of tiles; thirty-two is
// two such pages, and a ceiling is what stops a client asking the routing service to reshape an
// unbounded number of streams in one message.
export const MAX_LAYER_TRACKS = 32;

// The separator between a participant's handle and the name they gave a track. A track name is the
// pair, and the roster is how every other browser resolves one to a tile — so the room checks a
// publisher's prefix against it and the browser reads an owner back out of it.
export const TRACK_NAME_SEPARATOR = ":";

// The close code for a socket the room cannot serve — an attachment it cannot read, a meeting that
// has ended under it. From the private-use range (3000-4999), the only range an application may
// define, and the same code the assistant's push surface uses for the same meaning.
export const UNSERVICEABLE_CLOSE_CODE = 4000;
export const NORMAL_CLOSE_CODE = 1000;

// ---------------------------------------------------------------------------------------------
// Client -> room
// ---------------------------------------------------------------------------------------------

const sessionDescription = z.object({
  type: z.string().min(1).max(32),
  sdp: z.string().min(1),
});

const preferredRidSchema = z.enum(PREFERRED_RIDS);

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
        // Which layer to start on. Optional, because a microphone and a screen share have only one
        // layer to send and naming one for them would be a preference about nothing; absent, the
        // room asks the routing service for the track without a simulcast preference at all.
        preferredRid: preferredRidSchema.optional(),
      }),
    )
    .min(1)
    .max(64),
});

// A CHANGE OF MIND ABOUT AN EXISTING SUBSCRIPTION, and the reason it is not a second `subscribe`:
// the media is already flowing, and asking for it again would build a new transceiver and a new
// media section for a stream the browser is already receiving. This says "keep sending it, send it
// smaller", which the routing service answers on the section it is already using.
//
// Each entry names the track the way a subscription does — by the session that PUBLISHED it and the
// track's own name — plus the media section the receiving browser put it in, which is the handle
// the routing service accepts for changing it.
const layerFrame = z.object({
  ...versioned,
  type: z.literal("layer"),
  tracks: z
    .array(
      z.object({
        sessionId: z.string().min(1).max(200),
        trackName: z.string().min(1).max(200),
        mid: z.string().min(1).max(32),
        preferredRid: preferredRidSchema,
      }),
    )
    .min(1)
    .max(MAX_LAYER_TRACKS),
});

// WHO IS TALKING IS A FACT THE ROOM RELAYS, NOT ONE EVERY BROWSER MEASURES. A browser measures its
// OWN microphone — nothing else can, once it stops pulling everybody's audio — and states the two
// facts a tile shows. Sent on transitions only: a level is not news, a change of level is.
const presenceFrame = z.object({
  ...versioned,
  type: z.literal("presence"),
  speaking: z.boolean(),
  muted: z.boolean(),
});

// A BROWSER THAT SUSPECTS IT HAS MISSED SOMETHING, asking for the whole list again. It exists
// because the room stops sending full rosters above the threshold: a client applying differences
// has no way back to the truth on its own, and reconnecting to get one would cost it every track.
const syncFrame = z.object({ ...versioned, type: z.literal("sync") });

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
  layerFrame,
  presenceFrame,
  syncFrame,
  renegotiateFrame,
  closeFrame,
  leaveFrame,
  pingFrame,
]);

export type MeetingClientFrame = z.infer<typeof MeetingClientFrame>;

/**
 * Every frame type a browser may send, as a value.
 *
 * It is what tells a frame with an unknown type apart from one whose type is right and whose fields
 * are wrong, and it is what the fitness function walks to check the room has somewhere to send each
 * of them. Derived from the union above rather than written twice: a frame added to the union and
 * forgotten here would be parsed and then reported as unknown.
 */
export const MEETING_CLIENT_FRAME_TYPES: readonly MeetingClientFrame["type"][] = Object.freeze(
  MeetingClientFrame.options.map((option) => option.shape.type.value),
);

/**
 * Every frame type the ROOM may send.
 *
 * Declared rather than derived, because the room's frames are builders and not a schema union — the
 * room is the only writer of them and a browser reads what arrives. The fitness function walks this
 * list against the builders below and against the browser's own dispatch, which is what stops the
 * three drifting.
 */
export const MEETING_ROOM_FRAME_TYPES = Object.freeze([
  "welcome",
  "published",
  "subscribed",
  "renegotiated",
  "closed",
  "roster",
  "roster-delta",
  "presence",
  "layered",
  "ended",
  "refused",
  "pong",
] as const);

export type MeetingRoomFrameType = (typeof MEETING_ROOM_FRAME_TYPES)[number];

/**
 * Why a frame was refused. A CLOSED vocabulary: these are labels a browser branches on, never prose
 * to show somebody. The first eight are about the FRAME that arrived and leave the socket open; the
 * last four are about the room, and the three that name a state the socket cannot recover from are
 * followed by a close.
 *
 * `superseded` is the one the room sends without any frame having arrived: it is the answer to
 * somebody else's upgrade, not to anything this socket said.
 */
export const MEETING_REFUSAL_REASONS = Object.freeze([
  "frame-too-large",
  "binary-unsupported",
  "malformed-frame",
  "unknown-frame",
  // A subscription named a (session, track) pair that nobody in THIS room is publishing, or named
  // the asking participant's own session. The fleet shares one routing application, so a session
  // handle is only meaningful against the roster it came off — a pair that is not on it is either a
  // browser working from a roster that has moved on, or an attempt to pull a track out of a meeting
  // the asker is not in.
  "unknown-track",
  // A publish offered a track name that is not the caller's own. A track name carries the publisher's
  // participant handle, and every other browser resolves a tile from it, so a name belonging to
  // somebody else would put one member's media under another member's face.
  "foreign-track-name",
  // This participant already offers as many tracks as the room will carry for one person.
  "track-limit-reached",
  // A picture offered into a meeting that is a CALL. The medium is chosen when the meeting is
  // started and never changed, so a modified client cannot turn a call into a video meeting for the
  // people who joined one — they agreed to sound.
  "track-kind-refused",
  // The routing service did not answer, or answered something unreadable. Never carries a word of
  // what it said — see the media client in the worker, where the reason that text is withheld is
  // written out.
  "sfu-unavailable",
  // The socket's attachment cannot be read, so the room cannot say who this is. A socket accepted by
  // an older build, or one that predates a protocol change.
  "not-a-participant",
  // A NEWER SOCKET FOR THIS SAME STAY HAS TAKEN OVER, and this one is finished. One live socket per
  // stay is the rule, and it is forced by WebRTC rather than chosen: a reconnecting browser arrives
  // with a new peer connection, which means new ICE credentials and a new DTLS fingerprint, so it
  // cannot resume the routing session the old one opened — and two tabs cannot share one session at
  // all. Whoever connected last is the one holding the media. Nothing about this improves by
  // retrying on this socket, so it is followed by a close.
  "superseded",
  // The meeting closed while this socket was open.
  "meeting-ended",
] as const);

export type MeetingRefusalReason = (typeof MEETING_REFUSAL_REASONS)[number];

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
  const known = MEETING_CLIENT_FRAME_TYPES.some((candidate) => candidate === type);
  return { refusal: known ? "malformed-frame" : "unknown-frame" };
}

// ---------------------------------------------------------------------------------------------
// Room -> client
//
// Built rather than hand-written at each call site, so every frame carries the version and nothing
// composes a field name by hand.
// ---------------------------------------------------------------------------------------------

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

/**
 * Who is in the room now, whole.
 *
 * Still sent, and in two places only: as the answer to a `sync`, and as the ordinary broadcast in a
 * room at or below `ROSTER_DELTA_THRESHOLD`, where the list is smaller than the difference. A
 * `welcome` carries the same list inline, because a socket that has just arrived holds nothing to
 * apply a difference to.
 */
export function rosterFrame(participants: readonly RosterParticipant[]): string {
  return frame({ type: "roster", participants });
}

/**
 * WHAT CHANGED ABOUT THE ROOM, for a room too large to restate.
 *
 * `left` carries participant handles rather than whole entries: the receiver already holds
 * everything it knows about them, and the only fact being sent is that it should stop.
 *
 * All three lists are always present, empty where nothing of that kind happened, so a client reads
 * three arrays rather than branching on which keys arrived.
 */
export function rosterDeltaFrame(
  joined: readonly RosterParticipant[],
  left: readonly string[],
  updated: readonly RosterParticipant[],
): string {
  return frame({ type: "roster-delta", joined, left, updated });
}

/**
 * One participant's speaking and muted state, relayed to everybody else.
 *
 * Carries the whole of what it is about rather than a change to it, which is what makes the room's
 * throttle safe: a frame that is not sent loses nothing a later one does not restate. `at` is the
 * instant the room relayed it, so a client receiving two out of order can tell which is current.
 */
export function presenceDeltaFrame(
  participantId: string,
  speaking: boolean,
  muted: boolean,
  at: string,
): string {
  return frame({ type: "presence", participantId, speaking, muted, at });
}

/**
 * What the routing service did with each requested layer change.
 *
 * One entry per track the browser ASKED about, in the order it asked, so a client can pair the
 * answer with its request without matching on anything. `errorCode` is present only where the
 * service refused that one section; the rest are now sending the layer that was asked for.
 */
export function layeredFrame(
  tracks: readonly {
    readonly mid: string;
    readonly preferredRid: PreferredRid;
    readonly errorCode?: string;
  }[],
): string {
  return frame({ type: "layered", tracks });
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

export type { PreferredRid, RosterParticipant } from "./types.ts";
