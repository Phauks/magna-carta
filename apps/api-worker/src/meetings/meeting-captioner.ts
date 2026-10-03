import { DurableObject } from "cloudflare:workers";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import type { FirmId, MeetingId } from "@magna-carta/identifiers/types";
import type { CaptionResult, CaptionStream, InferencePort } from "@magna-carta/inference/port";
import {
  CAPTION_AUDIO_LOSS_GRACE_MILLISECONDS,
  CAPTION_FRAME_BUDGET_PER_SECOND,
  CAPTION_KEEP_ALIVE_MILLISECONDS,
  CAPTION_PENDING_AUDIO_BYTES,
  CAPTION_SESSION_CEILING,
  captionSilenceDeadline,
  captionText,
  freshCaptionFrameBudget,
  interimDueAt,
  spendCaptionFrameBudget,
  type CaptionFrameBudget,
} from "@magna-carta/meetings/caption-sessions";
import { decodePcmFrame, downmixToMono } from "@magna-carta/meetings/pcm-frame";
import { captionsEnabledDefinition } from "@magna-carta/meetings/settings";
import type { Bindings } from "../app.ts";
import { trackBackgroundWork } from "../background.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { deploymentInferencePort } from "../inference/call-site.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";
import {
  CAPTION_SINK_TOKEN_LIFETIME_MILLISECONDS,
  mintCaptionSinkToken,
} from "./caption-sink-token.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "./sfu/realtime-failure.ts";
import { sfuClientForEnv } from "./sfu/sfu-client.ts";
import { sinkEndpoint, sinkSigningKeyForEnv } from "./sink-token.ts";

// ONE MEETING'S LIVE CAPTIONS: the Durable Object that hears whoever is speaking and hands the words to
// the room, keyed `${firmId}:${meetingId}`.
//
// WHY A SIBLING OF THE RECORDER AND NOT A PART OF IT — the memory and the ownership arithmetic.
//
//   * OWNERSHIP. A recorder is one RECORDING's (`firmId:recordingId`) and lives exactly as long as it:
//     a stop and a second start are two recorders. Captions are the MEETING's, run with or without a
//     recording, and outlive a recording that stops while people go on talking. Captions inside the
//     recorder would have no object to live in when nothing is recorded, and would be torn down by a
//     stop nobody meant for them.
//   * MEMORY. The recorder's isolate is already spent by arithmetic: eleven tracks of a 6 MiB staging
//     buffer against a 40 MiB reserve (`@magna-carta/meetings/settings`). A caption session is small —
//     two sockets and at most two seconds of audio — but every byte added there comes out of the reserve
//     that arithmetic promised was untouched, and the track ceiling would have to be derived again.
//     Here the whole isolate holds at most `CAPTION_SESSION_CEILING` sessions of under half a megabyte.
//   * REACH. The recorder hears at most eleven stays — its ceiling — and a caption has to hear whoever
//     speaks in a room of three hundred.
//   * ISOLATION. A caption model that fails mid-meeting must degrade to no captions and touch nothing
//     else; in another object it cannot reach the recording's buffers, its uploads or its alarm at all.
//
// What it costs: while a meeting is BOTH recorded and captioned, the speaker's audio leaves the routing
// service twice — once to the recorder, once here — for the seconds they speak. That is the captions-only
// egress line of the cost table (about $0.045 a meeting-hour), small beside the model's own $0.72.
//
// WHAT IT DOES. The room tells it, on the `speaking` presence the room already relays, when somebody
// starts or stops talking (`speakingChanged`). On a start it opens a SESSION for that stay: a routing-
// service WebSocket adapter for their microphone, dialling this object back through the sink route with
// a signed caption token, and a stream to the platform's caption model through the inference port. Audio
// in is decoded, folded to mono and sent on as it arrives; words back are cleaned, interims coalesced,
// and handed to the room, which fans them out to every socket. Three seconds after the room says they
// stopped, the session closes: the adapter is closed, the model is asked to finish, and its last words
// still reach the room.
//
// NOTHING IS STORED. A caption is a display, and the transcript is the record. Words pass through this
// object's memory on their way to the room and are kept nowhere: not in its storage, not in the room's,
// not in a log line — no telemetry field, failure or refusal it emits carries a word, a name, a track
// name or a token. Its storage holds the meeting's identity, the handles of the adapters it has open (so
// a restart can close what it lost track of) and counts.
//
// NOT HIBERNATING, on the recorder's terms: it receives fifty frames a second per speaker while it works
// and holds an outbound socket to the model, so it is never idle while a session is open, and it is
// evicted soon after the last one closes.

