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
 *
 * SOMEBODY ELSE RECONNECTING IS ORDINARY, THOUGH, and this browser has to follow it. They come back
 * with the same attendance and the same track names on a NEW unit session, so what is already coming
 * in is counted by session AND name (`pulledTrackKey`), and a roster that stops naming a session is
 * what drops the tracks and the stream that went with it.
 *
 * WHAT IS PULLED IS DECIDED BY A PURE FUNCTION, NEVER HERE. A room holds up to three hundred people
 * and a browser pulls at most sixteen cameras and twenty-four microphones, so "what should be coming
 * in" is a judgment over the roster, the presence facts, the pins and the gallery page —
 * `subscriptionPolicy` in subscription-policy.ts. This class only makes the answer true: it asks for
 * what the plan names and is not already coming in, closes what the plan no longer names, and moves
 * a simulcast layer where the plan changed it. Reconciliation is rate-limited rather than run per
 * frame, because three hundred people joining is three hundred roster deltas.
 */
import {
  GALLERY_PAGE_SIZE,
  SPEAKER_VIEW_PAGE_SIZE,
  subscriptionPolicy,
  type PreferredRid,
  type SubscriptionPlan,
} from "./subscription-policy.ts";
import { createBrowserAudioLevelMeter, type AudioLevelMeter } from "./audio-level-meter.ts";

/*
 * The keepalive pair, byte for byte. These exact strings are what the runtime's WebSocket
 * auto-response is registered against, so a ping written any other way (a space after the colon, a
 * pretty-printed object) costs a full wake of the hibernating room instead of being answered for
 * free. The one home for the pair is
 * apps/api-worker/src/progress/job-progress-protocol.ts; it is repeated here because a browser
 * bundle cannot import from a Worker, and the bytes are the contract.
 *
 * That module's 256-byte client-frame cap belongs to the job-progress control protocol and does
 * NOT bind here: a publish frame carries a session description, which is orders of magnitude
 * larger, so the meeting room sizes its own frames.
 */
const PING_FRAME = '{"type":"ping"}';
const PONG_FRAME = '{"type":"pong"}';

/** The frame version this client speaks. It rides on every frame the client sends. */
const MEETING_FRAME_VERSION = 1;

/** How long between keepalive pings. */
const KEEPALIVE_INTERVAL_MILLISECONDS = 30_000;

/**
 * How many pings may go unanswered before the socket is treated as gone. Two, rather than one,
 * because a single missed round trip is a blip and a member watching a colleague speak should not
 * be thrown out of the room for it.
 */
const MISSED_PONGS_BEFORE_FAILURE = 2;

/**
 * How often what this browser is pulling may be worked out afresh.
 *
 * Three hundred people arriving at the top of the hour is three hundred roster deltas in a few
 * seconds, and each one on its own would re-run the policy and send frames. The first change in a
 * burst is acted on at once — a member should see somebody arrive, not wait a quarter of a second
 * for it — and everything that follows inside the window is folded into one pass at the end of it.
 */
export const RECONCILE_DEBOUNCE_MILLISECONDS = 250;

/**
 * The layers a camera is published in: full, half and quarter of the captured resolution.
 *
 * A room of three hundred draws its tiles small, and a subscriber that could only ever be sent the
 * full picture would be decoding sixteen full-resolution streams to paint sixteen thumbnails. The
 * unit cannot make a small picture out of a large one, so the publisher sends all three and each
 * subscriber names the one its tiles are worth. A fresh array per call: the browser takes ownership
 * of what it is handed.
 */
function cameraSimulcastEncodings(): RTCRtpEncodingParameters[] {
  return [
    { rid: "f", scaleResolutionDownBy: 1 },
    { rid: "h", scaleResolutionDownBy: 2 },
    { rid: "q", scaleResolutionDownBy: 4 },
  ];
}

/** The most tracks one `layer` frame may carry. Beyond it the change goes in several frames. */
const MAX_LAYER_TRACKS_PER_FRAME = 32;

/** The reason recorded when the signaling socket goes away without the meeting having ended. */
export const SOCKET_CLOSED_REASON = "socket-closed";

/**
 * The reason a socket is closed because the SAME member opened a newer one: a second tab, or a
 * rejoin after a drop. The room keeps one live socket per stay and the newest wins, so this one is
 * over — and the stay it was holding now belongs to the socket that superseded it, which is why a
 * screen meeting this must not offer to walk back in and must not close the stay on its way out.
 */
export const SUPERSEDED_REASON = "superseded";

/**
 * The refusals that END this browser's meeting. Everything else the room refuses is a setback: it
 * keeps the socket open, the roster keeps arriving, and the member is still in the room. Treating a
 * malformed frame or an unreachable unit as the end of a meeting throws somebody out of a room they
 * are still in, over a frame they never saw.
 */
const FATAL_REFUSAL_REASONS = new Set(["not-a-participant", "meeting-ended", SUPERSEDED_REASON]);

/**
 * The refusals that mean the tracks just asked for are not coming: the unit could not be reached, or
 * the room does not hold a track under the name it was asked for. Those tracks stop counting as
 * pulled, so the next roster asks for them again rather than waiting on media that was never sent.
 *
 * The room's other refusals are deliberately NOT here. A name refused as somebody else's, and a
 * track the room will not carry, are both about what THIS browser tried to publish — un-marking a
 * subscription over either would ask again for something nobody refused.
 */
const REFUSALS_THAT_LOSE_A_SUBSCRIPTION = new Set(["sfu-unavailable", "unknown-track"]);

/** Where a meeting stands from this browser's point of view. */
export type MeetingState = "idle" | "joining" | "live" | "ended" | "failed";

