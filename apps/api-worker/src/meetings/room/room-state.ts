import {
  refusedFrame,
  roomStateFrame,
  UNSERVICEABLE_CLOSE_CODE,
  type MeetingRefusalReason,
} from "@magna-carta/meeting-protocol/frames";
import type {
  MeetingCaptionsState,
  MeetingHostRole,
  MeetingLobbyMode,
  MeetingParticipantKind,
  MeetingRoomState,
  MeetingSpotlight,
} from "@magna-carta/meeting-protocol/types";
import type { MeetingMedium } from "@magna-carta/meetings/types";
import type { Bindings } from "../../bindings.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "../sfu/realtime-failure.ts";

// WHAT ONE MEETING'S ROOM HOLDS BETWEEN FRAMES, and the two places it can be held.
//
// The room hibernates: the runtime owns every socket's server end, so the object is evicted while
// people sit in the meeting and re-constructed when the next frame arrives. Class properties do not
// survive that, so nothing about a participant may live on the instance. There are exactly two
// places a fact can go instead, and this module owns both:
//
//   * the object's own STORAGE — the roster, the room's identity, the ended marker; read back by
//     every module that needs it, never cached on the instance;
//   * the per-socket ATTACHMENT — who this socket is — which the runtime serializes with the socket
//     and hands back on the far side of an eviction.
//
// Everything else in room/ is written over these two, which is why each of those modules takes a
// `RoomContext` rather than reaching for anything of its own.

const PARTICIPANT_PREFIX = "participant:";

// SOMEBODY AT THE DOOR, UNDER A DIFFERENT KEY ENTIRELY — and this is the structural guarantee the
// whole lobby rests on.
//
// A waiting participant is never stored under `participant:`, so `storedParticipants()` — the one
// read every roster, delta, subscription check and broadcast is built from — CANNOT include them. A
// waiter is not omitted from the roster by a filter somebody has to remember to write; they are not
// in the set the roster is made of. A filter would have to be re-applied by every future reader and
// would be wrong the first time one forgot.
const WAITING_PREFIX = "waiting:";

// The instant the meeting closed, and the ONE thing this object keeps after it. It is what lets a
// frame arriving on a socket that had not yet noticed be answered with the truth — the meeting is
// over — rather than with "the room does not know who you are", which is what a bare missing roster
// entry would otherwise say and would send a browser reconnecting forever.
const ENDED_KEY = "ended";

// Which meeting this room is, in the firm's own record. The attachment carries both on every socket,
// but the grace sweep runs from an alarm with no socket and no request, and a sweep that could not
// name the firm could not close anybody's stay.
const ROOM_KEY = "room";

// ONE PARTICIPANT ON EVERY SCREEN, decided by whoever is running the meeting. A room-level fact and
// therefore a room-level key: a pin is one member arranging their own gallery and lives in that
// browser, where a spotlight is the host deciding what the room is looking at. It dies with the
// room, which is why it is here and not in the firm's record.
const SPOTLIGHT_KEY = "spotlight";

// WHETHER LIVE CAPTIONS ARE RUNNING IN THIS ROOM, and which host turned them on. Room-level for the
// spotlight's reason: a host turns them on for everybody. It is the switch and nothing else — no caption
// is ever written here or anywhere in this object; the words pass through on their way to the sockets.
// It dies with the room.
const CAPTIONS_KEY = "captions";

// WHAT THE ROOM HAS BEEN THROWN THIS SECOND AND NOT YET SENT ON — the coalescing bucket a large
// room's reactions accumulate into. Room-level for the same reason the spotlight is: it is a fact
// about the room rather than about anybody in it, and three hundred per-participant buckets would be
// three hundred keys to read to flush one frame. It exists only while somebody is reacting, and it
// dies with the room.
const REACTIONS_KEY = "reactions";

/**
 * What a room module is given: the Durable Object's own context and the deployment's environment,
 * and nothing else.
 *
 * Passed explicitly rather than reached for, which is what makes each module testable without the
 * runtime — and what keeps the orchestrating class free of behaviour it would otherwise accumulate
 * one slice at a time.
 */
export interface RoomContext {
  readonly ctx: DurableObjectState;
  readonly env: Bindings;
}

/**
 * WHAT THIS BROWSER LAST SAID ABOUT ITS OWN CONNECTION, kept flat and kept once.
 *
 * Flat because the telemetry event built from it is flat — a declared field carries a primitive and
 * a structure has no way through the allowlist — so flattening once here is what keeps the stored
 * sample and the recorded one from disagreeing about what a field means. A measurement the browser
 * did not take is null rather than zero: somebody who published nothing has no outbound layer, which
 * is a different fact from an outbound layer of none.
 *
 * ONLY THE LATEST, and it dies with the room. A history would be a record of how somebody's
 * connection behaved, which is not a fact about the meeting and must never become one.
 */
