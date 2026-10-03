import { DurableObject } from "cloudflare:workers";
import { commitEffectBatch, type EffectStatement } from "@magna-carta/data-access/effect-batch";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  FirmId,
  MatterId,
  MeetingId,
  MeetingRecordingId,
  MeetingRecordingTrackId,
  MeetingTranscriptId,
} from "@magna-carta/identifiers/types";
import {
  decodePcmFrame,
  downmixToMono,
  PCM_BYTES_PER_SAMPLE,
  PCM_SAMPLE_RATE,
  PcmPartStager,
  sequenceStep,
  type StagedPart,
} from "@magna-carta/meetings/pcm-frame";
import {
  admitTrackStatements,
  recordingFailedAuditStatement,
  stopRecordingAfterSinkLoss,
  stopRecordingByPlatform,
} from "@magna-carta/meetings/recording-service";
import {
  failRecordingStatement,
  readRecordingById,
  recordCapturedSecondsStatement,
  recordTrackSinkStatement,
  reopenTrackStatement,
  settleTrackStatement,
} from "@magna-carta/meetings/recording-statements";
import {
  MAXIMUM_TRACK_SEGMENTS,
  placeTrackSegments,
  recordingStagingKey,
  type MeetingRecordingCandidateTrack,
  type MeetingRecordingStopReason,
} from "@magna-carta/meetings/recording-types";
import {
  RECORDED_TRACK_CEILING_MAXIMUM,
  RECORDING_PART_BYTES as PART_BYTES,
  RECORDING_PART_UPLOADS_IN_FLIGHT,
  RECORDING_TRACK_BUFFER_BYTES,
} from "@magna-carta/meetings/settings";
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
  MAXIMUM_RECORDING_HOURS,
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
// fifty frames a second per track and holds an open multipart upload and a staging buffer per track,
// so it is never idle while it works. Accepted sockets keep it resident for exactly as long as the
// routing service is sending.
//
// WHAT IT HOLDS, AND WHERE.
//
//   * In MEMORY, the staging: each open track's audio not yet uploaded, in ONE buffer preallocated
//     when the track opens — a part and its overflow — written in place and released when the track
//     closes. How big that is, and therefore how many tracks one recorder may hold, is arithmetic over
//     the isolate's memory, stated once in `@magna-carta/meetings/settings`. It never writes a byte of
//     audio to its own storage — the firm's bucket is where audio goes.
//   * In STORAGE, the metadata: the recording's identity and each track's adapter, upload, counters,
//     instants and place on its timeline — written at each part boundary and on each pass of the
//     alarm, only for the tracks that changed, so a recorder that restarts knows exactly what it lost.
//     Deleted when the recording settles.
//
// WHAT IT DOES. Every audio track the room carries gets an adapter that dials this object back and a
// multipart upload in the firm's own bucket. Each frame is decoded by the hand-written envelope
// reader, folded to mono, and written into the track's buffer with silence counted for every frame
// the sequence numbers — or, across a new socket, the wall clock — say never arrived. Where the wall
// clock says the frame belongs BEHIND the end of the object (a participant who left had their buffer
// closed with silence to a part boundary, and came back sooner than that silence lasts) or so far
// ahead that staging the silence would be uploading zeros for nothing, the frame begins a new STRETCH
// of the track instead, which carries the instant it was heard; the compose places every stretch at
// its own instant, so nothing a participant says after a return is shifted by the silence that closed
// their last stretch (`MeetingRecordingTrackSegment` in `@magna-carta/meetings`). Each whole part
// uploads as it fills, one at a time per track and a bounded number across the recorder. Every few
// seconds the alarm reads the firm's record (a recording stopped there is settled here, whether or not
// the stop reached this object), stops a recording that reached its maximum length or whose room has
// been empty too long, and reconciles against the room: a track published since is admitted (or
// refused past the ceiling and recorded as lost), a participant who left has their adapter closed, and
// a socket that has not come back is recorded as lost — and when every track is lost the recorder
// stops the recording itself. On stop it closes every adapter, uploads what each buffer holds as a
// final part, completes every upload, writes what each track actually carried, and hands the
// recording on to be composed.
//
// IT NEVER THROWS INTO THE ROUTING SERVICE'S SOCKET. A malformed frame is counted as dropped, an
// upload that fails is retried once and then recorded as a gap, and a reconciliation the room cannot
// answer is tried again on the next pass: one bad message, or one slow service, must never end a
// recording somebody is relying on.

/** One staged part — R2's minimum part size; see `@magna-carta/meetings/settings` for why. */
export const RECORDING_PART_BYTES = PART_BYTES;

/**
 * HOW OFTEN THE RECORDER RECONCILES while it records — and therefore the longest it can go on
 * capturing after a stop that never reached it, because each pass reads the firm's record first.
 */
export const RECORDER_RECONCILE_INTERVAL_MILLISECONDS = 5_000;

/**
 * HOW LONG A TRACK'S SOCKET MAY BE GONE BEFORE THE TRACK IS LOST. The routing service retries the same
 * endpoint for up to five seconds after a disconnect; three times that is the allowance before the
 * record says the recorder could not hear somebody — long enough that one retry cycle never becomes a
 * lost speaker, short enough that a dead track is named while the meeting is still running.
 */
export const TRACK_LOSS_GRACE_MILLISECONDS = 15_000;

/**
 * THE LONGEST GAP STAGED AS SILENCE. Silence keeps a staged track on a real timeline, which is the
 * point of writing it, and below this it is the cheapest way to: a handful of parts of zeros uploaded
 * from the one shared part. A gap past it is placed differently, according to what says it is there:
 * a sequence-number gap past it is not a run of dropped frames but a counter that jumped, so the wall
 * clock places the frame; and a wall-clock gap past it — a participant away for an hour — begins a new
 * stretch at the frame's own instant rather than uploading an hour of zeros. Neither is ever CLAMPED:
 * a gap shortened to fit would put everything after it early.
 */
export const MAXIMUM_GAP_SILENCE_SECONDS = 300;

/**
 * HOW FAR BEHIND THE END OF THE STAGED TRACK THE WALL CLOCK MAY PUT A FRAME and still have it placed at
 * the end. Frames arrive a little ahead of or behind real time as the network bunches them, and half a
 * second either way is that and nothing more; a frame further behind than this is a participant
 * returning before the silence that closed their last stretch had run out, and it begins a new stretch
 * at its own instant rather than landing late by the rest of that silence.
 */
export const WALL_CLOCK_BEHIND_TOLERANCE_MILLISECONDS = 500;

/**
 * HOW LONG A RECORDING MAY RUN WITH NOBODY IN IT before it stops itself as abandoned: no track open
 * and the room reporting nobody publishing audio. Ten minutes is forty times the loss grace — a break,
 * or everybody's connection dropping at once, does not end the recording — and short enough that a
 * recording nobody stopped after the last person left does not keep a recorder resident, and the
 * recording mark lit on the meeting, for the rest of the day.
 */
export const EMPTY_ROOM_ABANDON_MILLISECONDS = 10 * 60 * 1000;

