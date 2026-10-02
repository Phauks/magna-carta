import { DurableObject } from "cloudflare:workers";
import { commitEffectBatch, type EffectStatement } from "@magna-carta/data-access/effect-batch";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  FirmId,
  MatterId,
  MeetingId,
  MeetingRecordingId,
  MeetingRecordingTrackId,
} from "@magna-carta/identifiers/types";
import {
  decodePcmFrame,
  downmixToMono,
  monoSilenceBytes,
  monoToBytes,
  PCM_BYTES_PER_SAMPLE,
  PCM_SAMPLE_RATE,
  sequenceGap,
} from "@magna-carta/meetings/pcm-frame";
import {
  admitTrackStatements,
  recordingFailedAuditStatement,
  stopRecordingAfterSinkLoss,
} from "@magna-carta/meetings/recording-service";
import {
  failRecordingStatement,
  recordCapturedSecondsStatement,
  recordTrackSinkStatement,
  reopenTrackStatement,
  settleTrackStatement,
} from "@magna-carta/meetings/recording-statements";
import {
  recordingStagingKey,
  type MeetingRecordingCandidateTrack,
  type MeetingRecordingStopReason,
} from "@magna-carta/meetings/recording-types";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import { meetingRecorderStopped, meetingRecorderTrack } from "@magna-carta/telemetry/events";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import type { Bindings } from "../app.ts";
import { trackBackgroundWork } from "../background.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { isWebSocketUpgrade } from "../progress/job-progress-sockets.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "./sfu/realtime-failure.ts";
import { sfuClientForEnv } from "./sfu/sfu-client.ts";
import {
  mintSinkToken,
  SINK_TOKEN_LIFETIME_MILLISECONDS,
  sinkEndpoint,
  sinkSigningKeyForEnv,
} from "./sink-token.ts";

// ONE RECORDING'S SINK: the Durable Object the routing service's WebSocket adapters dial, one socket
// per recorded track, keyed `${firmId}:${recordingId}`.
//
// ONE PER RECORDING, NOT ONE PER MEETING. A stop and a second start are two recordings with two
// announcements and two consent records beneath them, so each gets a fresh object with a fresh
// lifecycle and nothing to reset.
//
// NOT HIBERNATING, and that is the opposite of the room's choice for the opposite reason. A
// hibernating socket is right for a signaling room that is idle between frames; a recorder receives
// fifty frames a second per track and holds an open multipart upload and a carry buffer per track, so
// it is never idle while it works, and an eviction mid-recording would lose the carry. Accepted sockets
// keep it resident for exactly as long as the routing service is sending.
//
// WHAT IT HOLDS, AND WHERE.
//
//   * In MEMORY, the carry: each track's mono audio not yet uploaded, at most one part of it. That is
//     the only audio this object ever holds, and it never writes a byte of it to its own storage —
//     the firm's bucket is where audio goes, and a Durable Object's storage is not that.
//   * In STORAGE, the metadata: the recording's identity and each track's adapter, upload, counters
//     and instants — written at each part boundary and on each pass of the alarm, so a reader of the
//     object (and the abandoned-recording sweep) sees where each track had got to. Deleted when the
//     recording settles.
//
// WHAT IT DOES, in the order the design states it. Every audio track the room carries gets an adapter
// that dials this object back and a multipart upload in the firm's own bucket. Each frame is decoded
// by the hand-written envelope reader, folded to mono, appended to the carry with silence written for
// every frame the sequence numbers say never arrived, and uploaded as the next part whenever the carry
// passes eight mebibytes. Every few seconds the alarm reconciles against the room: a track published
// since is admitted (or refused past the ceiling and recorded as lost), a participant who left has
// their adapter closed, and a socket that has not come back is recorded as lost — and when every track
// is lost the recorder stops the recording itself. On stop it closes every adapter, uploads each carry
// as a final part, completes every upload, writes what each track actually carried, and hands the
// recording on to be composed.
//
// IT NEVER THROWS INTO THE ROUTING SERVICE'S SOCKET. A malformed frame is counted as dropped, an
// upload that fails is recorded through the standard pipeline, and a reconciliation the room cannot
// answer is tried again on the next pass: one bad message, or one slow service, must never end a
// recording somebody is relying on.

/**
 * HOW BIG A STAGED PART IS: eight mebibytes of mono 48 kHz audio, about eighty-seven seconds — so an
 * hour's track is about forty-one parts, and the carry a track holds in memory is never more than
 * this. R2 requires every part but the last to be one size, which is why a part is always exactly
 * this many bytes and only the final one is shorter.
 */
export const RECORDING_PART_BYTES = 8 * 1024 * 1024;

/** How often the recorder reconciles against the room while it records. */
export const RECORDER_RECONCILE_INTERVAL_MILLISECONDS = 5_000;

/**
 * HOW LONG A TRACK'S SOCKET MAY BE GONE BEFORE THE TRACK IS LOST. The routing service retries the same
 * endpoint for up to five seconds after a disconnect; three times that is the allowance before the
 * record says the recorder could not hear somebody — long enough that one retry cycle never becomes a
 * lost speaker, short enough that a dead track is named while the meeting is still running.
 */
export const TRACK_LOSS_GRACE_MILLISECONDS = 15_000;

