/*
 * The signaling socket: the frames that go out, the frames that come in, and the keepalive that
 * tells a live socket from a dead one.
 *
 * NOTHING HERE DECIDES ANYTHING ABOUT A MEETING. It opens the socket, stamps the protocol version on
 * what is sent, buffers what was asked for before the socket opened, reads what arrives into the
 * shapes the rest of the client works in, and hands each frame to the one handler that owns it. What
 * a frame MEANS is decided by the module that takes it.
 *
 * THE FRAME NAMES ARE THE PROTOCOL PACKAGE'S, not this file's. `@magna-carta/meeting-protocol` is
 * the one declaration of the wire, imported by the room and by this browser alike, and a fitness
 * function in that package holds that every frame type it declares has a handler here and a sender
 * on the far side. Before it, the browser re-declared the frames by hand and the two ends drifted by
 * prose agreement.
 */
import {
  MEETING_PROTOCOL_VERSION,
  PING_FRAME,
  PONG_FRAME,
  TRACK_NAME_SEPARATOR,
  type PreferredRid,
} from "@magna-carta/meeting-protocol/frames";

/** How long between keepalive pings. */
const KEEPALIVE_INTERVAL_MILLISECONDS = 30_000;

/**
 * How many pings may go unanswered before the socket is treated as gone. Two, rather than one,
 * because a single missed round trip is a blip and a member watching a colleague speak should not
 * be thrown out of the room for it.
 */
const MISSED_PONGS_BEFORE_FAILURE = 2;

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

/** A session description as the frames carry it: the two fields, and nothing the browser adds. */
export interface SessionDescription {
  readonly type: RTCSdpType;
  readonly sdp: string;
}

