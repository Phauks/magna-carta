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
import type { MeetingHostRole } from "@magna-carta/meeting-protocol/types";
import type { MeetingMessage } from "@magna-carta/api-client";
import { noOperationDiagnosticsSink, type DiagnosticsSink } from "./diagnostics.svelte.ts";

/** How long between keepalive pings. */
const KEEPALIVE_INTERVAL_MILLISECONDS = 30_000;

/**
 * How long a `sync` that nothing has answered stands before the next gap may ask again.
 *
 * ASKING ONCE PER GAP IS NOT THE SAME AS ASKING ONCE EVER, and the difference was invisible until
 * the room started dropping a `sync` that follows too closely on the last one — which it does, so
 * that three hundred browsers meeting the same missing frame cannot ask for three hundred rosters
 * in the same second. A latch held until a full roster arrives is then permanent for exactly the
 * case it exists to cover: the dropped sync is never answered, so the latch never clears, and every
 * later gap in the meeting is swallowed by it. The window is longer than the room's own, so the
 * second ask is one the room will actually take.
 */
export const SYNC_LATCH_MILLISECONDS = 2_000;

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
  /**
   * Their hand is up: they want the floor, and a host works the queue in the order the hands went
   * up. It rides the roster as well as the presence frame that changes it, for the reason the other
   * two do — a browser arriving at the twentieth minute draws the marks and sorts the queue from
   * the roster alone rather than being blank until each hand next moves.
   */
  readonly hand: boolean;
  /**
   * When the room accepted the hand, or null where it is down.
   *
   * TWO FIELDS ON THE WIRE, ONE FACT IN STORAGE: the room keeps the instant and projects the
   * boolean from it, because every tile, every row and every badge branches on the boolean and none
   * of them wants to compare against null, while only the queue wants the instant. The CLOCK is the
   * room's for the reason the transcript's own instant is: a queue ordered by what each person's
   * machine said is not one ordering, and the disagreement is invisible to the host reading it.
   */
  readonly handRaisedAt: string | null;
  /**
   * Whether this person is running the meeting, and in which of the two ways. Null for everybody
   * else, which is most of the room.
   *
   * It rides on the roster rather than only on the socket holding the grant because every browser
   * draws the badge, and because a host's own screen decides from it which items a tile's menu
   * offers. The room reads it from the STORED participant record and rewrites those records after a
   * hosting route commits, so a grant withdrawn mid-meeting reaches every screen on the next roster.
   */
  readonly hostRole: MeetingHostRole | null;
  /**
   * Whether this is somebody from the firm or a guest from outside it. The room's roster carries it;
   * a row from a room that predates it is read as a member, which is what every row then was. Read
   * where the two kinds can do different things — a guest cannot answer a poll — rather than guessed
   * from whether an identifier happens to be present.
   */
  readonly kind: "member" | "guest";
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

/** Which of the two ways somebody is running the meeting. Null for anything else a frame says. */
export function readHostRole(value: unknown): MeetingHostRole | null {
  return value === "host" || value === "co-host" ? value : null;
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
      // Absent is a hand that is down, which is what a roster without the field always meant and
      // what is true of everybody in almost every room.
      hand: entry.hand === true,
      handRaisedAt: readString(entry, "handRaisedAt"),
      // Absent is "not running this meeting", which is what a roster without the field always meant
      // and what is true of everybody but one or two people in any room.
      hostRole: readHostRole(entry.hostRole),
      kind: entry.kind === "guest" ? "guest" : "member",
    });
  }
  return participants;
}

/**
 * One message a `message` frame carried, read into the shape the record's own route answers with.
 *
 * READ DEFENSIVELY AND WHOLE, like every other frame here: what arrives goes through the same merge
 * a page does, so a row missing the handle or the instant that ORDERS the transcript is not a row —
 * drawing it would put a message at an arbitrary place in a conversation, which is worse than
 * waiting the three seconds for the poll to read the same row correctly.
 */