/**
 * THE LONGEST SILENCE ONE GAP MAY WRITE. Silence keeps a staged track on a real timeline, which is the
 * point of writing it; a gap longer than this is not a dropped frame but a counter that jumped, and
 * writing hours of zeros into memory because one sequence number was wrong would be the crash the
 * track ceiling exists to prevent.
 */
export const MAXIMUM_GAP_SILENCE_SECONDS = 300;

/** How long a settled recorder keeps its metadata before it deletes its own storage. */
const SETTLED_RETENTION_MILLISECONDS = 60_000;

const RECORDING_KEY = "recording";
const TRACK_PREFIX = "track:";

/** What the recorder is handed when a recording starts — every value server-derived. */
export interface RecorderStartInput {
  readonly firmId: FirmId;
  readonly meetingId: MeetingId;
  readonly matterId: MatterId;
  readonly recordingId: MeetingRecordingId;
  readonly startedAt: string;
  readonly ceiling: number;
  readonly tracks: readonly (MeetingRecordingCandidateTrack & {
    readonly trackId: MeetingRecordingTrackId;
  })[];
}

/**
 * THE MESSAGE THAT HANDS A STOPPED RECORDING ON TO BE COMPOSED — the queue message the compose
 * consumer reads. Identifiers only: the consumer reads the tracks off the firm's own record and the
 * staged objects out of the firm's own bucket. Sent only when this deployment binds the compose queue;
 * until it does, a stopped recording waits in `composing` for the consumer that will pick it up.
 */
export interface MeetingRecordingComposeMessage {
  readonly kind: "meeting-recording-compose";
  readonly firmId: FirmId;
  readonly meetingId: MeetingId;
  readonly recordingId: MeetingRecordingId;
}

/** What a stop produced, for the route that asked and for the record. */
export interface RecorderStopOutcome {
  readonly outcome: "composing" | "failed";
  readonly capturedSeconds: number;
  readonly trackCount: number;
  readonly lostTrackCount: number;
}

interface StoredRecorderRecording {
  readonly firmId: FirmId;
  readonly meetingId: MeetingId;
  readonly matterId: MatterId;
  readonly recordingId: MeetingRecordingId;
  readonly startedAt: string;
  readonly ceiling: number;
  readonly state: "recording" | "stopped";
  // When the stopped recorder may delete its own storage; null while recording.
  readonly purgeAt: number | null;
}

/** One track as the recorder holds it. Metadata only — the carry is in memory, never here. */
interface RecorderTrack {
  readonly trackId: MeetingRecordingTrackId;
  readonly trackName: string;
  sessionId: string;
  readonly participantKind: MeetingRecordingCandidateTrack["participantKind"];
  readonly participantId: string;
  readonly userId: MeetingRecordingCandidateTrack["userId"];
  // `open` while it is (or may be) sending; `closed` when its participant left — reopened if they come
  // back on the same track; `lost` when its socket did not come back or the ceiling refused it.
  state: "open" | "closed" | "lost";
  adapterId: string | null;
  readonly stagingKey: string;
  uploadId: string | null;
  parts: R2UploadedPart[];
  framesReceived: number;
  framesDropped: number;
  firstFrameAt: string | null;
  lastFrameAt: string | null;
  lastSequence: number | null;
  lastFrameSamples: number;
  // Mono samples written to the staged track, uploaded and carried together.
  stagedSamples: number;
  // Since when this track has had no socket — set when its adapter is opened (the routing service has
  // not dialled yet) and when its socket closes, and cleared the moment a socket is accepted. The loss
  // grace is measured from here, so an adapter the service never dials becomes a lost track too.
  socketLostAt: number | null;
  // True after a new adapter replaced the old one: its sequence numbers start afresh, so the gap to
  // the first frame is measured on the wall clock instead.
  resumeFromWallClock: boolean;
}

/** The audio of one track not yet uploaded. In memory only — see the note at the top of the file. */
interface TrackCarry {
  chunks: Uint8Array[];
  bytes: number;
}