/** One track of a `subscribed` frame, as the room states it. */
export interface SubscribedTrack {
  readonly trackName: string;
  /** The media section the track arrives on. Null where the room named none. */
  readonly mid: string | null;
  /** The unit session the track is pulled from. Null where the room named none. */
  readonly sessionId: string | null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

export function readSessionDescription(value: unknown): SessionDescription | null {
  if (!isRecord(value)) return null;
  const type = readString(value, "type");
  const sdp = readString(value, "sdp");
  if (type === null || sdp === null) return null;
  return { type: type as RTCSdpType, sdp };
}

export function readSubscribedTracks(value: unknown): readonly SubscribedTrack[] {
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

export function readParticipants(value: unknown): readonly MeetingParticipant[] {
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
export function readPreferredRid(value: unknown): PreferredRid | null {
  return value === "f" || value === "h" || value === "q" ? value : null;
}

/** The participant ids a frame names, ignoring anything in the list that is not one. */
export function readIdentifiers(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** The participant a track name belongs to, read off the name's own prefix. */
export function ownerOfTrackName(trackName: string): string {
  const separator = trackName.indexOf(TRACK_NAME_SEPARATOR);
  return separator === -1 ? trackName : trackName.slice(0, separator);
}

/** Whether a track name names a screen share rather than a camera or a microphone. */
export function namesAScreen(trackName: string): boolean {
  return trackName.endsWith(`${TRACK_NAME_SEPARATOR}screen`);
}

/**
 * One handler per frame the ROOM sends. Every one of them is required, which is the point: a frame
 * type added to the protocol package cannot be half-wired here, and the package's fitness function
 * names the missing one before a tile has to go black to report it.
 */
export interface RoomFrameHandlers {
  welcome(frame: Record<string, unknown>): void;
  roster(frame: Record<string, unknown>): void;
  rosterDelta(frame: Record<string, unknown>): void;
  presence(frame: Record<string, unknown>): void;
  layered(frame: Record<string, unknown>): void;
  published(frame: Record<string, unknown>): void;
  subscribed(frame: Record<string, unknown>): void;
  renegotiated(frame: Record<string, unknown>): void;
  closed(frame: Record<string, unknown>): void;
  ended(frame: Record<string, unknown>): void;
  refused(frame: Record<string, unknown>): void;
  /**
   * A frame arrived stating a protocol version this page does not speak. Not a frame type — the
   * room's whole vocabulary is in question, so what follows is the client's to decide.
   */
  incompatible(version: number): void;
  /**
   * The socket went away, or the keepalive gave up on it. Whether that is a failure is the
   * client's to say: a socket closing under a member who pressed Leave is the expected end.
   */
  lost(): void;
}

/**
 * The room frames that mean something before `welcome` has arrived.
 *
 * EVERYTHING ELSE IS READ AGAINST A ROSTER THIS BROWSER HAS NOT BEEN GIVEN YET. A `presence` or a
 * `roster-delta` landing in that gap names somebody the empty roster does not hold, which is
 * exactly the shape of a frame gone missing — so the client asks for the whole list again. Every
 * browser joining at the top of the hour does that at once, over a roster that was always about to
 * arrive, which is a sync storm the room has to answer three hundred times for nothing.
 *
 * The three here are the frames that are about the socket rather than about the room's contents: the
 * hello itself, a refusal (which may be the reason there will never be a hello), and the meeting
 * having ended under it.
 */
const FRAMES_BEFORE_WELCOME = new Set(["welcome", "refused", "ended", "pong"]);

export class MeetingSignaling {
  readonly #openSocket: (url: string) => WebSocket;
  readonly #handlers: RoomFrameHandlers;

  #socket: WebSocket | null = null;
  #socketOpen = false;
  /** Frames asked for before the socket opened. Flushed in order the moment it does. */
  #outbox: string[] = [];
  #keepalive: ReturnType<typeof setInterval> | undefined;
  #missedPongs = 0;
  /** True while a `sync` has gone out and no full roster has come back, so one gap asks once. */
  #syncAsked = false;
  /** Whether the room has said hello. Almost nothing it sends means anything before it has. */
  #welcomed = false;

  constructor(openSocket: (url: string) => WebSocket, handlers: RoomFrameHandlers) {
    this.#openSocket = openSocket;
    this.#handlers = handlers;
  }

  open(url: string): void {
    this.#welcomed = false;
    const socket = this.#openSocket(url);
    this.#socket = socket;
    socket.addEventListener("open", () => {
      this.#socketOpen = true;
      const pending = this.#outbox;
      this.#outbox = [];
      for (const frame of pending) socket.send(frame);
      this.#startKeepalive();
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      this.receive(event.data);
    });
    socket.addEventListener("close", () => {
      this.#socketOpen = false;
      this.#handlers.lost();
    });
  }

  send(frame: Record<string, unknown>): void {
    this.sendRaw(JSON.stringify({ v: MEETING_PROTOCOL_VERSION, ...frame }));
  }

  sendRaw(frame: string): void {
    const socket = this.#socket;
    if (socket === null) return;
    if (!this.#socketOpen) {
      this.#outbox.push(frame);
      return;
    }
    socket.send(frame);
  }

  /** Ask the room for the whole roster, once, where a delta showed this browser has missed one. */
  requestSync(): void {
    if (this.#syncAsked) return;
    this.#syncAsked = true;
    this.send({ type: "sync" });
  }

  /** The whole list arrived, so whatever gap was suspected is settled and may be asked about again. */
  noteRosterSettled(): void {
    this.#syncAsked = false;
  }

  close(): void {
    this.#stopKeepalive();
    const socket = this.#socket;
    this.#socket = null;
    this.#socketOpen = false;
    this.#outbox = [];
    socket?.close();
  }

  reset(): void {
    this.#missedPongs = 0;
    this.#outbox = [];
    this.#syncAsked = false;
    this.#welcomed = false;
  }

  receive(data: unknown): void {
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

    /*
     * THE VERSION IS READ, because the protocol promises it rides on every frame in both directions
     * and a promise nothing checks is not one. A room speaking a version this page does not know is
     * not a frame to skip and carry on from: every frame after it is being read against the wrong
     * shape, so a field that moved reads as a field that is missing and the room looks empty rather
     * than incompatible. A frame stating NO version is left alone — the keepalive pair carries none
     * by design, and there is nothing to disagree with.
     */
    const version = parsed.v;
    if (typeof version === "number" && version !== MEETING_PROTOCOL_VERSION) {
      this.#handlers.incompatible(version);
      return;
    }

    const type = readString(parsed, "type");
    if (type === null) return;
    // Nothing about the room's contents is read before the room has said who this is and what it
    // holds — FRAMES_BEFORE_WELCOME says why at length.
    if (!this.#welcomed && !FRAMES_BEFORE_WELCOME.has(type)) return;

    switch (type) {
      case "pong":
        this.#missedPongs = 0;
        return;
      case "welcome":
        this.#welcomed = true;
        this.#handlers.welcome(parsed);
        return;
      case "roster":
        // The whole list, which is also the answer to a `sync`: whatever gap was suspected, this
        // frame settles it.
        this.noteRosterSettled();
        this.#handlers.roster(parsed);
        return;
      case "roster-delta":
        this.#handlers.rosterDelta(parsed);
        return;
      case "presence":
        this.#handlers.presence(parsed);
        return;
      case "layered":
        this.#handlers.layered(parsed);
        return;
      case "published":
        this.#handlers.published(parsed);
        return;
      case "subscribed":
        this.#handlers.subscribed(parsed);
        return;
      case "renegotiated":
        this.#handlers.renegotiated(parsed);
        return;
      case "closed":
        this.#handlers.closed(parsed);
        return;
      case "ended":
        this.#handlers.ended(parsed);
        return;
      case "refused":
        this.#handlers.refused(parsed);
        return;
      default:
        return;
    }
  }

  #startKeepalive(): void {
    this.#stopKeepalive();
    this.#missedPongs = 0;
    this.#keepalive = setInterval(() => {
      if (this.#missedPongs >= MISSED_PONGS_BEFORE_FAILURE) {
        this.#handlers.lost();
        return;
      }
      this.#missedPongs += 1;
      // The byte-exact frame the room's runtime answers without waking a hibernating object. Any
      // other spelling of a ping costs a full wake for every idle participant.
      this.sendRaw(PING_FRAME);
    }, KEEPALIVE_INTERVAL_MILLISECONDS);
  }

  #stopKeepalive(): void {
    if (this.#keepalive !== undefined) clearInterval(this.#keepalive);
    this.#keepalive = undefined;
  }
}
