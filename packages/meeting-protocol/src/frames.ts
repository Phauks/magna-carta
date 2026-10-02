import { z } from "zod";
import {
  MEETING_CONNECTION_QUALITIES,
  MEETING_REACTIONS,
  PREFERRED_RIDS,
  type MeetingChatMessage,
  type MeetingPollOptionCount,
  type MeetingPollSnapshot,
  type MeetingQuestionSnapshot,
  type MeetingQuestionUpvoteCount,
  type MeetingReaction,
  type MeetingRecordingAnnouncement,
  type MeetingRoomState,
  type PreferredRid,
  type RosterParticipant,
  type WaitingParticipant,
} from "./types.ts";

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

// HOW OFTEN ONE PARTICIPANT MAY SEND A SIGNAL THAT CANNOT BE RESTATED — a change to their hand, or
// a reaction.
//
// THE ROOM'S OTHER THROTTLES DROP, AND THIS ONE REFUSES, because the reasoning behind dropping does
// not carry here. A presence frame states the WHOLE of what it is about, so a suppressed one loses
// nothing a later one does not restate; a `sync` is a request the asker repeats. A raised hand may
// be the last thing somebody does for ten minutes — dropped, it is never relayed and the host never
// learns that somebody wants the floor — and a reaction is a single act with no later frame to
// restate it. So neither is ever silently discarded: one per window is relayed, and the next inside
// it is refused `rate-limited` with the socket left open, so the browser knows its act did not land
// and can send the settled state again when the window passes.
//
// It is HERE rather than in the room because it is a number both ends have to agree on: a client
// that paced itself differently would be refused for behaving correctly. The room's own coalescing
// window is not here, for the opposite reason — a browser draws whatever arrives and divides by
// nothing.
export const SIGNAL_INTERVAL_MILLISECONDS = 1000;

// WHAT ONE SOCKET MAY SEND, WHATEVER IT SENDS — the general budget every frame type answers to,
// underneath the per-frame rules above it.
//
// Each of those rules bounds one kind of frame against one cost: a sync against the roster read, a
// layer change and a reaction against the act they ask for. None of them bounds a browser that
// sends something ELSE as fast as it can write to a socket, and most of what it could send is not
// free — a publish, a subscribe, a renegotiation and a close are each a billed call to the routing
// service, a presence frame writes the participant record, and a frame the room refuses still costs
// it the refusal. So the socket carries a token bucket that every frame spends from, and a frame
// arriving with no token left is refused `rate-limited` with the socket KEPT OPEN: it is about the
// frame that arrived and nothing else, and a browser that paced itself has lost nothing.
//
// TWENTY A SECOND WITH A BURST OF FORTY is far above what a working client produces — the busiest
// thing a browser sends is presence, on transitions only, and a gallery page turn is a handful of
// frames at once — and far below what a loop can produce. The burst is what lets a browser arrive,
// publish, subscribe and ask for the roster in one gesture without meeting the bound.
//
// BOTH NUMBERS ARE HERE rather than in the room, on exactly the terms the signal window above is:
// they are the pace a client has to know in order to keep inside it, and a client that paced itself
// differently would be refused for behaving correctly.
export const FRAME_BUDGET_PER_SECOND = 20;
export const FRAME_BUDGET_BURST = 40;

// The most layer changes one frame may carry. A browser re-chooses layers when its gallery page
// turns or its window resizes, so a frame is naturally the size of a page of tiles; thirty-two is
// two such pages, and a ceiling is what stops a client asking the routing service to reshape an
// unbounded number of streams in one message.
export const MAX_LAYER_TRACKS = 32;

// The most tracks one subscription frame may name, and the most media sections one close frame may
// name. Exported for the same reason the layer ceiling is: a browser that has to CHUNK against a
// ceiling has to know it, and a client dividing by a number it wrote down itself is a client that
// silently starts losing a track the day the ceiling moves. Sixty-four is four gallery pages of
// tiles, which is the most a browser can reasonably be asking for at once — and past it the answer
// is several frames rather than one, because a frame the room refuses whole costs the asker
// everything it asked for.
export const MAX_SUBSCRIBE_TRACKS = 64;
export const MAX_CLOSE_MIDS = 64;

