/*
 * The browser half of a meeting: one RTCPeerConnection, one signaling socket, and the state a
 * screen renders from.
 *
 * WHAT TALKS TO WHAT. Media never crosses a Worker. This client publishes its own microphone,
 * camera and screen to the Cloudflare Realtime selective forwarding unit and pulls everybody
 * else's back from it; the meeting room on the server is a broker that holds the roster and speaks
 * to the unit on this browser's behalf. So every frame here is signaling — an offer, an answer, a
 * list of track names — and never a byte of anybody's picture or voice.
 *
 * THIS FILE IS THE COMPOSITION, and the state. Every concern of a meeting lives in its own module
 * beside it — the socket and the frames (signaling.ts), the peer connection and the serialized
 * chain (negotiation.ts), what is coming in against what the plan wants (subscriptions.ts, over the
 * pure policy in subscription-policy.ts), what is captured and how it is offered (the effects stage
 * in media-effects.ts says what to capture with, and capture.ts offers it), what this browser says
 * about its own microphone (presence.ts), and the door somebody may be waiting at (lobby.ts). The
 * polls and the question queue are records the screen holds (polls.svelte.ts, questions.svelte.ts);
 * the room relays copies of them here and this file hands each one on. What is HERE is the runes
 * state a screen renders from and the wiring
 * that turns one module's answer into another's question. A new concern is a new module, not another
 * field on this class.
 *
 * ONE PEER CONNECTION, TRACKS NAMED BY WHO OWNS THEM. A track is named `<participantId>:<kind>`,
 * which is what lets a roster frame naming somebody else's tracks be turned into a pull without a
 * second lookup, and what lets a returned mid be traced back to the participant whose picture it
 * carries. A screen share is a second local video track under the `screen` kind rather than a
 * second connection: one connection is one negotiation, and two would have to be kept in step.
 *
 * EVERY EXTERNAL EDGE IS A CONSTRUCTOR SEAM. Creating the peer connection, opening the socket,
 * capturing media and making an empty stream all arrive as functions, so the whole state machine
 * runs under a test with fakes and the browser's own objects are only ever reached from
 * `browserMeetingSeams()`. Nothing in this file touches `navigator` or `window`.
 *
 * RECONNECTION IS NOT IN THIS SLICE. A socket that closes without the room having said the meeting
 * ended is a failure with the reason `socket-closed`, and the screen offers the way back in. A
 * client that silently re-dialled would re-open an attendance row nobody asked for, and attendance
 * is a record of who was actually in the room.
 */
import type { MeetingMedium } from "@magna-carta/meeting-protocol/types";
import { createBrowserAudioLevelMeter, type AudioLevelMeter } from "./audio-level-meter.ts";
import type { ConnectionQuality } from "./connection-quality.ts";
import { MeetingDiagnostics } from "./diagnostics.svelte.ts";
import { MeetingClock } from "./meeting-clock.svelte.ts";
import {
  captureScreenShare,
  offerCapturedTracks,
  offerMicrophoneTrack,
  offerScreenTrack,
} from "./capture.ts";
import {
  askToUnmuteDirective,
  mayActOn,
  mayRunTheMeeting,
  muteAllDirective,
  muteDirective,
  MUTED_BY_HOST_NOTICE,
  NOT_HOSTING_NOTICE,
  OPEN_ROOM_STATE,
  readDirective,
  readRoomState,
  spotlightDirective,
  type MeetingDirective,
  type MeetingHostRole,
  type MeetingRoomState,
} from "./host-controls.ts";
import {
  DENIED_REASON,
  DENIED_STATEMENT,
  NOT_ADMITTED_NOTICE,
  NOT_ADMITTED_REASON,
  readWaitingParticipants,
  readWaitingPlace,
  waitingPlaceStatement,
  type MeetingLobbyMode,
  type MeetingWaitingPlace,
  type WaitingParticipant,
} from "./lobby.ts";
import {
  DEFAULT_EFFECT_SETTINGS,
  NO_EFFECTS,
  passThroughEffects,
  type AppliedEffects,
  type EffectedCapture,
  type MediaEffectSettings,
  type MediaEffectsStage,
} from "./media-effects.ts";
import { NO_POLL_RELAY, readPoll, readPollTally, type MeetingPollRelay } from "./polls.svelte.ts";
import {
  NO_QUESTION_RELAY,
  readQuestion,
  readQuestionTally,
  type MeetingQuestionRelay,
} from "./questions.svelte.ts";
import { MeetingNegotiation } from "./negotiation.ts";
import { MeetingPresence } from "./presence.ts";
import {
  browserReactionSeams,
  handsInRaisedOrder,
  isMeetingReaction,
  MeetingReactions,
  readReactionCounts,
  UNNAMED_REACTOR,
  type MeetingReaction,
  type RaisedHand,
} from "./reactions.svelte.ts";
import type { MeetingChatRelay } from "./chat.svelte.ts";
import {
  isRecord,
  MeetingSignaling,
  namesAScreen,
  readChatMessage,
  readIdentifiers,
  readParticipants,
  readPreferredRid,
  readSessionDescription,
  readString,
  readSubscribedTracks,
  type MeetingParticipant,
  type MeetingRefusal,
  type MeetingTrack,
  type MeetingTrackKind,
} from "./signaling.ts";
import {
  MeetingSubscriptions,
  RECONCILE_DEBOUNCE_MILLISECONDS,
  type SubscriptionHost,
} from "./subscriptions.ts";
import {
  GALLERY_PAGE_SIZE,
  MAX_VIDEO_SUBSCRIPTIONS,
  SPEAKER_VIEW_PAGE_SIZE,
  subscriptionPolicy,
  type PreferredRid,
  type SubscriptionPlan,
} from "./subscription-policy.ts";

export { RECONCILE_DEBOUNCE_MILLISECONDS };
export { mayActOn, mayRunTheMeeting };
export { DENIED_REASON, DENIED_STATEMENT, waitingPlaceStatement };
export type {
  ConnectionQuality,
  MeetingDirective,
  MeetingHostRole,
  MeetingLobbyMode,
  MeetingMedium,
  MeetingParticipant,
  MeetingReaction,
  MeetingRefusal,
  MeetingRoomState,
  MeetingTrack,
  MeetingTrackKind,
  MeetingWaitingPlace,
  RaisedHand,
  WaitingParticipant,
};

/** The reason recorded when the signaling socket goes away without the meeting having ended. */
export const SOCKET_CLOSED_REASON = "socket-closed";

/**
 * The reason recorded when the room speaks a version of the protocol this page does not.
 *
 * It is the one failure a member can fix themselves and the only one where carrying on is worse
 * than stopping: every frame after the first mismatched one is being read against the wrong shape,
 * so a field that moved reads as a field that is missing and the room looks empty rather than
 * incompatible. A page left open across a deploy is how this happens, and reloading is the whole
 * remedy.
 */
export const PROTOCOL_MISMATCH_REASON = "protocol-mismatch";

/**
 * The reason a socket is closed because the SAME member opened a newer one: a second tab, or a
 * rejoin after a drop. The room keeps one live socket per stay and the newest wins, so this one is
 * over — and the stay it was holding now belongs to the socket that superseded it, which is why a
 * screen meeting this must not offer to walk back in and must not close the stay on its way out.
 */
export const SUPERSEDED_REASON = "superseded";

/**
 * The reason a socket is closed because a host put this member out of the meeting.
 *
 * Fatal, and there is no way back in from this screen: the record now says they are not in the room,
 * the join path refuses a member barred from this meeting, and offering Rejoin would be the screen
 * inviting somebody to be told no. It is the MEETING they are barred from and not the event.
 */
export const REMOVED_REASON = "removed";
/** The firm withdrew the guest link this socket arrived on; nobody is barred, inviting again is the way back. */
export const WITHDRAWN_REASON = "withdrawn";

/**
 * The refusals that END this browser's meeting. Everything else the room refuses is a setback: it
 * keeps the socket open, the roster keeps arriving, and the member is still in the room. Treating a
 * malformed frame or an unreachable unit as the end of a meeting throws somebody out of a room they
 * are still in, over a frame they never saw.
 */
const FATAL_REFUSAL_REASONS = new Set([
  "not-a-participant",
  "meeting-ended",
  SUPERSEDED_REASON,
  REMOVED_REASON,
  // The twin of `removed`, on the same terms: barred entry is one rule with two labels, and the
  // join path refuses them while the meeting runs.
  DENIED_REASON,
]);

/** A host frame from a socket holding no grant. The socket stays open; the member is told. */
const NOT_HOST_REASON = "not-host";

/**
 * A hand change or a reaction inside the room's signal window.
 *
 * Non-fatal and not a fault: the room refuses these rather than dropping them precisely so the
 * browser learns its act did not land and can settle the state again once the window passes.
 */
const RATE_LIMITED_REASON = "rate-limited";

/**
 * The refusals that mean the tracks just asked for are not coming: the unit could not be reached,
 * the room does not hold a track under the name it was asked for, or the room could not read the
 * frame that asked at all. Those tracks stop counting as pulled, so the next roster asks for them
 * again rather than waiting on media that was never sent.
 *
 * A frame the room could not read is the same outcome by a different route, and it was the one
 * missing here: a `subscribe` refused as malformed or as too large is a frame that was never
 * applied, while every track it named stays marked as coming in for the rest of the meeting. The
 * tiles it was for then stay black and nothing asks again, which is precisely the silent failure
 * this set exists to prevent.
 *
 * The room's other refusals are deliberately NOT here. A name refused as somebody else's, and a
 * track the room will not carry, are both about what THIS browser tried to publish — un-marking a
 * subscription over either would ask again for something nobody refused.
 */