export function readChatMessage(value: unknown): MeetingMessage | null {
  if (!isRecord(value)) return null;
  const id = readString(value, "id");
  const sentAt = readString(value, "sentAt");
  const participantId = readString(value, "participantId");
  if (id === null || sentAt === null || participantId === null) return null;
  return {
    id,
    meetingId: readString(value, "meetingId") ?? "",
    // The record's own two kinds; anything else is a member, which is every row a firm's meeting
    // holds until guests land.
    participantKind: value.participantKind === "guest" ? "guest" : "member",
    participantId,
    userId: readString(value, "userId"),
    sentAt,
    body: readString(value, "body") ?? "",
    redactedAt: readString(value, "redactedAt"),
    redactedByUserId: readString(value, "redactedByUserId"),
  };
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

/** A count of tracks, for a diagnostic note that carries a number and no names. */
function countOfTracks(howMany: number): string {
  return howMany === 1 ? "1 track" : `${howMany} tracks`;
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
  /**
   * Somebody threw a reaction, named. It arrives at or below `ROSTER_DELTA_THRESHOLD` and never
   * about this browser itself — the room does not echo a reaction to its sender, whose own screen
   * has already drawn it.
   */
  reaction(frame: Record<string, unknown>): void;
  /**
   * The same second's reactions as COUNTS, which is what a room too large to attribute sends
   * instead: above the threshold a bubble on the right face is a promise the gallery cannot keep,
   * and the count is the thing that is actually true at that size. It reaches every socket,
   * including the people who reacted, so the strip and a bubble are drawn in different places and
   * nothing is counted twice on any screen.
   */
  reactions(frame: Record<string, unknown>): void;
  /**
   * A copy of a message the record already holds, so it reaches the other browsers as it is said.
   * The ROUTE is still the record: a browser that misses this is caught up by the read behind it.
   */
  message(frame: Record<string, unknown>): void;
  /** A message taken back, as the handle and the instant alone — the body is already blank. */
  messageRedacted(frame: Record<string, unknown>): void;
  /**
   * A host asked the room a question: the poll WHOLE, options and all, rather than a handle.
   *
   * Whole because a bare handle would send every browser in the room to the read in the instant a
   * poll opens, which is the stampede the relay exists to prevent. The route is still the record,
   * and a browser that misses this is caught up by the read behind it.
   */
  pollOpened(frame: Record<string, unknown>): void;
  /** A host closed a poll, with its final tally. A closed poll takes no more answers. */
  pollClosed(frame: Record<string, unknown>): void;
  /**
   * A poll's tally as it stands, once a second while people are answering. The room holds the
   * latest count rather than a sum, so every frame is the whole of the current truth.
   */
  pollTally(frame: Record<string, unknown>): void;
  /** Somebody put a question to the room: the question whole, on the poll's own reasoning. */
  questionAsked(frame: Record<string, unknown>): void;
  /** A question was marked answered, unmarked, or taken back. A redacted one carries no body. */
  questionUpdated(frame: Record<string, unknown>): void;
  /** Upvote counts, coalesced to one frame a second for the whole room. Never who upvoted. */
  questionTally(frame: Record<string, unknown>): void;
  layered(frame: Record<string, unknown>): void;
  published(frame: Record<string, unknown>): void;
  subscribed(frame: Record<string, unknown>): void;
  renegotiated(frame: Record<string, unknown>): void;
  closed(frame: Record<string, unknown>): void;
  /**
   * What is true of the ROOM rather than of anybody in it: who is on every screen, and whether the
   * door is shut. Carried on the `welcome` as well, because a socket that has just arrived holds
   * nothing to apply a change to.
   */
  roomState(frame: Record<string, unknown>): void;
  /** A host closed this browser's microphone upstream. Sent to the muted participant alone. */
  muted(frame: Record<string, unknown>): void;
  /** A host asked this member to unmute. A request — nothing happens until the member chooses. */
  unmuteRequested(frame: Record<string, unknown>): void;
  /**
   * Where this browser stands at the door. It arrives in place of a `welcome` and is re-sent as the
   * queue in front of them moves; a waiting socket is never sent a welcome at all.
   */
  lobby(frame: Record<string, unknown>): void;
  /**
   * A host let them in, on the socket they were waiting on. The ordinary `welcome` follows it.
   *
   * Two frames with one job each, which is what keeps the welcome handler the handler it has always
   * been: this one is where the browser learns it may start capturing and publishing.
   */
  admitted(frame: Record<string, unknown>): void;
  /**
   * Who is at the door, sent to the sockets holding a grant and to nobody else. Whole rather than as
   * a difference, and carried on a host's own `welcome` for the reason the roster is.
   */
  waiting(frame: Record<string, unknown>): void;
  /**
   * A recording started or stopped: the announcement the owner's ruling makes the consent mechanism.
   *
   * Sent to every WELCOMED socket — a guest's as much as a member's — the instant the route commits,
   * and never to a socket at the door, where nobody is being recorded. The recording already running
   * when a socket arrives rides on its `welcome` instead, in the same shape, so a late arrival is
   * told in exactly the words the room was told in and one code path plays both.
   */
  recording(frame: Record<string, unknown>): void;
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
 * The ones here are the frames that are about the socket rather than about the room's contents: the
 * hello itself, a refusal (which may be the reason there will never be a hello), and the meeting
 * having ended under it.
 *
 * THE DOOR'S TWO ARE HERE BECAUSE A WAITING SOCKET NEVER GETS A WELCOME AT ALL. `lobby` is what the
 * room sends in its place and `admitted` is what comes immediately before one, so a rule that held
 * them until a welcome had arrived would hold both of them forever — the screen would sit blank
 * behind a door that was open.
 */
const FRAMES_BEFORE_WELCOME = new Set(["welcome", "refused", "ended", "pong", "lobby", "admitted"]);

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
  /** When the latch above lets go on its own, where no roster has come back to clear it. */
  #syncLatch: ReturnType<typeof setTimeout> | undefined;
  /** Whether the room has said hello. Almost nothing it sends means anything before it has. */
  #welcomed = false;
  /**
   * True while this side is the one closing the socket.
   *
   * The close handler cannot tell a socket that went away from one this browser hung up, and the
   * difference is the whole meaning of the note: "the connection to the room went away" in a list
   * of what happened, under a meeting the member ended themselves, reads as a fault that was not
   * one — and it is the LAST line, which is the line somebody diagnosing reads first.
   */
  #closing = false;

  /** Where what happened on the wire is noted. A no-op unless the client wired one in. */
  readonly #diagnostics: DiagnosticsSink;

  constructor(
    openSocket: (url: string) => WebSocket,
    handlers: RoomFrameHandlers,
    diagnostics: DiagnosticsSink = noOperationDiagnosticsSink(),
  ) {
    this.#openSocket = openSocket;
    this.#handlers = handlers;
    this.#diagnostics = diagnostics;
  }

  open(url: string): void {
    this.#welcomed = false;
    this.#closing = false;
    this.#diagnostics.note({ kind: "join" });
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
      if (!this.#closing) this.#diagnostics.note({ kind: "socket-lost", detail: "closed" });
      this.#handlers.lost();
    });
  }

  send(frame: Record<string, unknown>): void {
    // Noted here rather than at the caller: a publish is the one frame going out that a member's
    // own picture and voice depend on, and this is the one place every frame passes through.
    if (frame.type === "publish") this.#diagnostics.note({ kind: "publish" });
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

  /**
   * Ask the room for the whole roster, once, where a delta showed this browser has missed one.
   *
   * The latch lets go on the roster that answers it, and failing that on its own after
   * `SYNC_LATCH_MILLISECONDS` — because a `sync` the room dropped is never answered, and a latch
   * with no way out would swallow every later gap in the meeting.
   */
  requestSync(): void {
    if (this.#syncAsked) return;
    this.#syncAsked = true;
    this.send({ type: "sync" });
    if (this.#syncLatch !== undefined) clearTimeout(this.#syncLatch);
    this.#syncLatch = setTimeout(() => {
      this.#syncLatch = undefined;
      this.#syncAsked = false;
    }, SYNC_LATCH_MILLISECONDS);
  }

  /** The whole list arrived, so whatever gap was suspected is settled and may be asked about again. */
  noteRosterSettled(): void {
    this.#clearSyncLatch();
  }

  close(): void {
    this.#stopKeepalive();
    this.#clearSyncLatch();
    const socket = this.#socket;
    this.#socket = null;
    this.#socketOpen = false;
    this.#outbox = [];
    this.#closing = true;
    socket?.close();
    this.#closing = false;
  }

  reset(): void {
    this.#missedPongs = 0;
    this.#outbox = [];
    this.#clearSyncLatch();
    this.#welcomed = false;
  }

  /** Let the next gap ask, and stop the timer that would have done it later. */
  #clearSyncLatch(): void {
    if (this.#syncLatch !== undefined) clearTimeout(this.#syncLatch);
    this.#syncLatch = undefined;
    this.#syncAsked = false;
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
      this.#diagnostics.note({
        kind: "protocol-mismatch",
        detail: `version ${version}`,
      });
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
        this.#diagnostics.note({ kind: "welcome" });
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
      case "reaction":
        this.#handlers.reaction(parsed);
        return;
      case "reactions":
        this.#handlers.reactions(parsed);
        return;
      case "message":
        this.#handlers.message(parsed);
        return;
      case "message-redacted":
        this.#handlers.messageRedacted(parsed);
        return;
      case "poll-opened":
        this.#handlers.pollOpened(parsed);
        return;
      case "poll-closed":
        this.#handlers.pollClosed(parsed);
        return;
      case "poll-tally":
        this.#handlers.pollTally(parsed);
        return;
      case "question-asked":
        this.#handlers.questionAsked(parsed);
        return;
      case "question-updated":
        this.#handlers.questionUpdated(parsed);
        return;
      case "question-tally":
        this.#handlers.questionTally(parsed);
        return;
      case "layered":
        this.#handlers.layered(parsed);
        return;
      case "published":
        this.#handlers.published(parsed);
        return;
      case "subscribed":
        this.#diagnostics.note({
          kind: "subscribed",
          detail: countOfTracks(Array.isArray(parsed.tracks) ? parsed.tracks.length : 0),
        });
        this.#handlers.subscribed(parsed);
        return;
      case "renegotiated":
        this.#handlers.renegotiated(parsed);
        return;
      case "closed":
        this.#handlers.closed(parsed);
        return;
      case "room-state":
        this.#handlers.roomState(parsed);
        return;
      case "muted":
        this.#handlers.muted(parsed);
        return;
      case "unmute-requested":
        this.#handlers.unmuteRequested(parsed);
        return;
      case "lobby":
        this.#handlers.lobby(parsed);
        return;
      case "admitted":
        // The welcome the room sends next is what makes this socket a member of the room; this
        // frame is where the browser learns the wait is over and may start capturing.
        this.#handlers.admitted(parsed);
        return;
      case "waiting":
        this.#handlers.waiting(parsed);
        return;
      case "recording":
        // Held behind the welcome like every frame about the room: the welcome itself carries the
        // recording running at arrival, so nothing said before it is lost by waiting for it.
        this.#handlers.recording(parsed);
        return;
      case "ended":
        this.#diagnostics.note({ kind: "ended" });
        this.#handlers.ended(parsed);
        return;
      case "refused": {
        // A supersession is its own kind rather than a refusal with a reason attached: it is the
        // one refusal that is not a fault at all, and reading a list of what went wrong is easier
        // when the entry that went RIGHT is not wearing the same word as the ones that did not.
        const reason = readString(parsed, "reason");
        this.#diagnostics.note({
          kind: reason === "superseded" ? "superseded" : "refused",
          detail: reason,
          errorId: readString(parsed, "errorId"),
        });
        this.#handlers.refused(parsed);
        return;
      }
      default:
        return;
    }
  }

  #startKeepalive(): void {
    this.#stopKeepalive();
    this.#missedPongs = 0;
    this.#keepalive = setInterval(() => {
      if (this.#missedPongs >= MISSED_PONGS_BEFORE_FAILURE) {
        this.#diagnostics.note({
          kind: "socket-lost",
          detail: "no answer to the keepalive",
        });
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