/** The longest a recording runs before the recorder stops it with the `ceiling` reason. */
export const MAXIMUM_RECORDING_MILLISECONDS = MAXIMUM_RECORDING_HOURS * 60 * 60 * 1000;

/**
 * THE MOST KEYS ONE STORAGE WRITE CARRIES. The storage API takes at most 128 key-value pairs in one
 * `put`, so a recording with more tracks than that writes them in several.
 */
export const STORAGE_PUT_BATCH_KEYS = 128;

/** How long a settled recorder keeps its metadata before it deletes its own storage. */
const SETTLED_RETENTION_MILLISECONDS = 60_000;

// A frame's length when a track has not yet said what its frames are: twenty milliseconds, the size a
// WebRTC audio frame usually is. Only ever an estimate for counting frames a gap stands for.
const DEFAULT_FRAME_SAMPLES = PCM_SAMPLE_RATE / 50;

const MAXIMUM_GAP_SILENCE_SAMPLES = MAXIMUM_GAP_SILENCE_SECONDS * PCM_SAMPLE_RATE;
const WALL_CLOCK_BEHIND_TOLERANCE_SAMPLES =
  (WALL_CLOCK_BEHIND_TOLERANCE_MILLISECONDS / 1000) * PCM_SAMPLE_RATE;

const RECORDING_KEY = "recording";
const TRACK_PREFIX = "track:";

// ONE PART OF ZEROS, shared by every track of every recorder in the isolate and never written after
// it is made: a run of silence that covers a whole part is uploaded from here rather than written into
// a buffer. Counted once in the memory arithmetic in `@magna-carta/meetings/settings`.
let sharedSilencePart: Uint8Array | null = null;
function silencePart(): Uint8Array {
  sharedSilencePart ??= new Uint8Array(RECORDING_PART_BYTES);
  return sharedSilencePart;
}

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

/**
 * THE MESSAGE THAT MOVES A FILED RECORDING'S TRANSCRIPT ON BY ONE WINDOW — the second kind of message
 * on the same queue the compose rides, so a deployment needs nothing new to carry it. Identifiers only:
 * the consumer reads the transcript's cursor off the firm's own record and the staged audio out of the
 * firm's own bucket, and nothing anybody said ever travels on a queue.
 */
export interface MeetingTranscriptMessage {
  readonly kind: "meeting-transcript";
  readonly firmId: FirmId;
  readonly meetingId: MeetingId;
  readonly recordingId: MeetingRecordingId;
  readonly transcriptId: MeetingTranscriptId;
}

/** Either message the recording queue carries; `kind` says which consumer it is for. */
export type MeetingRecordingQueueMessage =
  | MeetingRecordingComposeMessage
  | MeetingTranscriptMessage;

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
  // Since when no track has been open and the room has reported nobody publishing audio.
  readonly emptySince: number | null;
  // When this recorder last completed a pass over the room and the record while recording — what the
  // sweep reads to tell a recorder that is working from one that has stopped working.
  readonly reconciledAt?: number | null;
}

/**
 * WHERE A STOPPED RECORDING IS HANDED ON TO BE COMPOSED: the deployment's compose queue, or — in a
 * test that drives the compose step itself — what the test installed. The recorder is a Durable Object
 * constructed with the deployment's own environment and cannot be handed another, so a test reaches it
 * through this module seam, on the routing-service client's precedent; the default is the binding.
 */
interface ComposeQueue {
  send(message: MeetingRecordingComposeMessage): Promise<unknown>;
}
let composeQueueForTests: ComposeQueue | null = null;

/** Installs (or, with null, removes) the compose queue a test wants stopped recordings handed to. */
export function setRecordingComposeQueueForTests(queue: ComposeQueue | null): void {
  composeQueueForTests = queue;
}

/**
 * One stretch of a track as the recorder writes it down — the stored shape the compose reads
 * (`MeetingRecordingTrackSegment`), held mutable here because the recorder closes and reopens it.
 */
interface RecorderSegment {
  stagedFromSample: number;
  at: string;
  stagedToSample: number | null;
}

/** One track as the recorder holds it. Metadata only — the audio is in memory, never here. */
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
  // The nonce in the sink token of the adapter currently carrying this track — rotated with every new
  // adapter, so an earlier adapter's token opens nothing.
  adapterNonce: string | null;
  readonly stagingKey: string;
  uploadId: string | null;
  parts: R2UploadedPart[];
  framesReceived: number;
  framesDropped: number;
  firstFrameAt: string | null;
  lastFrameAt: string | null;
  lastSequence: number | null;
  lastFrameSamples: number;
  // Mono samples in parts that have UPLOADED — never the ones still in memory.
  stagedSamples: number;
  // Mono samples placed on this track's timeline: uploaded, held in the buffer, and counted silence.
  timelineSamples: number;
  // Where on the timeline the last frame taken ended, which the wall clock is measured from.
  lastFrameEndSample: number;
  // Where on the timeline the last AUDIO this recorder still has ends — the last frame written into
  // the buffer, pulled back to what had uploaded when a restart lost the rest. What a recording claims
  // to have captured is measured to here, never to silence that stands in for something lost.
  capturedEndSample: number;
  // How far along the timeline what a restart lost has already been counted as dropped, so a second
  // restart before anything more uploads does not count the same samples twice.
  lossAccountedThroughSample: number;
  // True once the short last part is up: nothing more may be appended to this track's upload.
  finalPartUploaded: boolean;
  // Since when this track has had no socket — set when its adapter is opened (the routing service has
  // not dialled yet), when its socket closes, and when the recorder restarts; cleared the moment a
  // socket is accepted. The loss grace is measured from here.
  socketLostAt: number | null;
  // True when the next frame is placed by the wall clock rather than its sequence number: on every
  // accepted socket (a new adapter's counter starts afresh) and after a restart.
  resumeFromWallClock: boolean;
  // True when the participant LEFT and came back: the silence before their next frame is their
  // absence, not frames that were lost, so it is not counted as dropped.
  resumeIsReturn: boolean;
  // Where each stretch of the staged object belongs in time — begun by the first frame, and again by a
  // frame the wall clock places behind the end of the object or too far past it to stage as silence.
  segments: RecorderSegment[];
}

/** One track's working set, in memory only and never written anywhere. */
interface TrackRuntime {
  stager: PcmPartStager | null;
  // The track's upload chain: at most one part of it out at a time.
  upload: Promise<void>;
  // While the track is letting go — closing, lost, or settling — nothing new is started on it.
  draining: boolean;
  failedAttempts: number;
  retryAtNextPass: boolean;
}

function newAdapterNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function frameSamplesOf(track: RecorderTrack): number {
  return track.lastFrameSamples > 0 ? track.lastFrameSamples : DEFAULT_FRAME_SAMPLES;
}