const REFUSALS_THAT_LOSE_A_SUBSCRIPTION = new Set([
  "sfu-unavailable",
  "unknown-track",
  "malformed-frame",
  "frame-too-large",
]);

/**
 * Where a meeting stands from this browser's point of view.
 *
 * `waiting` is its own standing rather than a flag beside `joining`, and it has to be: a socket at
 * the door has no roster, no peer connection worth anything and — deliberately — no capture, so
 * every surface and every module that asks "is this browser in the room" would otherwise have to
 * remember to ask a second question. It settles to `live` on the welcome that follows an admission.
 */
export type MeetingState = "idle" | "joining" | "waiting" | "live" | "ended" | "failed";

/**
 * What one person's microphone is doing, as the room last relayed it.
 *
 * It is held APART from the roster rather than folded into it. A roster row is three hundred
 * people's names, handles and track lists, and it changes when somebody joins or leaves; these two
 * booleans change every time anybody in the room starts or stops talking, which in a discussion is
 * many times a second. Folded in, every one of those frames replaced the whole roster array — three
 * hundred fresh objects, and every surface reading the roster re-rendered — to carry one boolean
 * about one person.
 */
export interface MeetingPresenceFact {
  readonly speaking: boolean;
  readonly muted: boolean;
  /** Their hand is up. The third fact a tile shows, measured by the same browser as the other two. */
  readonly hand: boolean;
  /**
   * When the hand went up, for the queue a host works through. Null where it is down.
   *
   * THE ROSTER'S INSTANT WHERE THERE IS ONE, AND THIS BROWSER'S WHERE THERE IS NOT. The room stamps
   * the instant on the stored participant and carries it on every roster row, so a browser arriving
   * late sorts the queue from the roster alone. A `presence` frame is the other door and carries the
   * boolean without the instant — it is a small frame about a change, not a restatement of a record
   * — so a hand learned that way is stamped here, the way `#lastSpokeAt` is and for the same reason:
   * what is available is the order the frames arrived in, and a queue ordered by nothing is worse
   * than a queue ordered by that.
   */
  readonly handRaisedAt: string | null;
}

/** What the join route answered with, plus where the room's socket lives. */
export interface MeetingJoinRequest {
  readonly meetingId: string;
  readonly participantId: string;
  readonly iceServers: readonly RTCIceServer[];
  readonly socketUrl: string;
  /**
   * What this room carries. Left out, it is a video meeting — which is what every meeting was
   * before calls existed, and what the record says for every meeting opened before that day.
   */
  readonly medium?: MeetingMedium;
  /**
   * Whether this stay is at the DOOR rather than in the room, as the join answered it.
   *
   * It decides that nothing is captured: a browser that lit the camera indicator for somebody
   * standing at a door would be taking a picture nobody asked for. The socket is opened either way,
   * because the queue's own frames arrive on it and giving up is a frame sent along it.
   */
  readonly waiting?: boolean;
  /**
   * What this member chose for their own sound and picture, as this browser remembers it. Left out,
   * it is the default: no background treatment, and the browser's noise reduction on.
   *
   * It rides the join because it is applied at every capture, and a rejoin is a capture: somebody who
   * blurred once is blurred every time on this machine without opening the panel again.
   */
  readonly effects?: MediaEffectSettings;
}

/**
 * The edges this client reaches the outside world through. Every one of them is supplied, so the
 * state machine has no ambient dependency on a browser.
 */
export interface MeetingClientSeams {
  createPeerConnection: (configuration: RTCConfiguration) => RTCPeerConnection;
  openSocket: (url: string) => WebSocket;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
  /** An empty stream to gather one participant's incoming tracks into. */
  createMediaStream: () => MediaStream;
  /**
   * A running measurement of whether one captured track is carrying speech. Only ever this
   * browser's own microphone: who else is talking is a fact the room relays.
   */
  createAudioLevelMeter: (track: MediaStreamTrack) => AudioLevelMeter;
  /**
   * The stage between capture and publish: what to capture with, and what is done to the capture
   * before it is offered to the room.
   *
   * Left out, it is the pass-through with no platform question asked — which is what a fake in a test
   * wants, and exactly what a browser gets apart from the one name the real seam looks up.
   */
  createMediaEffects?: () => MediaEffectsStage;
}

/** The seams as a real browser supplies them. */
export function browserMeetingSeams(): MeetingClientSeams {
  return {
    createPeerConnection: (configuration) => new RTCPeerConnection(configuration),
    openSocket: (url) => new WebSocket(url),
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
    createMediaStream: () => new MediaStream(),
    createAudioLevelMeter: (track) => createBrowserAudioLevelMeter(track),
    // The one question about the platform the stage needs answered: whether this browser knows the
    // name `voiceIsolation` at all. Asked here because this is the one function in the client that
    // may touch `navigator`.
    createMediaEffects: () => passThroughEffects({ voiceIsolation: knowsVoiceIsolation() }),
  };
}

/**
 * Whether this browser has heard of voice isolation. Read through `Reflect` because the typings do
 * not list it, and answered no wherever the browser offers no list at all: a page served without a
 * secure context has no media devices, and a question about a name must not be what stops a room
 * from opening.
 */
function knowsVoiceIsolation(): boolean {
  const devices: MediaDevices | undefined = Reflect.get(navigator, "mediaDevices");
  if (devices === undefined || typeof devices.getSupportedConstraints !== "function") return false;
  return Reflect.get(devices.getSupportedConstraints(), "voiceIsolation") === true;
}

/**
 * What a refusal the meeting survived reads as, in words a member can act on.
 *
 * The reasons themselves are the room's own vocabulary — a member should never be shown
 * `malformed-frame` — and they group by what the reader can do about it: wait, because it will be
 * asked for again; or report it, because the Error ID beside the sentence is what support needs.
 */
export function refusalStatement(refusal: MeetingRefusal): string {
  switch (refusal.reason) {
    case SUPERSEDED_REASON:
      // The one fatal reason with a sentence here, because it is the one a member CAUSED and can
      // understand: the meeting is still running and they are still in it, somewhere else.
      return "You joined this meeting again from another tab or window, so this one has closed.";
    case DENIED_REASON:
      // The second fatal reason with a sentence of its own, and for the opposite reason to the one
      // above: nothing here is a fault of this browser's, and somebody decided it about them by
      // name. A screen that said only "the room refused something" would leave them pressing Join.
      return DENIED_STATEMENT;
    case "sfu-unavailable":
      return "The service that carries the pictures and sound could not be reached. What was asked for will be asked for again.";
    case "unknown-track":
      return "Somebody's picture or sound was asked for under a name the room no longer holds. It will be asked for again.";
    case "foreign-track-name":
      // A publish under a name that is not this browser's own. Nothing the member did causes it and
      // nothing they can do fixes it, so the sentence says what is missing and the Error ID beside
      // it is what carries the rest.
      return "Something this page offered the room was named wrongly, so it is not being sent. Nobody else can see or hear it.";
    case "track-limit-reached":
      return "The room will not carry any more from one person, so this was not added. Stopping a screen share makes room for it.";
    case "track-kind-refused":
      // The room is a CALL. Nothing here can change that — the medium is settled when the room is
      // opened, because everybody in it agreed to the same thing.
      return "This is a call, so only sound is carried in it. Nothing you can see was sent.";
    case "malformed-frame":
    case "frame-too-large":
    case "binary-unsupported":
    case "unknown-frame":
      return "The room did not understand something this page sent, and ignored it.";
    default:
      return "The room refused something this page asked for, and carried on without it.";
  }
}

export class MeetingClient {
  /** Where the meeting stands. The screen renders from this and nothing else. */
  state = $state<MeetingState>("idle");
  /**
   * Why it failed: the reason the room refused with, or `socket-closed` where the signaling socket
   * went away on its own. Null while nothing has failed.
   */
  failureReason = $state<string | null>(null);
  /** Everybody in the room, this browser included, as the roster last stated them. */
  participants = $state<readonly MeetingParticipant[]>([]);
  /** This browser's own camera and microphone. Null until `publish` has captured them. */
  localStream = $state<MediaStream | null>(null);
  /** This browser's screen share. Null unless one is running. */
  screenStream = $state<MediaStream | null>(null);
  /** One stream per other participant, holding their camera and microphone as they are pulled. */
  remoteStreams = $state<ReadonlyMap<string, MediaStream>>(new Map());
  /**
   * One stream per other participant who is sharing a screen.
   *
   * It is kept apart from the camera stream on purpose: a video element plays the first video
   * track of the stream it is given, so a share folded in beside a camera would make the two tiles
   * a coin toss over which picture each one drew.
   */
  remoteScreens = $state<ReadonlyMap<string, MediaStream>>(new Map());
  /** Whether the local microphone is sending. Capture is unchanged either way. */
  microphoneOn = $state(true);
  /** Whether the local camera is sending. */
  cameraOn = $state(true);
  /** Whether a screen share is running. */
  sharing = $state(false);
  /**
   * Why the camera or microphone could not be captured, where that is what happened. A refusal
   * here does NOT end the meeting: a member who declined the camera is still in the room and can
   * still see and hear everybody else, and the screen says what is missing.
   */
  captureRefusal = $state<string | null>(null);
  /**
   * The room's last refusal that the meeting survived, for the screen to state. A refusal here is
   * about one frame, not about the meeting: the socket is open, the roster is still arriving, and
   * whatever was asked for can be asked for again.
   */
  lastRefusal = $state<MeetingRefusal | null>(null);
  /**
   * The last negotiation step that did not finish, in the words a member reads. Nothing here ends
   * the meeting either — the connection is where the failed step left it and the next frame is
   * still worth applying — but a step that fails silently is a picture that never arrives with
   * nothing on the screen saying so.
   */
  lastProblem = $state<string | null>(null);
  /**
   * What a host did TO this member, in the words they read.
   *
   * It is not a refusal and not a fault: a microphone that goes dead with nothing on screen is read
   * as a broken machine, so the screen says what happened. Cleared by the member's own next act on
   * the thing it is about.
   */
  lastNotice = $state<string | null>(null);
  /**
   * A host has ASKED this member to unmute, and nothing has happened yet.
   *
   * There is no frame in this protocol that opens somebody's microphone, and that absence is the
   * design: the member may be in a room with a client, on a call they muted themselves for precisely
   * so that the next two minutes were not in the meeting. Their screen offers Unmute and Stay muted,
   * and this is what it renders from.
   */
  unmuteRequest = $state<MeetingDirective | null>(null);
  /** Who last muted this member, and when. Null while no host has. */
  mutedBy = $state<MeetingDirective | null>(null);
  /**
   * What is true of the room rather than of anybody in it: who is on every screen, and whether the
   * door is shut. Replaced whole by each `room-state`, and carried inline on the `welcome`.
   */
  roomState = $state<MeetingRoomState>(OPEN_ROOM_STATE);
  /**
   * Where this browser stands at the door, as the room last stated it. Null once it is through one,
   * and null for everybody who never waited.
   */
  waiting = $state<MeetingWaitingPlace | null>(null);
  /**
   * Who is at the door, for a member running the meeting. Empty for everybody else, which is what
   * the room sends them: who is outside a room is a list of people a host has not yet decided about.
   */
  lobbyList = $state<readonly WaitingParticipant[]>([]);