/** The routing service's adapter for one speaker: who it is for and where its audio goes. */
export interface CaptionSpeakingUpdate {
  readonly firmId: FirmId;
  readonly meetingId: MeetingId;
  // The STAY whose microphone this is — a member's attendance or a guest's stay.
  readonly participantId: string;
  readonly participantKind: "member" | "guest";
  // The member behind the stay, or null for a guest.
  readonly userId: string | null;
  // The name the roster gives them, which every caption of theirs carries.
  readonly displayName: string;
  readonly speaking: boolean;
  // The routing session and track name of their microphone, or null when they publish none.
  readonly track: { readonly sessionId: string; readonly trackName: string } | null;
  // The room's instant for this transition, in milliseconds — so an update that overtook a later one on
  // the way here is recognised and ignored rather than reopening a session somebody has closed.
  readonly at: number;
}

/** One caption, as the captioner hands it to the room to fan out. */
export interface CaptionHeard {
  readonly participantId: string;
  readonly participantKind: "member" | "guest";
  readonly userId: string | null;
  readonly displayName: string;
  readonly segmentId: string;
  readonly text: string;
  readonly final: boolean;
  readonly at: string;
}

/** Why a session closed — counted, never more. */
type CaptionSessionEnding =
  | "silence"
  | "audio-lost"
  | "model-failed"
  | "participant-gone"
  | "captions-off"
  | "meeting-ended";

/** What the captioner has counted, across every session it has run for this meeting. */
interface CaptionMeter {
  // Milliseconds of audio sent to the caption model — what the model bills, and what captions are
  // metered on, as the transcript is metered on the audio it sent.
  readonly audioMilliseconds: number;
  readonly sessionsOpened: number;
  // Speakers past `CAPTION_SESSION_CEILING`, who were not captioned.
  readonly sessionsRefused: number;
  // Sessions the model or the adapter would not open, or dropped part-way.
  readonly sessionFailures: number;
}

const NO_METER: CaptionMeter = {
  audioMilliseconds: 0,
  sessionsOpened: 0,
  sessionsRefused: 0,
  sessionFailures: 0,
};

const IDENTITY_KEY = "identity";
const ADAPTERS_KEY = "adapters";
const METER_KEY = "meter";

interface StoredIdentity {
  readonly firmId: FirmId;
  readonly meetingId: MeetingId;
}

/** One speaker's session, in memory only. */
interface CaptionSession {
  readonly participantId: string;
  readonly participantKind: "member" | "guest";
  readonly userId: string | null;
  displayName: string;
  readonly trackName: string;
  readonly routingSessionId: string;
  // The nonce in the caption token of this session's one adapter; a dial carrying any other is refused.
  readonly adapterNonce: string;
  adapterId: string | null;
  audioSocket: WebSocket | null;
  // Since when no audio socket has been attached: from the moment the adapter is asked for, until the
  // routing service dials, and again from any drop. The loss grace is measured from here.
  audioSocketLostAt: number | null;
  stream: CaptionStream | null;
  // Audio that arrived before the model's stream was open, oldest first and bounded.
  pending: Uint8Array[];
  pendingBytes: number;
  framesReceived: number;
  framesDropped: number;
  // When the room last said they stopped speaking, or null while they are speaking.
  silentSince: number | null;
  // When the model was last sent anything — audio or a keepalive.
  lastModelContactAt: number;
  // The stretch of speech the next caption belongs to, and whether a caption of it has been shown.
  segmentNumber: number;
  segmentShown: boolean;
  // The latest interim guess not yet sent, and the timer that will send it.
  heldInterim: string | null;
  interimTimer: ReturnType<typeof setTimeout> | null;
  lastInterimSentAt: number | null;
  closing: boolean;
}