// THE CEILINGS ON A CONNECTION REPORT, and they are sanity bounds rather than expectations.
//
// Every number on a `diagnostic-report` is measured by the browser sending it, which makes it the one
// frame in this protocol whose whole content is a claim about the sender that nothing can check. The
// bounds exist so that a claim which cannot be true is refused at the parse rather than recorded:
// telemetry aggregates these, and one browser reporting a round trip of a hundred million
// milliseconds moves an average nobody can then explain. Each is far above anything a working
// connection produces and far below anything that would be believed.
//
// A minute of round trip is a connection that has already failed every other way; ten seconds of
// jitter likewise. A hundred megabits is two orders above the camera's own ceiling. Sixteen thousand
// pixels is past any display. The inbound count is a count of streams arriving, not of people in the
// room — the room's own ceiling is a number only the server reads (see the note on `MAX_MEETING_LOBBY`
// in this package's area note), so this is a bound of its own.
export const MAX_DIAGNOSTIC_ROUND_TRIP_MILLISECONDS = 60_000;
export const MAX_DIAGNOSTIC_JITTER_MILLISECONDS = 10_000;
export const MAX_DIAGNOSTIC_BITS_PER_SECOND = 100_000_000;
export const MAX_DIAGNOSTIC_PIXELS = 16_384;
export const MAX_DIAGNOSTIC_INBOUND_COUNT = 1_000;

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
    .max(MAX_SUBSCRIBE_TRACKS),
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
//
// `hand` IS OPTIONAL HERE AND REQUIRED ON THE ROOM'S OWN PRESENCE FRAME, and the asymmetry is the
// whole of what makes this additive. A browser left open across the deploy goes on sending two
// booleans, and an absent `hand` means "this browser has nothing to say about a hand" — the stored
// value is left exactly as it stands. Reading absence as `false` would lower the hand of every
// participant who had not reloaded. Room to client the field is always present, because the room is
// the one writing it and a reader branching on presence is a reader with two code paths.
//
// The three facts are measured by the same browser about the same person at the same moment, which
// is why the hand rides here rather than on a frame of its own — but they are governed by two
// different rules, decided by which field moved: `speaking` and `muted` keep the drop-throttle, and
// a frame that changes the hand answers to `SIGNAL_INTERVAL_MILLISECONDS` above.
const presenceFrame = z.object({
  ...versioned,
  type: z.literal("presence"),
  speaking: z.boolean(),
  muted: z.boolean(),
  hand: z.boolean().optional(),
});

/**
 * SOMETHING THROWN ON A TILE, from the closed vocabulary and nothing else.
 *
 * A name outside `MEETING_REACTIONS` does not parse, which is what keeps arbitrary text off a tile
 * in a firm's meeting. Nothing else rides here: the sender is taken from the socket's own
 * attachment, and the instant is the room's — a modified client can no more react as somebody else
 * than it can publish under their name.
 */
const reactionFrame = z.object({
  ...versioned,
  type: z.literal("reaction"),
  name: z.enum(MEETING_REACTIONS),
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
  mids: z.array(z.string().min(1).max(32)).min(1).max(MAX_CLOSE_MIDS),
});

const leaveFrame = z.object({ ...versioned, type: z.literal("leave") });

// THE HOST'S OWN FRAMES, and the reason they are frames rather than routes.
//
// An act is a route with an audit row when somebody could later ask who did it — a member put out
// of a meeting on a matter's record, a door somebody shut, a room that changed hands. An act is a
// FRAME when it is about this moment and leaves nothing behind: a mute is undone by the member
// themselves a second later, a spotlight dies with the room, a request to unmute is a tap on the
// shoulder. An audit row for each would fill a matter's log with the mechanics of a conversation,
// which is the one thing this subsystem has been careful not to record — and it would put a round
// trip and the idempotency gate between a host pressing Mute and the microphone going quiet, for an
// act whose whole value is that it is instant.
//
// A frame is not anonymous for being unaudited: every one of them carries the handle of the host who
// sent it, so the person muted sees who muted them and the room sees who put whose face on every
// screen. What none of them carries is content, like everything else on this wire.
//
// THE ROOM DECIDES AUTHORITY FROM THE STORED PARTICIPANT, never from the socket these arrive on —
// see the note on `hostRole` in ./types.ts. Nothing about that is expressible here: what this
// package declares is the shape, and the room is where a frame from somebody holding no grant is
// refused `not-host`.