/** What a track carries. A screen share is its own kind, not a second camera. */
export type MeetingTrackKind = "audio" | "video" | "screen";

/** One published track, as the roster names it. */
export interface MeetingTrack {
  readonly trackName: string;
  readonly kind: MeetingTrackKind;
}

/** Somebody in the room, as the roster states them. */
export interface MeetingParticipant {
  readonly participantId: string;
  readonly userId: string;
  readonly displayName: string;
  /** The unit's session this participant publishes through. Null before they have published. */
  readonly sfuSessionId: string | null;
  readonly tracks: readonly MeetingTrack[];
  /**
   * Their microphone is carrying speech, as their own browser measured it and the room relayed it.
   *
   * It is a fact the room states rather than one this browser works out. Measuring it here would
   * mean an analyser per incoming track — three hundred of them in a full room, for one boolean
   * each — and it could only ever be measured for the few tracks already being pulled, which is the
   * wrong set: whoever speaks next is usually somebody nobody is currently listening to.
   */
  readonly speaking: boolean;
  /** Their microphone is off, so nothing is coming from it whatever anybody's meter says. */
  readonly muted: boolean;
}

/**
 * A refusal the meeting SURVIVES: the room said no to one frame and stayed open.
 *
 * The Error ID is the room's own correlation handle where its failure reached the logging pipeline,
 * and it is the one thing worth quoting to support — so it travels with the reason rather than being
 * squeezed into a sentence.
 */
export interface MeetingRefusal {
  readonly reason: string;
  readonly errorId: string | null;
}

/**
 * What a meeting is made of: pictures and sound, or sound alone.
 *
 * A CALL IS NOT A MEETING WITH THE CAMERAS OFF. It is chosen when the room is opened and never
 * changes, because the people who joined agreed to one thing — so this browser captures no camera in
 * a call, offers no screen share, and draws no picture, rather than capturing a camera nobody asked
 * for and hiding it behind a control.
 */
export type MeetingMedium = "video" | "audio";

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

/** A session description as the frames carry it: the two fields, and nothing the browser adds. */
interface SessionDescription {
  readonly type: RTCSdpType;
  readonly sdp: string;
}

