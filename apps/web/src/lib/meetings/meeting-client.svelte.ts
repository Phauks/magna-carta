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
 */

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

/** The reason recorded when the signaling socket goes away without the meeting having ended. */
export const SOCKET_CLOSED_REASON = "socket-closed";

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
}

/** What the join route answered with, plus where the room's socket lives. */
export interface MeetingJoinRequest {
  readonly meetingId: string;
  readonly participantId: string;
  readonly iceServers: readonly RTCIceServer[];
  readonly socketUrl: string;
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
}

/** The seams as a real browser supplies them. */
export function browserMeetingSeams(): MeetingClientSeams {
  return {
    createPeerConnection: (configuration) => new RTCPeerConnection(configuration),
    openSocket: (url) => new WebSocket(url),
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
    createMediaStream: () => new MediaStream(),
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
    });
  }
  return participants;
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

  /** This browser's own participant, as the room named it. */
  participantId = $state<string | null>(null);
  /** The meeting being attended. */
  meetingId = $state<string | null>(null);

  /** Everybody but this browser — the tiles the grid draws from the pulled streams. */
  readonly others = $derived(
    this.participants.filter((participant) => participant.participantId !== this.participantId),
  );

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

  /** Track names already asked for, so a repeated roster does not pull the same track twice. */
  readonly #pulledTracks = new Set<string>();
  /** Which participant each pulled track name belongs to. */
  readonly #trackOwners = new Map<string, string>();
  /** The screen share's transceiver mid, which is what closing it names. */
  #screenMid: string | null = null;

  /**
   * Every frame that renegotiates runs here, one after another. Two session descriptions applied
   * concurrently is an invalid-state error the browser reports from whichever one lost, so the
   * ordering is made explicit rather than left to the order frames happen to arrive in.
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
    this.#peerConnection = this.#seams.createPeerConnection({
      iceServers: [...request.iceServers],
    });
    this.#openSocket(request.socketUrl);
  }

  /**
   * Capture the microphone and camera and offer them to the unit.
   *
   * The mids are read AFTER the local description is set, because that is when the browser assigns
   * them; read before, every track would be named with a null mid and the unit would have nothing
   * to match the offer's media sections against.
   */
  async publish(): Promise<void> {
    const peerConnection = this.#peerConnection;
    if (peerConnection === null || this.localStream !== null) return;

    let stream: MediaStream;
    try {
      stream = await this.#seams.getUserMedia({ audio: true, video: true });
    } catch {
      this.captureRefusal = "The microphone and camera are not available in this browser.";
      return;
    }
    this.localStream = stream;
    this.captureRefusal = null;

    const published: PublishedTrack[] = [];
    for (const track of stream.getTracks()) {
      const transceiver = peerConnection.addTransceiver(track, { direction: "sendonly" });
      published.push({ transceiver, kind: track.kind === "audio" ? "audio" : "video" });
    }
    this.microphoneOn = stream.getAudioTracks().length > 0;
    this.cameraOn = stream.getVideoTracks().length > 0;

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
  }

  /**
   * Pull whichever of a participant's tracks are not already coming in. Called for each roster
   * entry as the roster changes; a track already asked for is never asked for twice, because the
   * unit would answer with a second copy of a stream already on screen.
   */
  subscribeTo(participant: MeetingParticipant): void {
    const sessionId = participant.sfuSessionId;
    if (sessionId === null) return;
    if (participant.participantId === this.participantId) return;
    const wanted = participant.tracks.filter((track) => !this.#pulledTracks.has(track.trackName));
    if (wanted.length === 0) return;
    for (const track of wanted) {
      this.#pulledTracks.add(track.trackName);
      this.#trackOwners.set(track.trackName, participant.participantId);
    }
    this.#send({
      type: "subscribe",
      tracks: wanted.map((track) => ({ sessionId, trackName: track.trackName })),
    });
  }

  /** Capture a screen or a window and publish it as a second video track. */
  async shareScreen(): Promise<void> {
    const peerConnection = this.#peerConnection;
    if (peerConnection === null || this.sharing) return;

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

    const transceiver = peerConnection.addTransceiver(track, { direction: "sendonly" });
    const sessionDescription = await this.#offer(peerConnection);
    this.#screenMid = transceiver.mid;
    this.#send({
      type: "publish",
      sessionDescription,
      tracks: [{ trackName: this.#trackName("screen"), mid: transceiver.mid, kind: "screen" }],
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
  }

  /** Turn the camera picture off or on. */
  toggleCamera(): void {
    const stream = this.localStream;
    if (stream === null) return;
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
        this.#adoptRoster(readParticipants(parsed.participants));
        return;
      case "published":
        this.#enqueue(() => this.#applyRemote(readSessionDescription(parsed.sessionDescription)));
        return;
      case "subscribed":
        this.#enqueue(() => this.#handleSubscribed(parsed));
        return;
      case "closed":
        this.#enqueue(() =>
          this.#answerIfOffered(readSessionDescription(parsed.sessionDescription)),
        );
        return;
      case "ended":
        this.#leaving = true;
        this.state = "ended";
        this.#teardown();
        return;
      case "refused":
        this.#fail(readString(parsed, "reason") ?? "refused");
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

  /** Take the roster as stated and pull whatever it names that is not already coming in. */
  #adoptRoster(participants: readonly MeetingParticipant[]): void {
    this.participants = participants;
    for (const participant of participants) this.subscribeTo(participant);
  }

  async #handleSubscribed(frame: Record<string, unknown>): Promise<void> {
    const peerConnection = this.#peerConnection;
    const offer = readSessionDescription(frame.sessionDescription);
    if (peerConnection === null || offer === null) return;
    await peerConnection.setRemoteDescription(offer);

    // The mids are only meaningful once the offer is applied: before it, the transceivers the
    // unit's media sections map onto do not exist on this connection at all.
    const tracks = Array.isArray(frame.tracks) ? frame.tracks : [];
    for (const entry of tracks) {
      if (!isRecord(entry)) continue;
      const trackName = readString(entry, "trackName");
      const mid = readString(entry, "mid");
      if (trackName === null || mid === null) continue;
      const owner = this.#trackOwners.get(trackName) ?? ownerOfTrackName(trackName);
      const transceiver = peerConnection
        .getTransceivers()
        .find((candidate) => candidate.mid === mid);
      const track = transceiver?.receiver.track;
      if (track === undefined || track === null) continue;
      this.#attachRemoteTrack(owner, trackName, track);
    }

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    this.#send({
      type: "renegotiate",
      sessionDescription: this.#describeLocal(peerConnection, answer),
    });
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
      sessionDescription: this.#describeLocal(peerConnection, answer),
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
    return this.#describeLocal(peerConnection, offer);
  }

  #describeLocal(
    peerConnection: RTCPeerConnection,
    fallback: RTCSessionDescriptionInit,
  ): SessionDescription {
    const local = peerConnection.localDescription;
    return {
      type: local?.type ?? fallback.type ?? "offer",
      sdp: local?.sdp ?? fallback.sdp ?? "",
    };
  }

  #enqueue(task: () => Promise<void>): void {
    this.#work = this.#work.then(task).catch(() => {
      // A negotiation step that throws leaves the connection where it was; the room is still there
      // and the next frame is still worth applying, so the chain is kept alive rather than broken.
    });
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
    this.participants = [];
    this.remoteStreams = new Map();
    this.remoteScreens = new Map();
    this.microphoneOn = true;
    this.cameraOn = true;
    this.sharing = false;
    this.#leaving = false;
    this.#missedPongs = 0;
    this.#pulledTracks.clear();
    this.#trackOwners.clear();
    this.#screenMid = null;
    this.#outbox = [];
  }
}