// The stay a directive names. A participant handle, which is what the roster carries and what every
// other frame on this wire is addressed by — a member handle would not distinguish two stays.
const participantHandle = z.string().min(1).max(128);

/** Silence one participant: the room closes their audio upstream and tells them who did it. */
const muteFrame = z.object({
  ...versioned,
  type: z.literal("mute"),
  participantId: participantHandle,
});

/**
 * The same over everybody who is neither the caller nor a host or co-host.
 *
 * Hosts are left alone because a host muting the room is clearing the floor in order to speak, and
 * a control that silences the person pressing it is a control that does not work; co-hosts are left
 * alone because they are running the meeting with the host.
 */
const muteAllFrame = z.object({ ...versioned, type: z.literal("mute-all") });

/**
 * A REQUEST, and never a forced unmute — the one act this protocol refuses to build the obvious
 * version of.
 *
 * A platform that can open a member's microphone from another member's click is a listening device
 * in a law firm. The member may be in a room with a client, on a call they muted themselves for
 * precisely so that the next two minutes were not in the meeting, and a microphone opened for them
 * would put a privileged conversation on the wire with nothing in front of them to say it had
 * happened. So this reaches the target as `unmute-requested`, their screen offers Unmute and Stay
 * muted, and nothing happens until they choose. The host sees no acknowledgement, because there is
 * nothing to acknowledge: they asked.
 */
const askToUnmuteFrame = z.object({
  ...versioned,
  type: z.literal("ask-to-unmute"),
  participantId: participantHandle,
});

/**
 * A HAND PUT DOWN BY SOMEBODY OTHER THAN ITS OWNER — one, or the whole room's.
 *
 * ONE ACT WITH DIFFERENT ARGUMENTS rather than two frames, on the hosting route's own precedent:
 * null means everybody, and two frames whose invariants can drift apart is how "lower one" and
 * "lower all" end up disagreeing about whose hand is spared. Nobody's is: a host clearing the floor
 * is clearing it, and their own hand goes down with the rest. That is the opposite of the mute-all
 * rule and deliberately so — mute-all exists so a host can speak, and this exists so a host can
 * start the queue again.
 *
 * A FRAME AND NOT A ROUTE, by the rule the four above are frames: a lowered hand leaves nothing
 * behind that anybody could later ask who did. The participant lowers their own with the ordinary
 * presence frame, which is why this is the host's half alone.
 */
const lowerHandsFrame = z.object({
  ...versioned,
  type: z.literal("lower-hands"),
  participantId: participantHandle.nullable(),
});

/** One participant on every screen, or null to clear it. A room-level fact, not a per-browser one. */
const spotlightFrame = z.object({
  ...versioned,
  type: z.literal("spotlight"),
  participantId: participantHandle.nullable(),
});

/**
 * WHAT THIS BROWSER'S CONNECTION IS DOING, told to the room.
 *
 * It is the one frame whose content is a MEASUREMENT rather than a request, and the direction is
 * forced: once a browser has stopped pulling every stream in a room of three hundred, nothing but
 * that browser can say whether its own picture is arriving anywhere. The room records the numbers
 * through the standard telemetry pipeline and keeps the LAST of them on the participant record, so
 * an operator inspecting a meeting that is going badly can see which end it is going badly at.
 *
 * EVERY FIELD IS OPTIONAL, AND THAT IS THE SHAPE RATHER THAN A CONVENIENCE. A browser that has not
 * published anything has no outbound layer to describe, a connection in its first seconds has no
 * rates yet, and a report that had to invent a zero for each of those would put a measurement in
 * the record that nobody took. An absent field is "not measured"; it is never "none".
 *
 * WHAT IT CANNOT CARRY. No track name, no session description, no display name, nothing a person
 * typed — the numbers are rates, counts and one enum, and unknown keys are stripped by the parse.
 * A connection's behaviour is not a fact about the meeting and never reaches its record; what the
 * room keeps is the latest sample, which dies with the room.
 *
 * The room accepts one of these per participant per window and drops the rest, exactly as it drops a
 * `sync` inside its window: a sample is a restatement, and the next one is along in a moment.
 */