  /** This browser's own participant, as the room named it. */
  participantId = $state<string | null>(null);
  /** The meeting being attended. */
  meetingId = $state<string | null>(null);
  /**
   * What this room carries, as the join stated it. It decides what is captured and what is offered,
   * and it never changes while a meeting is open — the room refuses a picture published into a call,
   * so a client that changed its mind would only be refused.
   */
  medium = $state<MeetingMedium>("video");

  /**
   * What this member asked for their own sound and picture. Set by the join, and by the member
   * changing it in the Effects panel; applied at every capture.
   */
  effectSettings = $state<MediaEffectSettings>(DEFAULT_EFFECT_SETTINGS);
  /**
   * What the browser reported doing once the effects were asked for — read off the tracks, never
   * assumed from what was asked. Null until something has been captured, which is also what tells
   * the Effects control there is nothing yet to treat.
   */
  appliedEffects = $state<AppliedEffects | null>(null);

  /** The gallery page being shown, counted from zero. */
  page = $state(0);
  /**
   * Whoever this member has pinned, in the order they pinned them. It is LOCAL: pinning changes
   * what this browser pulls and where it draws somebody, and says nothing to anybody else in the
   * room — a member cannot rearrange a colleague's screen.
   */
  pinned = $state<readonly string[]>([]);
  /** Whether the room is drawn as one large speaker with a strip, rather than an even gallery. */
  speakerView = $state(false);

  /**
   * When each participant was last heard speaking, on THIS browser's clock.
   *
   * The presence frame carries the room's own `at`, and it is deliberately not what is stored: the
   * room's clock and this browser's clock are not the same clock, and an ordering built from a
   * mixture of the two puts somebody who spoke a moment ago behind somebody who spoke a minute ago
   * on a machine whose time is out. What matters is the order the frames arrived in, which is what
   * stamping them here records.
   */
  #lastSpokeAt = $state<ReadonlyMap<string, number>>(new Map());

  /**
   * What each participant's microphone is doing, as the presence frames have stated it.
   *
   * Beside the roster and never inside it: see `MeetingPresenceFact`. A participant with no entry
   * here has had nothing said about them since the last roster, so the roster's own two booleans
   * are the answer — which is what `presenceOf` resolves.
   */
  #presenceByParticipant = $state<ReadonlyMap<string, MeetingPresenceFact>>(new Map());

  /** The clock the plan ages recent speakers against, ticking for as long as the meeting is live. */
  readonly #clock = new MeetingClock();

  /**
   * What the connection is doing, and what has happened on the wire.
   *
   * Public because the screen reads the marks straight off it, and its own concern rather than a
   * set of fields here: a connection-quality sample is a module, which is the rule this directory
   * is arranged by. Nothing it holds is written anywhere or put on the meeting's record.
   */
  readonly diagnostics: MeetingDiagnostics;

  /**
   * A raised hand and a thrown reaction: the two signals the record never keeps.
   *
   * Public because the screen renders the bubbles, the counts strip and the hand's own control
   * straight off it, and its own concern rather than a set of fields here — the rule this directory
   * is arranged by. Nothing it holds outlives the meeting, and nothing in it is written anywhere.
   */
  readonly reactions: MeetingReactions;

  /** Everybody but this browser — the people the gallery pages over. */
  readonly others = $derived(
    this.participants.filter((participant) => participant.participantId !== this.participantId),
  );

  /**
   * Whether this member is running this meeting, and in which of the two ways.
   *
   * Read off the ROSTER rather than held as a fact of its own, because the roster is where a grant
   * written or withdrawn during the meeting arrives: the hosting routes rewrite the room's stored
   * records and the room broadcasts the change, so a co-host whose grant was withdrawn loses their
   * menus on the next roster rather than on their next reload.
   */
  readonly myRole = $derived<MeetingHostRole | null>(
    this.participants.find((participant) => participant.participantId === this.participantId)
      ?.hostRole ?? null,
  );

  /** Whether this member may run the meeting at all. What every host surface is shown behind. */
  readonly hosting = $derived(mayRunTheMeeting(this.myRole));

  /**
   * Everybody with a hand up, in the order the hands went up.
   *
   * THE CLIENT IS WHAT SORTS, NEVER THE ROOM: the room relays facts and the browser arranges them,
   * which is the same division the subscription policy already holds and for the same reason — a
   * room of three hundred must not be asked to keep a sorted list in storage and rewrite it on
   * every change. It is a pure derivation of what every browser already holds.
   */
  readonly raisedHands = $derived<readonly RaisedHand[]>(
    handsInRaisedOrder(
      this.participants
        .map((participant) => {
          const presence = this.presenceOf(participant);
          return {
            participantId: participant.participantId,
            handRaisedAt: presence.handRaisedAt,
            hand: presence.hand,
          };
        })
        .filter((row) => row.hand),
    ),
  );

  /**
   * What should be coming in, and what the gallery should be drawing. Everything the screen renders
   * about who is shown, and everything `reconcile` asks the room for, comes from here.
   */
  readonly plan: SubscriptionPlan = $derived(
    subscriptionPolicy({
      medium: this.medium,
      self: this.participantId ?? "",
      participants: this.participants.map((participant) => {
        const presence = this.presenceOf(participant);
        return {
          participantId: participant.participantId,
          sfuSessionId: participant.sfuSessionId,
          tracks: participant.tracks,
          speaking: presence.speaking,
          muted: presence.muted,
          lastSpokeAt: this.#lastSpokeAt.get(participant.participantId) ?? null,
        };
      }),
      pinned: this.pinned,
      // A fact about the ROOM, which is why it outranks this member's own pins rather than sitting
      // among them: a pin arranges one screen, a spotlight arranges every screen at once.
      spotlight: this.roomState.spotlight?.participantId ?? null,
      page: this.page,
      pageSize: this.speakerView ? SPEAKER_VIEW_PAGE_SIZE : GALLERY_PAGE_SIZE,
      // The room's own ticking clock, never `Date.now()` read here. The policy ages a speaker out
      // of the recent-speakers band five minutes after they stop, and read straight off the system
      // clock that window would only ever close when some OTHER change made this be worked out
      // again — so in a room that has gone quiet it never closes at all. meeting-clock.svelte.ts.
      now: this.#clock.now,
    }),
  );

  /** How many gallery pages the room takes. Always at least one. */
  readonly pages = $derived(this.plan.pages);
  /** The participants drawn on this page, in order. This browser's own preview is not among them. */
  readonly shown = $derived(this.plan.shown);

  readonly #seams: MeetingClientSeams;
  readonly #signaling: MeetingSignaling;
  readonly #negotiation: MeetingNegotiation;
  readonly #subscriptions: MeetingSubscriptions;
  readonly #presence = new MeetingPresence();