// THE CLOCK the deadlines are measured on, replaceable by a test: the silence close, the audio-loss
// grace and the keepalive are each seconds long, and a test that waited for them would be measuring the
// machine. Inert outside a test that installs one.
let clockForTests: (() => number) | null = null;

/** Installs (or, with null, removes) the clock a test wants the captioner's deadlines measured on. */
export function setCaptionerClockForTests(clock: (() => number) | null): void {
  clockForTests = clock;
}

function now(): number {
  return clockForTests === null ? Date.now() : clockForTests();
}

// THE MODEL PORT, replaceable by a test, on the recorder's compose-queue precedent: the captioner is
// constructed with the deployment's own environment and cannot be handed another. The default is the
// deployment's own port over the AI binding — never the stub, because a caption of stub text on a
// client's screen would be worse than none.
let portForTests: InferencePort | null = null;

/** Installs (or, with null, removes) the inference port a test wants captions heard through. */
export function setCaptionInferencePortForTests(port: InferencePort | null): void {
  portForTests = port;
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class MeetingCaptioner extends DurableObject<Bindings> {
  private identity: StoredIdentity | null = null;
  private meter: CaptionMeter = NO_METER;
  private readonly sessions = new Map<string, CaptionSession>();
  // The latest instant the room has spoken for each stay, so an older update is never acted on.
  private readonly latestUpdateAt = new Map<string, number>();
  private budget: CaptionFrameBudget = freshCaptionFrameBudget(now());
  // One chain for everything handed to the room, so a final is never overtaken by an earlier interim.
  private delivery: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // What a previous instance left behind. Its sessions were in memory and are gone; the adapters it
    // opened for them are not, and go on sending audio to an address nobody is listening at — so they
    // are closed before anything else is delivered. Only handles were stored, never a word.
    void ctx.blockConcurrencyWhile(async () => {
      this.identity = (await ctx.storage.get<StoredIdentity>(IDENTITY_KEY)) ?? null;
      this.meter = (await ctx.storage.get<CaptionMeter>(METER_KEY)) ?? NO_METER;
      const orphaned = (await ctx.storage.get<Record<string, string>>(ADAPTERS_KEY)) ?? {};
      const adapterIds = Object.values(orphaned);
      if (adapterIds.length > 0) {
        await this.closeAdapters(adapterIds);
        await ctx.storage.delete(ADAPTERS_KEY);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // The door the room knocks on
  // ---------------------------------------------------------------------------------------------

  /**
   * SOMEBODY STARTED OR STOPPED SPEAKING — the room's relay of the presence it already keeps, sent only
   * while captions are on. A start opens their session if none is open; a stop starts the three-second
   * count to its close, and a start inside it cancels the count.
   */
  async speakingChanged(update: CaptionSpeakingUpdate): Promise<void> {
    await this.remember(update.firmId, update.meetingId);
    const latest = this.latestUpdateAt.get(update.participantId);
    if (latest !== undefined && latest > update.at) return;
    this.latestUpdateAt.set(update.participantId, update.at);
    const session = this.sessions.get(update.participantId);
    if (update.speaking) {
      if (session !== undefined) {
        session.silentSince = null;
        session.displayName = update.displayName;
        return;
      }
      await this.openSession(update);
      return;
    }
    if (session !== undefined && session.silentSince === null) {
      session.silentSince = now();
      await this.armAlarm();
    }
  }

  /** Somebody left the room: their session, if any, closes now rather than after the silence. */
  async participantGone(participantId: string): Promise<void> {
    this.latestUpdateAt.delete(participantId);
    const session = this.sessions.get(participantId);
    if (session !== undefined) await this.closeSession(session, "participant-gone");
  }

  /** Captions are off, or the meeting is over: every session closes. */
  async stop(reason: "captions-off" | "meeting-ended"): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values(), async (session) => {
        await this.closeSession(session, reason);
      }),
    );
    this.latestUpdateAt.clear();
  }

  /** What this captioner is holding, for a test and for an operator: handles and counts, never words. */
  async inspect(): Promise<{
    readonly meter: CaptionMeter;
    readonly sessions: readonly {
      readonly participantId: string;
      readonly adapterOpen: boolean;
      readonly attached: boolean;
      readonly streaming: boolean;
      readonly quiet: boolean;
      readonly framesReceived: number;
      readonly framesDropped: number;
      readonly pendingBytes: number;
      readonly audioMillisecondsSent: number;
    }[];
    readonly storedAdapters: number;
  }> {
    const stored = (await this.ctx.storage.get<Record<string, string>>(ADAPTERS_KEY)) ?? {};
    return {
      meter: this.meter,
      sessions: [...this.sessions.values()].map((session) => ({
        participantId: session.participantId,
        adapterOpen: session.adapterId !== null,
        attached: session.audioSocket !== null,
        streaming: session.stream !== null,
        quiet: session.silentSince !== null,
        framesReceived: session.framesReceived,
        framesDropped: session.framesDropped,
        pendingBytes: session.pendingBytes,
        audioMillisecondsSent: session.stream?.audioMillisecondsSent() ?? 0,
      })),
      storedAdapters: Object.keys(stored).length,
    };
  }

  /**
   * THE SOCKET THE ROUTING SERVICE DIALS, forwarded by the sink route after it verified a caption
   * token. The stay and the adapter nonce ride the internal address the route built from the verified
   * claims. ONE SOCKET PER SESSION, AND ONLY FOR ITS CURRENT ADAPTER: a dial for a stay with no open
   * session, for an earlier adapter, or against a socket that is still live is refused.
   */
  override async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) {
      return new Response("this endpoint accepts the routing service's audio only", {
        status: 426,
      });
    }
    const address = new URL(request.url);
    const participantId = address.searchParams.get("participant") ?? "";
    const adapterNonce = address.searchParams.get("adapter") ?? "";
    const session = this.sessions.get(participantId);
    if (
      session === undefined ||
      session.closing ||
      session.adapterNonce !== adapterNonce ||
      session.audioSocket !== null
    ) {
      return new Response(null, { status: 404 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Buffers, decoded in arrival order — a Blob can only be read asynchronously, which would let two
    // frames of one speaker reach the model out of order.
    (server as unknown as { binaryType: string }).binaryType = "arraybuffer";
    server.accept();
    session.audioSocket = server;
    session.audioSocketLostAt = null;
    server.addEventListener("message", (event) => {
      this.receive(session, event.data);
    });
    server.addEventListener("close", () => {
      if (session.audioSocket !== server) return;
      session.audioSocket = null;
      session.audioSocketLostAt = now();
      void this.armAlarm();
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * THE DEADLINES: a quiet speaker's session closed three seconds after they stopped, one whose audio
   * socket has been gone past its grace closed for want of it, and a stalled stream kept alive.
   */
  override async alarm(): Promise<void> {
    const at = now();
    const closing: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      if (session.silentSince !== null && at >= captionSilenceDeadline(session.silentSince)) {
        closing.push(this.closeSession(session, "silence"));
        continue;
      }
      if (
        session.audioSocket === null &&
        session.audioSocketLostAt !== null &&
        at - session.audioSocketLostAt >= CAPTION_AUDIO_LOSS_GRACE_MILLISECONDS
      ) {
        closing.push(this.closeSession(session, "audio-lost"));
        continue;
      }
      if (
        session.stream !== null &&
        at - session.lastModelContactAt >= CAPTION_KEEP_ALIVE_MILLISECONDS
      ) {
        session.stream.keepAlive();
        session.lastModelContactAt = at;
      }
    }
    await Promise.all(closing);
    await this.armAlarm();
  }

  // ---------------------------------------------------------------------------------------------
  // Opening and closing a session
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens one speaker's session: the firm's switch read again, then the model's stream and the routing
   * service's adapter together. Held in the map from the first instant, before any await, so a second
   * start for the same stay finds it rather than opening a second one.
   */
  private async openSession(update: CaptionSpeakingUpdate): Promise<void> {
    // Nothing to hear: they publish no microphone.
    if (update.track === null) return;
    if (this.sessions.size >= CAPTION_SESSION_CEILING) {
      await this.count({ sessionsRefused: 1 });
      return;
    }
    const at = now();
    const session: CaptionSession = {
      participantId: update.participantId,
      participantKind: update.participantKind,
      userId: update.userId,
      displayName: update.displayName,
      trackName: update.track.trackName,
      routingSessionId: update.track.sessionId,
      adapterNonce: newNonce(),
      adapterId: null,
      audioSocket: null,
      audioSocketLostAt: at,
      stream: null,
      pending: [],
      pendingBytes: 0,
      framesReceived: 0,
      framesDropped: 0,
      silentSince: null,
      lastModelContactAt: at,
      segmentNumber: 0,
      segmentShown: false,
      heldInterim: null,
      interimTimer: null,
      lastInterimSentAt: null,
      closing: false,
    };
    this.sessions.set(session.participantId, session);

    // THE FIRM'S SWITCH, READ AGAIN AT EVERY OPEN. The room checked it when a host turned captions on;
    // a firm that switched captions off since then is honoured at the next person who speaks, and the
    // room is told so it announces captions off to everybody. A read that fails decides nothing in
    // captions' favour: that turn is not captioned.
    let allowed: boolean;
    try {
      allowed = await readFirmSetting(
        firmDatabaseFor(this.env.FIRM_DATABASE, update.firmId),
        captionsEnabledDefinition,
      );
    } catch (caught) {
      this.recordFailure("read-setting", caught);
      this.sessions.delete(session.participantId);
      return;
    }
    if (!allowed) {
      this.sessions.delete(session.participantId);
      await this.withdraw(update.firmId, update.meetingId);
      return;
    }

    const [stream, adapterId] = await Promise.all([
      this.openStream(update.firmId, session),
      this.openAdapter(update.firmId, update.meetingId, session),
    ]);
    if (session.closing || stream === null || adapterId === null) {
      // One half did not open, or the session was closed while both were opening. Whatever did open is
      // let go, and the speaker is simply not captioned this turn — a caption that cannot be had is not
      // a fault anybody in the meeting can act on.
      stream?.close();
      if (adapterId !== null) await this.closeAdapters([adapterId]);
      if (!session.closing) {
        this.sessions.delete(session.participantId);
        await this.count({ sessionFailures: 1 });
      }
      return;
    }
    session.stream = stream;
    session.adapterId = adapterId;
    session.lastModelContactAt = now();
    for (const samples of session.pending) stream.sendAudio(samples);
    session.pending = [];
    session.pendingBytes = 0;
    await this.rememberAdapter(session.participantId, adapterId);
    await this.count({ sessionsOpened: 1 });
    await this.armAlarm();
  }

  /** The model's stream for one session, or null when it would not open. */
  private async openStream(firmId: FirmId, session: CaptionSession): Promise<CaptionStream | null> {
    const port = portForTests ?? deploymentInferencePort(this.env);
    try {
      const opened = await port.openCaptionStream({
        firmId,
        onResult: (result) => {
          this.heard(session, result);
        },
        onEnd: (outcome) => {
          void this.streamEnded(session, outcome);
        },
      });
      if (!opened.ok) {
        this.recordFailure("open-stream", new Error(`caption stream refused: ${opened.reason}`));
        return null;
      }
      return opened.value;
    } catch (caught) {
      this.recordFailure("open-stream", caught);
      return null;
    }
  }

  /**
   * Asks the routing service for one adapter on the speaker's microphone, dialling this object back
   * with a signed caption token; answers its handle, or null when none was opened.
   */
  private async openAdapter(
    firmId: FirmId,
    meetingId: MeetingId,
    session: CaptionSession,
  ): Promise<string | null> {
    const client = sfuClientForEnv(this.env);
    const key = sinkSigningKeyForEnv(this.env);
    const appBaseUrl = this.env.APP_BASE_URL;
    if (client === null || key === null || appBaseUrl === undefined || appBaseUrl === "") {
      return null;
    }
    try {
      const token = await mintCaptionSinkToken(key, {
        firmId,
        meetingId,
        participantId: session.participantId,
        adapterNonce: session.adapterNonce,
        expiresAt: Date.now() + CAPTION_SINK_TOKEN_LIFETIME_MILLISECONDS,
      });
      const [result] = await client.createWebSocketAdapters([
        {
          location: "remote",
          sessionId: session.routingSessionId,
          trackName: session.trackName,
          endpoint: sinkEndpoint(appBaseUrl, token),
          outputCodec: "pcm",
        },
      ]);
      if (
        result === undefined ||
        result.errorCode !== undefined ||
        result.adapterId === undefined
      ) {
        return null;
      }
      return result.adapterId;
    } catch (caught) {
      this.recordFailure("open-adapter", caught);
      return null;
    }
  }

  /**
   * LETS GO OF ONE SESSION: out of the map at once, so the speaker's next start opens a fresh one; the
   * routing service told to stop sending; the audio socket hung up; and the model asked to finish, so
   * the words it still holds reach the room as a final caption before its stream ends.
   */
  private async closeSession(
    session: CaptionSession,
    _ending: CaptionSessionEnding,
  ): Promise<void> {
    if (session.closing) return;
    session.closing = true;
    if (this.sessions.get(session.participantId) === session) {
      this.sessions.delete(session.participantId);
    }
    if (session.interimTimer !== null) clearTimeout(session.interimTimer);
    session.interimTimer = null;
    // The guess held back is superseded by the final the close asks the model for.
    session.heldInterim = null;
    session.pending = [];
    session.pendingBytes = 0;
    const socket = session.audioSocket;
    session.audioSocket = null;
    try {
      socket?.close(1000, "caption session closed");
    } catch {
      // Already closed.
    }
    if (session.adapterId !== null) {
      await this.closeAdapters([session.adapterId]);
      await this.forgetAdapter(session.participantId);
    }
    session.adapterId = null;
    const stream = session.stream;
    if (stream !== null) {
      stream.close();
      await this.count({ audioMilliseconds: stream.audioMillisecondsSent() });
    }
    await this.armAlarm();
  }

  /**
   * THE MODEL'S STREAM ENDED. Asked to, it is the end of a session already closing. Unasked, the model
   * or its transport failed under a speaker: the session closes, the failure is recorded, and nothing
   * else changes — the recording and the transcript of record do not go through this model at all. The
   * speaker's next turn tries again.
   */
  private async streamEnded(session: CaptionSession, outcome: "closed" | "failed"): Promise<void> {
    if (session.closing) return;
    if (outcome === "failed") {
      this.recordFailure("stream-dropped", new Error("the caption stream ended unasked"));
      await this.count({ sessionFailures: 1 });
    }
    await this.closeSession(session, "model-failed");
  }

  // ---------------------------------------------------------------------------------------------
  // Audio in, words out
  // ---------------------------------------------------------------------------------------------

  /**
   * One message off a speaker's audio socket: the envelope read, the two channels folded to the one the
   * model takes, and sent on — or held, bounded, while the model's stream is still opening.
   */
  private receive(session: CaptionSession, data: unknown): void {
    if (session.closing) return;
    let bytes: Uint8Array;
    if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (Object.prototype.toString.call(data) === "[object ArrayBuffer]") {
      bytes = new Uint8Array(data as ArrayBuffer);
    } else {
      session.framesDropped += 1;
      return;
    }
    const frame = decodePcmFrame(bytes);
    if (frame === null) {
      session.framesDropped += 1;
      return;
    }
    const mono = downmixToMono(frame.payload);
    const samples = new Uint8Array(mono.buffer, mono.byteOffset, mono.byteLength);
    session.framesReceived += 1;
    if (session.stream !== null) {
      session.stream.sendAudio(samples);
      session.lastModelContactAt = now();
      return;
    }
    session.pending.push(samples);
    session.pendingBytes += samples.byteLength;
    // Bounded: the OLDEST audio goes first, so what the model hears when it opens is the most recent.
    while (session.pendingBytes > CAPTION_PENDING_AUDIO_BYTES && session.pending.length > 0) {
      const dropped = session.pending.shift();
      session.pendingBytes -= dropped?.byteLength ?? 0;
      session.framesDropped += 1;
    }
  }

  /**
   * One answer from the model. A FINAL goes to the room at once and settles its stretch of speech; the
   * next stretch gets a new segment. An INTERIM is coalesced: at most one a speaker per window, and the
   * room's budget spent before it goes, the latest guess held and sent when its turn comes.
   */
  private heard(session: CaptionSession, result: CaptionResult): void {
    const words = captionText(result.text);
    if (result.final) {
      if (session.interimTimer !== null) clearTimeout(session.interimTimer);
      session.interimTimer = null;
      session.heldInterim = null;
      // An empty final after a guess was shown still settles the line, so a browser does not keep a
      // guess the model has taken back; an empty final nothing was shown for is nothing.
      if (words !== "" || session.segmentShown) this.deliver(session, words, true);
      session.segmentNumber += 1;
      session.segmentShown = false;
      return;
    }
    if (session.closing || words === "") return;
    session.heldInterim = words;
    this.flushInterim(session);
  }

  /** Sends the held interim if its window and the room's budget allow, or schedules the next try. */
  private flushInterim(session: CaptionSession): void {
    if (session.heldInterim === null || session.closing || session.interimTimer !== null) return;
    const at = now();
    const dueAt = interimDueAt(session.lastInterimSentAt, at);
    if (dueAt <= at) {
      const spent = spendCaptionFrameBudget(this.budget, at, false);
      this.budget = spent.budget;
      if (spent.allowed) {
        const words = session.heldInterim;
        session.heldInterim = null;
        session.lastInterimSentAt = at;
        this.deliver(session, words, false);
        return;
      }
    }
    // Not yet: its window has not closed, or the room's budget is spent for now. The latest guess waits
    // for the earliest instant either could allow it, and is replaced by any newer one meanwhile. A
    // resident timer rather than the alarm: this object is resident while a session is open, and the
    // wait is a fraction of a second.
    const waitMilliseconds = Math.max(
      dueAt - at,
      Math.ceil(1000 / CAPTION_FRAME_BUDGET_PER_SECOND),
    );
    session.interimTimer = setTimeout(() => {
      session.interimTimer = null;
      this.flushInterim(session);
    }, waitMilliseconds);
  }

  /** Hands one caption to the room, after every caption handed before it. */
  private deliver(session: CaptionSession, words: string, final: boolean): void {
    const identity = this.identity;
    if (identity === null) return;
    if (final) this.budget = spendCaptionFrameBudget(this.budget, now(), true).budget;
    if (!final) session.segmentShown = true;
    const heard: CaptionHeard = {
      participantId: session.participantId,
      participantKind: session.participantKind,
      userId: session.userId,
      displayName: session.displayName,
      segmentId: `${session.adapterNonce}-${String(session.segmentNumber)}`,
      text: words,
      final,
      at: new Date(now()).toISOString(),
    };
    const work = this.delivery.then(async () => {
      try {
        const room = this.env.MEETING_ROOM.get(
          this.env.MEETING_ROOM.idFromName(`${identity.firmId}:${identity.meetingId}`),
        );
        await room.captionHeard(heard);
      } catch (caught) {
        // A caption the room did not take is a caption nobody sees; the next one is along in a moment.
        this.recordFailure("deliver", caught);
      }
    });
    this.delivery = work;
    this.ctx.waitUntil(trackBackgroundWork(work));
  }

  // ---------------------------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------------------------

  /** The firm switched captions off: every session closes and the room announces captions off. */
  private async withdraw(firmId: FirmId, meetingId: MeetingId): Promise<void> {
    await this.stop("captions-off");
    try {
      const room = this.env.MEETING_ROOM.get(
        this.env.MEETING_ROOM.idFromName(`${firmId}:${meetingId}`),
      );
      await room.captionsWithdrawn();
    } catch (caught) {
      this.recordFailure("withdraw", caught);
    }
  }

  /** The meeting this captioner serves, written once. */
  private async remember(firmId: FirmId, meetingId: MeetingId): Promise<void> {
    if (this.identity !== null) return;
    this.identity = { firmId, meetingId };
    await this.ctx.storage.put(IDENTITY_KEY, this.identity);
  }

  private async rememberAdapter(participantId: string, adapterId: string): Promise<void> {
    const stored = (await this.ctx.storage.get<Record<string, string>>(ADAPTERS_KEY)) ?? {};
    await this.ctx.storage.put(ADAPTERS_KEY, { ...stored, [participantId]: adapterId });
  }

  private async forgetAdapter(participantId: string): Promise<void> {
    const stored = (await this.ctx.storage.get<Record<string, string>>(ADAPTERS_KEY)) ?? {};
    if (!(participantId in stored)) return;
    const { [participantId]: _closed, ...remaining } = stored;
    if (Object.keys(remaining).length === 0) await this.ctx.storage.delete(ADAPTERS_KEY);
    else await this.ctx.storage.put(ADAPTERS_KEY, remaining);
  }

  /** Adds to the meter and writes it down — counts only. */
  private async count(change: Partial<CaptionMeter>): Promise<void> {
    this.meter = {
      audioMilliseconds: this.meter.audioMilliseconds + (change.audioMilliseconds ?? 0),
      sessionsOpened: this.meter.sessionsOpened + (change.sessionsOpened ?? 0),
      sessionsRefused: this.meter.sessionsRefused + (change.sessionsRefused ?? 0),
      sessionFailures: this.meter.sessionFailures + (change.sessionFailures ?? 0),
    };
    await this.ctx.storage.put(METER_KEY, this.meter);
  }

  /** The nearest deadline any open session waits on, armed — or nothing, when none is open. */
  private async armAlarm(): Promise<void> {
    let nearest: number | null = null;
    for (const session of this.sessions.values()) {
      const deadlines = [
        session.silentSince === null ? null : captionSilenceDeadline(session.silentSince),
        session.audioSocket === null && session.audioSocketLostAt !== null
          ? session.audioSocketLostAt + CAPTION_AUDIO_LOSS_GRACE_MILLISECONDS
          : null,
        session.stream === null
          ? null
          : session.lastModelContactAt + CAPTION_KEEP_ALIVE_MILLISECONDS,
      ];
      for (const deadline of deadlines) {
        if (deadline !== null && (nearest === null || deadline < nearest)) nearest = deadline;
      }
    }
    if (nearest === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    // Measured on the captioner's clock and armed on the runtime's: the distance is what carries over.
    await this.ctx.storage.setAlarm(Date.now() + Math.max(0, nearest - now()));
  }

  /** Closes adapters, best effort: a slow routing service must not keep a session from closing. */
  private async closeAdapters(adapterIds: readonly string[]): Promise<void> {
    const client = sfuClientForEnv(this.env);
    if (client === null || adapterIds.length === 0) return;
    try {
      await client.closeWebSocketAdapters(adapterIds);
    } catch (caught) {
      this.recordFailure("close-adapters", caught);
    }
  }

  private recordFailure(operation: string, caught: unknown): void {
    recordRealtimeFailure(realtimeLoggerFor(this.env), `meetings.captioner.${operation}`, caught);
  }
}