const diagnosticReportFrame = z.object({
  ...versioned,
  type: z.literal("diagnostic-report"),
  sample: z.object({
    quality: z.enum(MEETING_CONNECTION_QUALITIES).optional(),
    roundTripMilliseconds: z.number().min(0).max(MAX_DIAGNOSTIC_ROUND_TRIP_MILLISECONDS).optional(),
    // A fraction of what was sent, never a packet count: a count is a number whose meaning depends
    // on an interval the room does not know.
    lossFraction: z.number().min(0).max(1).optional(),
    jitterMilliseconds: z.number().min(0).max(MAX_DIAGNOSTIC_JITTER_MILLISECONDS).optional(),
    // The camera as it is actually going out — which simulcast layer, at what size, at what rate.
    // Absent for somebody who joined to listen, and for a call, where there is no picture at all.
    outbound: z
      .object({
        rid: z.enum(PREFERRED_RIDS).optional(),
        width: z.number().int().min(1).max(MAX_DIAGNOSTIC_PIXELS).optional(),
        height: z.number().int().min(1).max(MAX_DIAGNOSTIC_PIXELS).optional(),
        bitrate: z.number().min(0).max(MAX_DIAGNOSTIC_BITS_PER_SECOND).optional(),
      })
      .optional(),
    // How many streams this browser is receiving — the number that says whether a member seeing
    // nothing is subscribed to nothing or subscribed to everything and receiving none of it.
    inboundCount: z.number().int().min(0).max(MAX_DIAGNOSTIC_INBOUND_COUNT).optional(),
  }),
});

/** The measurement a `diagnostic-report` carries, as both ends read it. */
export type MeetingDiagnosticSample = z.infer<typeof diagnosticReportFrame>["sample"];

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
  reactionFrame,
  syncFrame,
  renegotiateFrame,
  closeFrame,
  leaveFrame,
  muteFrame,
  muteAllFrame,
  askToUnmuteFrame,
  lowerHandsFrame,
  spotlightFrame,
  diagnosticReportFrame,
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
  "room-state",
  "muted",
  "unmute-requested",
  // THE TWO SIGNALS THAT ARE RELAYED AND NEVER STORED, and which of them arrives depends on the
  // size of the room: `reaction` names the person at or below `ROSTER_DELTA_THRESHOLD`, and above it
  // the room sends `reactions` — one frame a second carrying the counts for the whole room. A client
  // has to handle both at any size, which it must anyway: it cannot know how many people were in the
  // room at the instant the room decided.
  "reaction",
  "reactions",
  // A COPY OF SOMETHING ALREADY ON THE RECORD. The route is the record either way — the write never
  // goes through this socket — so a browser that misses one of these is caught up by the read.
  "message",
  "message-redacted",
  // THE POLL AND THE QUESTION QUEUE, on the same terms: every act is a route, the browser sends
  // nothing new on the socket, and each of these is a copy of a row that has already committed. The
  // two tallies are coalesced by the room to one frame a second, and a browser that misses any of the
  // six is caught up by the paged read.
  "poll-opened",
  "poll-closed",
  "poll-tally",
  "question-asked",
  "question-updated",
  "question-tally",
  // THE THREE THE DOOR ADDED. `lobby` and `admitted` go to a socket that is WAITING and to nobody
  // else; `waiting` goes to the sockets holding a grant and to nobody else. A waiting socket is
  // never sent a `welcome`, a `roster` or a `roster-delta` — see the note on `lobby` below.
  "lobby",
  "admitted",
  "waiting",
  // THE ANNOUNCEMENT THAT A RECORDING STARTED OR STOPPED, which the owner's ruling makes the consent
  // mechanism. To every WELCOMED socket — a guest's as much as a member's, because everybody whose
  // voice is being captured is told — and never to the lobby, where nobody is being recorded. Start
  // and stop are ROUTES: the browser sends nothing new on the socket to cause either.
  "recording",
  "ended",
  "refused",
  "pong",
] as const);