function concatenate(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Takes exactly `count` bytes off the front of a carry. */
function takeFromCarry(carry: TrackCarry, count: number): Uint8Array {
  const merged = concatenate(carry.chunks, carry.bytes);
  const taken = merged.slice(0, count);
  const rest = merged.slice(count);
  carry.chunks = rest.byteLength === 0 ? [] : [rest];
  carry.bytes = rest.byteLength;
  return taken;
}

export class MeetingRecorder extends DurableObject<Bindings> {
  // NON-HIBERNATING, so the instance is the working set: these live exactly as long as the sockets
  // that feed them, and storage holds the metadata a reader or a sweep would need if they did not.
  private recording: StoredRecorderRecording | null = null;
  private readonly tracks = new Map<string, RecorderTrack>();
  private readonly carries = new Map<string, TrackCarry>();
  private readonly sockets = new Map<string, WebSocket>();
  // One chain per track so its parts upload in order and never two at once.
  private readonly uploads = new Map<string, Promise<void>>();
  // One chain for the acts that change WHICH tracks exist — start, reconcile, stop — so they never
  // interleave across the network calls each of them makes.
  private serial: Promise<unknown> = Promise.resolve();
  private bucket: R2Bucket | null = null;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // Read back what a previous instance wrote, before any call is delivered. Only metadata survives
    // a restart; a carry that was in memory is gone, which is the case the abandoned-recording sweep
    // exists for.
    void ctx.blockConcurrencyWhile(async () => {
      this.recording = (await ctx.storage.get<StoredRecorderRecording>(RECORDING_KEY)) ?? null;
      const stored = await ctx.storage.list<RecorderTrack>({ prefix: TRACK_PREFIX });
      for (const [, track] of stored) this.tracks.set(track.trackName, track);
    });
  }

  /** Runs one act that changes the set of tracks after every act already queued. */
  private exclusive<T>(act: () => Promise<T>): Promise<T> {
    const next = this.serial.then(act, act);
    this.serial = next.catch(() => undefined);
    return next;
  }

  // ---------------------------------------------------------------------------------------------
  // The door the routes and the room knock on
  // ---------------------------------------------------------------------------------------------

  /**
   * A recording has started: open an adapter and an upload for every track the route recorded.
   *
   * Called once, by the start route, after the recording row and the announcement have both
   * committed. A second call is a retry and changes nothing. A track whose adapter cannot be opened is
   * recorded as lost rather than failing the recording — the others are still being heard, and the
   * record says plainly who is not.
   */
  async start(
    input: RecorderStartInput,
  ): Promise<{ readonly opened: number; readonly lost: number }> {
    return await this.exclusive(async () => {
      if (this.recording !== null) return { opened: 0, lost: 0 };
      this.recording = {
        firmId: input.firmId,
        meetingId: input.meetingId,
        matterId: input.matterId,
        recordingId: input.recordingId,
        startedAt: input.startedAt,
        ceiling: input.ceiling,
        state: "recording",
        purgeAt: null,
      };
      await this.ctx.storage.put(RECORDING_KEY, this.recording);
      let opened = 0;
      let lost = 0;
      for (const track of input.tracks) {
        const outcome = await this.openTrack(this.recording, track, track.trackId);
        if (outcome === "opened") opened += 1;
        else lost += 1;
      }
      await this.ctx.storage.setAlarm(Date.now() + RECORDER_RECONCILE_INTERVAL_MILLISECONDS);
      return { opened, lost };
    });
  }

  /**
   * The recording has been stopped — by a member, by a host, or by the meeting ending — and the route
   * has already committed the stop. Closes every adapter, flushes and completes every upload, writes
   * what each track actually carried, and hands the recording on to be composed.
   */
  async stop(stopReason: MeetingRecordingStopReason): Promise<RecorderStopOutcome | null> {
    return await this.exclusive(async () => await this.settle(stopReason));
  }

  /** What the recorder is holding, for a test and for an operator: metadata, never audio. */
  async inspect(): Promise<{
    readonly state: "recording" | "stopped" | "none";
    readonly tracks: readonly {
      readonly trackId: string;
      readonly state: RecorderTrack["state"];
      readonly attached: boolean;
      readonly framesReceived: number;
      readonly framesDropped: number;
      readonly parts: number;
      readonly carriedBytes: number;
      readonly stagedSamples: number;
    }[];
  }> {
    return {
      state: this.recording?.state ?? "none",
      tracks: [...this.tracks.values()].map((track) => ({
        trackId: track.trackId,
        state: track.state,
        attached: this.sockets.has(track.trackName),
        framesReceived: track.framesReceived,
        framesDropped: track.framesDropped,
        parts: track.parts.length,
        carriedBytes: this.carries.get(track.trackName)?.bytes ?? 0,
        stagedSamples: track.stagedSamples,
      })),
    };
  }

  /**
   * THE SOCKET THE ROUTING SERVICE DIALS, forwarded by the sink route after it verified the token and
   * asked the record that this recording is running and this track open. The track rides the internal
   * address the route built; nothing a caller sent reaches here.
   */
  override async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) {
      return new Response("this endpoint accepts the routing service's audio only", {
        status: 426,
      });
    }
    const trackName = new URL(request.url).searchParams.get("track") ?? "";
    const track = this.tracks.get(trackName);
    if (this.recording?.state !== "recording" || track === undefined || track.state !== "open") {
      return new Response(null, { status: 404 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Binary frames as buffers, decoded in the order they arrive. The runtime's standard default is a
    // Blob, which can only be read asynchronously — and an asynchronous read per frame would let two
    // frames of one track land out of order.
    (server as unknown as { binaryType: string }).binaryType = "arraybuffer";
    server.accept();
    // ONE SOCKET PER TRACK, AND THE NEWEST WINS: the routing service reconnects to the same address
    // after a drop, and the reconnection is the socket that is sending now.
    const previous = this.sockets.get(trackName);
    this.sockets.set(trackName, server);
    track.socketLostAt = null;
    if (previous !== undefined) {
      try {
        previous.close(1000, "superseded");
      } catch {
        // Closed already — which is why the routing service dialled again.
      }
    }
    server.addEventListener("message", (event) => {
      this.receive(trackName, event.data);
    });
    server.addEventListener("close", () => {
      if (this.sockets.get(trackName) !== server) return;
      this.sockets.delete(trackName);
      const current = this.tracks.get(trackName);
      if (current !== undefined && current.state === "open") current.socketLostAt = Date.now();
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  override async alarm(): Promise<void> {
    await this.exclusive(async () => {
      const recording = this.recording;
      if (recording === null) return;
      if (recording.state === "stopped") {
        if (recording.purgeAt !== null && recording.purgeAt <= Date.now()) {
          await this.ctx.storage.deleteAll();
          this.recording = null;
          this.tracks.clear();
          return;
        }
        if (recording.purgeAt !== null) await this.ctx.storage.setAlarm(recording.purgeAt);
        return;
      }
      await this.reconcile(recording);
      if (this.recording?.state === "recording") {
        await this.persistTracks();
        await this.ctx.storage.setAlarm(Date.now() + RECORDER_RECONCILE_INTERVAL_MILLISECONDS);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Frames in, bytes out
  // ---------------------------------------------------------------------------------------------

  /**
   * One message off a track's socket. Synchronous up to the point a part is due, so fifty frames a
   * second cost fifty decodes and nothing else; the upload is queued on the track's own chain.
   */
  private receive(trackName: string, data: unknown): void {
    const track = this.tracks.get(trackName);
    if (track === undefined || track.state !== "open" || this.recording?.state !== "recording") {
      return;
    }
    let bytes: Uint8Array;
    // Read by its tag rather than `instanceof`: a buffer handed across the runtime's socket boundary
    // need not come from this module's realm.
    if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (Object.prototype.toString.call(data) === "[object ArrayBuffer]") {
      bytes = new Uint8Array(data as ArrayBuffer);
    } else {
      // A text message is not something the adapter sends; it is counted and carried past.
      track.framesDropped += 1;
      return;
    }
    const frame = decodePcmFrame(bytes);
    if (frame === null) {
      track.framesDropped += 1;
      return;
    }
    const nowMilliseconds = Date.now();
    const now = new Date(nowMilliseconds).toISOString();
    const mono = downmixToMono(frame.payload);
    const carry = this.carryOf(trackName);

    // SILENCE FOR WHAT NEVER ARRIVED, so the staged track stays on a real timeline and a composite of
    // several never drifts. Counted from the sequence numbers while one adapter feeds the track, and
    // from the wall clock across the change of adapter that a reconnection makes.
    let silenceSamples = 0;
    if (track.resumeFromWallClock) {
      track.resumeFromWallClock = false;
      track.lastSequence = null;
      if (track.lastFrameAt !== null) {
        const elapsed = nowMilliseconds - Date.parse(track.lastFrameAt);
        const frameMilliseconds = (track.lastFrameSamples / PCM_SAMPLE_RATE) * 1000;
        silenceSamples = Math.round(((elapsed - frameMilliseconds) / 1000) * PCM_SAMPLE_RATE);
      }
    } else {
      const gap = sequenceGap(track.lastSequence, frame.sequenceNumber);
      // A duplicate, or a frame reordered behind a later one: already accounted for.
      if (gap === null) return;
      if (gap > 0) {
        track.framesDropped += gap;
        silenceSamples = gap * (track.lastFrameSamples > 0 ? track.lastFrameSamples : mono.length);
      }
    }
    silenceSamples = Math.min(
      Math.max(0, silenceSamples),
      MAXIMUM_GAP_SILENCE_SECONDS * PCM_SAMPLE_RATE,
    );
    if (silenceSamples > 0) {
      carry.chunks.push(monoSilenceBytes(silenceSamples));
      carry.bytes += silenceSamples * PCM_BYTES_PER_SAMPLE;
      track.stagedSamples += silenceSamples;
    }

    const audio = monoToBytes(mono);
    carry.chunks.push(audio);
    carry.bytes += audio.byteLength;
    track.stagedSamples += mono.length;
    track.framesReceived += 1;
    track.lastSequence = frame.sequenceNumber;
    track.lastFrameSamples = mono.length;
    track.firstFrameAt ??= now;
    track.lastFrameAt = now;

    if (carry.bytes >= RECORDING_PART_BYTES) this.queueFullParts(track);
  }

  private carryOf(trackName: string): TrackCarry {
    let carry = this.carries.get(trackName);
    if (carry === undefined) {
      carry = { chunks: [], bytes: 0 };
      this.carries.set(trackName, carry);
    }
    return carry;
  }

  /** Queues every whole part the carry holds onto the track's own upload chain. */
  private queueFullParts(track: RecorderTrack): void {
    this.queueUpload(track.trackName, async () => {
      const carry = this.carryOf(track.trackName);
      while (carry.bytes >= RECORDING_PART_BYTES) {
        await this.uploadPart(track, takeFromCarry(carry, RECORDING_PART_BYTES));
      }
    });
  }

  private queueUpload(trackName: string, work: () => Promise<void>): void {
    const previous = this.uploads.get(trackName) ?? Promise.resolve();
    const next = previous.then(work).catch((caught: unknown) => {
      // Recorded and carried on with: the parts already up are still the track's, and the next part
      // is a separate attempt. A recording that stopped over one failed upload would lose the rest.
      this.recordFailure("upload-part", caught);
    });
    this.uploads.set(trackName, next);
    this.ctx.waitUntil(trackBackgroundWork(next));
  }

  private async uploadPart(track: RecorderTrack, bytes: Uint8Array): Promise<void> {
    if (track.uploadId === null || this.recording === null) return;
    const bucket = await this.firmBucket(this.recording.firmId);
    const upload = bucket.resumeMultipartUpload(track.stagingKey, track.uploadId);
    track.parts.push(await upload.uploadPart(track.parts.length + 1, bytes));
    await this.ctx.storage.put(`${TRACK_PREFIX}${track.trackName}`, track);
  }

  // ---------------------------------------------------------------------------------------------
  // Tracks arriving and leaving
  // ---------------------------------------------------------------------------------------------

  /**
   * Opens one track: an upload in the firm's bucket, a signed address for it, and an adapter that
   * dials that address. Answers `lost` when any of the three could not be had — the row says so and
   * nobody is silently missing.
   */
  private async openTrack(
    recording: StoredRecorderRecording,
    candidate: MeetingRecordingCandidateTrack,
    trackId: MeetingRecordingTrackId,
  ): Promise<"opened" | "lost"> {
    const track: RecorderTrack = {
      trackId,
      trackName: candidate.trackName,
      sessionId: candidate.sessionId,
      participantKind: candidate.participantKind,
      participantId: candidate.participantId,
      userId: candidate.userId,
      state: "open",
      adapterId: null,
      stagingKey: recordingStagingKey(recording.meetingId, recording.recordingId, trackId),
      uploadId: null,
      parts: [],
      framesReceived: 0,
      framesDropped: 0,
      firstFrameAt: null,
      lastFrameAt: null,
      lastSequence: null,
      lastFrameSamples: 0,
      stagedSamples: 0,
      socketLostAt: null,
      resumeFromWallClock: false,
    };
    // Held before the adapter is asked for, so a socket the routing service dials while that call is
    // still answering finds the track it is for.
    this.tracks.set(track.trackName, track);
    try {
      const bucket = await this.firmBucket(recording.firmId);
      const upload = await bucket.createMultipartUpload(track.stagingKey, {
        // A staged track is a conversation on this matter, so it is stamped with the matter like the
        // document it is composed into — and with a class of its own, because it is raw material
        // rather than the record. Stamped at create: a multipart object's metadata is fixed there.
        customMetadata: matterScopedObjectDimensions({
          objectClass: "meeting-recording-track",
          matterId: recording.matterId,
        }),
        httpMetadata: { contentType: "application/octet-stream" },
      });
      track.uploadId = upload.uploadId;
      const adapterId = await this.openAdapter(recording, track);
      if (adapterId === null) {
        await upload.abort();
        track.uploadId = null;
        await this.loseTrack(recording, track, "failed");
        return "lost";
      }
      track.adapterId = adapterId;
      if (!this.sockets.has(track.trackName)) track.socketLostAt ??= Date.now();
      await this.commit(recording, [
        recordTrackSinkStatement(firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId), {
          recordingId: recording.recordingId,
          trackName: track.trackName,
          adapterId,
          stagingKey: track.stagingKey,
          now: new Date().toISOString(),
        }),
      ]);
      await this.ctx.storage.put(`${TRACK_PREFIX}${track.trackName}`, track);
      this.recordTrack(recording, track, "opened");
      return "opened";
    } catch (caught) {
      this.recordFailure("open-track", caught);
      await this.loseTrack(recording, track, "failed");
      return "lost";
    }
  }

  /** Asks the routing service for one adapter, answering its handle or null when none was opened. */
  private async openAdapter(
    recording: StoredRecorderRecording,
    track: RecorderTrack,
  ): Promise<string | null> {
    const client = sfuClientForEnv(this.env);
    const key = sinkSigningKeyForEnv(this.env);
    const appBaseUrl = this.env.APP_BASE_URL;
    if (client === null || key === null || appBaseUrl === undefined || appBaseUrl === "") {
      return null;
    }
    const token = await mintSinkToken(key, {
      firmId: recording.firmId,
      recordingId: recording.recordingId,
      trackName: track.trackName,
      expiresAt: Date.now() + SINK_TOKEN_LIFETIME_MILLISECONDS,
    });
    try {
      const [result] = await client.createWebSocketAdapters([
        {
          location: "remote",
          sessionId: track.sessionId,
          trackName: track.trackName,
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
      this.recordFailure("create-adapter", caught);
      return null;
    }
  }

  /** Closes adapters, best-effort: the record is already right, and a slow service must not change it. */
  private async closeAdapters(adapterIds: readonly string[]): Promise<void> {
    const client = sfuClientForEnv(this.env);
    if (client === null || adapterIds.length === 0) return;
    try {
      await client.closeWebSocketAdapters(adapterIds);
    } catch (caught) {
      this.recordFailure("close-adapters", caught);
    }
  }

  /**
   * A track the recorder can no longer hear — its socket did not come back, or its adapter could not
   * be opened. The row says `lost` with what it carried; the upload stays open so what was captured
   * before the loss is still composed.
   */
  private async loseTrack(
    recording: StoredRecorderRecording,
    track: RecorderTrack,
    act: "lost" | "failed",
  ): Promise<void> {
    track.state = "lost";
    const socket = this.sockets.get(track.trackName);
    this.sockets.delete(track.trackName);
    try {
      socket?.close(1000, "track lost");
    } catch {
      // Already closed — which is what losing it means.
    }
    if (track.adapterId !== null) {
      await this.closeAdapters([track.adapterId]);
      track.adapterId = null;
    }
    await this.commit(recording, [this.settleStatement(recording, track, "lost", false)]);
    await this.ctx.storage.put(`${TRACK_PREFIX}${track.trackName}`, track);
    this.recordTrack(recording, track, act);
  }

  /**
   * RECONCILE AGAINST THE ROOM: who is publishing audio now, against who this recorder is holding.
   *
   * Pulled on the alarm rather than pushed by the room, so the room's media path carries no recording
   * concern at all and a recorder that is slow or gone never slows a publish. The cost is a few
   * seconds before a late arrival's track is admitted — and the arrival was told on their welcome
   * the instant they came in, which is what the consent ruling is about.
   */
  private async reconcile(recording: StoredRecorderRecording): Promise<void> {
    let candidates: readonly MeetingRecordingCandidateTrack[];
    try {
      const room = this.env.MEETING_ROOM.get(
        this.env.MEETING_ROOM.idFromName(`${recording.firmId}:${recording.meetingId}`),
      );
      candidates = await room.recordingCandidates();
    } catch (caught) {
      // The room did not answer this pass. Nothing is decided on no answer: the next pass asks again.
      this.recordFailure("reconcile", caught);
      return;
    }
    const present = new Map(candidates.map((candidate) => [candidate.trackName, candidate]));
    const database = firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId);

    // Arrivals, and returns.
    for (const candidate of present.values()) {
      const held = this.tracks.get(candidate.trackName);
      if (held === undefined) {
        const openTracks = [...this.tracks.values()].filter((one) => one.state === "open").length;
        const admitted = admitTrackStatements(
          database,
          recording.recordingId,
          candidate,
          { openTracks, ceiling: recording.ceiling },
          { clock: { now: () => new Date().toISOString() }, randomSource: cryptoRandomSource },
        );
        await this.commit(recording, admitted.statements);
        if (admitted.state === "open") {
          await this.openTrack(recording, candidate, admitted.trackId);
        } else {
          // PAST THE CEILING: a row that says this person could not be heard, with no frames.
          const refused: RecorderTrack = {
            trackId: admitted.trackId,
            trackName: candidate.trackName,
            sessionId: candidate.sessionId,
            participantKind: candidate.participantKind,
            participantId: candidate.participantId,
            userId: candidate.userId,
            state: "lost",
            adapterId: null,
            stagingKey: recordingStagingKey(
              recording.meetingId,
              recording.recordingId,
              admitted.trackId,
            ),
            uploadId: null,
            parts: [],
            framesReceived: 0,
            framesDropped: 0,
            firstFrameAt: null,
            lastFrameAt: null,
            lastSequence: null,
            lastFrameSamples: 0,
            stagedSamples: 0,
            socketLostAt: null,
            resumeFromWallClock: false,
          };
          this.tracks.set(refused.trackName, refused);
          await this.ctx.storage.put(`${TRACK_PREFIX}${refused.trackName}`, refused);
          this.recordTrack(recording, refused, "refused");
        }
        continue;
      }
      // A lost track stays lost: the record says the recorder could not hear them from that instant.
      if (held.state === "lost") continue;
      // THE SAME TRACK ON A NEW SESSION — the participant's connection came back, or they left and
      // returned within their stay. A new adapter on the new session, into the SAME staged object, so
      // the record is one track with a gap in it rather than two.
      if (held.state === "closed" || held.sessionId !== candidate.sessionId) {
        if (held.adapterId !== null) await this.closeAdapters([held.adapterId]);
        held.adapterId = null;
        held.sessionId = candidate.sessionId;
        held.resumeFromWallClock = true;
        const reopened = held.state === "closed";
        held.state = "open";
        const adapterId = await this.openAdapter(recording, held);
        if (adapterId === null) {
          await this.loseTrack(recording, held, "failed");
          continue;
        }
        held.adapterId = adapterId;
        if (!this.sockets.has(held.trackName)) held.socketLostAt = Date.now();
        const now = new Date().toISOString();
        await this.commit(recording, [
          ...(reopened
            ? [reopenTrackStatement(database, recording.recordingId, held.trackName, now)]
            : []),
          recordTrackSinkStatement(database, {
            recordingId: recording.recordingId,
            trackName: held.trackName,
            adapterId,
            stagingKey: held.stagingKey,
            now,
          }),
        ]);
        this.recordTrack(recording, held, "reattached");
      }
    }

    // Departures: a participant no longer publishing has their adapter closed and their track closed,
    // and the staged object stays open in case they come back.
    for (const held of this.tracks.values()) {
      if (held.state !== "open" || present.has(held.trackName)) continue;
      held.state = "closed";
      const socket = this.sockets.get(held.trackName);
      this.sockets.delete(held.trackName);
      try {
        socket?.close(1000, "participant left");
      } catch {
        // Already closed.
      }
      if (held.adapterId !== null) await this.closeAdapters([held.adapterId]);
      held.adapterId = null;
      await this.commit(recording, [this.settleStatement(recording, held, "closed", false)]);
      this.recordTrack(recording, held, "detached");
    }

    // Losses: a socket gone past its grace, on a track that is still meant to be sending.
    const now = Date.now();
    for (const held of this.tracks.values()) {
      if (held.state !== "open" || this.sockets.has(held.trackName)) continue;
      if (held.socketLostAt !== null && now - held.socketLostAt >= TRACK_LOSS_GRACE_MILLISECONDS) {
        await this.loseTrack(recording, held, "lost");
      }
    }

    // EVERY TRACK LOST: there is nobody left this recording can hear, so it stops itself rather than
    // run on recording nothing under a mark that says it is recording.
    const tracks = [...this.tracks.values()];
    if (tracks.length > 0 && tracks.every((one) => one.state === "lost")) {
      await this.stopAfterSinkLoss(recording);
    }
  }

  /** The recorder's own stop: record it, settle, and have the room tell everybody. */
  private async stopAfterSinkLoss(recording: StoredRecorderRecording): Promise<void> {
    const database = firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId);
    const now = () => new Date().toISOString();
    const stopped = await stopRecordingAfterSinkLoss(database, recording.recordingId, {
      clock: { now },
      randomSource: cryptoRandomSource,
    });
    if (stopped !== undefined) await commitEffectBatch(database, stopped.effect, { now });
    await this.settle("sink-lost");
    try {
      const room = this.env.MEETING_ROOM.get(
        this.env.MEETING_ROOM.idFromName(`${recording.firmId}:${recording.meetingId}`),
      );
      await room.recordingStopped({
        firmId: recording.firmId,
        meetingId: recording.meetingId,
        recordingId: recording.recordingId,
        at: stopped?.recording.stopped_at ?? now(),
        by: null,
      });
    } catch (caught) {
      this.recordFailure("announce-stop", caught);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Settling
  // ---------------------------------------------------------------------------------------------

  /**
   * Lets go of the recording: every adapter closed, every socket hung up, every carry uploaded as a
   * final part, every upload completed (or abandoned when nothing reached it), what each track
   * carried written down, and the recording handed on to be composed — or failed when nothing at all
   * was captured. Answers null when there was nothing running to settle.
   */
  private async settle(
    stopReason: MeetingRecordingStopReason,
  ): Promise<RecorderStopOutcome | null> {
    const recording = this.recording;
    if (recording === null || recording.state !== "recording") return null;
    const purgeAt = Date.now() + SETTLED_RETENTION_MILLISECONDS;
    this.recording = { ...recording, state: "stopped", purgeAt };
    await this.ctx.storage.put(RECORDING_KEY, this.recording);

    // The service stops sending FIRST, so nothing arrives after the stop was announced.
    await this.closeAdapters(
      [...this.tracks.values()].flatMap((track) =>
        track.adapterId === null ? [] : [track.adapterId],
      ),
    );
    for (const [trackName, socket] of this.sockets) {
      this.sockets.delete(trackName);
      try {
        socket.close(1000, "recording stopped");
      } catch {
        // Already closed.
      }
    }

    const database = firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId);
    const statements: EffectStatement[] = [];
    let capturedSamples = 0;
    let lostTrackCount = 0;
    const startedAt = Date.parse(recording.startedAt);
    for (const track of this.tracks.values()) {
      track.adapterId = null;
      await (this.uploads.get(track.trackName) ?? Promise.resolve());
      const discarded = await this.finishUpload(recording, track);
      if (track.state === "lost") lostTrackCount += 1;
      const finalState = track.state === "lost" ? "lost" : "closed";
      track.state = finalState;
      statements.push(this.settleStatement(recording, track, finalState, discarded));
      // WHAT A COMPOSITE OF THESE TRACKS COULD CONTAIN: each track lands at the offset its first
      // frame arrived at, and runs for the samples it staged. Never the wall-clock length.
      if (track.firstFrameAt !== null && track.stagedSamples > 0 && !discarded) {
        const offsetSamples = Math.max(
          0,
          Math.round(((Date.parse(track.firstFrameAt) - startedAt) / 1000) * PCM_SAMPLE_RATE),
        );
        capturedSamples = Math.max(capturedSamples, offsetSamples + track.stagedSamples);
      }
    }
    const capturedSeconds = Math.floor(capturedSamples / PCM_SAMPLE_RATE);
    const nowInstant = new Date().toISOString();
    statements.push(
      recordCapturedSecondsStatement(database, recording.recordingId, capturedSeconds, nowInstant),
    );
    const capturedAnything = capturedSamples > 0;
    if (!capturedAnything) {
      // NOTHING WAS CAPTURED AT ALL: failed, with an Error ID and no document to file — a recording
      // never claims more than it captured, and an empty one claims nothing.
      const failureErrorId = recordRealtimeFailure(
        realtimeLoggerFor(this.env),
        "meetings.recorder.nothing-captured",
        new Error("the recording stopped with no audio captured on any track"),
      );
      statements.push(
        failRecordingStatement(database, {
          id: recording.recordingId,
          failureErrorId,
          now: nowInstant,
        }),
        recordingFailedAuditStatement(
          database,
          {
            recordingId: recording.recordingId,
            meetingId: recording.meetingId,
            failureErrorId,
          },
          { clock: { now: () => nowInstant }, randomSource: cryptoRandomSource },
        ),
      );
    }
    await this.commit(recording, statements);

    if (capturedAnything) {
      const message: MeetingRecordingComposeMessage = {
        kind: "meeting-recording-compose",
        firmId: recording.firmId,
        meetingId: recording.meetingId,
        recordingId: recording.recordingId,
      };
      try {
        await this.env.MEETING_RECORDING_COMPOSE?.send(message);
      } catch (caught) {
        this.recordFailure("enqueue-compose", caught);
      }
    }

    this.carries.clear();
    await this.persistTracks();
    await this.ctx.storage.setAlarm(purgeAt);
    const outcome: RecorderStopOutcome = {
      outcome: capturedAnything ? "composing" : "failed",
      capturedSeconds,
      trackCount: this.tracks.size,
      lostTrackCount,
    };
    try {
      realtimeLoggerFor(this.env).log(
        meetingRecorderStopped(
          { correlationId: newCorrelationId(), now: nowInstant },
          {
            firmId: recording.firmId,
            meetingId: recording.meetingId,
            recordingId: recording.recordingId,
            stopReason,
            trackCount: outcome.trackCount,
            lostTrackCount,
            capturedSeconds,
            outcome: outcome.outcome,
          },
        ),
      );
    } catch {
      // Telemetry never costs the recording anything.
    }
    return outcome;
  }

  /**
   * Uploads a track's carry as its final part and completes the upload — or abandons the upload when
   * nothing ever reached it, answering true so the row stops naming an object that does not exist.
   */
  private async finishUpload(
    recording: StoredRecorderRecording,
    track: RecorderTrack,
  ): Promise<boolean> {
    if (track.uploadId === null) return true;
    const carry = this.carryOf(track.trackName);
    try {
      const bucket = await this.firmBucket(recording.firmId);
      const upload = bucket.resumeMultipartUpload(track.stagingKey, track.uploadId);
      if (carry.bytes > 0) {
        track.parts.push(
          await upload.uploadPart(track.parts.length + 1, takeFromCarry(carry, carry.bytes)),
        );
      }
      if (track.parts.length === 0) {
        await upload.abort();
        track.uploadId = null;
        return true;
      }
      await upload.complete(track.parts);
      return false;
    } catch (caught) {
      // The parts already up are in the bucket and the sweep composes what completed; the record says
      // what this track carried either way.
      this.recordFailure("complete-upload", caught);
      return false;
    }
  }

  private settleStatement(
    recording: StoredRecorderRecording,
    track: RecorderTrack,
    state: "open" | "closed" | "lost",
    stagingDiscarded: boolean,
  ) {
    return settleTrackStatement(firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId), {
      recordingId: recording.recordingId,
      trackName: track.trackName,
      framesReceived: track.framesReceived,
      framesDropped: track.framesDropped,
      firstFrameAt: track.firstFrameAt,
      lastFrameAt: track.lastFrameAt,
      state,
      stagingDiscarded,
      now: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------------------------

  /** One batch to the firm's own database, through the firm-scoped data-access layer. */
  private async commit(
    recording: StoredRecorderRecording,
    statements: readonly EffectStatement[],
  ): Promise<void> {
    if (statements.length === 0) return;
    const database = firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId);
    try {
      await commitEffectBatch(
        database,
        { statements: [...statements], outboxMessages: [] },
        { now: () => new Date().toISOString() },
      );
    } catch (caught) {
      // The record could not be written this time. Recorded through the standard pipeline; the audio
      // is unaffected, and the next settle writes the counts again.
      this.recordFailure("commit", caught);
    }
  }

  /** The firm's own bucket, resolved once per instance through the one seam that answers it. */
  private async firmBucket(firmId: FirmId): Promise<R2Bucket> {
    if (this.bucket !== null) return this.bucket;
    // Reached on first use rather than at module scope, so the bucket resolver's signing graph is not
    // part of what the Worker's entrypoint evaluates at startup.
    const { resolveFirmBucketForFirmId } = await import("../files/firm-bucket.ts");
    this.bucket = (await resolveFirmBucketForFirmId(this.env, firmId)).bucket;
    return this.bucket;
  }

  private async persistTracks(): Promise<void> {
    const entries: Record<string, RecorderTrack> = {};
    for (const track of this.tracks.values()) entries[`${TRACK_PREFIX}${track.trackName}`] = track;
    if (Object.keys(entries).length > 0) await this.ctx.storage.put(entries);
  }

  private recordFailure(operation: string, caught: unknown): void {
    recordRealtimeFailure(realtimeLoggerFor(this.env), `meetings.recorder.${operation}`, caught);
  }

  private recordTrack(
    recording: StoredRecorderRecording,
    track: RecorderTrack,
    act: "opened" | "refused" | "failed" | "reattached" | "detached" | "lost",
  ): void {
    try {
      realtimeLoggerFor(this.env).log(
        meetingRecorderTrack(
          { correlationId: newCorrelationId(), now: new Date().toISOString() },
          {
            firmId: recording.firmId,
            meetingId: recording.meetingId,
            recordingId: recording.recordingId,
            trackId: track.trackId,
            act,
            framesReceived: track.framesReceived,
            framesDropped: track.framesDropped,
          },
        ),
      );
    } catch {
      // Telemetry never costs the recording anything.
    }
  }
}