  /** What the effects stage handed back for this browser's own capture. Null before one. */
  #capture: EffectedCapture | null = null;
  /** The screen share's transceiver mid, which is what closing it names. */
  #screenMid: string | null = null;
  /**
   * The media section this browser's microphone goes up, so coming back after a host's mute reuses
   * it rather than adding one. A meeting where a host mutes the room repeatedly would otherwise
   * grow a section per return, for the length of the meeting.
   */
  #microphoneMid: string | null = null;
  /**
   * True while this browser's microphone is closed AT THE ROUTING SERVICE because a host muted it.
   *
   * It is what makes un-muting afterwards a republish rather than a flipped flag. A member's own
   * mute leaves the track up and carrying silence, so flipping `enabled` back is the whole of it; a
   * host's mute takes the track away at the far end, and a browser that only flipped a flag would
   * show itself as sending while nobody could hear it for the rest of the meeting.
   */
  #microphoneClosedUpstream = false;
  /**
   * True while this stay is at the DOOR, which is what stops anything being captured.
   *
   * It is held apart from the standing rather than read off it because it answers a narrower
   * question — "may this browser open a device" — and the standing changes for reasons that have
   * nothing to do with the door.
   */
  #waitingAtTheDoor = false;
  /**
   * True between an admission and the welcome that follows it, so the client publishes on arrival
   * exactly as it would have on an ordinary join. A member let in at the twentieth minute should
   * not have to press anything to be seen.
   */
  #publishOnWelcome = false;
  /** True once this browser asked to leave, so the socket closing is expected rather than a fault. */
  #leaving = false;
  /**
   * Where a relayed message goes. A no-op until the screen that READS the transcript wires itself
   * in, so a client with no chat panel beside it drops the frame rather than holding a record.
   */
  #chat: MeetingChatRelay = {
    noteMessageFrame: () => {},
    noteMessageRedacted: () => {},
  };
  /** Where a relayed poll goes. A no-op until the screen that holds the polls wires itself in. */
  #polls: MeetingPollRelay = NO_POLL_RELAY;
  /** Where a relayed question goes, on the same terms. */
  #questions: MeetingQuestionRelay = NO_QUESTION_RELAY;
  /** The stage every capture passes through on its way to the room. */
  readonly #effects: MediaEffectsStage;

  constructor(
    seams: MeetingClientSeams,
    diagnostics: MeetingDiagnostics = new MeetingDiagnostics(),
  ) {
    this.#seams = seams;
    this.#effects = seams.createMediaEffects?.() ?? passThroughEffects();
    this.diagnostics = diagnostics;
    this.reactions = new MeetingReactions(
      browserReactionSeams(
        (frame) => this.#signaling.send(frame),
        // The two facts a presence frame has to carry whole, as the room was last told them: a
        // frame that stated the hand and guessed at the other two would relay a speaking
        // transition nobody measured.
        () => this.#presence.announced(),
      ),
    );
    this.#negotiation = new MeetingNegotiation((problem) => {
      this.lastProblem = problem;
    });
    const host: SubscriptionHost = {
      plan: () => this.plan,
      isLive: () => this.state === "live",
      send: (frame) => this.#signaling.send(frame),
      attachRemoteTrack: (participantId, trackName, track) =>
        this.#attachRemoteTrack(participantId, trackName, track),
      detachRemoteTrack: (participantId, screen, media) =>
        this.#detachRemoteTrack(participantId, screen, media),
      releaseRemote: (participantId, screen) => this.#releaseRemote(participantId, screen),
      remoteOwners: (screen) => [...(screen ? this.remoteScreens : this.remoteStreams).keys()],
    };
    this.#subscriptions = new MeetingSubscriptions(host, diagnostics);
    this.#signaling = new MeetingSignaling(
      seams.openSocket,
      {
        welcome: (frame) => this.#handleWelcome(frame),
        roster: (frame) => this.#adoptRoster(readParticipants(frame.participants)),
        rosterDelta: (frame) => this.#handleRosterDelta(frame),
        presence: (frame) => this.#handlePresence(frame),
        reaction: (frame) => this.#handleReaction(frame),
        reactions: (frame) => {
          // The strip and a bubble are drawn in different places, so a room that sends counts to
          // everybody — reactors included — is not counting anybody twice on any screen.
          this.reactions.noteCounts(readReactionCounts(frame.counts));
        },
        message: (frame) => {
          const message = readChatMessage(frame.message);
          if (message !== null) this.#chat.noteMessageFrame(message);
        },
        messageRedacted: (frame) => {
          const messageId = readString(frame, "messageId");
          const redactedAt = readString(frame, "redactedAt");
          if (messageId !== null && redactedAt !== null) {
            this.#chat.noteMessageRedacted(messageId, redactedAt);
          }
        },
        // The poll and the question queue are records the SCREEN holds, like the transcript: each of
        // these is a copy of a committed row, handed on through the relay the screen wired in.
        pollOpened: (frame) => {
          const poll = readPoll(frame.poll);
          if (poll !== null) this.#polls.notePollOpened(poll);
        },
        pollClosed: (frame) => {
          const pollId = readString(frame, "pollId");
          const closedAt = readString(frame, "closedAt");
          if (pollId === null || closedAt === null) return;
          this.#polls.notePollClosed(pollId, closedAt, readPollTally(frame));
        },
        pollTally: (frame) => {
          const pollId = readString(frame, "pollId");
          const tally = readPollTally(frame);
          if (pollId !== null && tally !== null) this.#polls.notePollTally(pollId, tally);
        },
        questionAsked: (frame) => {
          const question = readQuestion(frame.question);
          if (question !== null) this.#questions.noteQuestionAsked(question);
        },
        questionUpdated: (frame) => {
          const question = readQuestion(frame.question);
          if (question !== null) this.#questions.noteQuestionUpdated(question);
        },
        questionTally: (frame) => {
          this.#questions.noteQuestionTally(readQuestionTally(frame));
        },
        layered: (frame) => this.#handleLayered(frame),
        published: (frame) =>
          void this.#negotiation.enqueue(
            "The room's answer to what you are sending was not applied.",
            () => this.#negotiation.applyRemote(readSessionDescription(frame.sessionDescription)),
          ),
        subscribed: (frame) =>
          void this.#negotiation.enqueue("Somebody else's picture and sound did not come in.", () =>
            this.#handleSubscribed(frame),
          ),
        // The room accepted the answer this browser sent and the exchange is closed: there is nothing
        // to apply and nothing owed back. Wired explicitly rather than left to fall through, because
        // a frame with no handler and a frame whose handler has nothing to do read identically from
        // outside and mean opposite things — the first is a wire the two ends disagree about.
        renegotiated: () => {},
        closed: (frame) =>
          void this.#negotiation.enqueue(
            "The room's change to what is being sent was not applied.",
            () => this.#answerIfOffered(readSessionDescription(frame.sessionDescription)),
          ),
        roomState: (frame) => this.#handleRoomState(frame),
        muted: (frame) => this.#handleMuted(frame),
        unmuteRequested: (frame) => {
          this.unmuteRequest = readDirective(frame);
        },
        lobby: (frame) => {
          this.waiting = readWaitingPlace(frame);
        },
        admitted: () => this.#handleAdmitted(),
        waiting: (frame) => {
          this.lobbyList = readWaitingParticipants(frame.participants);
        },
        ended: () => {
          this.#leaving = true;
          this.state = "ended";
          this.#teardown();
        },
        refused: (frame) => this.#handleRefused(frame),
        // A room speaking a protocol this page does not know. Nothing is retried and nothing is read
        // further: the screen says to reload, which is the whole remedy.
        incompatible: () => this.#fail(PROTOCOL_MISMATCH_REASON),
        lost: () => {
          if (this.#leaving || this.state === "ended" || this.state === "failed") return;
          this.#fail(SOCKET_CLOSED_REASON);
        },
      },
      diagnostics,
    );
  }

  /**
   * Open the peer connection and the signaling socket. The room answers with `welcome` — or, for a
   * stay the join put at the door, with `lobby` and nothing else until a host admits them.
   */
  join(request: MeetingJoinRequest): void {
    if (this.state === "joining" || this.state === "waiting" || this.state === "live") return;
    this.#reset();
    this.#waitingAtTheDoor = request.waiting === true;
    this.state = this.#waitingAtTheDoor ? "waiting" : "joining";
    this.meetingId = request.meetingId;
    this.participantId = request.participantId;
    this.medium = request.medium ?? "video";
    this.effectSettings = request.effects ?? DEFAULT_EFFECT_SETTINGS;
    // The clock starts with the meeting, because what it ages — who spoke recently — starts being
    // recorded the moment the first roster arrives.
    this.#clock.start(() => this.#subscriptions.schedule());
    this.#negotiation.open(
      this.#seams.createPeerConnection({ iceServers: [...request.iceServers] }),
    );
    // Sampling starts with the connection rather than with the first publish: a member who declined
    // their camera still has a connection that can be failing, and the round trip is the same
    // number either way.
    this.diagnostics.start({
      readStats: () => this.#negotiation.connection?.getStats() ?? null,
      // The media sections are only meaningful with somebody's name on them, and the module that
      // asked for each track is the one that knows whose it is.
      ownerOfMid: (mid) => this.#subscriptions.ownerOfMid(mid),
      screenMid: () => this.#screenMid,
      participantId: () => this.participantId,
      // A socket still at the door may send nothing but the keepalive, and sampling starts before
      // that door has opened — so the report asks whether this browser is in the room at all.
      isLive: () => this.state === "live",
      send: (frame) => this.#signaling.send(frame),
    });
    this.#signaling.open(request.socketUrl);
  }

  /**
   * Take who is at the door from a READ rather than from a frame.
   *
   * The frames are the ordinary source and they are live: the room re-sends the whole list to every
   * socket holding a grant as the queue moves. What they cannot cover is the socket that was not
   * holding one when the last arrival happened — a member named co-host at the twentieth minute is
   * sent the roster that says so and nothing about the people already standing outside, so their
   * count and their panel would both read empty until somebody else arrived. The read closes that,
   * and lands here rather than beside it so that one list answers the question everywhere.
   *
   * IT NEVER WRITES OVER WHAT THE WIRE SAID. A read is at best as current as the moment it was
   * asked, and a frame is what the room holds now — so a read whose answer arrives after a `waiting`
   * frame would put a stale list back, and the list it puts back would be the one a host acts on.
   * It fills a gap or it does nothing.
   */
  noteWhoIsWaiting(waiting: readonly WaitingParticipant[]): void {
    if (this.lobbyList.length > 0) return;
    this.lobbyList = waiting;
  }

  /**
   * Let the transcript hear what the room relays.
   *
   * The screen wires this because the screen is what holds the transcript: a message is a route and
   * a row, and the client's job is to carry the copy the room sends so it arrives as it is said
   * rather than on the poll's next tick.
   */
  relayMessagesTo(chat: MeetingChatRelay): void {
    this.#chat = chat;
  }

  /**
   * Let the polls and the question queue hear what the room relays.
   *
   * On the transcript's own terms: both are records the screen holds, written by routes and read
   * back by pages, and the room's frames are copies of committed rows that reach three hundred
   * browsers at once rather than on each one's next read.
   */
  relayPollsTo(polls: MeetingPollRelay): void {
    this.#polls = polls;
  }

  relayQuestionsTo(questions: MeetingQuestionRelay): void {
    this.#questions = questions;
  }

  /**
   * Change what is done to this member's own sound and picture, without capturing again.
   *
   * What comes back is read off the tracks, so the panel shows what the browser did rather than what
   * was asked; where nothing has been captured yet, the choice is held and applied at the capture.
   */
  async changeEffects(settings: MediaEffectSettings): Promise<void> {
    this.effectSettings = settings;
    const capture = this.#capture;
    if (capture === null) return;
    const applied = await capture.update(settings);
    // A capture that went away while the browser was answering is not one to report on.
    if (this.#capture === capture) this.appliedEffects = applied;
  }

  /**
   * Put this member's hand up, or take it down.
   *
   * It goes out on the ORDINARY presence frame, paced against the window the room refuses on.
   * Answers false where the window has not passed, which is what a control reads to say nothing
   * happened; the room's own refusal, if one arrives anyway, is answered by re-sending the settled
   * hand rather than by telling the member their meeting is broken.
   */
  raiseHand(): boolean {
    return this.reactions.raiseHand();
  }

  lowerHand(): boolean {
    return this.reactions.lowerHand();
  }

  /** Throw one of the six reactions. Answers whether it left, so a menu closes on an act. */
  react(name: MeetingReaction): boolean {
    return this.reactions.react(name, this.participantId);
  }

  /**
   * A host putting a hand down: one, or every hand in the room.
   *
   * A host's OWN hand goes down with the rest — clearing the floor is clearing it — which is the
   * opposite of the mute-all rule and deliberately so: mute-all exists so a host can speak, and
   * this exists so a host can start the queue again.
   */
  lowerHands(participantId: string | null): void {
    this.reactions.lowerHands(participantId, this.participantId);
  }

  /** How somebody else's picture and sound are arriving, for a surface that draws the mark. */
  qualityOf(participantId: string): ConnectionQuality {
    return this.diagnostics.qualityOf(participantId);
  }

  /**
   * What somebody's microphone is doing: what the presence frames have said where any have, and
   * what the roster itself stated where none have.
   *
   * Every surface that draws a speaking or a muted mark asks HERE rather than reading the two
   * booleans off a roster row, because the roster row is only ever as current as the last roster.
   */
  presenceOf(participant: MeetingParticipant): MeetingPresenceFact {
    return (
      this.#presenceByParticipant.get(participant.participantId) ?? {
        speaking: participant.speaking,
        muted: participant.muted,
        hand: participant.hand,
        handRaisedAt: participant.handRaisedAt,
      }
    );
  }

  /**
   * Capture what this room carries and offer it to the unit: the microphone and camera in a meeting,
   * the microphone alone in a call.
   *
   * The mids are read AFTER the local description is set, because that is when the browser assigns
   * them; read before, every track would be named with a null mid and the unit would have nothing
   * to match the offer's media sections against.
   *
   * THE OFFER IS MADE IN THE NEGOTIATION QUEUE, not beside it. Capturing is slow and an incoming
   * offer from the unit can land in the middle of it; two session descriptions applied at once is an
   * invalid-state error the browser raises from whichever one lost, and the one that loses is
   * usually this one — a member who publishes as somebody else joins is then in the room seeing
   * everybody while nobody sees them.
   */
  async publish(): Promise<void> {
    const peerConnection = this.#negotiation.connection;
    if (peerConnection === null || this.localStream !== null) return;
    /*
     * NOTHING IS CAPTURED AT THE DOOR, and this is the guard rather than a decision the screen
     * makes. A browser that lit the camera indicator for somebody standing outside a room would be
     * taking a picture nobody asked for, and the screen calls this on arrival whether or not the
     * join put them in a queue — so the one place that knows they are waiting is the one that
     * refuses. The admission itself asks again.
     */
    if (this.#waitingAtTheDoor) return;

    const wantsPicture = this.medium === "video";
    const settings = this.effectSettings;
    /*
     * CAPTURE, THEN EFFECTS, THEN PUBLISH. The stage says what to capture with — the microphone's
     * treatment asked for by name as plain booleans, never exactly, so a device that cannot give one
     * is captured untreated rather than not at all — and whatever it hands back is what everything
     * below treats as this browser's own stream.
     */
    let captured: MediaStream;
    try {
      captured = await this.#seams.getUserMedia(
        this.#effects.captureConstraints(this.medium, settings),
      );
    } catch {
      // A member who declined the camera is still in the room and can still see and hear
      // everybody else, so the refusal is stated rather than thrown.
      this.captureRefusal = wantsPicture
        ? "The microphone and camera are not available in this browser."
        : "The microphone is not available in this browser.";
      return;
    }
    const effected = await this.#applyEffects(captured, settings);
    const stream = effected.stream;
    this.#capture = effected;
    this.appliedEffects = effected.applied;
    this.localStream = stream;
    this.captureRefusal = null;
    this.microphoneOn = stream.getAudioTracks().length > 0;
    this.cameraOn = stream.getVideoTracks().length > 0;
    this.#presence.watch(
      stream,
      (track) => this.#seams.createAudioLevelMeter(track),
      () => this.microphoneOn,
      (speaking, muted) => this.#announcePresence(speaking, muted),
    );

    const notOffered = wantsPicture
      ? "Your camera and microphone were not offered to the room."
      : "Your microphone was not offered to the room.";
    await this.#negotiation.enqueue(notOffered, async () => {
      const offered = offerCapturedTracks(peerConnection, stream, wantsPicture);
      const sessionDescription = await this.#negotiation.offer(peerConnection);
      // Read AFTER the local description, like every other mid here: a transceiver has none until
      // the browser has described the connection it sits on.
      this.#microphoneMid =
        offered.find((entry) => entry.kind === "audio")?.transceiver.mid ?? null;
      this.#signaling.send({
        type: "publish",
        sessionDescription,
        tracks: offered.map((entry) => ({
          trackName: this.#trackName(entry.kind),
          mid: entry.transceiver.mid,
          kind: entry.kind,
        })),
      });
    });
  }

  /**
   * Put a capture through the effects stage, and never lose the capture to the stage.
   *
   * A STAGE THAT THROWS LEAVES THE MEMBER CAPTURING UNPROCESSED, RATHER THAN NOT AT ALL. The member
   * agreed to be seen and heard; an effect is something extra they asked for. A processing stage
   * failing is therefore a reason to publish the capture as it came and say the effects are not
   * running — never a reason to stand them in the room silent and invisible.
   */
  async #applyEffects(
    captured: MediaStream,
    settings: MediaEffectSettings,
  ): Promise<EffectedCapture> {
    try {
      return await this.#effects.applyEffects(captured, settings);
    } catch {
      const unprocessed = await passThroughEffects().applyEffects(captured, NO_EFFECTS);
      return {
        stream: unprocessed.stream,
        applied: {
          ...unprocessed.applied,
          refusal:
            "Your sound and picture are being sent as captured, without the effects you chose.",
        },
        update: (next) => unprocessed.update(next),
        setSourceEnabled: (kind, enabled) => unprocessed.setSourceEnabled(kind, enabled),
        close: () => unprocessed.close(),
      };
    }
  }

  /**
   * Make the plan true: ask for what should be coming in, close what should not, and move the layer
   * of anything the plan now wants at a different size.
   */
  reconcile(): void {
    this.#subscriptions.reconcile();
  }

  /** Show a different page of the gallery. Out of range is clamped rather than refused. */
  setPage(page: number): void {
    const next = Math.min(Math.max(0, Math.floor(page)), this.pages - 1);
    if (next === this.page) return;
    this.page = next;
    this.#subscriptions.schedule();
  }

  /**
   * Keep somebody on screen whatever the room does.
   *
   * It moves them to the front of the order, which is the first page — so the gallery goes there
   * too. Pinning somebody on page eleven and watching them vanish from page eleven is the one
   * outcome a member would read as the control not working.
   *
   * THERE IS A CEILING, AND IT IS THE CAMERA CAP. A browser pulls at most `MAX_VIDEO_SUBSCRIPTIONS`
   * cameras, so a seventeenth pin is a person the first page cannot draw and the connection will
   * not fetch: they would sit pinned, off every page and with nothing coming in, which reads as the
   * pin having silently failed. It is said instead, and nothing is pinned.
   */
  pin(participantId: string): void {
    if (this.pinned.includes(participantId)) return;
    if (this.pinned.length >= MAX_VIDEO_SUBSCRIPTIONS) {
      // The number comes from the cap itself rather than being spelled out, so the sentence cannot
      // go on saying sixteen after the cap has moved.
      this.lastProblem = `Only ${MAX_VIDEO_SUBSCRIPTIONS} people can be kept on screen at once. Unpin somebody to keep somebody else.`;
      return;
    }
    this.pinned = [...this.pinned, participantId];
    this.page = 0;
    this.#subscriptions.schedule();
  }

  /** Stop keeping somebody on screen. They fall back to wherever the room's own order puts them. */
  unpin(participantId: string): void {
    if (!this.pinned.includes(participantId)) return;
    this.pinned = this.pinned.filter((pinned) => pinned !== participantId);
    this.#subscriptions.schedule();
  }

  /** Whether this member is holding somebody on screen. */
  isPinned(participantId: string): boolean {
    return this.pinned.includes(participantId);
  }

  /** Swap between the even gallery and one large speaker with a strip of recent ones beside it. */
  toggleSpeakerView(): void {
    this.speakerView = !this.speakerView;
    this.page = 0;
    this.#subscriptions.schedule();
  }

  /**
   * Capture a screen or a window and publish it as a second video track.
   *
   * A CALL REFUSES THIS HERE, not at the room. A screen share is a video track, the room would
   * refuse it (`track-kind-refused`), and the picker would already have been opened and a screen
   * already chosen by then — so the refusal is stated before anybody is asked to choose anything.
   */
  async shareScreen(): Promise<void> {
    const peerConnection = this.#negotiation.connection;
    if (peerConnection === null || this.sharing) return;
    if (this.medium !== "video") {
      this.lastProblem = "This is a call, so there is no picture in it to share a screen into.";
      return;
    }

    const stream = await captureScreenShare(this.#seams);
    if (stream === null) return;
    const [track] = stream.getVideoTracks();
    if (track === undefined) return;

    this.screenStream = stream;
    this.sharing = true;
    // Stopping the share from the browser's own control is the same act as pressing Stop here, so
    // it runs the same path rather than leaving the room believing the share is still up.
    track.addEventListener("ended", () => {
      void this.stopSharing();
    });

    // In the queue for the reason `publish` is: the picker is open for as long as the member takes
    // to choose a window, and whatever the room sends in the meantime is a description this would
    // otherwise collide with.
    await this.#negotiation.enqueue("Your screen was not offered to the room.", async () => {
      const transceiver = offerScreenTrack(peerConnection, track);
      const sessionDescription = await this.#negotiation.offer(peerConnection);
      this.#screenMid = transceiver.mid;
      this.#signaling.send({
        type: "publish",
        sessionDescription,
        tracks: [
          {
            trackName: this.#trackName("screen"),
            mid: transceiver.mid,
            kind: "screen",
          },
        ],
      });
    });
  }

  /**
   * Offer the microphone again after a host closed it at the routing service.
   *
   * IN THE NEGOTIATION QUEUE, like every other offer: an incoming description from the unit can land
   * in the middle of this one, and two applied at once is an invalid-state error the browser reports
   * from whichever lost — which here would leave the member believing they had come back.
   *
   * The device's own track is what goes up the new section. Nothing stopped it: the close happened
   * at the far end, so the member is not asked for their microphone a second time.
   */
  async #republishMicrophone(): Promise<void> {
    const peerConnection = this.#negotiation.connection;
    const stream = this.localStream;
    if (peerConnection === null || stream === null) return;
    const [track] = stream.getAudioTracks();
    if (track === undefined) return;

    await this.#negotiation.enqueue(
      "Your microphone was not offered to the room again.",
      async () => {
        // The section the microphone last went up is reused, so a member muted and unmuted twenty
        // times over an hour leaves the description exactly as long as it started.
        const transceiver = await offerMicrophoneTrack(peerConnection, track, this.#microphoneMid);
        const sessionDescription = await this.#negotiation.offer(peerConnection);
        this.#microphoneMid = transceiver.mid;
        this.#signaling.send({
          type: "publish",
          sessionDescription,
          tracks: [{ trackName: this.#trackName("audio"), mid: transceiver.mid, kind: "audio" }],
        });
      },
    );
  }

  /** Stop sharing and tell the room which media section went away. */
  async stopSharing(): Promise<void> {
    if (!this.sharing) return;
    this.sharing = false;
    const stream = this.screenStream;
    this.screenStream = null;
    if (stream !== null) for (const track of stream.getTracks()) track.stop();
    const mid = this.#screenMid;
    this.#screenMid = null;
    if (mid !== null) this.#signaling.send({ type: "close", mids: [mid] });
  }

  /**
   * Mute or unmute the microphone.
   *
   * TWO KINDS OF MUTE MEET HERE, and they undo differently. This member's own mute leaves the track
   * up and carrying silence, so turning it back on is the source being re-enabled and nothing
   * renegotiates. A HOST's mute closed the track at the routing service, so there is nothing left to
   * re-enable: coming back is a fresh media section, a fresh offer and a fresh `publish`. A browser
   * that flipped a flag in that case would show itself as sending with nobody able to hear it, which
   * is the one failure this control must never have.
   */
  toggleMicrophone(): void {
    if (this.localStream === null) return;
    const next = !this.microphoneOn;
    this.#capture?.setSourceEnabled("audio", next);
    this.microphoneOn = next;
    if (next) {
      // The member has answered whatever they were told, whichever way it was put to them.
      this.lastNotice = null;
      this.unmuteRequest = null;
      if (this.#microphoneClosedUpstream) {
        this.#microphoneClosedUpstream = false;
        void this.#republishMicrophone();
      }
    }
    // Muting is a fact about this browser that the room cannot measure: the track keeps arriving,
    // carrying silence, so nothing downstream would ever know. Either way the answer to "is this
    // person speaking" starts again at no — muted, they are not; unmuted, the meter says so within
    // its own hysteresis rather than this browser assuming the last answer still holds.
    this.#announcePresence(false, !next);
  }

  /**
   * Leave the microphone where it is, and let go of the request to open it.
   *
   * The other half of what an asked member is offered. It says nothing to the host — there is
   * nothing to acknowledge, because they asked — and it exists so that the prompt has a way out
   * that is not the member doing what they were asked.
   */
  declineUnmuteRequest(): void {
    this.unmuteRequest = null;
  }

  /** Silence one participant: the room closes their audio upstream and tells them who did it. */
  mute(participantId: string): void {
    this.#signaling.send(muteDirective(participantId));
  }

  /**
   * Silence everybody who is neither this member nor a host or co-host.
   *
   * WHO THAT IS, IS THE ROOM'S ANSWER. A client sending one directive per name off its own roster
   * would be acting on a list it may be a frame behind on, and would silence the person pressing it.
   */
  muteAll(): void {
    this.#signaling.send(muteAllDirective());
  }

  /** Ask somebody to unmute. A request their screen offers them, and never a forced unmute. */
  askToUnmute(participantId: string): void {
    this.#signaling.send(askToUnmuteDirective(participantId));
  }

  /** Put one participant on every screen in the room, or clear whoever is on them. */
  spotlight(participantId: string | null): void {
    this.#signaling.send(spotlightDirective(participantId));
  }

  /** Turn the camera picture off or on. A call has no camera, so there is nothing to turn. */
  toggleCamera(): void {
    if (this.localStream === null || this.medium !== "video") return;
    const next = !this.cameraOn;
    this.#capture?.setSourceEnabled("video", next);
    this.cameraOn = next;
  }

  /** Leave the room: tell it, stop every local capture, and close everything down. */
  leave(): void {
    if (this.state === "ended" || this.state === "failed") return;
    this.#leaving = true;
    this.#signaling.send({ type: "leave" });
    this.state = "ended";
    this.#teardown();
  }

  /** Drop everything without telling the room. For a surface going away mid-meeting. */
  dispose(): void {
    this.#leaving = true;
    this.#teardown();
  }

  /**
   * Tell the room what this browser's microphone is doing — ON TRANSITIONS ONLY.
   *
   * Recorded locally as well as sent, so this member's own tile answers immediately instead of
   * waiting for the room to relay their own voice back to them.
   */
  #announcePresence(speaking: boolean, muted: boolean): void {
    if (!this.#presence.isTransition(speaking, muted)) return;
    this.#presence.noteAnnounced(speaking, muted);
    const self = this.participantId;
    // The hand is restated rather than re-decided: this frame is about the microphone, and the one
    // browser that knows whether the hand is up is this one.
    if (self !== null) this.#recordPresence(self, speaking, muted, this.reactions.hand);
    this.#signaling.send({ type: "presence", speaking, muted });
    this.#subscriptions.schedule();
  }

  #trackName(kind: MeetingTrackKind): string {
    return `${this.participantId ?? ""}:${kind}`;
  }

  #handleWelcome(frame: Record<string, unknown>): void {
    const participantId = readString(frame, "participantId");
    if (participantId !== null) this.participantId = participantId;
    this.state = "live";
    // The room's own facts ride inline for the reason the whole roster does: a socket that has just
    // arrived holds nothing to apply a change to, so it cannot be told about a spotlight as one.
    this.roomState = readRoomState(frame.roomState);
    // Who is at the door rides along on the same reasoning, and is empty for everybody who is not
    // running the meeting — which is what the room sends them.
    this.lobbyList = readWaitingParticipants(frame.waiting);
    this.#adoptRoster(readParticipants(frame.roster));
    if (!this.#publishOnWelcome) return;
    this.#publishOnWelcome = false;
    void this.publish();
  }

  /**
   * A host let this browser in, on the socket it was waiting on.
   *
   * The welcome follows immediately, and it is that frame rather than this one that makes this a
   * member of the room — so what happens here is the two facts the welcome cannot carry: the door
   * is behind them, and the capture that was refused at it is now owed. The peer connection was
   * built from the relay credentials the join already answered with, which is why the join carries
   * them even for somebody who is about to wait.
   */
  #handleAdmitted(): void {
    this.#waitingAtTheDoor = false;
    this.waiting = null;
    this.#publishOnWelcome = true;
  }

  /** What the room now says about itself, replacing what this browser held. */
  #handleRoomState(frame: Record<string, unknown>): void {
    this.roomState = readRoomState(frame);
    // Who is on every screen is the first band of the plan, so a spotlight changes what is pulled
    // and at which layer — not only what is drawn.
    this.#subscriptions.schedule();
  }

  /**
   * A host closed this browser's microphone at the routing service.
   *
   * The track is GONE rather than silenced, which is what the flag below records: the member's own
   * control now has to republish, and a browser that flipped `enabled` back would sit showing itself
   * as sending with nobody able to hear it. The source is disabled as well, so the member is not
   * still feeding a device into a track that no longer goes anywhere.
   */
  #handleMuted(frame: Record<string, unknown>): void {
    // Who did it rides on the frame and is deliberately not in the sentence. The person whose
    // microphone went dead needs to know that a host did it and that their own control brings it
    // back; naming the host is an invitation to argue with somebody who is clearing the floor.
    this.mutedBy = readDirective(frame);
    this.#microphoneClosedUpstream = true;
    this.#capture?.setSourceEnabled("audio", false);
    this.microphoneOn = false;
    this.lastNotice = MUTED_BY_HOST_NOTICE;
    // Whoever asked is answered: a request to unmute that a mute overtook is no longer a question.
    this.unmuteRequest = null;
    this.#announcePresence(false, true);
  }

  /**
   * Take the roster as stated, forget what it no longer names, and pull whatever the plan wants.
   *
   * `stated` is the rows THIS FRAME carried, which for a full roster is all of them and for a delta
   * is only what joined or changed. The difference matters: a delta's merged list is mostly rows
   * this browser has been holding since the last full roster, and reading their two booleans as
   * fresh would overwrite live presence with whatever the room said minutes ago.
   */
  #adoptRoster(
    participants: readonly MeetingParticipant[],
    stated: readonly MeetingParticipant[] = participants,
  ): void {
    this.participants = participants;
    this.#adoptPresenceFrom(participants, stated);
    this.#subscriptions.forgetWhatTheRosterNoLongerNames(participants);
    this.#subscriptions.schedule();
  }

  /**
   * Take what the arriving rows say about microphones, and drop what is about people who have gone.
   *
   * A ROW IS AUTHORITATIVE THE MOMENT IT ARRIVES, and it took a real failure to settle that. The
   * room composes a row out of the presence it holds at the instant it sends it, so a row is at
   * least as current as anything here — and on a rejoin the room RESETS what it was holding, so the
   * row says "not speaking" about somebody this browser last heard was. Kept apart and never
   * overwritten, that stale `true` held them at the front of everybody's gallery, with their
   * microphone pulled, for the rest of the meeting. Which is exactly the failure the map exists
   * beside the roster to avoid, arriving by the other door.
   *
   * Presence also arrives for whoever the room relays it about, including — for one frame, before
   * the sync answers — somebody this browser has not been told about yet. Left to accumulate, that
   * map is the one thing in a long meeting that only ever grows. Rebuilt only where something
   * actually changed, so an unchanged roster does not make the plan be worked out again for nothing.
   */
  #adoptPresenceFrom(
    participants: readonly MeetingParticipant[],
    stated: readonly MeetingParticipant[],
  ): void {
    const present = new Set(participants.map((participant) => participant.participantId));
    const next = new Map(
      [...this.#presenceByParticipant].filter(([participantId]) => present.has(participantId)),
    );
    let changed = next.size !== this.#presenceByParticipant.size;
    const spoke: string[] = [];

    for (const row of stated) {
      const before = next.get(row.participantId);
      if (
        before?.speaking === row.speaking &&
        before.muted === row.muted &&
        before.hand === row.hand &&
        before.handRaisedAt === row.handRaisedAt
      ) {
        continue;
      }
      // The moment somebody STARTS is what orders the gallery, and a row is one of the two places
      // it can be learned. Stamped on this browser's own clock for the reason a presence frame is:
      // the room's clock and this one are not the same clock.
      if (row.speaking && before?.speaking !== true) spoke.push(row.participantId);
      next.set(row.participantId, {
        speaking: row.speaking,
        muted: row.muted,
        hand: row.hand,
        // The row's own instant, which is the room's and is what the queue is ordered by. A room
        // that states a hand without one keeps whatever this browser stamped when it first learned
        // of it, so a roster arriving mid-meeting never reshuffles a queue a host is working.
        handRaisedAt: row.handRaisedAt ?? (row.hand ? (before?.handRaisedAt ?? null) : null),
      });
      changed = true;
    }

    if (!changed) return;
    this.#presenceByParticipant = next;
    if (spoke.length === 0) return;
    const stamped = new Map(this.#lastSpokeAt);
    for (const participantId of spoke) stamped.set(participantId, Date.now());
    this.#lastSpokeAt = stamped;
  }

  /**
   * Apply what changed rather than being told the whole room again.
   *
   * A full roster to three hundred sockets on every one of three hundred joins is ninety thousand
   * frames of a list nobody's screen can show at once, so above a threshold the room sends only the
   * difference. The cost of that is that this browser can be wrong without knowing: a delta that
   * updates or removes somebody it has never heard of means a frame went missing, and the only
   * honest answer is to ask for the whole list again rather than carry on from a roster with a hole
   * in it.
   */
  #handleRosterDelta(frame: Record<string, unknown>): void {
    const byIdentifier = new Map(
      this.participants.map((participant) => [participant.participantId, participant] as const),
    );
    let gap = false;
    // What this frame actually STATED, which is what its two booleans may be read off. Everything
    // else in the merged list is a row from an earlier frame — `#adoptPresenceFrom` says why the
    // distinction is load-bearing.
    const stated: MeetingParticipant[] = [];

    for (const participant of readParticipants(frame.joined)) {
      byIdentifier.set(participant.participantId, participant);
      stated.push(participant);
    }
    for (const participant of readParticipants(frame.updated)) {
      if (!byIdentifier.has(participant.participantId)) gap = true;
      byIdentifier.set(participant.participantId, participant);
      stated.push(participant);
    }
    for (const participantId of readIdentifiers(frame.left)) {
      if (!byIdentifier.delete(participantId)) gap = true;
    }

    this.#adoptRoster([...byIdentifier.values()], stated);
    if (gap) this.#signaling.requestSync();
  }

  /**
   * Somebody started or stopped talking, turned their microphone off, or moved their hand.
   *
   * It is what the gallery's order is built from, so it arrives as its own small frame rather than
   * as a roster: a room where a dozen people take turns speaking would otherwise be re-stating
   * three hundred participant records every second to carry two booleans. The hand rides here for
   * the opposite reason — it moves rarely — but it is the same browser measuring the same person at
   * the same moment, and a second frame would be a second small message about one subject.
   */
  #handlePresence(frame: Record<string, unknown>): void {
    const participantId = readString(frame, "participantId");
    if (participantId === null) return;
    const hand = frame.hand === true;
    const wasRaised = this.#presenceByParticipant.get(participantId)?.hand === true;
    const known = this.#recordPresence(
      participantId,
      frame.speaking === true,
      frame.muted === true,
      hand,
    );
    // A HAND GOING UP IS ANNOUNCED AT EVERY ROOM SIZE, unlike a reaction: it is a request for the
    // floor, and somebody running the meeting by ear has no other way to learn about it. Only the
    // change is said — a roster restating a hand that was already up is not news.
    if (hand && !wasRaised && known) {
      this.reactions.noteHandRaised(this.#nameOf(participantId));
    }
    // Presence about somebody this browser has never heard of is the same gap a delta shows, by a
    // different route: their join went missing.
    if (!known) this.#signaling.requestSync();
    this.#subscriptions.schedule();
  }

  /**
   * Somebody threw a reaction, in a room small enough for the room to say who.
   *
   * It is never about this browser itself: the room does not echo a `reaction` to its sender, whose
   * own bubble was drawn the moment the control was pressed. A reaction about somebody the roster
   * does not name is dropped rather than drawn — a bubble with no tile under it is a bubble in the
   * corner of the screen, and the sync a missing roster row would ask for is already asked by the
   * presence and delta paths.
   */
  #handleReaction(frame: Record<string, unknown>): void {
    const participantId = readString(frame, "participantId");
    const name = frame.name;
    if (participantId === null || !isMeetingReaction(name)) return;
    if (!this.participants.some((one) => one.participantId === participantId)) return;
    this.reactions.noteReaction(participantId, name, this.#nameOf(participantId));
  }

  /** What somebody is called, for a sentence a screen reader reads out. */
  #nameOf(participantId: string): string {
    const displayName = this.participants.find(
      (participant) => participant.participantId === participantId,
    )?.displayName;
    return displayName === undefined || displayName === "" ? UNNAMED_REACTOR : displayName;
  }

  /**
   * Note what somebody's microphone and hand are doing. Answers whether the roster knows them.
   *
   * The moment they STOP is recorded as well as the moment they start, because "who spoke most
   * recently" is what orders the gallery — and the person who just finished a sentence is the one a
   * member is most likely to want to keep looking at.
   */
  #recordPresence(
    participantId: string,
    speaking: boolean,
    muted: boolean,
    hand: boolean,
  ): boolean {
    const onRoster = this.participants.find(
      (participant) => participant.participantId === participantId,
    );
    const known = onRoster !== undefined;
    const held = this.#presenceByParticipant.get(participantId);
    const wasSpeaking = held?.speaking ?? onRoster?.speaking === true;
    // The roster array is left exactly as it was. A presence frame is three facts about one
    // person, and rebuilding three hundred roster rows to carry them re-rendered every surface
    // reading the roster — many times a second in a discussion.
    const stated = new Map(this.#presenceByParticipant);
    stated.set(participantId, {
      speaking,
      muted,
      hand,
      // The frame carries the boolean and not the instant, so a hand that was already up keeps the
      // stamp it had and a hand going up now is stamped where this browser learned of it. Never
      // stored and never sent anywhere: it is an ordering key for one queue in one tab.
      handRaisedAt: hand
        ? (held?.handRaisedAt ?? onRoster?.handRaisedAt ?? new Date().toISOString())
        : null,
    });
    this.#presenceByParticipant = stated;
    if (speaking || wasSpeaking) {
      const stamped = new Map(this.#lastSpokeAt);
      stamped.set(participantId, Date.now());
      this.#lastSpokeAt = stamped;
    }
    return known;
  }

  /** The room's answer to a layer change, handed on to what is keeping track of the layers. */
  #handleLayered(frame: Record<string, unknown>): void {
    if (!Array.isArray(frame.tracks)) return;
    const moved: { mid: string; preferredRid: PreferredRid }[] = [];
    for (const entry of frame.tracks) {
      if (!isRecord(entry)) continue;
      if (readString(entry, "errorCode") !== null) continue;
      const mid = readString(entry, "mid");
      const preferredRid = readPreferredRid(entry.preferredRid);
      if (mid === null || preferredRid === null) continue;
      moved.push({ mid, preferredRid });
    }
    this.#subscriptions.noteLayered(moved);
  }

  async #handleSubscribed(frame: Record<string, unknown>): Promise<void> {
    const peerConnection = this.#negotiation.connection;
    const offer = readSessionDescription(frame.sessionDescription);
    const tracks = readSubscribedTracks(frame.tracks);

    /*
     * A pull the unit could not serve comes back with no description at all, and one that needed no
     * renegotiation says so in the flag. Either way no media arrives on this frame, so the tracks
     * stop counting as pulled: left marked, they would never be asked for again and the tile they
     * belong to would stay black for the rest of the meeting.
     */
    if (
      peerConnection === null ||
      offer === null ||
      frame.requiresImmediateRenegotiation === false
    ) {
      this.#subscriptions.forgetSubscribed(tracks);
      return;
    }
    await peerConnection.setRemoteDescription(offer);

    // The mids are only meaningful once the offer is applied: before it, the transceivers the
    // unit's media sections map onto do not exist on this connection at all.
    for (const entry of tracks) {
      if (entry.mid === null) continue;
      this.#subscriptions.clearPending(entry);
      const track = this.#negotiation.transceiverFor(entry.mid)?.receiver.track;
      if (track === undefined || track === null) continue;
      this.#subscriptions.noteArrival(entry, entry.mid, track);
    }
    // Anything the plan wanted at a different layer was waiting on these mids.
    this.#subscriptions.schedule();

    this.#signaling.send({
      type: "renegotiate",
      sessionDescription: await this.#negotiation.answer(peerConnection),
    });
  }

  /**
   * What a refusal means: the end of this browser's meeting for the two reasons that are, and a
   * statement on the screen for every other one, because the room kept the socket open.
   */
  #handleRefused(frame: Record<string, unknown>): void {
    const reason = readString(frame, "reason") ?? "refused";
    if (FATAL_REFUSAL_REASONS.has(reason)) {
      this.#fail(reason);
      return;
    }
    // A directive from a socket holding no grant is not a fault in the wire and does not belong in
    // the band that reports one: the member is in the meeting, everything else they can do still
    // works, and what they cannot do is run it. Ordinarily they never see this at all — the menus
    // that send these frames are absent for somebody who is not hosting — so it is the answer to a
    // grant withdrawn between the menu opening and the item being pressed.
    if (reason === NOT_HOST_REASON) {
      this.lastNotice = NOT_HOSTING_NOTICE;
      return;
    }
    // A frame from a socket that is still at the door. Nothing is wrong with it — the only frames a
    // waiting socket may send are the keepalive and giving up — so the member is told rather than
    // taken anywhere, and the door may still open.
    if (reason === NOT_ADMITTED_REASON) {
      this.lastNotice = NOT_ADMITTED_NOTICE;
      return;
    }
    /*
     * A SIGNAL THAT ARRIVED TOO FAST, and the one refusal that is answered rather than reported.
     * The room refuses instead of dropping precisely so this browser can tell its act did not land
     * — a hand is a standing state the room is now wrong about, so it is sent again once the window
     * passes. Nothing goes on the screen: the member pressed a control, the control answered, and a
     * band saying the room refused a frame would be the product reporting its own pacing to
     * somebody who did nothing wrong.
     */
    if (reason === RATE_LIMITED_REASON) {
      this.reactions.noteRateLimited();
      return;
    }
    this.lastRefusal = { reason, errorId: readString(frame, "errorId") };
    if (REFUSALS_THAT_LOSE_A_SUBSCRIPTION.has(reason)) this.#subscriptions.forgetPending();
  }

  /** Answer an offer the room only sometimes sends — closing a track may or may not need one. */
  async #answerIfOffered(
    sessionDescription: {
      readonly type: RTCSdpType;
      readonly sdp: string;
    } | null,
  ): Promise<void> {
    const peerConnection = this.#negotiation.connection;
    if (peerConnection === null || sessionDescription === null) return;
    await peerConnection.setRemoteDescription(sessionDescription);
    this.#signaling.send({
      type: "renegotiate",
      sessionDescription: await this.#negotiation.answer(peerConnection),
    });
  }

  #attachRemoteTrack(participantId: string, trackName: string, track: MediaStreamTrack): void {
    const screen = namesAScreen(trackName);
    const held = screen ? this.remoteScreens : this.remoteStreams;
    const stream = held.get(participantId) ?? this.#seams.createMediaStream();
    stream.addTrack(track);
    const next = new Map(held);
    next.set(participantId, stream);
    if (screen) this.remoteScreens = next;
    else this.remoteStreams = next;
  }

  /**
   * Take one track out of the stream it was gathered into, and stop it. Where it was the last
   * track a participant had, the stream goes too.
   */
  #detachRemoteTrack(
    participantId: string,
    screen: boolean,
    media: MediaStreamTrack | undefined,
  ): void {
    const held = screen ? this.remoteScreens : this.remoteStreams;
    const stream = held.get(participantId);
    if (stream === undefined) return;
    if (media !== undefined) {
      stream.removeTrack(media);
      media.stop();
    }
    const next = new Map(held);
    if (stream.getTracks().length === 0) next.delete(participantId);
    else next.set(participantId, stream);
    if (screen) this.remoteScreens = next;
    else this.remoteStreams = next;
  }

  /** Stop holding a participant's incoming media, and stop the tracks it was made of. */
  #releaseRemote(participantId: string, screen: boolean): void {
    const held = screen ? this.remoteScreens : this.remoteStreams;
    const stream = held.get(participantId);
    if (stream === undefined) return;
    for (const track of stream.getTracks()) track.stop();
    const next = new Map(held);
    next.delete(participantId);
    if (screen) this.remoteScreens = next;
    else this.remoteStreams = next;
  }

  /*
   * The standing is recorded BEFORE anything is torn down, because closing the socket is what fires
   * the close handler that would otherwise come straight back here and fail a second time.
   */
  #fail(reason: string): void {
    if (this.state === "failed" || this.state === "ended") return;
    this.failureReason = reason;
    this.state = "failed";
    this.#teardown();
  }

  #teardown(): void {
    this.#subscriptions.stopScheduling();
    this.#clock.stop();
    // The samples go with the connection they were about; what happened on the wire is kept, because
    // the last thing that happened is usually the reason the meeting is over.
    this.diagnostics.stop();
    this.#presence.stop();
    // The bubbles, the counts and this browser's own hand go with the room they were about: every
    // one of them is a fact about the next few seconds of a meeting that is over.
    this.reactions.clear();
    this.#capture?.close();
    this.#capture = null;
    this.appliedEffects = null;
    const screen = this.screenStream;
    if (screen !== null) for (const track of screen.getTracks()) track.stop();
    this.localStream = null;
    this.screenStream = null;
    this.sharing = false;
    this.#screenMid = null;
    this.#microphoneMid = null;
    this.remoteStreams = new Map();
    this.remoteScreens = new Map();
    this.#negotiation.close();
    this.#signaling.close();
  }

  #reset(): void {
    this.failureReason = null;
    this.captureRefusal = null;
    this.lastRefusal = null;
    this.lastProblem = null;
    this.lastNotice = null;
    this.unmuteRequest = null;
    this.mutedBy = null;
    this.roomState = OPEN_ROOM_STATE;
    this.waiting = null;
    this.lobbyList = [];
    this.#waitingAtTheDoor = false;
    this.#publishOnWelcome = false;
    this.#microphoneClosedUpstream = false;
    this.participants = [];
    this.remoteStreams = new Map();
    this.remoteScreens = new Map();
    this.appliedEffects = null;
    this.microphoneOn = true;
    this.cameraOn = true;
    this.sharing = false;
    this.#leaving = false;
    this.#screenMid = null;
    this.#microphoneMid = null;
    this.page = 0;
    this.pinned = [];
    this.speakerView = false;
    this.#lastSpokeAt = new Map();
    this.#presenceByParticipant = new Map();
    this.#subscriptions.clear();
    this.#signaling.reset();
    this.#presence.stop();
    this.reactions.clear();
    this.diagnostics.clear();
  }
}