export type MeetingRoomFrameType = (typeof MEETING_ROOM_FRAME_TYPES)[number];

/**
 * Why a frame was refused. A CLOSED vocabulary: these are labels a browser branches on, never prose
 * to show somebody. Most are about the FRAME that arrived — its shape, what it named, whether the
 * sender may ask for it — and leave the socket open, because a browser that reconnects has to
 * renegotiate every track from nothing. The rest are about the ROOM, and the four that name a state
 * this socket cannot recover from (`not-a-participant`, `superseded`, `removed`, `meeting-ended`)
 * are followed by a close.
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
  // The firm withdrew the guest link this socket arrived on. Distinct from `removed`, which a host
  // does to a person and which bars the link for the meeting, and from `superseded`, which a fresh
  // arrival or a rotated link does to an older socket: a withdrawn link is the firm's act on the
  // credential, nobody is barred by it, and inviting again is the way back.
  "withdrawn",
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
  // A SIGNAL THAT CANNOT BE RESTATED, ARRIVING TOO FAST — a second change of hand, or a second
  // reaction, inside `SIGNAL_INTERVAL_MILLISECONDS`. NON-FATAL, and the socket stays open: it is
  // about the frame that arrived and nothing else, so a browser re-sends the settled state when the
  // window passes. It exists because the room's other throttles DROP, and dropping a hand or a
  // reaction loses an act that nothing later restates — so this is the price of never losing one.
  //
  // It is also what a socket over its general budget is answered with (`FRAME_BUDGET_PER_SECOND`),
  // and what an act that costs the routing service is answered with when it arrives faster than the
  // room will spend on it — one reason for one thing, because what a browser does about all three is
  // the same: slow down and send it again.
  "rate-limited",
  // A HOST FRAME FROM A SOCKET HOLDING NO GRANT. The socket stays open: the member is in the
  // meeting and everything else they can do still works — what they cannot do is run it. Decided
  // from the STORED participant record rather than from the socket's attachment, because a co-host
  // whose grant was withdrawn ten minutes ago would otherwise go on muting people for as long as
  // their socket stayed open.
  "not-host",
  // A HOST PUT THIS MEMBER OUT OF THE MEETING. Fatal, and followed by a close: the record now says
  // they are not in the room, the join path refuses them while the meeting runs, and nothing about
  // this improves by retrying. It is the MEETING they are barred from and not the event.
  "removed",
  // A HOST TURNED THIS MEMBER AWAY AT THE DOOR. The twin of `removed` and fatal on the same terms —
  // barred entry is one rule with two labels, the join path refuses them while the meeting runs,
  // and the screen offers no way back in. A close follows.
  "denied",
  // A FRAME FROM A SOCKET THAT IS STILL WAITING. The socket STAYS OPEN — they are at the door and
  // the door may open — and the only frames a waiting socket may send are `ping` and `leave`.
  // Decided before the routing client is even resolved, so a waiter's frame never costs a session
  // at the routing service.
  "not-admitted",
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

/**
 * Sent once, on connect: who this socket is, who is already here, and what is true of the room.
 *
 * The room state rides inline for the reason the whole roster does — a socket that has just arrived
 * holds nothing to apply a change to, so it cannot be told about a spotlight as a difference. The
 * lobby list rides along on the same reasoning and is EMPTY for everybody who is not running the
 * meeting: who is at the door is a list of people a host has not yet decided about, and telling the
 * room who is outside it is the leak the door was shut to prevent.
 *
 * It is never sent to a waiting socket at all. That one gets `lobby` instead.
 *
 * A GUEST'S SOCKET IS SENT THE SAME FRAMES WITH THE IDENTIFIERS TAKEN OUT: every roster entry on a
 * `welcome`, `roster` or `roster-delta` it receives carries `userId: null`, because somebody from
 * outside the firm sees names and tiles and never a firm's user identifiers. The room builds that
 * second payload; the frame's shape is the same.
 */