interface PublishedTrack {
  readonly transceiver: RTCRtpTransceiver;
  readonly kind: MeetingTrackKind;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function readSessionDescription(value: unknown): SessionDescription | null {
  if (!isRecord(value)) return null;
  const type = readString(value, "type");
  const sdp = readString(value, "sdp");
  if (type === null || sdp === null) return null;
  return { type: type as RTCSdpType, sdp };
}

/** One track of a `subscribed` frame, as the room states it. */
interface SubscribedTrack {
  readonly trackName: string;
  /** The media section the track arrives on. Null where the room named none. */
  readonly mid: string | null;
  /** The unit session the track is pulled from. Null where the room named none. */
  readonly sessionId: string | null;
}

function readSubscribedTracks(value: unknown): readonly SubscribedTrack[] {
  if (!Array.isArray(value)) return [];
  const tracks: SubscribedTrack[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const trackName = readString(entry, "trackName");
    if (trackName === null) continue;
    tracks.push({
      trackName,
      mid: readString(entry, "mid"),
      sessionId: readString(entry, "sessionId"),
    });
  }
  return tracks;
}

function readTrackKind(value: unknown): MeetingTrackKind {
  return value === "audio" || value === "screen" ? value : "video";
}

function readParticipants(value: unknown): readonly MeetingParticipant[] {
  if (!Array.isArray(value)) return [];
  const participants: MeetingParticipant[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const participantId = readString(entry, "participantId");
    if (participantId === null) continue;
    const rawTracks = Array.isArray(entry.tracks) ? entry.tracks : [];
    const tracks: MeetingTrack[] = [];
    for (const rawTrack of rawTracks) {
      if (!isRecord(rawTrack)) continue;
      const trackName = readString(rawTrack, "trackName");
      if (trackName === null) continue;
      tracks.push({ trackName, kind: readTrackKind(rawTrack.kind) });
    }
    participants.push({
      participantId,
      userId: readString(entry, "userId") ?? "",
      displayName: readString(entry, "displayName") ?? "",
      sfuSessionId: readString(entry, "sfuSessionId"),
      tracks,
      // Absent on a room that has not been taught presence yet, and absent is "not speaking, not
      // muted" — the state a roster without the two booleans always meant.
      speaking: entry.speaking === true,
      muted: entry.muted === true,
    });
  }
  return participants;
}

/** A simulcast layer as a frame states it, or null where the frame named something else. */
function readPreferredRid(value: unknown): PreferredRid | null {
  return value === "f" || value === "h" || value === "q" ? value : null;
}

/** The participant ids a frame names, ignoring anything in the list that is not one. */
function readIdentifiers(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** The participant a track name belongs to, read off the name's own prefix. */
function ownerOfTrackName(trackName: string): string {
  const separator = trackName.indexOf(":");
  return separator === -1 ? trackName : trackName.slice(0, separator);
}

/** Whether a track name names a screen share rather than a camera or a microphone. */
function namesAScreen(trackName: string): boolean {
  return trackName.endsWith(":screen");
}

/**
 * How a pulled track is keyed: the unit session it comes from, and then its name.
 *
 * The name on its own is not enough to say what is already coming in. A participant who drops and
 * comes back keeps their attendance, so their tracks keep their names, while the unit gives them a
 * NEW session — and a set keyed on the name alone reports those tracks as already pulled, never asks
 * for them, and leaves that person's tile black for as long as they stay in the room.
 */
function pulledTrackKey(sessionId: string, trackName: string): string {
  return `${sessionId}:${trackName}`;
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

  /** Everybody but this browser — the people the gallery pages over. */
  readonly others = $derived(
    this.participants.filter((participant) => participant.participantId !== this.participantId),
  );

  /**
   * What should be coming in, and what the gallery should be drawing. Everything the screen renders
   * about who is shown, and everything `reconcile` asks the room for, comes from here.
   */
  readonly plan: SubscriptionPlan = $derived(
    subscriptionPolicy({
      medium: this.medium,
      self: this.participantId ?? "",
      participants: this.participants.map((participant) => ({
        participantId: participant.participantId,
        sfuSessionId: participant.sfuSessionId,
        tracks: participant.tracks,
        speaking: participant.speaking,
        muted: participant.muted,
        lastSpokeAt: this.#lastSpokeAt.get(participant.participantId) ?? null,
      })),
      pinned: this.pinned,
      page: this.page,
      pageSize: this.speakerView ? SPEAKER_VIEW_PAGE_SIZE : GALLERY_PAGE_SIZE,
      now: Date.now(),
    }),
  );

  /** How many gallery pages the room takes. Always at least one. */
  readonly pages = $derived(this.plan.pages);
  /** The participants drawn on this page, in order. This browser's own preview is not among them. */
  readonly shown = $derived(this.plan.shown);

  readonly #seams: MeetingClientSeams;

  #peerConnection: RTCPeerConnection | null = null;
  #socket: WebSocket | null = null;
  #socketOpen = false;
  /** Frames asked for before the socket opened. Flushed in order the moment it does. */
  #outbox: string[] = [];
  #keepalive: ReturnType<typeof setInterval> | undefined;
  #missedPongs = 0;
  /** True once this browser asked to leave, so the socket closing is expected rather than a fault. */
  #leaving = false;

  /**
   * The tracks already asked for, keyed by session and name (`pulledTrackKey`), so a repeated roster
   * does not pull the same track twice and a reconnected participant's new session is pulled afresh.
   */
  readonly #pulledTracks = new Set<string>();
  /** The same keys, for the subscriptions the room has not answered yet. */
  readonly #pendingSubscriptions = new Set<string>();
  /** Which participant each pulled track belongs to, under the same key. */
  readonly #trackOwners = new Map<string, string>();
  /**
   * The media section each pulled track arrives on, as the room's `subscribed` named it. Closing a
   * track names its mid, so a track with no mid here is one that cannot be closed yet.
   */
  readonly #pulledMids = new Map<string, string>();
  /** The incoming track itself, so closing one takes it out of the stream it was gathered into. */
  readonly #pulledMediaTracks = new Map<string, MediaStreamTrack>();
  /** The simulcast layer last ASKED FOR per pulled track, so a layer frame is sent only on change. */
  readonly #askedRids = new Map<string, PreferredRid>();
  /** The screen share's transceiver mid, which is what closing it names. */
  #screenMid: string | null = null;

  /** The running measurement of this browser's own microphone. Null before anything is captured. */
  #meter: AudioLevelMeter | null = null;
  /** The last presence this browser told the room, so only a CHANGE is sent. */
  #announcedPresence: { speaking: boolean; muted: boolean } | null = null;

  /** The window inside which further changes are folded into one reconciliation. */
  #reconcileWindow: ReturnType<typeof setTimeout> | undefined;
  /** Whether something changed while the window was open, so a pass is owed when it closes. */
  #reconcileOwed = false;
  /** True while a `sync` has gone out and no full roster has come back, so one gap asks once. */
  #syncAsked = false;

  /**
   * Everything that renegotiates runs here, one after another: the frames that arrive, and this
   * browser's own publishes. Two session descriptions applied concurrently is an invalid-state error
   * the browser reports from whichever one lost, so the ordering is made explicit rather than left
   * to the order frames happen to arrive in.
   */
  #work: Promise<void> = Promise.resolve();

  constructor(seams: MeetingClientSeams) {
    this.#seams = seams;
  }

  /** Open the peer connection and the signaling socket. The room answers with `welcome`. */
  join(request: MeetingJoinRequest): void {
    if (this.state === "joining" || this.state === "live") return;
    this.#reset();
    this.state = "joining";
    this.meetingId = request.meetingId;
    this.participantId = request.participantId;
    this.medium = request.medium ?? "video";
    this.#peerConnection = this.#seams.createPeerConnection({
      iceServers: [...request.iceServers],
    });
    this.#openSocket(request.socketUrl);
  }