export class MeetingRecorder extends DurableObject<Bindings> {
  // NON-HIBERNATING, so the instance is the working set: these live exactly as long as the sockets
  // that feed them, and storage holds the metadata a restart or a sweep would need if they did not.
  private recording: StoredRecorderRecording | null = null;
  // Keyed by the track ROW, which the server minted; the track name a browser chose is only ever
  // matched against the room's candidates.
  private readonly tracks = new Map<string, RecorderTrack>();
  private readonly runtimes = new Map<string, TrackRuntime>();
  private readonly sockets = new Map<string, WebSocket>();
  private readonly dirty = new Set<string>();
  // One chain for the acts that change WHICH tracks exist — start, reconcile, stop — so they never
  // interleave across the network calls each of them makes.
  private serial: Promise<unknown> = Promise.resolve();
  private bucket: R2Bucket | null = null;
  // THE MEMORY THIS RECORDER HOLDS, counted as it is taken and given back, so the bound the settings
  // arithmetic promises is a number a test can read.
  private trackBuffers = 0;
  private peakTrackBuffers = 0;
  private uploadsInFlight = 0;
  private peakUploadsInFlight = 0;
  private readonly slotWaiters: (() => void)[] = [];
  private readonly awaitingSlot = new Set<string>();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    // Read back what a previous instance wrote, before any call is delivered. Only metadata survives
    // a restart. What was in memory — the buffered audio of every open track — is gone, so each open
    // track counts it as dropped and puts silence of its length back on the timeline, and waits for
    // its socket as though it had just dropped: redialled, it resumes on the wall clock; not, it is
    // lost on the ordinary loss path.
    void ctx.blockConcurrencyWhile(async () => {
      this.recording = (await ctx.storage.get<StoredRecorderRecording>(RECORDING_KEY)) ?? null;
      const stored = await ctx.storage.list<RecorderTrack>({ prefix: TRACK_PREFIX });
      const now = Date.now();
      for (const [, track] of stored) {
        // A track written down before stretches were recorded is one stretch from its first frame,
        // which is exactly what its staged object was.
        if ((track as { segments?: RecorderSegment[] }).segments === undefined) {
          track.segments =
            track.firstFrameAt === null
              ? []
              : [{ stagedFromSample: 0, at: track.firstFrameAt, stagedToSample: null }];
        }
        this.tracks.set(track.trackId, track);
        if (this.recording?.state === "recording" && track.state === "open") {
          this.accountForRestart(track, now);
          this.openStager(track);
          this.dirty.add(track.trackId);
        }
      }
      await this.persistTracks();
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
   * record says plainly who is not — and so is a track past the ceiling, or a second audio track of a
   * stay already being heard.
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
        emptySince: null,
        reconciledAt: Date.now(),
      };
      await this.ctx.storage.put(RECORDING_KEY, this.recording);
      let opened = 0;
      let lost = 0;
      for (const candidate of input.tracks) {
        if (this.admissionRefused(this.recording, candidate.participantId)) {
          const refused = this.newTrack(this.recording, candidate, candidate.trackId, "open");
          this.tracks.set(refused.trackId, refused);
          await this.loseTrack(this.recording, refused, "refused");
          lost += 1;
          continue;
        }
        const outcome = await this.openTrack(this.recording, candidate, candidate.trackId);
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

  /**
   * WHETHER THIS RECORDER IS WORKING, for the sweep: the recording it holds and when its last pass over
   * the room and the record completed. `none` is a recorder that never took a recording — a start whose
   * hand-over never arrived — or one that has already let go of it and deleted its storage.
   */
  async heartbeat(): Promise<{
    readonly state: "recording" | "stopped" | "none";
    readonly reconciledAt: number | null;
  }> {
    return {
      state: this.recording?.state ?? "none",
      reconciledAt: this.recording?.reconciledAt ?? null,
    };
  }

  /**
   * THE SWEEP GAVE UP ON THIS RECORDING — the record already says `abandoned` — so the recorder lets go
   * of it WITHOUT handing anything on: every adapter closed and every socket hung up, then every track's
   * audio KEPT — what each buffer still holds uploaded as its final part and every upload COMPLETED, so
   * the staged objects exist for the seven days the sweep retains an abandoned recording's staging and
   * somebody can ask for what was captured. Nothing is composed: a recorder that stopped reconciling is
   * exactly the one whose account of its parts cannot be trusted to line a composite up, and the record
   * already says nothing was filed. A track that never staged a part has no object to keep, so its
   * upload is aborted and its row stops naming one. What each track carried is written down, as a stop
   * writes it.
   *
   * Answers how many uploads it completed and how many it aborted; a recorder holding no running
   * recording does nothing.
   */
  async abandon(): Promise<{ readonly completedUploads: number; readonly abortedUploads: number }> {
    return await this.exclusive(async () => {
      const recording = this.recording;
      if (recording === null || recording.state !== "recording") {
        return { completedUploads: 0, abortedUploads: 0 };
      }
      const purgeAt = Date.now() + SETTLED_RETENTION_MILLISECONDS;
      this.recording = { ...recording, state: "stopped", purgeAt };
      await this.ctx.storage.put(RECORDING_KEY, this.recording);
      await this.closeAdapters(
        [...this.tracks.values()].flatMap((track) =>
          track.adapterId === null ? [] : [track.adapterId],
        ),
      );
      for (const trackId of this.sockets.keys()) this.hangUp(trackId, "recording abandoned");
      await Promise.all([...this.runtimes.values()].map((runtime) => runtime.upload));
      let completedUploads = 0;
      let abortedUploads = 0;
      const statements: EffectStatement[] = [];
      for (const track of this.tracks.values()) {
        track.adapterId = null;
        track.adapterNonce = null;
        // Nothing could hear an open track from the moment its recorder stopped working; the record
        // already says so, and a lost track stays lost.
        if (track.state === "open") track.state = "lost";
        const hadUpload = track.uploadId !== null;
        const discarded = await this.finishUpload(recording, track);
        if (hadUpload && discarded) abortedUploads += 1;
        else if (hadUpload) completedUploads += 1;
        this.dirty.add(track.trackId);
        statements.push(this.settleStatement(recording, track, track.state, discarded));
      }
      await this.commit(recording, statements);
      await this.persistTracks();
      await this.ctx.storage.setAlarm(purgeAt);
      return { completedUploads, abortedUploads };
    });
  }

  /** What the recorder is holding, for a test and for an operator: metadata and sizes, never audio. */
  async inspect(): Promise<{
    readonly state: "recording" | "stopped" | "none";
    readonly memory: {
      readonly trackBuffers: number;
      readonly trackBufferBytes: number;
      readonly peakTrackBuffers: number;
      readonly uploadsInFlight: number;
      readonly peakUploadsInFlight: number;
    };
    readonly tracks: readonly {
      readonly trackId: string;
      readonly state: RecorderTrack["state"];
      readonly attached: boolean;
      readonly framesReceived: number;
      readonly framesDropped: number;
      readonly parts: number;
      readonly carriedBytes: number;
      readonly bufferBytes: number;
      readonly pendingSilenceBytes: number;
      readonly silencePartsQueued: number;
      readonly stagedSamples: number;
      readonly timelineSamples: number;
    }[];
  }> {
    return {
      state: this.recording?.state ?? "none",
      memory: {
        trackBuffers: this.trackBuffers,
        trackBufferBytes: this.trackBuffers * RECORDING_TRACK_BUFFER_BYTES,
        peakTrackBuffers: this.peakTrackBuffers,
        uploadsInFlight: this.uploadsInFlight,
        peakUploadsInFlight: this.peakUploadsInFlight,
      },
      tracks: [...this.tracks.values()].map((track) => {
        const stager = this.runtimes.get(track.trackId)?.stager ?? null;
        return {
          trackId: track.trackId,
          state: track.state,
          attached: this.sockets.has(track.trackId),
          framesReceived: track.framesReceived,
          framesDropped: track.framesDropped,
          parts: track.parts.length,
          carriedBytes: stager?.heldBytes ?? 0,
          bufferBytes: stager?.capacityBytes ?? 0,
          pendingSilenceBytes: stager?.pendingSilenceBytes ?? 0,
          silencePartsQueued: stager?.silencePartsQueued ?? 0,
          stagedSamples: track.stagedSamples,
          timelineSamples: track.timelineSamples,
        };
      }),
    };
  }

  /**
   * THE SOCKET THE ROUTING SERVICE DIALS, forwarded by the sink route after it verified the token and
   * asked the record that this recording is running and this track open. The track and the adapter
   * nonce ride the internal address the route built from the verified claims; nothing a caller sent
   * reaches here.
   *
   * ONE SOCKET PER TRACK, AND ONLY FOR ITS CURRENT ADAPTER. A dial carrying an earlier adapter's nonce
   * is refused — that adapter was replaced, and its token must not open the track again — and so is a
   * dial against a track whose socket is still live: the routing service dials again only after a
   * drop, so a second socket while the first is sending is somebody else holding the token.
   */
  override async fetch(request: Request): Promise<Response> {
    if (!isWebSocketUpgrade(request)) {
      return new Response("this endpoint accepts the routing service's audio only", {
        status: 426,
      });
    }
    const address = new URL(request.url);
    const trackId = address.searchParams.get("track") ?? "";
    const adapterNonce = address.searchParams.get("adapter") ?? "";
    const track = this.tracks.get(trackId);
    if (
      this.recording?.state !== "recording" ||
      track === undefined ||
      track.state !== "open" ||
      track.adapterNonce === null ||
      adapterNonce !== track.adapterNonce ||
      this.sockets.has(trackId)
    ) {
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
    this.sockets.set(trackId, server);
    track.socketLostAt = null;
    // A NEW SOCKET IS A NEW COUNTER as far as this object can tell — a redialled adapter, or one the
    // service restarted — so the first frame on it is placed by the wall clock.
    if (track.lastFrameAt !== null) track.resumeFromWallClock = true;
    this.dirty.add(trackId);
    server.addEventListener("message", (event) => {
      this.receive(trackId, event.data);
    });
    server.addEventListener("close", () => {
      if (this.sockets.get(trackId) !== server) return;
      this.sockets.delete(trackId);
      const current = this.tracks.get(trackId);
      if (current !== undefined && current.state === "open") {
        current.socketLostAt = Date.now();
        this.dirty.add(trackId);
      }
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

      // THE RECORD FIRST. A stop the route committed whose call never reached this object — it failed,
      // or the caller went away — must not leave the recorder capturing under a recording the record
      // already says has stopped; so each pass asks, and a recording that is not `recording` there is
      // settled here. That bounds capture after any stop to one alarm interval.
      const stoppedReason = await this.stoppedInRecord(recording);
      if (stoppedReason !== null) {
        await this.settle(stoppedReason);
        return;
      }

      // THE MAXIMUM LENGTH: a recording nobody stopped stops itself rather than run until the isolate
      // is recycled, and its tokens expire beside it.
      if (Date.now() >= Date.parse(recording.startedAt) + MAXIMUM_RECORDING_MILLISECONDS) {
        await this.stopByPlatform(recording, "ceiling");
        return;
      }

      // A part that failed to upload is retried once, on the pass after it failed.
      for (const [trackId, runtime] of this.runtimes) {
        if (!runtime.retryAtNextPass) continue;
        runtime.retryAtNextPass = false;
        this.pump(trackId);
      }

      await this.reconcile(recording);
      if (this.recording?.state === "recording") {
        await this.persistTracks();
        // THE HEARTBEAT the sweep reads: this pass reached the record and the room and the recorder is
        // still holding the recording. One small write a pass, beside the tracks the pass wrote.
        await this.putRecording({ ...this.recording, reconciledAt: Date.now() });
        await this.ctx.storage.setAlarm(Date.now() + RECORDER_RECONCILE_INTERVAL_MILLISECONDS);
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Frames in, bytes out
  // ---------------------------------------------------------------------------------------------

  /**
   * One message off a track's socket. Synchronous, and allocation-free beyond the decode and the mono
   * fold of one frame: the frame is written into the track's own buffer in place, and a part that
   * fills is queued on the track's upload chain.
   */
  private receive(trackId: string, data: unknown): void {
    const track = this.tracks.get(trackId);
    const runtime = this.runtimes.get(trackId);
    const stager = runtime?.stager ?? null;
    if (
      track === undefined ||
      track.state !== "open" ||
      this.recording?.state !== "recording" ||
      runtime === undefined ||
      runtime.draining ||
      stager === null
    ) {
      return;
    }
    this.dirty.add(trackId);
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
    const frameSamples = track.lastFrameSamples > 0 ? track.lastFrameSamples : mono.length;

    // SILENCE FOR WHAT NEVER ARRIVED, so the staged track stays on a real timeline and a composite of
    // several never drifts. Counted from the sequence numbers while one counter feeds the track, and
    // from the wall clock on a new socket, after a restart, and when the counter starts again. The
    // track's first frame begins its first stretch, with nothing before it.
    let silenceSamples = 0;
    let beginsStretch = track.segments.length === 0;
    let placeByWallClock = !beginsStretch && track.resumeFromWallClock;
    if (!beginsStretch && !placeByWallClock) {
      const step = sequenceStep(track.lastSequence, frame.sequenceNumber);
      if (step.kind === "behind") {
        // A repeat, or a frame reordered behind a later one: its place is already taken — by itself,
        // or by the silence written for it — and taking it again would move every sample after it.
        track.framesDropped += 1;
        return;
      }
      if (step.kind === "reset") placeByWallClock = true;
      else if (step.kind === "ahead" && step.missing > 0) {
        if (step.missing * frameSamples > MAXIMUM_GAP_SILENCE_SAMPLES) {
          // Not a run of lost frames but a counter that jumped: the wall clock says where this is.
          placeByWallClock = true;
        } else {
          track.framesDropped += step.missing;
          silenceSamples = step.missing * frameSamples;
        }
      }
    }
    if (placeByWallClock) {
      const gap = this.wallClockGap(track, nowMilliseconds);
      if (!track.resumeIsReturn && gap > 0 && frameSamples > 0) {
        track.framesDropped += Math.round(gap / frameSamples);
      }
      // BEHIND THE END OF THE OBJECT — the participant came back before the silence that closed their
      // last stretch ran out — or FAR PAST IT: a new stretch at this frame's own instant. Anything
      // else is silence of the gap's own length, never shortened. A track at its stretch ceiling is
      // placed at the end of its object instead, late by at most the padding of one departure.
      const behind = gap < -WALL_CLOCK_BEHIND_TOLERANCE_SAMPLES;
      const farAhead = gap > MAXIMUM_GAP_SILENCE_SAMPLES;
      if ((behind || farAhead) && track.segments.length < MAXIMUM_TRACK_SEGMENTS) {
        beginsStretch = true;
      } else {
        silenceSamples = Math.max(0, gap);
      }
      track.resumeFromWallClock = false;
      track.resumeIsReturn = false;
    }
    if (beginsStretch) {
      track.segments.push({
        stagedFromSample: track.timelineSamples,
        at: now,
        stagedToSample: null,
      });
    } else {
      // The stretch carries on: if its participant left and this is their return placed on the
      // timeline, the silence that closed it is now the time they were away, and part of it.
      const current = track.segments.at(-1);
      if (current !== undefined && current.stagedToSample !== null) current.stagedToSample = null;
    }
    stager.writeSilence(silenceSamples);
    track.timelineSamples += silenceSamples;

    // A frame with no room — the overflow is full because uploads are slow — is dropped and its length
    // becomes silence: memory never grows past the buffer, and the timeline keeps its place.
    const placed = stager.writeAudio(mono);
    track.timelineSamples += mono.length;
    if (placed) {
      track.framesReceived += 1;
      track.firstFrameAt ??= now;
      track.capturedEndSample = track.timelineSamples;
    } else {
      track.framesDropped += 1;
    }
    track.lastSequence = frame.sequenceNumber;
    if (mono.length > 0) track.lastFrameSamples = mono.length;
    track.lastFrameAt = now;
    track.lastFrameEndSample = track.timelineSamples;
    this.pump(trackId);
  }

  /**
   * HOW FAR PAST THE END OF THE TRACK'S TIMELINE A FRAME ARRIVING NOW BELONGS, by the wall clock since
   * the last one taken — negative when the timeline has already run past that instant, which is what
   * the silence closing a departed participant's stretch does.
   */
  private wallClockGap(track: RecorderTrack, nowMilliseconds: number): number {
    if (track.lastFrameAt === null) return 0;
    const lastFrameMilliseconds = (track.lastFrameSamples / PCM_SAMPLE_RATE) * 1000;
    const elapsed = nowMilliseconds - Date.parse(track.lastFrameAt) - lastFrameMilliseconds;
    const target = track.lastFrameEndSample + Math.round((elapsed / 1000) * PCM_SAMPLE_RATE);
    return target - track.timelineSamples;
  }

  /**
   * WHAT A RESTART LOST, counted: everything on the timeline that had not uploaded was in memory, and
   * is now silence of the same length, counted as dropped frames once.
   */
  private accountForRestart(track: RecorderTrack, now: number): void {
    track.socketLostAt = now;
    track.resumeFromWallClock = true;
    track.resumeIsReturn = false;
    const countedFrom = Math.max(track.stagedSamples, track.lossAccountedThroughSample);
    const lostSamples = track.timelineSamples - countedFrom;
    if (lostSamples > 0) track.framesDropped += Math.ceil(lostSamples / frameSamplesOf(track));
    track.lossAccountedThroughSample = track.timelineSamples;
    track.capturedEndSample = Math.min(track.capturedEndSample, track.stagedSamples);
  }

  /**
   * THE TRACK'S ONE BUFFER, preallocated as it opens. Whatever of its timeline has not uploaded — after
   * a restart, the buffered audio that was lost — is put back as silence, so the next part lands where
   * it belongs.
   */
  private openStager(track: RecorderTrack): void {
    const runtime = this.runtimeOf(track.trackId);
    if (runtime.stager !== null) return;
    runtime.stager = new PcmPartStager(
      new Uint8Array(RECORDING_TRACK_BUFFER_BYTES),
      RECORDING_PART_BYTES,
    );
    this.trackBuffers += 1;
    this.peakTrackBuffers = Math.max(this.peakTrackBuffers, this.trackBuffers);
    runtime.stager.writeSilence(track.timelineSamples - track.stagedSamples);
  }

  private releaseStager(runtime: TrackRuntime): void {
    if (runtime.stager === null) return;
    runtime.stager = null;
    this.trackBuffers -= 1;
  }

  private runtimeOf(trackId: string): TrackRuntime {
    let runtime = this.runtimes.get(trackId);
    if (runtime === undefined) {
      runtime = {
        stager: null,
        upload: Promise.resolve(),
        draining: false,
        failedAttempts: 0,
        retryAtNextPass: false,
      };
      this.runtimes.set(trackId, runtime);
    }
    return runtime;
  }

  /**
   * STARTS THE TRACK'S NEXT PART UPLOADING, if one is due and nothing holds it back: at most one part
   * of a track out at a time, at most `RECORDING_PART_UPLOADS_IN_FLIGHT` across the recorder (a track
   * past that waits its turn), none while the track is letting go, and none after a failure until the
   * next pass retries it.
   */
  private pump(trackId: string): void {
    const track = this.tracks.get(trackId);
    const runtime = this.runtimes.get(trackId);
    const stager = runtime?.stager ?? null;
    if (track === undefined || runtime === undefined || stager === null) return;
    if (this.recording?.state !== "recording" || runtime.draining || runtime.retryAtNextPass) {
      return;
    }
    if (stager.partOutstanding || stager.nextPartKind() === null) return;
    if (!this.tryAcquireUploadSlot()) {
      this.awaitingSlot.add(trackId);
      return;
    }
    const part = stager.nextPart();
    if (part === null) {
      this.releaseUploadSlot();
      return;
    }
    const work = this.uploadPart(track, stager, part).then((uploaded) => {
      this.releaseUploadSlot();
      if (uploaded) {
        runtime.failedAttempts = 0;
      } else {
        runtime.failedAttempts += 1;
        if (runtime.failedAttempts >= 2 && part.kind === "buffer") {
          // TRIED TWICE: what the part held is given up as a gap — a part of silence in its place,
          // the frames it carried counted as dropped — rather than held in memory while the next
          // frames have nowhere to go.
          const givenUp = stager.replaceHeadWithSilence();
          track.framesDropped += Math.ceil(givenUp / frameSamplesOf(track));
          runtime.failedAttempts = 0;
        } else {
          // Retried on the next pass. A part of silence holds no memory, so it is retried as often
          // as it takes.
          runtime.retryAtNextPass = true;
        }
      }
      this.pump(trackId);
    });
    runtime.upload = work;
    this.ctx.waitUntil(trackBackgroundWork(work));
  }

  private tryAcquireUploadSlot(): boolean {
    if (this.uploadsInFlight >= RECORDING_PART_UPLOADS_IN_FLIGHT) return false;
    this.uploadsInFlight += 1;
    this.peakUploadsInFlight = Math.max(this.peakUploadsInFlight, this.uploadsInFlight);
    return true;
  }

  private async acquireUploadSlot(): Promise<void> {
    while (!this.tryAcquireUploadSlot()) {
      await new Promise<void>((resolve) => this.slotWaiters.push(resolve));
    }
  }

  private releaseUploadSlot(): void {
    this.uploadsInFlight -= 1;
    const waiter = this.slotWaiters.shift();
    if (waiter !== undefined) {
      waiter();
      return;
    }
    const waiting = [...this.awaitingSlot];
    this.awaitingSlot.clear();
    for (const trackId of waiting) this.pump(trackId);
  }

  /** Uploads one whole part, answering whether it went up. Never throws. */
  private async uploadPart(
    track: RecorderTrack,
    stager: PcmPartStager,
    part: StagedPart,
  ): Promise<boolean> {
    const bytes = part.kind === "buffer" ? part.bytes : silencePart();
    try {
      await this.putPart(track, bytes);
    } catch (caught) {
      stager.partFailed();
      this.recordFailure("upload-part", caught);
      return false;
    }
    stager.partUploaded();
    return true;
  }

  /** One part into the track's upload, recorded on the track — and written down before it counts. */
  private async putPart(track: RecorderTrack, bytes: Uint8Array): Promise<void> {
    if (track.uploadId === null || this.recording === null) {
      throw new Error("the track has no upload to stage a part into");
    }
    const bucket = await this.firmBucket(this.recording.firmId);
    const upload = bucket.resumeMultipartUpload(track.stagingKey, track.uploadId);
    track.parts.push(await upload.uploadPart(track.parts.length + 1, bytes));
    track.stagedSamples += bytes.byteLength / PCM_BYTES_PER_SAMPLE;
    // The part is up whatever happens next: a write that fails here must not send the same bytes up
    // again as the following part, so it is recorded and left to the next pass's write.
    try {
      await this.putTrack(track);
    } catch (caught) {
      this.dirty.add(track.trackId);
      this.recordFailure("persist-track", caught);
    }
  }

  /**
   * LETS GO OF A TRACK'S BUFFER: waits for the part that is out, uploads every whole part still due,
   * and then either pads the last part to a boundary with silence (`pad`, for a participant who left
   * and may come back on the same upload) or uploads it short as the upload's final part (`final`) —
   * and releases the buffer. Silence nothing followed is forgotten rather than staged. A part that
   * fails twice is given up as a gap; a part of silence that fails twice ends the attempt, and what
   * was not staged is counted as dropped.
   */
  private async drainTrack(
    track: RecorderTrack,
    mode: { readonly pad: boolean; readonly final: boolean },
  ): Promise<void> {
    const runtime = this.runtimeOf(track.trackId);
    runtime.draining = true;
    this.awaitingSlot.delete(track.trackId);
    try {
      await runtime.upload;
      const stager = runtime.stager;
      if (stager === null || track.uploadId === null || track.finalPartUploaded) return;
      track.timelineSamples -= stager.discardPendingSilence();
      if (mode.pad) {
        // The stretch's audio ends HERE: what the padding adds is not the participant, and the
        // compose must neither place it nor let it push their return late.
        const current = track.segments.at(-1);
        if (current !== undefined) current.stagedToSample = track.timelineSamples;
        track.timelineSamples += stager.padToPartBoundary();
      }
      let failures = 0;
      for (;;) {
        const part = stager.nextPart();
        if (part === null) break;
        await this.acquireUploadSlot();
        const uploaded = await this.uploadPart(track, stager, part).finally(() => {
          this.releaseUploadSlot();
        });
        if (uploaded) {
          failures = 0;
          continue;
        }
        failures += 1;
        if (failures < 2) continue;
        if (part.kind === "buffer") {
          track.framesDropped += Math.ceil(stager.replaceHeadWithSilence() / frameSamplesOf(track));
          failures = 0;
          continue;
        }
        track.framesDropped += Math.ceil(
          stager.heldBytes / PCM_BYTES_PER_SAMPLE / frameSamplesOf(track),
        );
        return;
      }
      const last = mode.final ? stager.finalPart() : null;
      if (last !== null) {
        await this.acquireUploadSlot();
        try {
          let uploaded = false;
          for (let attempt = 0; attempt < 2 && !uploaded; attempt += 1) {
            try {
              await this.putPart(track, last);
              uploaded = true;
            } catch (caught) {
              this.recordFailure("upload-part", caught);
            }
          }
          if (!uploaded) {
            track.framesDropped += Math.ceil(
              last.byteLength / PCM_BYTES_PER_SAMPLE / frameSamplesOf(track),
            );
          }
        } finally {
          this.releaseUploadSlot();
        }
        stager.finalPartSettled();
      }
      if (mode.final) track.finalPartUploaded = true;
    } finally {
      this.releaseStager(runtime);
      runtime.draining = false;
      runtime.retryAtNextPass = false;
      runtime.failedAttempts = 0;
      this.dirty.add(track.trackId);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Tracks arriving and leaving
  // ---------------------------------------------------------------------------------------------

  private newTrack(
    recording: StoredRecorderRecording,
    candidate: MeetingRecordingCandidateTrack,
    trackId: MeetingRecordingTrackId,
    state: RecorderTrack["state"],
  ): RecorderTrack {
    return {
      trackId,
      trackName: candidate.trackName,
      sessionId: candidate.sessionId,
      participantKind: candidate.participantKind,
      participantId: candidate.participantId,
      userId: candidate.userId,
      state,
      adapterId: null,
      adapterNonce: null,
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
      timelineSamples: 0,
      lastFrameEndSample: 0,
      capturedEndSample: 0,
      lossAccountedThroughSample: 0,
      finalPartUploaded: false,
      socketLostAt: null,
      resumeFromWallClock: false,
      resumeIsReturn: false,
      segments: [],
    };
  }

  /**
   * WHETHER ONE MORE TRACK FOR THIS STAY MAY OPEN. One open track per stay — a participant's second
   * audio track is recorded as not heard rather than taking a slot another participant needs — and no
   * more stays than the recording's ceiling, which is never above what the memory arithmetic allows
   * whatever the caller handed in.
   */
  private admissionRefused(
    recording: StoredRecorderRecording,
    participantId: string,
    excludingTrackId?: string,
  ): boolean {
    const open = [...this.tracks.values()].filter(
      (one) => one.state === "open" && one.trackId !== excludingTrackId,
    );
    if (open.some((one) => one.participantId === participantId)) return true;
    return open.length >= Math.min(recording.ceiling, RECORDED_TRACK_CEILING_MAXIMUM);
  }

  /**
   * Opens one track: an upload in the firm's bucket, its buffer, a signed address for it, and an
   * adapter that dials that address. Answers `lost` when any of these could not be had — the row says
   * so and nobody is silently missing.
   */
  private async openTrack(
    recording: StoredRecorderRecording,
    candidate: MeetingRecordingCandidateTrack,
    trackId: MeetingRecordingTrackId,
  ): Promise<"opened" | "lost"> {
    const track = this.newTrack(recording, candidate, trackId, "open");
    // Held before the adapter is asked for, so a socket the routing service dials while that call is
    // still answering finds the track it is for.
    this.tracks.set(track.trackId, track);
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
      this.openStager(track);
      const adapterId = await this.openAdapter(recording, track);
      if (adapterId === null) {
        await upload.abort();
        track.uploadId = null;
        await this.loseTrack(recording, track, "failed");
        return "lost";
      }
      track.adapterId = adapterId;
      if (!this.sockets.has(track.trackId)) track.socketLostAt ??= Date.now();
      await this.commit(recording, [
        recordTrackSinkStatement(firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId), {
          recordingId: recording.recordingId,
          trackName: track.trackName,
          adapterId,
          stagingKey: track.stagingKey,
          now: new Date().toISOString(),
        }),
      ]);
      await this.putTrack(track);
      this.recordTrack(recording, track, "opened");
      return "opened";
    } catch (caught) {
      this.recordFailure("open-track", caught);
      await this.loseTrack(recording, track, "failed");
      return "lost";
    }
  }

  /**
   * Asks the routing service for one adapter, answering its handle or null when none was opened. A
   * new adapter is a new nonce, minted before the call so a dial that races the answer finds it, and
   * the token it carries expires with the recording's own maximum length.
   */
  private async openAdapter(
    recording: StoredRecorderRecording,
    track: RecorderTrack,
  ): Promise<string | null> {
    const client = sfuClientForEnv(this.env);
    const key = sinkSigningKeyForEnv(this.env);
    const appBaseUrl = this.env.APP_BASE_URL;
    track.adapterNonce = null;
    if (client === null || key === null || appBaseUrl === undefined || appBaseUrl === "") {
      return null;
    }
    const adapterNonce = newAdapterNonce();
    track.adapterNonce = adapterNonce;
    const token = await mintSinkToken(key, {
      firmId: recording.firmId,
      recordingId: recording.recordingId,
      trackId: track.trackId,
      adapterNonce,
      expiresAt: Date.parse(recording.startedAt) + SINK_TOKEN_LIFETIME_MILLISECONDS,
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
        track.adapterNonce = null;
        return null;
      }
      return result.adapterId;
    } catch (caught) {
      track.adapterNonce = null;
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

  private hangUp(trackId: string, reason: string): void {
    const socket = this.sockets.get(trackId);
    this.sockets.delete(trackId);
    try {
      socket?.close(1000, reason);
    } catch {
      // Already closed.
    }
  }

  /**
   * A track the recorder can no longer hear — its socket did not come back, its adapter could not be
   * opened, or it was refused a slot. The row says `lost` with what it carried; what was captured
   * before the loss is uploaded as the upload's last part, so it is still composed.
   */
  private async loseTrack(
    recording: StoredRecorderRecording,
    track: RecorderTrack,
    act: "lost" | "failed" | "refused",
  ): Promise<void> {
    track.state = "lost";
    this.hangUp(track.trackId, "track lost");
    if (track.adapterId !== null) {
      await this.closeAdapters([track.adapterId]);
      track.adapterId = null;
    }
    track.adapterNonce = null;
    await this.drainTrack(track, { pad: false, final: true });
    await this.commit(recording, [this.settleStatement(recording, track, "lost", false)]);
    await this.putTrack(track);
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
    const heldByName = new Map([...this.tracks.values()].map((one) => [one.trackName, one]));
    const database = firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId);

    // Arrivals, and returns.
    for (const candidate of present.values()) {
      const held = heldByName.get(candidate.trackName);
      if (held === undefined) {
        // The decision is the recorder's — one track per stay, and the ceiling the memory allows — and
        // the record is written in the state it decided.
        const refused = this.admissionRefused(recording, candidate.participantId);
        const admitted = admitTrackStatements(
          database,
          recording.recordingId,
          candidate,
          refused ? "lost" : "open",
          { clock: { now: () => new Date().toISOString() }, randomSource: cryptoRandomSource },
        );
        await this.commit(recording, admitted.statements);
        if (admitted.state === "open") {
          await this.openTrack(recording, candidate, admitted.trackId);
        } else {
          // PAST THE CEILING, or a stay already heard: a row that says this track was not heard, with
          // no frames.
          const lost = this.newTrack(recording, candidate, admitted.trackId, "lost");
          this.tracks.set(lost.trackId, lost);
          await this.putTrack(lost);
          this.recordTrack(recording, lost, "refused");
        }
        continue;
      }
      // A lost track stays lost: the record says the recorder could not hear them from that instant.
      if (held.state === "lost") continue;
      // THE SAME TRACK ON A NEW SESSION — the participant's connection came back, or they left and
      // returned within their stay. A new adapter on the new session, into the SAME staged object, so
      // the record is one track with a gap in it rather than two.
      if (held.state === "closed" || held.sessionId !== candidate.sessionId) {
        const reopened = held.state === "closed";
        // A return is admitted like an arrival: the slot it left may have been taken since, and a
        // return past the ceiling is recorded as not heard, exactly as an arrival past it is.
        if (reopened && this.admissionRefused(recording, held.participantId, held.trackId)) {
          await this.loseTrack(recording, held, "refused");
          continue;
        }
        if (held.adapterId !== null) await this.closeAdapters([held.adapterId]);
        held.adapterId = null;
        // The socket belonged to the adapter just closed; the new adapter dials a socket of its own.
        this.hangUp(held.trackId, "adapter replaced");
        held.sessionId = candidate.sessionId;
        held.resumeFromWallClock = true;
        if (reopened) held.resumeIsReturn = true;
        held.state = "open";
        this.openStager(held);
        const adapterId = await this.openAdapter(recording, held);
        if (adapterId === null) {
          await this.loseTrack(recording, held, "failed");
          continue;
        }
        held.adapterId = adapterId;
        held.socketLostAt = Date.now();
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
        this.dirty.add(held.trackId);
        this.recordTrack(recording, held, "reattached");
      }
    }

    // Departures: a participant no longer publishing has their adapter closed, their buffer padded to
    // a part boundary and released, and their track closed — the staged object stays open in case
    // they come back.
    for (const held of this.tracks.values()) {
      if (held.state !== "open" || present.has(held.trackName)) continue;
      held.state = "closed";
      this.hangUp(held.trackId, "participant left");
      if (held.adapterId !== null) await this.closeAdapters([held.adapterId]);
      held.adapterId = null;
      held.adapterNonce = null;
      await this.drainTrack(held, { pad: true, final: false });
      await this.commit(recording, [this.settleStatement(recording, held, "closed", false)]);
      this.recordTrack(recording, held, "detached");
    }

    // Losses: a socket gone past its grace, on a track that is still meant to be sending.
    const now = Date.now();
    for (const held of this.tracks.values()) {
      if (held.state !== "open" || this.sockets.has(held.trackId)) continue;
      if (held.socketLostAt !== null && now - held.socketLostAt >= TRACK_LOSS_GRACE_MILLISECONDS) {
        await this.loseTrack(recording, held, "lost");
      }
    }

    // EVERY TRACK LOST: there is nobody left this recording can hear, so it stops itself rather than
    // run on recording nothing under a mark that says it is recording.
    const tracks = [...this.tracks.values()];
    if (tracks.length > 0 && tracks.every((one) => one.state === "lost")) {
      await this.stopByPlatform(recording, "sink-lost");
      return;
    }

    // NOBODY THERE: no track open and nobody in the room publishing audio — a recording that never had
    // a track is held to the same rule. Held for a sustained window before it is called abandoned.
    const current = this.recording;
    if (current === null || current.state !== "recording") return;
    const empty = candidates.length === 0 && !tracks.some((one) => one.state === "open");
    if (!empty) {
      if (current.emptySince !== null) await this.putRecording({ ...current, emptySince: null });
      return;
    }
    const emptySince = current.emptySince ?? now;
    if (current.emptySince === null) await this.putRecording({ ...current, emptySince });
    if (now - emptySince >= EMPTY_ROOM_ABANDON_MILLISECONDS) {
      await this.stopByPlatform(current, "abandoned");
    }
  }

  /**
   * THE RECORDER'S OWN STOP — every track lost, the room empty too long, or the maximum length
   * reached: committed to the record first, then settled, then announced to the room. A stop that
   * cannot be committed this pass is not settled either; the next pass reads the record and either
   * finds it stopped by somebody else (and settles) or tries again.
   */
  private async stopByPlatform(
    recording: StoredRecorderRecording,
    stopReason: "sink-lost" | "abandoned" | "ceiling",
  ): Promise<void> {
    const database = firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId);
    const now = () => new Date().toISOString();
    const system = { clock: { now }, randomSource: cryptoRandomSource };
    let stoppedAt: string | null = null;
    try {
      const stopped =
        stopReason === "sink-lost"
          ? await stopRecordingAfterSinkLoss(database, recording.recordingId, system)
          : await stopRecordingByPlatform(database, recording.recordingId, stopReason, system);
      if (stopped !== undefined) {
        await commitEffectBatch(database, stopped.effect, { now });
        stoppedAt = stopped.recording.stopped_at;
      }
    } catch (caught) {
      this.recordFailure("stop", caught);
      return;
    }
    await this.settle(stopReason);
    // Announced only by the stop that committed: a stop somebody else made was announced by them.
    if (stoppedAt === null) return;
    try {
      const room = this.env.MEETING_ROOM.get(
        this.env.MEETING_ROOM.idFromName(`${recording.firmId}:${recording.meetingId}`),
      );
      await room.recordingStopped({
        firmId: recording.firmId,
        meetingId: recording.meetingId,
        recordingId: recording.recordingId,
        at: stoppedAt,
        by: null,
      });
    } catch (caught) {
      this.recordFailure("announce-stop", caught);
    }
  }

  /**
   * The reason the firm's record gives for a recording that is no longer running, or null while it is
   * — or when the record could not be read this pass, which decides nothing.
   */
  private async stoppedInRecord(
    recording: StoredRecorderRecording,
  ): Promise<MeetingRecordingStopReason | null> {
    try {
      const row = await readRecordingById(
        firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId),
        recording.recordingId,
      );
      if (row === undefined) return "abandoned";
      if (row.state === "recording") return null;
      return row.stop_reason ?? "abandoned";
    } catch (caught) {
      this.recordFailure("read-record", caught);
      return null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Settling
  // ---------------------------------------------------------------------------------------------

  /**
   * Lets go of the recording: every adapter closed, every socket hung up, every buffer uploaded as a
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
    for (const trackId of this.sockets.keys()) this.hangUp(trackId, "recording stopped");
    // Every part already out lands before any final part is cut, so no track has two out at once.
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.upload));

    const database = firmDatabaseFor(this.env.FIRM_DATABASE, recording.firmId);
    const statements: EffectStatement[] = [];
    let capturedSamples = 0;
    let lostTrackCount = 0;
    for (const track of this.tracks.values()) {
      track.adapterId = null;
      track.adapterNonce = null;
      const discarded = await this.finishUpload(recording, track);
      if (track.state === "lost") lostTrackCount += 1;
      const finalState = track.state === "lost" ? "lost" : "closed";
      track.state = finalState;
      this.dirty.add(track.trackId);
      statements.push(this.settleStatement(recording, track, finalState, discarded));
      // WHAT A COMPOSITE OF THESE TRACKS COULD CONTAIN: each stretch lands where the compose will put
      // it, and the track runs to the end of the last audio it still has — never past what uploaded,
      // never over the silence a closed stretch was padded with, and never over silence that stands
      // in for audio a restart lost. Never the wall-clock length.
      const heard = Math.min(track.capturedEndSample, track.stagedSamples);
      if (track.firstFrameAt !== null && heard > 0 && !discarded) {
        for (const span of placeTrackSegments({
          startedAt: recording.startedAt,
          firstFrameAt: track.firstFrameAt,
          segments: track.segments,
          objectSamples: heard,
        })) {
          capturedSamples = Math.max(capturedSamples, span.offset + span.samples);
        }
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
        // A zero here means the recording already left `composing` — a sweep abandoned it, or a
        // failed start recorded its own failure first — and that state is the truer record. Guarding
        // it would roll back the whole settle and lose what every track carried; the audit row beside
        // it is written only when this failure is the one the row kept.
        // fitness:unguarded-write — a later state is the truer record, and the settle must still land
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
        await (composeQueueForTests ?? this.env.MEETING_RECORDING_COMPOSE)?.send(message);
      } catch (caught) {
        this.recordFailure("enqueue-compose", caught);
      }
    }

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
   * Uploads what a track's buffer still holds as its final part and completes the upload — or
   * abandons the upload when nothing ever reached it, answering true so the row stops naming an object
   * that does not exist.
   */
  private async finishUpload(
    recording: StoredRecorderRecording,
    track: RecorderTrack,
  ): Promise<boolean> {
    const runtime = this.runtimeOf(track.trackId);
    if (track.uploadId === null) {
      this.releaseStager(runtime);
      return true;
    }
    await this.drainTrack(track, { pad: false, final: true });
    try {
      const bucket = await this.firmBucket(recording.firmId);
      const upload = bucket.resumeMultipartUpload(track.stagingKey, track.uploadId);
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
      segments: track.segments.length === 0 ? null : JSON.stringify(track.segments),
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

  private async putRecording(recording: StoredRecorderRecording): Promise<void> {
    this.recording = recording;
    await this.ctx.storage.put(RECORDING_KEY, recording);
  }

  /** One track written now — at a part boundary, where what has uploaded must be durable. */
  private async putTrack(track: RecorderTrack): Promise<void> {
    this.dirty.delete(track.trackId);
    await this.ctx.storage.put(`${TRACK_PREFIX}${track.trackId}`, track);
  }

  /**
   * THE TRACKS THAT CHANGED SINCE THE LAST WRITE, and only those — a recording that has seen a
   * hundred tracks come and go writes the dozen that are sending — in batches of at most
   * `STORAGE_PUT_BATCH_KEYS`.
   */
  private async persistTracks(): Promise<void> {
    const changed = [...this.dirty].flatMap((trackId) => {
      const track = this.tracks.get(trackId);
      return track === undefined ? [] : [track];
    });
    this.dirty.clear();
    for (let start = 0; start < changed.length; start += STORAGE_PUT_BATCH_KEYS) {
      const entries: Record<string, RecorderTrack> = {};
      for (const track of changed.slice(start, start + STORAGE_PUT_BATCH_KEYS)) {
        entries[`${TRACK_PREFIX}${track.trackId}`] = track;
      }
      await this.ctx.storage.put(entries);
    }
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