export function welcomeFrame(
  participantId: string,
  roster: readonly RosterParticipant[],
  roomState: MeetingRoomState,
  waiting: readonly WaitingParticipant[],
  // THE RECORDING RUNNING WHEN THIS SOCKET ARRIVED — the "and on arrival" half of the consent ruling.
  // It is server-sent, so a browser that never paints it was still told; and it is the same
  // announcement the room broadcast at the start, so a late arrival hears exactly what the room heard.
  // Always `started` when present. ABSENT, not null, when nothing is being recorded: a welcome to a
  // room that is not recording is then byte-for-byte the welcome it always was, and a browser reads
  // the missing field as "not recording", which is what it means.
  recording: MeetingRecordingAnnouncement | null = null,
): string {
  return frame({
    type: "welcome",
    participantId,
    roster,
    roomState,
    waiting,
    ...(recording === null ? {} : { recording }),
  });
}

/**
 * A RECORDING STARTED OR STOPPED — the announcement, broadcast to every welcomed socket the instant
 * the route committed the transition.
 *
 * The browser plays it three ways at once (a synthesized tone, spoken words where the browser offers
 * them, and a banner with a live-region announcement), and draws the persistent mark for as long as
 * the state is `started`. What the server records is not what was rendered but what it delivered: the
 * room writes a notice for every stay it sent this frame to.
 *
 * A guest's copy carries `by.userId: null`, the rule every frame naming a firm user follows.
 */
export function recordingFrame(announcement: MeetingRecordingAnnouncement): string {
  return frame({ type: "recording", ...announcement });
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
  hand: boolean,
  at: string,
): string {
  return frame({ type: "presence", participantId, speaking, muted, hand, at });
}

/**
 * ONE REACTION, ON THE TILE OF THE PERSON WHO THREW IT — the shape a small room gets.
 *
 * Sent at or below `ROSTER_DELTA_THRESHOLD`, and NEVER to its own sender: that browser drew its own
 * bubble the moment the button was pressed, which is what makes the control feel like a button
 * rather than a request. Above the threshold the room sends `reactions` instead, because a bubble on
 * the right face is a promise a screen drawing sixteen tiles out of three hundred cannot keep.
 *
 * `at` is the room's instant, not the sender's, on the terms every other instant on this wire is.
 */
export function reactionRelayFrame(
  participantId: string,
  name: MeetingReaction,
  at: string,
): string {
  return frame({ type: "reaction", participantId, name, at });
}

/**
 * WHAT THE WHOLE ROOM THREW IN ONE SECOND, as counts — the shape a large room gets.
 *
 * Three hundred people applauding one sentence is three hundred inbound frames and, relayed one by
 * one, ninety thousand outbound in a single second. So above the threshold the room accumulates them
 * into a per-name count and sends this once a second for the whole room, which is the design target:
 * one frame a second whatever the applause.
 *
 * What coalescing costs is attribution, and that is the honest trade — above sixteen participants
 * nobody can see three hundred tiles anyway, and the count is the thing that is actually true at that
 * size. It goes to EVERY socket including the reactors, because a count that excluded the reader
 * would be a different number per socket and the room would be building three hundred frames to
 * avoid one double-count; the client draws its own glyph on its own tile and the counts in the
 * strip, so nothing is counted twice on any screen.
 *
 * `counts` is keyed by the reaction's name and carries only the names that actually arrived — a zero
 * for a name nobody chose is a fact nobody is waiting for.
 */
export function reactionsFrame(counts: Readonly<Record<string, number>>, at: string): string {
  return frame({ type: "reactions", counts, at });
}