  /**
   * Capture what this room carries and offer it to the unit: the microphone and camera in a meeting,
   * the microphone alone in a call.
   *
   * THE CAMERA IS NOT CAPTURED IN A CALL, rather than captured and muted. A browser that opens a
   * camera lights the device's own indicator, and a member who started a call did not agree to that;
   * the room would refuse the picture anyway (`track-kind-refused`), so asking for it would be a
   * light on somebody's laptop in exchange for nothing.
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
    const peerConnection = this.#peerConnection;
    if (peerConnection === null || this.localStream !== null) return;

    const wantsPicture = this.medium === "video";
    let stream: MediaStream;
    try {
      stream = await this.#seams.getUserMedia({ audio: true, video: wantsPicture });
    } catch {
      this.captureRefusal = wantsPicture
        ? "The microphone and camera are not available in this browser."
        : "The microphone is not available in this browser.";
      return;
    }
    this.localStream = stream;
    this.captureRefusal = null;
    this.microphoneOn = stream.getAudioTracks().length > 0;
    this.cameraOn = stream.getVideoTracks().length > 0;
    this.#startMeasuringSpeech(stream);

    const notOffered = wantsPicture
      ? "Your camera and microphone were not offered to the room."
      : "Your microphone was not offered to the room.";
    await this.#enqueue(notOffered, async () => {
      const published: PublishedTrack[] = [];
      for (const track of stream.getTracks()) {
        // A call offers sound and nothing else. Capture asked for no picture, so this is the second
        // gate rather than the first: a browser that handed back a video track anyway does not get
        // to publish it into a room whose people agreed to a call.
        if (!wantsPicture && track.kind !== "audio") continue;
        // The camera goes up in three layers and the microphone in one. Sound has no resolution to
        // step down, and a screen share is published elsewhere as a single layer, because a
        // quarter-resolution document is a document nobody can read.
        const transceiver = peerConnection.addTransceiver(track, {
          direction: "sendonly",
          ...(track.kind === "video" ? { sendEncodings: cameraSimulcastEncodings() } : {}),
        });
        published.push({ transceiver, kind: track.kind === "audio" ? "audio" : "video" });
      }

      const sessionDescription = await this.#offer(peerConnection);
      this.#send({
        type: "publish",
        sessionDescription,
        tracks: published.map((entry) => ({
          trackName: this.#trackName(entry.kind),
          mid: entry.transceiver.mid,
          kind: entry.kind,
        })),
      });
    });
  }

  /**
   * Make the plan true: ask for what should be coming in and is not, close what should not, and
   * move the layer of anything the plan now wants at a different size.
   *
   * It is safe to call at any time and does nothing when nothing has changed, which is what lets
   * every arrival, departure, presence frame, pin and page turn go through the same one path
   * instead of each one deciding for itself what it implies.
   */
  reconcile(): void {
    if (this.state !== "live") return;
    const plan = this.plan;

    /** Everything the plan wants, keyed the way what is already coming in is keyed. */
    const wanted = new Map<
      string,
      { sessionId: string; trackName: string; participantId: string; rid: PreferredRid | null }
    >();
    for (const track of plan.video) {
      wanted.set(pulledTrackKey(track.sessionId, track.trackName), {
        sessionId: track.sessionId,
        trackName: track.trackName,
        participantId: track.participantId,
        rid: track.preferredRid,
      });
    }
    if (plan.screen !== null) {
      wanted.set(pulledTrackKey(plan.screen.sessionId, plan.screen.trackName), {
        ...plan.screen,
        rid: null,
      });
    }
    for (const track of plan.audio) {
      wanted.set(pulledTrackKey(track.sessionId, track.trackName), { ...track, rid: null });
    }

    this.#pullWhatIsMissing(wanted);
    this.#closeWhatIsNoLongerWanted(wanted);
    this.#moveLayersThatChanged(wanted);
  }

  /** Show a different page of the gallery. Out of range is clamped rather than refused. */
  setPage(page: number): void {
    const next = Math.min(Math.max(0, Math.floor(page)), this.pages - 1);
    if (next === this.page) return;
    this.page = next;
    this.#scheduleReconcile();
  }

  /**
   * Keep somebody on screen whatever the room does.
   *
   * It moves them to the front of the order, which is the first page — so the gallery goes there
   * too. Pinning somebody on page eleven and watching them vanish from page eleven is the one
   * outcome a member would read as the control not working.
   */
  pin(participantId: string): void {
    if (this.pinned.includes(participantId)) return;
    this.pinned = [...this.pinned, participantId];
    this.page = 0;
    this.#scheduleReconcile();
  }

  /** Stop keeping somebody on screen. They fall back to wherever the room's own order puts them. */
  unpin(participantId: string): void {
    if (!this.pinned.includes(participantId)) return;
    this.pinned = this.pinned.filter((pinned) => pinned !== participantId);
    this.#scheduleReconcile();
  }

  /** Whether this member is holding somebody on screen. */
  isPinned(participantId: string): boolean {
    return this.pinned.includes(participantId);
  }

  /** Swap between the even gallery and one large speaker with a strip of recent ones beside it. */
  toggleSpeakerView(): void {
    this.speakerView = !this.speakerView;
    this.page = 0;
    this.#scheduleReconcile();
  }

