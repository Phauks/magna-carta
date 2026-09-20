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
 * pure policy in subscription-policy.ts), what is captured and how it is offered (capture.ts,
 * through the effects stage in media-effects.ts), and what this browser says about its own
 * microphone (presence.ts). What is HERE is the runes state a screen renders from and the wiring
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
  captureLocalMedia,
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
import type { EffectedCapture } from "./media-effects.ts";
import { MeetingNegotiation } from "./negotiation.ts";
import { MeetingPresence } from "./presence.ts";
import {
  isRecord,
  MeetingSignaling,
  namesAScreen,
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
export type {
  ConnectionQuality,
  MeetingDirective,
  MeetingHostRole,
  MeetingMedium,
  MeetingParticipant,
  MeetingRefusal,
  MeetingRoomState,
  MeetingTrack,
  MeetingTrackKind,
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
]);

/** A host frame from a socket holding no grant. The socket stays open; the member is told. */
const NOT_HOST_REASON = "not-host";

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

/** Where a meeting stands from this browser's point of view. */
export type MeetingState = "idle" | "joining" | "live" | "ended" | "failed";

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
  };
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
   * True while this browser's microphone is closed AT THE ROUTING SERVICE because a host muted it.
   *
   * It is what makes un-muting afterwards a republish rather than a flipped flag. A member's own
   * mute leaves the track up and carrying silence, so flipping `enabled` back is the whole of it; a
   * host's mute takes the track away at the far end, and a browser that only flipped a flag would
   * show itself as sending while nobody could hear it for the rest of the meeting.
   */
  #microphoneClosedUpstream = false;
  /** True once this browser asked to leave, so the socket closing is expected rather than a fault. */
  #leaving = false;

  constructor(
    seams: MeetingClientSeams,
    diagnostics: MeetingDiagnostics = new MeetingDiagnostics(),
  ) {
    this.#seams = seams;
    this.diagnostics = diagnostics;
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

  /** Open the peer connection and the signaling socket. The room answers with `welcome`. */
  join(request: MeetingJoinRequest): void {
    if (this.state === "joining" || this.state === "live") return;
    this.#reset();
    this.state = "joining";
    this.meetingId = request.meetingId;
    this.participantId = request.participantId;
    this.medium = request.medium ?? "video";
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
    });
    this.#signaling.open(request.socketUrl);
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

    const wantsPicture = this.medium === "video";
    const captured = await captureLocalMedia(this.#seams, this.medium);
    if (captured === null) {
      this.captureRefusal = wantsPicture
        ? "The microphone and camera are not available in this browser."
        : "The microphone is not available in this browser.";
      return;
    }
    const stream = captured.stream;
    this.#capture = captured;
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
        const transceiver = offerMicrophoneTrack(peerConnection, track);
        const sessionDescription = await this.#negotiation.offer(peerConnection);
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
    if (self !== null) this.#recordPresence(self, speaking, muted);
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
    this.#adoptRoster(readParticipants(frame.roster));
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
      if (before?.speaking === row.speaking && before.muted === row.muted) continue;
      // The moment somebody STARTS is what orders the gallery, and a row is one of the two places
      // it can be learned. Stamped on this browser's own clock for the reason a presence frame is:
      // the room's clock and this one are not the same clock.
      if (row.speaking && before?.speaking !== true) spoke.push(row.participantId);
      next.set(row.participantId, { speaking: row.speaking, muted: row.muted });
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
   * Somebody started or stopped talking, or turned their microphone off.
   *
   * It is what the gallery's order is built from, so it arrives as its own small frame rather than
   * as a roster: a room where a dozen people take turns speaking would otherwise be re-stating
   * three hundred participant records every second to carry two booleans.
   */
  #handlePresence(frame: Record<string, unknown>): void {
    const participantId = readString(frame, "participantId");
    if (participantId === null) return;
    const known = this.#recordPresence(
      participantId,
      frame.speaking === true,
      frame.muted === true,
    );
    // Presence about somebody this browser has never heard of is the same gap a delta shows, by a
    // different route: their join went missing.
    if (!known) this.#signaling.requestSync();
    this.#subscriptions.schedule();
  }

  /**
   * Note what somebody's microphone is doing. Answers whether the roster knows them at all.
   *
   * The moment they STOP is recorded as well as the moment they start, because "who spoke most
   * recently" is what orders the gallery — and the person who just finished a sentence is the one a
   * member is most likely to want to keep looking at.
   */
  #recordPresence(participantId: string, speaking: boolean, muted: boolean): boolean {
    const onRoster = this.participants.find(
      (participant) => participant.participantId === participantId,
    );
    const known = onRoster !== undefined;
    const wasSpeaking =
      this.#presenceByParticipant.get(participantId)?.speaking ?? onRoster?.speaking === true;
    // The roster array is left exactly as it was. A presence frame is two booleans about one
    // person, and rebuilding three hundred roster rows to carry them re-rendered every surface
    // reading the roster — many times a second in a discussion.
    const stated = new Map(this.#presenceByParticipant);
    stated.set(participantId, { speaking, muted });
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
    this.#capture?.close();
    this.#capture = null;
    const screen = this.screenStream;
    if (screen !== null) for (const track of screen.getTracks()) track.stop();
    this.localStream = null;
    this.screenStream = null;
    this.sharing = false;
    this.#screenMid = null;
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
    this.#microphoneClosedUpstream = false;
    this.participants = [];
    this.remoteStreams = new Map();
    this.remoteScreens = new Map();
    this.microphoneOn = true;
    this.cameraOn = true;
    this.sharing = false;
    this.#leaving = false;
    this.#screenMid = null;
    this.page = 0;
    this.pinned = [];
    this.speakerView = false;
    this.#lastSpokeAt = new Map();
    this.#presenceByParticipant = new Map();
    this.#subscriptions.clear();
    this.#signaling.reset();
    this.#presence.stop();
    this.diagnostics.clear();
  }
}