/**
 * SOMETHING SOMEBODY SAID, RELAYED AS IT WAS SAID — a copy of a row that is already committed.
 *
 * THE ROUTE IS THE RECORD AND STAYS THE RECORD. This frame exists so a message reaches the other
 * browsers in the room now rather than on a poller's next tick; a browser that misses one is caught
 * up by the read, and the write never goes through the socket, because a record that existed only
 * where a Durable Object's transient storage holds it would empty when the room does.
 *
 * The whole record travels rather than a projection of it, so the frame and the list answer with the
 * same object and a screen has one shape to draw. It reaches every WELCOMED socket and never the
 * lobby: what is being said inside a room is exactly what somebody standing at the door must not
 * reach.
 */
export function messageFrame(message: MeetingChatMessage): string {
  return frame({ type: "message", message });
}

/**
 * A message taken back, as the handle and the instant alone.
 *
 * The body is already blank on the record and there is nothing here to blank: what a client holds is
 * a copy, so this is the news that the copy is stale and what to put in its place. A whole record
 * would carry an empty body and say the same thing at more expense.
 */
export function messageRedactedFrame(messageId: string, redactedAt: string): string {
  return frame({ type: "message-redacted", messageId, redactedAt });
}

/**
 * A HOST ASKED THE ROOM — the poll WHOLE, not a handle to it.
 *
 * That looks like the opposite of "the route is the record", and the reason is arithmetic: a bare
 * handle would send three hundred browsers to the read path in the same instant a poll opens, which
 * is the thundering herd this relay exists to prevent. A poll is small and bounded — five hundred
 * characters of question and ten labels of two hundred — so it sits far inside the frame ceiling. A
 * browser that misses it is still caught up by the paged read, which remains the record.
 *
 * Reaches every welcomed socket and never the lobby. A guest's copy carries null user identifiers.
 */
export function pollOpenedFrame(poll: MeetingPollSnapshot): string {
  return frame({ type: "poll-opened", poll });
}

/**
 * A host closed a poll: the instant, and the FINAL tally, so every browser switches the card to its
 * result without a read. A closed poll takes no more answers.
 */
export function pollClosedFrame(
  pollId: string,
  closedAt: string,
  counts: readonly MeetingPollOptionCount[],
  respondents: number,
): string {
  return frame({ type: "poll-closed", pollId, closedAt, counts, respondents });
}

/**
 * WHERE A POLL STANDS NOW — coalesced by the room to at most one frame a second per poll, and sent to
 * every socket.
 *
 * It carries the LATEST tally rather than a difference: the route that wrote an answer read the new
 * counts and handed them to the room, and the room's bucket keeps the most recent, so a flush sends
 * the current truth rather than a replay. `counts` is every option in `position` order, including the
 * ones nobody chose; `respondents` is people rather than answers.
 */
export function pollTallyFrame(
  pollId: string,
  counts: readonly MeetingPollOptionCount[],
  respondents: number,
  at: string,
): string {
  return frame({ type: "poll-tally", pollId, counts, respondents, at });
}

/**
 * SOMEBODY PUT A QUESTION TO THE ROOM — the question whole, for the poll's reason: a handle would send
 * the whole room to the read at once. At most a thousand characters. A guest's copy carries null
 * user identifiers.
 */
export function questionAskedFrame(question: MeetingQuestionSnapshot): string {
  return frame({ type: "question-asked", question });
}

/**
 * A QUESTION'S NEW STATE — answered, unanswered or taken back — as the whole question again, so a
 * browser replaces what it holds rather than applying a difference. A redacted question's copy
 * carries an empty body, because the record's own is empty.
 */
export function questionUpdatedFrame(question: MeetingQuestionSnapshot): string {
  return frame({ type: "question-updated", question });
}

/**
 * HOW MANY UPVOTES EACH QUESTION HOLDS NOW — coalesced by the room to at most one frame a second for
 * the whole queue, carrying only the questions whose count moved inside that second, each at its
 * latest count. The browser re-sorts the queue it holds when this arrives, without a read.
 */