  /**
   * Capture a screen or a window and publish it as a second video track.
   *
   * A CALL REFUSES THIS HERE, not at the room. A screen share is a video track, the room would
   * refuse it (`track-kind-refused`), and the picker would already have been opened and a screen
   * already chosen by then — so the refusal is stated before anybody is asked to choose anything.
   */
  async shareScreen(): Promise<void> {
    const peerConnection = this.#peerConnection;
    if (peerConnection === null || this.sharing) return;
    if (this.medium !== "video") {
      this.lastProblem = "This is a call, so there is no picture in it to share a screen into.";
      return;
    }

    let stream: MediaStream;
    try {
      stream = await this.#seams.getDisplayMedia({ video: true });
    } catch {
      return;
    }
    const [track] = stream.getVideoTracks();
    if (track === undefined) {
      for (const spare of stream.getTracks()) spare.stop();
      return;
    }

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
    await this.#enqueue("Your screen was not offered to the room.", async () => {
      const transceiver = peerConnection.addTransceiver(track, { direction: "sendonly" });
      const sessionDescription = await this.#offer(peerConnection);
      this.#screenMid = transceiver.mid;
      this.#send({
        type: "publish",
        sessionDescription,
        tracks: [{ trackName: this.#trackName("screen"), mid: transceiver.mid, kind: "screen" }],
      });
    });
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
    if (mid !== null) this.#send({ type: "close", mids: [mid] });
  }

  /** Mute or unmute the microphone. The track stays captured, so nothing renegotiates. */
  toggleMicrophone(): void {
    const stream = this.localStream;
    if (stream === null) return;
    const next = !this.microphoneOn;
    for (const track of stream.getAudioTracks()) track.enabled = next;
    this.microphoneOn = next;
    // Muting is a fact about this browser that the room cannot measure: the track keeps arriving,
    // carrying silence, so nothing downstream would ever know. Either way the answer to "is this
    // person speaking" starts again at no — muted, they are not; unmuted, the meter says so within
    // its own hysteresis rather than this browser assuming the last answer still holds.
    this.#announcePresence(false, !next);
  }

  /** Turn the camera picture off or on. A call has no camera, so there is nothing to turn. */
  toggleCamera(): void {
    const stream = this.localStream;
    if (stream === null || this.medium !== "video") return;
    const next = !this.cameraOn;
    for (const track of stream.getVideoTracks()) track.enabled = next;
    this.cameraOn = next;
  }

  /** Leave the room: tell it, stop every local capture, and close everything down. */
  leave(): void {
    if (this.state === "ended" || this.state === "failed") return;
    this.#leaving = true;
    this.#send({ type: "leave" });
    this.state = "ended";
    this.#teardown();
  }

  /** Drop everything without telling the room. For a surface going away mid-meeting. */
  dispose(): void {
    this.#leaving = true;
    this.#teardown();
  }

  /** Ask for the plan's tracks that are not already coming in, in one frame. */
  #pullWhatIsMissing(
    wanted: ReadonlyMap<
      string,
      { sessionId: string; trackName: string; participantId: string; rid: PreferredRid | null }
    >,
  ): void {
    const tracks: Record<string, unknown>[] = [];
    for (const [key, track] of wanted) {
      if (this.#pulledTracks.has(key)) continue;
      this.#pulledTracks.add(key);
      this.#pendingSubscriptions.add(key);
      this.#trackOwners.set(key, track.participantId);
      if (track.rid !== null) this.#askedRids.set(key, track.rid);
      tracks.push({
        sessionId: track.sessionId,
        trackName: track.trackName,
        ...(track.rid === null ? {} : { preferredRid: track.rid }),
      });
    }
    if (tracks.length > 0) this.#send({ type: "subscribe", tracks });
  }

  /**
   * Stop pulling what the plan no longer names, and take the media out of the stream it was
   * gathered into.
   *
   * Leaving a closed track in the stream is not harmless: a video element plays the first video
   * track it was given, so a tile that has stopped receiving would keep drawing the last frame of
   * somebody who is no longer on this page, which reads as a picture of a person sitting still.
   */
  #closeWhatIsNoLongerWanted(wanted: ReadonlyMap<string, unknown>): void {
    const mids: string[] = [];
    // A copy, because forgetting a key mutates the set this walks.
    for (const key of [...this.#pulledTracks]) {
      if (wanted.has(key)) continue;
      const mid = this.#pulledMids.get(key);
      // A track asked for and not yet answered has no media section to name, and forgetting it
      // here would leave the unit sending something nothing on this side is counting. It keeps its
      // place until the answer arrives, and the pass that follows the answer closes it properly.
      if (mid === undefined && this.#pendingSubscriptions.has(key)) continue;
      const owner = this.#trackOwners.get(key);
      const media = this.#pulledMediaTracks.get(key);
      this.#forgetTrack(key);
      if (mid !== undefined) mids.push(mid);
      if (owner !== undefined) this.#detachRemoteTrack(owner, namesAScreen(key), media);
    }
    if (mids.length > 0) this.#send({ type: "close", mids });
  }

  /**
   * Ask the unit for a different layer of what is already coming in.
   *
   * Only where the mid is known: the layer is named on the subscribe itself, so a track still
   * waiting for its answer is already being pulled at the right size, and asking again by mid
   * before the unit has said which mid it is would name nothing.
   *
   * A frame carries at most `MAX_LAYER_TRACKS_PER_FRAME` tracks, which is what the room accepts.
   */
  #moveLayersThatChanged(
    wanted: ReadonlyMap<
      string,
      { sessionId: string; trackName: string; participantId: string; rid: PreferredRid | null }
    >,
  ): void {
    const changed: Record<string, unknown>[] = [];
    for (const [key, track] of wanted) {
      if (track.rid === null) continue;
      const mid = this.#pulledMids.get(key);
      if (mid === undefined) continue;
      if (this.#askedRids.get(key) === track.rid) continue;
      this.#askedRids.set(key, track.rid);
      changed.push({
        sessionId: track.sessionId,
        trackName: track.trackName,
        mid,
        preferredRid: track.rid,
      });
    }
    for (let from = 0; from < changed.length; from += MAX_LAYER_TRACKS_PER_FRAME) {
      this.#send({ type: "layer", tracks: changed.slice(from, from + MAX_LAYER_TRACKS_PER_FRAME) });
    }
  }

  /**
   * Reconcile now if the last pass was not just run, and otherwise once the window closes.
   *
   * Acting on the first change of a burst and folding the rest is what keeps a room of three
   * hundred responsive AND cheap: one person arriving is answered immediately, three hundred
   * arriving cost one pass every quarter second rather than three hundred passes.
   */
  #scheduleReconcile(): void {
    if (this.#reconcileWindow !== undefined) {
      this.#reconcileOwed = true;
      return;
    }
    this.reconcile();
    this.#reconcileWindow = setTimeout(() => {
      this.#reconcileWindow = undefined;
      if (!this.#reconcileOwed) return;
      this.#reconcileOwed = false;
      this.#scheduleReconcile();
    }, RECONCILE_DEBOUNCE_MILLISECONDS);
  }

  /**
   * Watch this browser's own microphone, and tell the room when the answer changes.
   *
   * The meter runs on the captured track rather than on what is being sent, so a member who mutes
   * is reported muted rather than silently not-speaking — the two read differently on a tile and
   * mean different things to the person looking at it.
   */
  #startMeasuringSpeech(stream: MediaStream): void {
    const [microphone] = stream.getAudioTracks();
    if (microphone === undefined) return;
    this.#meter?.stop();
    const meter = this.#seams.createAudioLevelMeter(microphone);
    this.#meter = meter;
    meter.start((speaking) => {
      // A muted microphone still makes sound the meter can hear; nobody else can hear it, so it is
      // not speech as far as the room is concerned.
      this.#announcePresence(speaking && this.microphoneOn, !this.microphoneOn);
    });
  }

  /**
   * Tell the room what this browser's microphone is doing — ON TRANSITIONS ONLY.
   *
   * A frame per measurement would be twenty frames a second from every person in the room; a frame
   * per change is a handful per sentence. The room throttles what it relays on top of this, but a
   * client that sent the same fact over and over would be spending a room of three hundred's whole
   * signalling budget on saying nothing.
   */
  #announcePresence(speaking: boolean, muted: boolean): void {
    const last = this.#announcedPresence;
    if (last !== null && last.speaking === speaking && last.muted === muted) return;
    this.#announcedPresence = { speaking, muted };
    // Recorded locally as well as sent, so this member's own tile answers immediately instead of
    // waiting for the room to relay their own voice back to them.
    const self = this.participantId;
    if (self !== null) this.#recordPresence(self, speaking, muted);
    this.#send({ type: "presence", speaking, muted });
    this.#scheduleReconcile();
  }

  /** Ask the room for the whole roster, once, where a delta showed this browser has missed one. */
  #askForTheWholeRoster(): void {
    if (this.#syncAsked) return;
    this.#syncAsked = true;
    this.#send({ type: "sync" });
  }

  #trackName(kind: MeetingTrackKind): string {
    return `${this.participantId ?? ""}:${kind}`;
  }

  #openSocket(url: string): void {
    const socket = this.#seams.openSocket(url);
    this.#socket = socket;
    socket.addEventListener("open", () => {
      this.#socketOpen = true;
      const pending = this.#outbox;
      this.#outbox = [];
      for (const frame of pending) socket.send(frame);
      this.#startKeepalive();
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      this.#receive(event.data);
    });
    socket.addEventListener("close", () => {
      this.#socketOpen = false;
      if (this.#leaving || this.state === "ended" || this.state === "failed") return;
      this.#fail(SOCKET_CLOSED_REASON);
    });
  }

  #startKeepalive(): void {
    this.#stopKeepalive();
    this.#missedPongs = 0;
    this.#keepalive = setInterval(() => {
      if (this.#missedPongs >= MISSED_PONGS_BEFORE_FAILURE) {
        this.#fail(SOCKET_CLOSED_REASON);
        return;
      }
      this.#missedPongs += 1;
      this.#sendRaw(PING_FRAME);
    }, KEEPALIVE_INTERVAL_MILLISECONDS);
  }

  #stopKeepalive(): void {
    if (this.#keepalive !== undefined) clearInterval(this.#keepalive);
    this.#keepalive = undefined;
  }

  /** Close the reconciliation window, so a torn-down client's last pass cannot fire after it. */
  #stopReconciling(): void {
    if (this.#reconcileWindow !== undefined) clearTimeout(this.#reconcileWindow);
    this.#reconcileWindow = undefined;
    this.#reconcileOwed = false;
  }

  #receive(data: unknown): void {
    if (typeof data !== "string") return;
    if (data === PONG_FRAME) {
      this.#missedPongs = 0;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    const type = readString(parsed, "type");
    if (type === null) return;

    switch (type) {
      case "pong":
        this.#missedPongs = 0;
        return;
      case "welcome":
        this.#handleWelcome(parsed);
        return;
      case "roster":
        // The whole list, which is also the answer to a `sync`: whatever gap was suspected, this
        // frame settles it.
        this.#syncAsked = false;
        this.#adoptRoster(readParticipants(parsed.participants));
        return;
      case "roster-delta":
        this.#handleRosterDelta(parsed);
        return;
      case "presence":
        this.#handlePresence(parsed);
        return;
      case "layered":
        this.#handleLayered(parsed);
        return;
      case "published":
        void this.#enqueue("The room's answer to what you are sending was not applied.", () =>
          this.#applyRemote(readSessionDescription(parsed.sessionDescription)),
        );
        return;
      case "subscribed":
        void this.#enqueue("Somebody else's picture and sound did not come in.", () =>
          this.#handleSubscribed(parsed),
        );
        return;
      case "closed":
        void this.#enqueue("The room's change to what is being sent was not applied.", () =>
          this.#answerIfOffered(readSessionDescription(parsed.sessionDescription)),
        );
        return;
      case "ended":
        this.#leaving = true;
        this.state = "ended";
        this.#teardown();
        return;
      case "refused":
        this.#handleRefused(parsed);
        return;
      default:
        return;
    }
  }

  #handleWelcome(frame: Record<string, unknown>): void {
    const participantId = readString(frame, "participantId");
    if (participantId !== null) this.participantId = participantId;
    this.state = "live";
    this.#adoptRoster(readParticipants(frame.roster));
  }

  /** Take the roster as stated, forget what it no longer names, and pull whatever the plan wants. */
  #adoptRoster(participants: readonly MeetingParticipant[]): void {
    this.participants = participants;
    this.#forgetWhatTheRosterNoLongerNames(participants);
    this.#scheduleReconcile();
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

    for (const participant of readParticipants(frame.joined)) {
      byIdentifier.set(participant.participantId, participant);
    }
    for (const participant of readParticipants(frame.updated)) {
      if (!byIdentifier.has(participant.participantId)) gap = true;
      byIdentifier.set(participant.participantId, participant);
    }
    for (const participantId of readIdentifiers(frame.left)) {
      if (!byIdentifier.delete(participantId)) gap = true;
    }

    this.#adoptRoster([...byIdentifier.values()]);
    if (gap) this.#askForTheWholeRoster();
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
    if (!known) this.#askForTheWholeRoster();
    this.#scheduleReconcile();
  }

  /**
   * Note what somebody's microphone is doing. Answers whether the roster knows them at all.
   *
   * The moment they STOP is recorded as well as the moment they start, because "who spoke most
   * recently" is what orders the gallery — and the person who just finished a sentence is the one a
   * member is most likely to want to keep looking at.
   */
  #recordPresence(participantId: string, speaking: boolean, muted: boolean): boolean {
    let known = false;
    let wasSpeaking = false;
    this.participants = this.participants.map((participant) => {
      if (participant.participantId !== participantId) return participant;
      known = true;
      wasSpeaking = participant.speaking;
      return { ...participant, speaking, muted };
    });
    if (speaking || wasSpeaking) {
      const stamped = new Map(this.#lastSpokeAt);
      stamped.set(participantId, Date.now());
      this.#lastSpokeAt = stamped;
    }
    return known;
  }

  /**
   * The room's answer to a layer change.
   *
   * A track the room could not move is left recorded at the layer it was ASKED for rather than
   * being un-recorded, so the next pass does not ask again on the next roster frame, and the next
   * one after that: the picture stays at whatever size the unit is sending, and a genuine change —
   * a page turn, a pin, a different number of tiles — asks afresh.
   */
  #handleLayered(frame: Record<string, unknown>): void {
    if (!Array.isArray(frame.tracks)) return;
    const byMid = new Map<string, string>();
    for (const [key, mid] of this.#pulledMids) byMid.set(mid, key);
    for (const entry of frame.tracks) {
      if (!isRecord(entry)) continue;
      if (readString(entry, "errorCode") !== null) continue;
      const mid = readString(entry, "mid");
      const preferredRid = readPreferredRid(entry.preferredRid);
      if (mid === null || preferredRid === null) continue;
      const key = byMid.get(mid);
      if (key === undefined) continue;
      this.#askedRids.set(key, preferredRid);
    }
  }

  /**
   * Drop what the roster has stopped naming: a track under a session that is no longer its
   * participant's, and everything held for somebody who has left the room.
   *
   * A forgotten track is asked for again as soon as the roster names it under its new session, which
   * is what puts a reconnected participant's picture back. Their old stream goes with it, because a
   * video element plays the first video track it was given and a dead one left in the stream is the
   * black tile the fresh subscription was supposed to end.
   */
  #forgetWhatTheRosterNoLongerNames(participants: readonly MeetingParticipant[]): void {
    const named = new Set<string>();
    const present = new Set<string>();
    for (const participant of participants) {
      present.add(participant.participantId);
      const sessionId = participant.sfuSessionId;
      if (sessionId === null) continue;
      for (const track of participant.tracks) {
        named.add(pulledTrackKey(sessionId, track.trackName));
      }
    }
    // Forgetting the key currently being visited is what this loop does on almost every pass, and
    // that is defined: a set drops it from behind the iterator rather than from in front of it.
    for (const key of this.#pulledTracks) {
      if (named.has(key)) continue;
      const owner = this.#trackOwners.get(key);
      this.#forgetTrack(key);
      if (owner !== undefined) this.#releaseRemote(owner, namesAScreen(key));
    }
    // The two below walk the map as it stands NOW; releasing replaces the field with a new map, and
    // the walk is over the one this loop started on, which is the whole set to be judged.
    for (const participantId of this.remoteStreams.keys()) {
      if (!present.has(participantId)) this.#releaseRemote(participantId, false);
    }
    for (const participantId of this.remoteScreens.keys()) {
      if (!present.has(participantId)) this.#releaseRemote(participantId, true);
    }
  }

  /** Stop counting a track as coming in, so the next pass asks for it again. */
  #forgetTrack(key: string): void {
    this.#pulledTracks.delete(key);
    this.#pendingSubscriptions.delete(key);
    this.#trackOwners.delete(key);
    this.#pulledMids.delete(key);
    this.#pulledMediaTracks.delete(key);
    this.#askedRids.delete(key);
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

  /** Forget every track asked for that the room has not answered for yet. */
  #forgetPendingSubscriptions(): void {
    for (const key of this.#pendingSubscriptions) this.#forgetTrack(key);
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

  async #handleSubscribed(frame: Record<string, unknown>): Promise<void> {
    const peerConnection = this.#peerConnection;
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
      this.#forgetSubscribed(tracks);
      return;
    }
    await peerConnection.setRemoteDescription(offer);

    // The mids are only meaningful once the offer is applied: before it, the transceivers the
    // unit's media sections map onto do not exist on this connection at all.
    for (const entry of tracks) {
      if (entry.mid === null) continue;
      const key =
        entry.sessionId === null ? null : pulledTrackKey(entry.sessionId, entry.trackName);
      if (key !== null) this.#pendingSubscriptions.delete(key);
      const owner =
        (key === null ? undefined : this.#trackOwners.get(key)) ??
        ownerOfTrackName(entry.trackName);
      const transceiver = peerConnection
        .getTransceivers()
        .find((candidate) => candidate.mid === entry.mid);
      const track = transceiver?.receiver.track;
      if (track === undefined || track === null) continue;
      if (key !== null) {
        // The mid is what closing this track will name, and the track itself is what taking it out
        // of the stream will need. Neither is knowable before the offer was applied.
        this.#pulledMids.set(key, entry.mid);
        this.#pulledMediaTracks.set(key, track);
      }
      this.#attachRemoteTrack(owner, entry.trackName, track);
    }
    // Anything the plan wanted at a different layer was waiting on these mids.
    this.#scheduleReconcile();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    this.#send({
      type: "renegotiate",
      sessionDescription: this.#describeLocal(peerConnection),
    });
  }

  /**
   * Forget the tracks a `subscribed` frame was about. A frame that names none of them — or names
   * them without their session — is about whatever was outstanding, so everything still waiting is
   * forgotten rather than left marked for the rest of the meeting.
   */
  #forgetSubscribed(tracks: readonly SubscribedTrack[]): void {
    const keys = tracks
      .map((track) =>
        track.sessionId === null ? null : pulledTrackKey(track.sessionId, track.trackName),
      )
      .filter((key): key is string => key !== null);
    if (keys.length === 0) {
      this.#forgetPendingSubscriptions();
      return;
    }
    for (const key of keys) this.#forgetTrack(key);
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
    this.lastRefusal = { reason, errorId: readString(frame, "errorId") };
    if (REFUSALS_THAT_LOSE_A_SUBSCRIPTION.has(reason)) this.#forgetPendingSubscriptions();
  }

  /** Apply an answer the room sent back. Nothing is owed in return. */
  async #applyRemote(sessionDescription: SessionDescription | null): Promise<void> {
    const peerConnection = this.#peerConnection;
    if (peerConnection === null || sessionDescription === null) return;
    await peerConnection.setRemoteDescription(sessionDescription);
  }

  /** Answer an offer the room only sometimes sends — closing a track may or may not need one. */
  async #answerIfOffered(sessionDescription: SessionDescription | null): Promise<void> {
    const peerConnection = this.#peerConnection;
    if (peerConnection === null || sessionDescription === null) return;
    await peerConnection.setRemoteDescription(sessionDescription);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    this.#send({
      type: "renegotiate",
      sessionDescription: this.#describeLocal(peerConnection),
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

  async #offer(peerConnection: RTCPeerConnection): Promise<SessionDescription> {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    return this.#describeLocal(peerConnection);
  }

  /**
   * What this browser has just put on its own connection, as a frame carries it.
   *
   * THE TYPE IS READ, NEVER ASSUMED. It used to fall back to "offer" where the browser had no local
   * description — which is a lie on every answering path, and the unit given an answer labelled as
   * an offer refuses the whole renegotiation. A connection that cannot describe itself has nothing
   * true to send, so it fails the step it is in and the reason reaches the screen.
   */
  #describeLocal(peerConnection: RTCPeerConnection): SessionDescription {
    const local = peerConnection.localDescription;
    if (local === null) {
      throw new Error("The browser did not describe its own connection.");
    }
    return { type: local.type, sdp: local.sdp };
  }

  /**
   * Run a negotiation step after every step already queued, and record it where one does not finish.
   *
   * A step that throws leaves the connection where it was — the room is still there and the next
   * frame is still worth applying — so the chain is kept alive rather than broken. What it must not
   * do is vanish: a swallowed invalid-state error is a member sitting in front of a picture that
   * never arrives with nothing on the screen saying why.
   */
  #enqueue(problem: string, task: () => Promise<void>): Promise<void> {
    const step = this.#work.then(task).catch(() => {
      this.lastProblem = problem;
    });
    this.#work = step;
    return step;
  }

  #send(frame: Record<string, unknown>): void {
    this.#sendRaw(JSON.stringify({ v: MEETING_FRAME_VERSION, ...frame }));
  }

  #sendRaw(frame: string): void {
    const socket = this.#socket;
    if (socket === null) return;
    if (!this.#socketOpen) {
      this.#outbox.push(frame);
      return;
    }
    socket.send(frame);
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
    this.#stopKeepalive();
    this.#stopReconciling();
    this.#meter?.stop();
    this.#meter = null;
    this.#announcedPresence = null;
    const local = this.localStream;
    if (local !== null) for (const track of local.getTracks()) track.stop();
    const screen = this.screenStream;
    if (screen !== null) for (const track of screen.getTracks()) track.stop();
    this.localStream = null;
    this.screenStream = null;
    this.sharing = false;
    this.#screenMid = null;
    this.remoteStreams = new Map();
    this.remoteScreens = new Map();
    this.#peerConnection?.close();
    this.#peerConnection = null;
    const socket = this.#socket;
    this.#socket = null;
    this.#socketOpen = false;
    this.#outbox = [];
    socket?.close();
  }

  #reset(): void {
    this.failureReason = null;
    this.captureRefusal = null;
    this.lastRefusal = null;
    this.lastProblem = null;
    this.participants = [];
    this.remoteStreams = new Map();
    this.remoteScreens = new Map();
    this.microphoneOn = true;
    this.cameraOn = true;
    this.sharing = false;
    this.#leaving = false;
    this.#missedPongs = 0;
    this.#pulledTracks.clear();
    this.#pendingSubscriptions.clear();
    this.#trackOwners.clear();
    this.#pulledMids.clear();
    this.#pulledMediaTracks.clear();
    this.#askedRids.clear();
    this.#screenMid = null;
    this.#outbox = [];
    this.page = 0;
    this.pinned = [];
    this.speakerView = false;
    this.#lastSpokeAt = new Map();
    this.#announcedPresence = null;
    this.#syncAsked = false;
    this.#stopReconciling();
  }
}