export interface StoredClientSample {
  readonly at: string;
  readonly quality: string | null;
  readonly roundTripMilliseconds: number | null;
  readonly lossFraction: number | null;
  readonly jitterMilliseconds: number | null;
  readonly outboundRid: string | null;
  readonly outboundWidth: number | null;
  readonly outboundHeight: number | null;
  readonly outboundBitsPerSecond: number | null;
  readonly inboundCount: number | null;
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
export interface StoredTrack {
  readonly trackName: string;
  readonly kind: string;
  readonly mid: string | null;
}

/** One connected participant, as the room holds them between frames. */
export interface StoredParticipant {
  // The firm member behind the stay, or the EMPTY STRING for a guest — who has none. Never put on the
  // wire as it stands: the roster module projects it, and a guest's entry, and every entry sent to a
  // guest's socket, carries null. Nothing authorizes from it but the hosting rewrite, which matches it
  // against grants a guest can never hold.
  readonly userId: string;
  // Which kind of stay this is. Optional, because a record written before guests existed carries
  // none, which reads as a member — which is what it was.
  readonly participantKind?: MeetingParticipantKind;
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
  // The two facts every other browser draws on this person's tile, measured by their own browser
  // and relayed by the room. Kept here rather than derived from anything the room can see: once a
  // browser stops pulling three hundred audio tracks, nothing but that browser knows whether its
  // own microphone is carrying a voice.
  readonly speaking: boolean;
  readonly muted: boolean;
  // When the room last RELAYED this participant's presence — not when it last changed. It is half
  // the throttle's state: a transition arriving inside the window updates the two booleans above and
  // leaves this alone, so the next one out of the window is relayed immediately.
  readonly presenceAt: string | null;
  // THE OTHER HALF, and the reason a held-back transition is not a lost one. A frame suppressed by
  // the window leaves the booleans above current and this flag raised; the room's alarm, armed for
  // the end of that window, relays what is stored and lowers it. Without it the LAST transition of a
  // burst was dropped outright — a one-word answer left somebody speaking on every other screen
  // until they spoke again, and a quick mute-unmute left them muted for the rest of the meeting.
  readonly presenceDirty: boolean;
  // When this participant's last whole-roster request was answered, and their last layer change
  // forwarded. Both are throttles on frames that cost the ROOM rather than the sender: a sync is a
  // list of every key the room holds, and a layer change is a call to the routing service. A browser
  // can send either as fast as it can write to a socket, so what bounds them is here.
  readonly syncAt: string | null;
  readonly layerAt: string | null;
  // THE FOUR ACTS THAT REACH THE ROUTING SERVICE, each carrying the instant the room last spent on
  // it for this participant. A publish, a subscription, a renegotiation and a close are each a
  // billed call out of this account, and none of them is bounded by anything the frame itself
  // carries — the track ceiling bounds how many tracks one participant may HOLD and not how often
  // they may ask, and a subscription that names the same roster track again is a second forwarding
  // request for it.
  //
  // REFUSED RATHER THAN DROPPED inside the window, which is the opposite of the two throttles above
  // and follows the same rule they follow: a sync is a request the asker repeats and a layer change
  // is superseded by the next one, while each of these four is an act the browser is waiting on an
  // answer to — a dropped publish is a camera that never appears, and a dropped renegotiation is a
  // subscription that never carries media. So the browser is told, and can ask again.
  //
  // Optional, because a record written before these windows existed carries none — which reads as a
  // participant who has never spent one, which is what they were.
  readonly publishAt?: string | null;
  readonly subscribeAt?: string | null;
  readonly renegotiateAt?: string | null;
  readonly closeAt?: string | null;
  // WHEN SOMEBODY LAST ASKED THIS PARTICIPANT TO UNMUTE — kept on the person being asked rather than
  // on the host asking, because the thing worth bounding is how often one member is tapped on the
  // shoulder, and two hosts taking turns would otherwise each stay inside their own budget while the
  // member's screen filled with requests.
  readonly unmuteAskedAt?: string | null;
  // The media sections the room subscribed on THIS participant's behalf, which is the whole of what
  // they may later ask to change the layer of. A section number is the routing service's handle for
  // a track inside one session, so a browser naming a section the room never subscribed for it is
  // naming a part of its own session it does not own — and the service, which has no notion of a
  // meeting, would honour the change.
  readonly subscribedMids: readonly string[];
  // WHETHER THIS PERSON IS RUNNING THE MEETING, and the one fact on this record that is deliberately
  // NOT taken from the socket's attachment at frame time.
  //
  // The attachment is written once at upgrade and frozen there, which is right for the firm, the
  // meeting and the medium — none of which can change under a socket — and wrong for hosting, which
  // is exactly the thing that changes during a meeting. A co-host whose grant was withdrawn ten
  // minutes ago would go on muting people for as long as their socket stayed open. So the hosting
  // routes tell the room after they commit, the room rewrites this field, and every host frame is
  // authorized from HERE.
  //
  // The upgrade seeds it, because the socket route has just read the live grants to decide the
  // caller may be in the room at all and a second round trip from the room would buy nothing.
  readonly hostRole: MeetingHostRole | null;
  // When this browser's last connection report was ACCEPTED, and the sample it carried. The first is
  // the other bounded frame's throttle, on exactly the terms `syncAt` and `layerAt` above are: a
  // report costs a write and an event, and one inside the window is dropped because the next
  // measurement is along in a moment. The second is what an operator's inspect call reads.
  //
  // Optional, because a record written by a build that predated diagnostics carries neither — which
  // reads as "never reported", which is what it was.
  readonly reportAt?: string | null;
  readonly lastSample?: StoredClientSample | null;
  // WHEN THIS PERSON PUT THEIR HAND UP, or null while it is down — ONE stored fact behind the two
  // fields the wire carries (`hand` and `handRaisedAt` on the roster entry, projected in
  // room-roster.ts and nowhere else).
  //
  // The instant is the ROOM's rather than the browser's, for the reason a chat message's is: a
  // queue ordered by what each participant's own machine said is not one ordering, and the
  // disagreement is invisible to the host reading it. What the room does NOT keep is a sorted queue
  // — every browser holds the roster and `filter(hand).sort(by handRaisedAt)` is a pure derivation
  // of it, where a sorted list in storage would be rewritten on every change in a room of three
  // hundred.
  //
  // Nothing about a hand ever reaches the firm's record: no table, no audit row, no personal-data
  // registration. It is deleted with the rest of the roster when this stay ends or the meeting does,
  // which is the whole claim of the slice that added it. Optional, because a record written before
  // hands existed carries none — which reads as a hand that is down, which is what it was.
  readonly handRaisedAt?: string | null;
  // WHEN THIS PARTICIPANT'S LAST SIGNAL WAS ACCEPTED — a change of hand, or a reaction.
  //
  // The third throttle on this record and the only one that REFUSES rather than drops, because
  // neither of the two frames it governs restates itself: a raised hand may be the last thing
  // somebody does for ten minutes, and a reaction is a single act with no later frame to carry it.
  // So a frame inside `SIGNAL_INTERVAL_MILLISECONDS` is answered `rate-limited` with the socket left
  // open rather than silently discarded, and the window is on the wire because a client that paced
  // itself differently would be refused for behaving correctly.
  readonly signalAt?: string | null;
}

/**
 * One person at the door, as the room holds them between frames.
 *
 * Deliberately a much smaller record than a `StoredParticipant`: a waiter publishes nothing,
 * subscribes to nothing and holds no routing session, so there is no media state to keep and nothing
 * for the roster to draw. What the room needs is who they are, when they knocked, and — exactly as
 * for somebody in the room — when their socket went away, so a browser closed at the door does not
 * leave an open stay in the firm's record forever.
 */
export interface StoredWaiting {
  /** The empty string for a guest, who has no user id; see `StoredParticipant`. */
  readonly userId: string;
  readonly displayName: string;
  readonly waitingFrom: string;
  readonly socketLostAt: string | null;
  // A GUEST AT THE DOOR CARRIES TWO NAMES — the one typed there (`displayName`) and the Directory name
  // the link was minted for — and the hosts' `waiting` frame carries both, because the difference
  // between them is what a forwarded link leaves behind. Optional: a record from before guests reads
  // as a member with no invitation.
  readonly participantKind?: MeetingParticipantKind;
  readonly invitedName?: string | null;
}

/** Which meeting, in which firm, this room is the signaling side of. */
export interface StoredRoom {
  readonly firmId: string;
  readonly meetingId: string;
  // What kind of gathering this is. Kept here rather than read off each socket, so the answer is the
  // room's and not one browser's — and so the alarm, which has no socket, could read it too.
  readonly medium: MeetingMedium;
  // WHETHER THE DOOR IS SHUT. The record holds it — `meeting.locked_at` is what actually refuses an
  // arrival — and this is the room's copy of it, kept so the state a browser paints arrives on the
  // wire rather than costing a read of the firm's database per socket. Refreshed from the row on
  // every upgrade and rewritten by the lock route after it commits. Optional, because a room stored
  // by a build that predated the door reads as open, which is what it was.
  readonly locked?: boolean;
  // WHETHER ARRIVALS WAIT. The room's copy of `meeting.lobby`, kept on the same terms as the lock
  // beside it: the record is what actually sends somebody to the door, and this is what lets the
  // room state a browser paints arrive on the wire without a read of the firm's database per socket.
  // Refreshed from the row on every upgrade and rewritten by the lobby route after it commits.
  // Optional, because a room stored by a build that predated the door reads as `off`, which is what
  // it was.
  readonly lobby?: MeetingLobbyMode;
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
  // Whether this socket has been given its welcome. A socket is ACCEPTED before it is admitted —
  // the runtime has to own it before the roster can be written — and in that window it is already
  // in `getWebSockets()`, so a broadcast raised by somebody else's arrival reached a browser that
  // had not yet been told who is in the room. It read a roster difference against nothing, decided
  // it had missed something, and asked for the whole list; three hundred people joining at the top
  // of the hour made that a storm the room answered one list of three hundred keys at a time.
  // Raised by `admitParticipant` the moment the welcome is on the wire.
  readonly welcomed?: boolean;
  // The caller's live grant on this meeting as the socket route read it, which SEEDS the stored
  // participant record and is never read again. Every authority question the room answers is asked
  // of that record instead — see `hostRole` on `StoredParticipant` for why a frozen attachment is
  // the wrong place for a fact that changes during a meeting.
  readonly hostRole?: MeetingHostRole | null;
  // Whether the door was shut when this socket arrived, read off the meeting row by the route
  // exactly as the medium is. It seeds the room's own copy, which the lock route rewrites — a socket
  // already in the room is never turned out by the door shutting behind it.
  readonly locked?: boolean;
  // Whether arrivals wait, read off the meeting row by the route exactly as the lock is. It seeds
  // the room's own copy.
  readonly lobby?: MeetingLobbyMode;
  // WHETHER THIS SOCKET IS AT THE DOOR OR IN THE ROOM, derived by the route off the stay it just
  // authorized the upgrade against — never named by the browser, like every other value here. A
  // waiting socket is admitted to the LOBBY state: it is stored under `waiting:`, it is sent `lobby`
  // instead of `welcome`, and every frame but `ping` and `leave` is refused `not-admitted`.
  //
  // It is lowered by `participantsAdmitted`, which rewrites the attachment as it moves the record —
  // the one value here that changes under a socket, and it does so exactly once.
  readonly waiting?: boolean;
  // WHEN THIS STAY REACHED THE DOOR, off the same row. The room could stamp its own instant when a
  // waiting socket arrives, and that would be a second answer to a question the record already
  // answers — a host's panel would then show one waiting time from the lobby route and another from
  // the `waiting` frame, differing by however long the browser took to open its socket.
  readonly waitingFrom?: string;
  // THE SOCKET'S OWN FRAME BUDGET — what is left of it, and when that was last measured.
  //
  // It rides the ATTACHMENT rather than the participant record on purpose, and the two would answer
  // different questions. The budget is about one connection: a browser sending faster than the room
  // will serve is a browser, not a person, and a member whose tunnel dropped and who dialled back in
  // is a new connection that has done nothing yet. Keeping it here also keeps the bound off storage
  // entirely — every frame would otherwise read and write a key to be told it may proceed, which is
  // a cost the size of the thing being bounded.
  //
  // Absent on a socket that has sent nothing, and on one accepted by a build that predated the
  // budget — both read as a full bucket, which is what they are.
  readonly frameBudgetTokens?: number;
  readonly frameBudgetAt?: string;
  // WHICH KIND OF PERSON HOLDS THIS SOCKET, derived by the route that authorized the upgrade — the
  // guest route writes `guest`, every member route `member` — and never named by the browser. It is
  // what every roster, welcome and relayed message is redacted by: a guest's socket is sent display
  // names and never a firm's user identifiers. Absent on a socket accepted before guests existed,
  // which reads as a member.
  readonly participantKind?: MeetingParticipantKind;
  // A guest's Directory name at mint, carried to the door so the hosts can read it beside the name the
  // guest typed. Absent for a member.
  readonly invitedName?: string;
}

// ---------------------------------------------------------------------------------------------
// The roster, in storage
//
// AND WHAT IT COSTS, COUNTED WHERE IT IS SPENT. The room's whole economy is one rule — the roster is
// read at most once per frame, because in a room of three hundred that read is three hundred keys —
// and until these two counters existed nothing measured whether it held. They are bumped by the
// reads that are proportional to the size of the meeting and by nothing else, so a frame's delta is
// the number the rule is about; room-diagnostics.ts samples it. Module state rather than instance
// state, which is right for a measurement in a way it would not be for a fact: it does not survive
// hibernation, and a delta taken across a wake is as good as one taken within it.
// ---------------------------------------------------------------------------------------------

let storageListCount = 0;
let storageGetCount = 0;

/** The room's storage spend since this instance woke — a running total, read as a difference. */
export function storageReadCounts(): { readonly lists: number; readonly gets: number } {
  return { lists: storageListCount, gets: storageGetCount };
}

export async function readParticipant(
  room: RoomContext,
  attendanceId: string,
): Promise<StoredParticipant | undefined> {
  storageGetCount += 1;
  return await room.ctx.storage.get<StoredParticipant>(`${PARTICIPANT_PREFIX}${attendanceId}`);
}

export async function putParticipant(
  room: RoomContext,
  attendanceId: string,
  participant: StoredParticipant,
): Promise<void> {
  await room.ctx.storage.put(`${PARTICIPANT_PREFIX}${attendanceId}`, participant);
}

/** Removes one roster entry, answering whether there was one to remove. */
export async function deleteParticipant(room: RoomContext, attendanceId: string): Promise<boolean> {
  return await room.ctx.storage.delete(`${PARTICIPANT_PREFIX}${attendanceId}`);
}

/**
 * Every roster entry, keyed by the stay it belongs to.
 *
 * THE ONE EXPENSIVE READ IN THE ROOM, and the reason every caller is written to take the result
 * rather than to call this again: in a room of three hundred it is three hundred keys, and a
 * frame that read it twice would double the cost of the thing the room does most.
 */
export async function storedParticipants(
  room: RoomContext,
): Promise<Map<string, StoredParticipant>> {
  storageListCount += 1;
  const stored = await room.ctx.storage.list<StoredParticipant>({ prefix: PARTICIPANT_PREFIX });
  return new Map(
    [...stored].map(([key, participant]) => [key.slice(PARTICIPANT_PREFIX.length), participant]),
  );
}

/** Drops every roster entry at once — the one act that is about the room rather than a person. */
export async function deleteEveryKey(room: RoomContext): Promise<void> {
  await room.ctx.storage.deleteAll();
}

// ---------------------------------------------------------------------------------------------
// The door, in storage — a second keyspace rather than a flag on the first
// ---------------------------------------------------------------------------------------------

export async function readWaiting(
  room: RoomContext,
  attendanceId: string,
): Promise<StoredWaiting | undefined> {
  storageGetCount += 1;
  return await room.ctx.storage.get<StoredWaiting>(`${WAITING_PREFIX}${attendanceId}`);
}

export async function putWaiting(
  room: RoomContext,
  attendanceId: string,
  waiting: StoredWaiting,
): Promise<void> {
  await room.ctx.storage.put(`${WAITING_PREFIX}${attendanceId}`, waiting);
}

/** Removes one entry from the door, answering whether there was one to remove. */
export async function deleteWaiting(room: RoomContext, attendanceId: string): Promise<boolean> {
  return await room.ctx.storage.delete(`${WAITING_PREFIX}${attendanceId}`);
}

/**
 * Everybody at the door, oldest knock first.
 *
 * Bounded at a hundred by the door's own ceiling, so this is a much cheaper read than the roster —
 * which is why the hosts are sent the whole list rather than a difference. Sorted here rather than
 * relying on the key order, because the keys are stay handles and say nothing about when somebody
 * arrived.
 */
export async function storedWaiting(room: RoomContext): Promise<Map<string, StoredWaiting>> {
  storageListCount += 1;
  const stored = await room.ctx.storage.list<StoredWaiting>({ prefix: WAITING_PREFIX });
  return new Map(
    [...stored]
      .map(
        ([key, waiting]) => [key.slice(WAITING_PREFIX.length), waiting] as [string, StoredWaiting],
      )
      .toSorted(([, left], [, right]) => left.waitingFrom.localeCompare(right.waitingFrom)),
  );
}

export async function readRoom(room: RoomContext): Promise<StoredRoom | undefined> {
  return await room.ctx.storage.get<StoredRoom>(ROOM_KEY);
}

export async function putRoom(room: RoomContext, stored: StoredRoom): Promise<void> {
  await room.ctx.storage.put<StoredRoom>(ROOM_KEY, stored);
}

export async function readEndedAt(room: RoomContext): Promise<string | undefined> {
  return await room.ctx.storage.get<string>(ENDED_KEY);
}

export async function putEndedAt(room: RoomContext, endedAt: string): Promise<void> {
  await room.ctx.storage.put(ENDED_KEY, endedAt);
}

export async function deleteEndedMarker(room: RoomContext): Promise<void> {
  await room.ctx.storage.delete(ENDED_KEY);
}

// ---------------------------------------------------------------------------------------------
// What is true of the ROOM rather than of anybody in it
// ---------------------------------------------------------------------------------------------

export async function readSpotlight(room: RoomContext): Promise<MeetingSpotlight | undefined> {
  return await room.ctx.storage.get<MeetingSpotlight>(SPOTLIGHT_KEY);
}

/** Sets the spotlight, or clears it — null is how a host takes everybody's face off every screen. */
export async function putSpotlight(
  room: RoomContext,
  spotlight: MeetingSpotlight | null,
): Promise<void> {
  if (spotlight === null) await room.ctx.storage.delete(SPOTLIGHT_KEY);
  else await room.ctx.storage.put(SPOTLIGHT_KEY, spotlight);
}

/**
 * THE REACTIONS OF ONE SECOND, WAITING TO GO OUT AS ONE FRAME.
 *
 * Opened by the first reaction in a window and flushed by the next frame past it, with the room's
 * own alarm as the backstop for a bucket nothing follows. `openedAt` is the window's start rather
 * than its deadline, so a reader here needs no arithmetic to know when the window began and the
 * interval stays the one number the reactions module divides by.
 *
 * `counts` carries only the names that actually arrived: a zero for a name nobody chose is a fact
 * nobody is waiting for, and it would cost a field on every frame in a large room.
 */
export interface StoredReactionBucket {
  readonly openedAt: string;
  readonly counts: Readonly<Record<string, number>>;
}

export async function readReactionBucket(
  room: RoomContext,
): Promise<StoredReactionBucket | undefined> {
  return await room.ctx.storage.get<StoredReactionBucket>(REACTIONS_KEY);
}

export async function putReactionBucket(
  room: RoomContext,
  bucket: StoredReactionBucket,
): Promise<void> {
  await room.ctx.storage.put(REACTIONS_KEY, bucket);
}

export async function deleteReactionBucket(room: RoomContext): Promise<void> {
  await room.ctx.storage.delete(REACTIONS_KEY);
}

/** Whether captions are running, and who turned them on — undefined while they are off. */
export async function readCaptions(room: RoomContext): Promise<MeetingCaptionsState | undefined> {
  return await room.ctx.storage.get<MeetingCaptionsState>(CAPTIONS_KEY);
}

/** Turns captions on, or with null off. */
export async function putCaptions(
  room: RoomContext,
  captions: MeetingCaptionsState | null,
): Promise<void> {
  if (captions === null) await room.ctx.storage.delete(CAPTIONS_KEY);
  else await room.ctx.storage.put(CAPTIONS_KEY, captions);
}

/** The room-level facts, composed for the wire. */
export async function roomStateOf(room: RoomContext): Promise<MeetingRoomState> {
  const [spotlight, stored, captions] = await Promise.all([
    readSpotlight(room),
    readRoom(room),
    readCaptions(room),
  ]);
  return {
    spotlight: spotlight ?? null,
    locked: stored?.locked ?? false,
    lobby: stored?.lobby ?? "off",
    // ABSENT, not null, while captions are off — so the room state of a room nobody has captioned is
    // byte-for-byte the one it always was, the rule a welcome's recording keeps, and a browser reads
    // the missing field as off, which is what it means.
    ...(captions === undefined ? {} : { captions }),
  };
}

/** Tells everybody what is now true of the room. */
export async function announceRoomState(room: RoomContext, except?: WebSocket): Promise<void> {
  broadcast(room, roomStateFrame(await roomStateOf(room)), except);
}

/**
 * The door, as the room holds it. Written by the lock route AFTER its own write commits, so nobody
 * is told the door moved by a write that then failed.
 */
export async function setRoomLocked(room: RoomContext, locked: boolean): Promise<boolean> {
  return await room.ctx.blockConcurrencyWhile(async () => {
    const stored = await readRoom(room);
    // A room the object has never been addressed for holds nothing to update, and inventing a
    // `StoredRoom` here would need a firm and a meeting this call does not have. The next upgrade
    // writes the whole record off the meeting row, which is where the truth is anyway.
    if (stored === undefined) return false;
    await putRoom(room, { ...stored, locked });
    return true;
  });
}

/** The door's own setting, on exactly the terms the lock above is written. */
export async function setRoomLobby(room: RoomContext, lobby: MeetingLobbyMode): Promise<boolean> {
  return await room.ctx.blockConcurrencyWhile(async () => {
    const stored = await readRoom(room);
    if (stored === undefined) return false;
    await putRoom(room, { ...stored, lobby });
    return true;
  });
}

/**
 * Clears the spotlight if it names somebody who has gone, and tells the room.
 *
 * A SPOTLIGHT ON AN EMPTY CHAIR IS WORSE THAN NONE: every browser would go on asking for the full
 * layer of a track nobody is publishing and drawing the large tile for a participant who is not
 * there. Called by every path that removes somebody from the roster, which is why it takes a set
 * rather than one handle — the grace sweep removes several at once.
 */
export async function clearSpotlightFor(
  room: RoomContext,
  departed: readonly string[],
): Promise<void> {
  const spotlight = await readSpotlight(room);
  if (spotlight === undefined) return;
  if (!departed.includes(spotlight.participantId)) return;
  await putSpotlight(room, null);
  await announceRoomState(room);
}

// ---------------------------------------------------------------------------------------------
// The sockets, which are the other half of what the room holds
//
// A hibernating socket carries its own context, so reading an attachment is a read of room state in
// exactly the sense the storage reads above are — it is the fact that survived the eviction. Nothing
// here keeps a socket on the instance either.
// ---------------------------------------------------------------------------------------------

export function attachmentOf(socket: WebSocket): MeetingSocketAttachment | null {
  const attachment = socket.deserializeAttachment() as MeetingSocketAttachment | null;
  if (attachment === null || attachment === undefined) return null;
  return typeof attachment.attendanceId === "string" &&
    attachment.attendanceId !== "" &&
    typeof attachment.meetingId === "string" &&
    attachment.meetingId !== ""
    ? attachment
    : null;
}

/** Every socket carrying this stay, other than the one that is asking. */
export function socketsFor(
  room: RoomContext,
  attendanceId: string,
  except?: WebSocket,
): WebSocket[] {
  const found: WebSocket[] = [];
  for (const socket of room.ctx.getWebSockets()) {
    if (socket === except) continue;
    if (attachmentOf(socket)?.attendanceId === attendanceId) found.push(socket);
  }
  return found;
}

/** True when some OTHER socket is still carrying this stay. */
export function socketExistsFor(
  room: RoomContext,
  attendanceId: string,
  except?: WebSocket,
): boolean {
  return socketsFor(room, attendanceId, except).length > 0;
}

/**
 * Every stay with a socket open, resolved in ONE pass over the sockets.
 *
 * Reading an attachment deserializes it, so asking "is this person connected" once per participant
 * costs the room a deserialization per participant per socket — ninety thousand of them in a room of
 * three hundred, on a call the alarm makes every time anybody's connection drops. Every caller that
 * needs the answer about more than one person takes this set instead.
 */
export function connectedAttendanceIds(room: RoomContext): Set<string> {
  const connected = new Set<string>();
  for (const socket of room.ctx.getWebSockets()) {
    const attendanceId = attachmentOf(socket)?.attendanceId;
    if (attendanceId !== undefined) connected.add(attendanceId);
  }
  return connected;
}

/**
 * One frame to everybody in the room, answering how many sockets it actually reached.
 *
 * The COUNT is returned rather than discarded because a relay that reached nobody and one that
 * reached three hundred people are the same call and a very different fact, and the walk has already
 * been paid for — deriving it afterwards would be a second pass over every socket. Every existing
 * caller ignores it, which is right: a roster change is announced whether or not anybody is left to
 * hear it.
 */
export function broadcast(room: RoomContext, payload: string, except?: WebSocket): number {
  return sendToRoom(room, payload, (socket) => socket === except);
}

/** Which kind of person holds this socket — a member unless the upgrade said otherwise. */
export function viewerKindOf(attachment: MeetingSocketAttachment | null): MeetingParticipantKind {
  return attachment?.participantKind === "guest" ? "guest" : "member";
}

/**
 * ONE FRAME TO EVERYBODY IN THE ROOM, BUILT FOR WHO IS READING IT — a member's socket and a guest's
 * are sent different payloads of the same frame.
 *
 * A guest sees display names, who is talking and which tracks exist, and never a firm's user
 * identifiers; so every frame that names a member is built twice at most — once per kind of reader,
 * lazily, and only the second time if a guest is actually in the room — rather than once per socket.
 * The welcome gate and the send are `broadcast`'s own, and the count is of sockets reached.
 */
export function broadcastPerViewer(
  room: RoomContext,
  payloadFor: (viewer: MeetingParticipantKind) => string,
  except?: WebSocket,
): number {
  const built = new Map<MeetingParticipantKind, string>();
  let sent = 0;
  for (const socket of room.ctx.getWebSockets()) {
    if (socket === except) continue;
    const attachment = attachmentOf(socket);
    if (attachment?.welcomed !== true) continue;
    const viewer = viewerKindOf(attachment);
    let payload = built.get(viewer);
    if (payload === undefined) {
      payload = payloadFor(viewer);
      built.set(viewer, payload);
    }
    trySend(socket, payload);
    sent += 1;
  }
  return sent;
}

/** How many sockets are in the ROOM — welcomed, and therefore able to receive a broadcast. */
export function welcomedSocketCount(room: RoomContext): number {
  let welcomed = 0;
  for (const socket of room.ctx.getWebSockets()) {
    if (attachmentOf(socket)?.welcomed === true) welcomed += 1;
  }
  return welcomed;
}

/**
 * The same, to everybody except the stay it is ABOUT — for a frame the room sends on somebody's
 * behalf rather than in answer to a socket, where there is no one socket to leave out.
 */
export function broadcastExcludingStay(
  room: RoomContext,
  payload: string,
  attendanceId: string,
): number {
  return sendToRoom(room, payload, (socket) => attachmentOf(socket)?.attendanceId === attendanceId);
}

/**
 * ONE FRAME TO ONE SOCKET, AND A SOCKET THAT HAS GONE IS NOT A FAILURE.
 *
 * `send` on a closed socket THROWS, and a throw out of `webSocketMessage` does not fail one frame —
 * the runtime terminates and resets the object, which drops every socket in the meeting. So one
 * member's browser closing between the room deciding to answer them and the answer going out would
 * end the meeting for everybody in it.
 *
 * It is not a rare race. A supersede closes the socket a frame may already be queued behind, ending
 * the meeting closes every socket at once, and a member pressing Leave closes theirs while whatever
 * they last asked for is still being served. The room-wide broadcast has swallowed this since it was
 * written; the DIRECT replies had not, and the load harness is what surfaced it — three hundred
 * browsers reconnecting is the case where the window stops being theoretical.
 *
 * Nothing is lost by swallowing it: the socket's close handler is already running, and the roster and
 * the record are that path's to fix.
 *
 * ANSWERS WHETHER THE FRAME WAS HANDED TO THE SOCKET. Most callers ignore it, because a frame that
 * did not go out is the close handler's business. The one that cannot is the recording's consent
 * record: a notice says the server told this person, and a frame swallowed here told nobody — so the
 * announcement counts a stay as told only on `true`. It is what the runtime accepted for sending, not
 * what a browser rendered; nothing on this side can know the second.
 */
export function trySend(socket: WebSocket, payload: string): boolean {
  try {
    socket.send(payload);
    return true;
  } catch {
    // Deliberately swallowed — see above.
    return false;
  }
}

function sendToRoom(
  room: RoomContext,
  payload: string,
  skip: (socket: WebSocket) => boolean,
): number {
  let sent = 0;
  for (const socket of room.ctx.getWebSockets()) {
    if (skip(socket)) continue;
    // A SOCKET THAT HAS NOT BEEN WELCOMED IS NOT YET IN THE ROOM, and sending to it is worse than
    // sending nothing: a difference applied against a roster the browser does not have is a gap it
    // can only resolve by asking for the whole list. Its own welcome carries everything this frame
    // would have said, and it is already being built.
    if (attachmentOf(socket)?.welcomed !== true) continue;
    // A socket that went away between the list and the send is exactly the case a roster broadcast
    // exists to announce, so failing the whole broadcast over it would stop everybody else
    // learning. The close handler removes it from the roster on its own.
    trySend(socket, payload);
    // Counted as ATTEMPTED rather than as delivered, and said so here: a socket that closed between
    // the walk and the send swallows its frame in `trySend`, which is exactly the case nothing on
    // this side can observe. The number is what the room decided to send to.
    sent += 1;
  }
  return sent;
}

export function refuseAndClose(socket: WebSocket, reason: MeetingRefusalReason): void {
  // The reason goes out BEFORE the close, so a browser always learns why rather than inferring it
  // from a code. The code is from the private-use range, the only range an application may define.
  trySend(socket, refusedFrame(reason));
  try {
    socket.close(UNSERVICEABLE_CLOSE_CODE, "reconnect required");
  } catch {
    // Closed already — by the peer, or by a supersede that beat this one. The outcome asked for is
    // the outcome there is.
  }
}

/**
 * One failure, through the standard pipeline, answering with the handle a member is shown.
 *
 * The logger is built per call because class properties do not survive hibernation, and an
 * Analytics Engine logger costs nothing to construct.
 */
export function recordRoomFailure(room: RoomContext, operation: string, caught: unknown): string {
  return recordRealtimeFailure(realtimeLoggerFor(room.env), `meetings.room.${operation}`, caught);
}