export function questionTallyFrame(
  questions: readonly MeetingQuestionUpvoteCount[],
  at: string,
): string {
  return frame({ type: "question-tally", questions, at });
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

/**
 * WHAT IS TRUE OF THE ROOM RATHER THAN OF ANYBODY IN IT — the spotlight, and whether the door is
 * shut.
 *
 * Broadcast whole rather than as a difference, because it is two fields: a client that receives it
 * replaces what it holds, and there is no ordering question to get wrong. The same object rides on
 * the `welcome`, which is what a socket arriving mid-meeting applies.
 */
export function roomStateFrame(roomState: MeetingRoomState): string {
  return frame({ type: "room-state", ...roomState });
}

/**
 * Sent to the muted participant ALONE, and never to the room.
 *
 * Everybody else learns it from the roster: the track has left it, so nobody re-subscribes to
 * silence. What this frame is for is the person it happened to — a microphone that goes dead with
 * nothing on screen is read as a broken machine, so the screen says a host muted them and who.
 */
export function mutedFrame(by: string, at: string): string {
  return frame({ type: "muted", by, at });
}

/**
 * A request to unmute, relayed to the asked participant alone. NOTHING ELSE HAPPENS.
 *
 * Their screen offers Unmute and Stay muted, and the member chooses. There is no acknowledgement
 * frame back to the host, because there is nothing to acknowledge — see `ask-to-unmute` above for
 * why the platform will not open somebody's microphone.
 */
export function unmuteRequestedFrame(by: string, at: string): string {
  return frame({ type: "unmute-requested", by, at });
}

/**
 * WHERE SOMEBODY IS IN THE QUEUE — the frame a waiting socket gets in place of a `welcome`.
 *
 * A waiting socket is never sent a welcome, and that is structural rather than tidy: there is
 * nothing it is welcome to yet, and a welcome with an empty roster is a shape every future reader
 * has to remember to keep empty. The room does not filter them out of the roster either — it stores
 * them under a different key entirely, so the read every roster, delta, subscription check and
 * broadcast is built from cannot include them.
 *
 * `position` is one-based and `waiting` is how many are at the door, so a screen can say "second of
 * three" without a second frame. Re-sent whenever the queue in front of somebody changes.
 */
export function lobbyFrame(position: number, waiting: number, at: string): string {
  return frame({ type: "lobby", position, waiting, at });
}

/**
 * A HOST LET THEM IN, on the same socket they were waiting on.
 *
 * Followed immediately by the ordinary `welcome`. Two frames with one job each, so the client's
 * welcome handler is the same handler it has always been — and the admitted browser builds its peer
 * connection from the relay credentials its join already answered with, which is why the join
 * carries them even for somebody who is about to wait.
 */
export function admittedFrame(at: string): string {
  return frame({ type: "admitted", at });
}

/**
 * WHO IS AT THE DOOR, sent to the sockets holding a grant and to nobody else.
 *
 * Whole rather than as a difference: a lobby is bounded at a hundred and is usually one or two
 * people, so the bookkeeping a difference costs on both ends is more than the list. The `welcome`
 * carries the current list inline for a host, and an empty array for everybody else — a socket that
 * has just arrived holds nothing to apply a change to, which is the rule the roster already follows.
 */
export function waitingFrame(participants: readonly WaitingParticipant[]): string {
  return frame({ type: "waiting", participants });
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

export type {
  MeetingChatMessage,
  MeetingConnectionQuality,
  MeetingHostRole,
  MeetingLobbyMode,
  MeetingParticipantKind,
  MeetingPollOptionCount,
  MeetingPollOptionStanding,
  MeetingPollSnapshot,
  MeetingQuestionSnapshot,
  MeetingQuestionUpvoteCount,
  MeetingReaction,
  MeetingRecordingActor,
  MeetingRecordingAnnouncement,
  MeetingRoomState,
  MeetingSpotlight,
  PreferredRid,
  RosterParticipant,
  WaitingParticipant,
} from "./types.ts";
export { MEETING_CONNECTION_QUALITIES, MEETING_REACTIONS } from "./types.ts";
