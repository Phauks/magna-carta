import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type EffectStatement,
} from "@magna-carta/data-access/effect-batch";
import {
  abortUploadSession,
  completeUploadSession,
  initiateUpload,
} from "@magna-carta/file-manager/file-service";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  MeetingRecordingTrackId,
  MeetingTranscriptId,
  UploadSessionId,
} from "@magna-carta/identifiers/types";
import type { InferencePort } from "@magna-carta/inference/port";
import { PCM_BYTES_PER_SAMPLE, PCM_SAMPLE_RATE } from "@magna-carta/meetings/pcm-frame";
import { samplesFromPcmBytes, writePcmBytes } from "@magna-carta/meetings/pcm-mix";
import {
  clearStagingKeysStatements,
  listRecordingTracks,
  readComposeTarget,
  readRecordingById,
  readRecordingFilingFacts,
} from "@magna-carta/meetings/recording-statements";
import {
  parseTrackSegments,
  placeTrackSegments,
  type MeetingRecordingRow,
  type MeetingRecordingTrackRow,
  type PlacedTrackSpan,
} from "@magna-carta/meetings/recording-types";
import {
  downsampleForTranscription,
  TRANSCRIPTION_SAMPLE_RATE,
} from "@magna-carta/meetings/resample";
import {
  framesToSamples,
  planSpeechPieces,
  SPEECH_FRAME_SAMPLES,
  writeFrameLevels,
} from "@magna-carta/meetings/speech-spans";
import {
  countWords,
  gapsForTracks,
  placeHeardSegments,
  promptTail,
  wholeRecordingGap,
  type PlacedLine,
} from "@magna-carta/meetings/transcript-assembly";
import {
  assembleTranscriptStatements,
  claimTranscriptWindowEffect,
  cursorOf,
  failTranscriptEffect,
  LANGUAGE_DETECTION_MINIMUM_MILLISECONDS,
  readyTranscriptStatements,
  TRANSCRIPT_CLAIM_GUARD,
  TRANSCRIPT_FAIL_GUARD,
  TRANSCRIPT_FILING_GUARD,
  TRANSCRIPT_MODEL_FAILURE_GUARD,
  TRANSCRIPT_PROGRESS_GUARD,
  TRANSCRIPT_READY_GUARD,
  transcriptModelFailureEffect,
  transcriptProgressEffect,
  type TranscriptTrackSpeaker,
} from "@magna-carta/meetings/transcript-service";
import {
  hasTranscriptSpeech,
  listStagedTracksOfRecording,
  listTranscriptSegments,
  readLastTrackWords,
  readTranscriptById,
  releaseTranscriptClaimStatement,
  type TranscriptCursor,
} from "@magna-carta/meetings/transcript-statements";
import type { MeetingTranscriptRow } from "@magna-carta/meetings/transcript-types";
import { beginSummaryStatements } from "@magna-carta/meetings/summary-service";
import { WAV_HEADER_BYTES, wavHeader } from "@magna-carta/meetings/wav";
import { renderWebVtt, type WebVttCue } from "@magna-carta/meetings/webvtt";
import { matterScopedObjectDimensions } from "@magna-carta/object-dimensions/dimensions";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import { enqueueDevIngestEvent } from "../files/presign.ts";
import { deploymentInferencePort } from "../inference/call-site.ts";
import type { MeetingSummaryMessage, MeetingTranscriptMessage } from "./meeting-recorder.ts";
import { meetingDocumentFileName } from "./recording-compose-consumer.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "./sfu/realtime-failure.ts";

// THE TRANSCRIPT OF A FILED RECORDING: each track's own staged audio, cut into the spans its speaker
// was talking, sent to the platform's speech model a piece at a time, and assembled into one
// chronological list of lines — every one attributed to the track it came from — then filed beside the
// audio as a WebVTT document through the same upload pipeline the audio went through.
//
// ON THE RECORDING'S OWN QUEUE, as a second kind of message: the compose files the recording, writes the
// pending transcript in the same batch, and sends its first message on the queue it is itself consumed
// from — so a deployment needs no new queue, consumer or binding to carry it (`event-dispatch.ts` routes
// by the message's `kind`).
//
// A WINDOW AT A TIME, on the compose's shape. One message is a bounded amount of work — at most
// `TRANSCRIPT_PIECES_PER_INVOCATION` calls to the model and `TRANSCRIPT_REGIONS_PER_INVOCATION`
// regions of audio measured — and the cursor on the transcript's row (the track, the staged sample, the
// segments written) says where the next one begins. Each window is CLAIMED on the row first, a lease as
// long as a consumer can run, so a second delivery of one message never sends the same audio to the
// model twice; every piece's lines are written in ONE guarded batch with the cursor that moves past
// them, so a consumer that loses its claim writes nothing.
//
// WHAT IS SENT TO THE MODEL. A track is measured a region (five minutes) at a time, never held whole:
// `speech-spans.ts` finds where its speaker was talking from the audio's own energy, relative to the
// track's own noise floor, with a hangover so words are not clipped, and cuts each span at thirty
// seconds, at a pause where there is one. Each piece is downsampled to 16 kHz behind an anti-alias
// filter (`resample.ts`), wrapped as a 16 kHz mono WAV, and sent with the tail of the track's previous
// piece's words as its prompt. A staged track is placed on the recording's timeline stretch by stretch
// (`placeTrackSegments`, the compose's own placement), and a piece never crosses from one stretch into
// the next — a participant who left and came back is two stretches, and the time between them is not
// their speech.
//
// MEMORY PER INVOCATION is bounded and does not grow with the recording: one region's frame levels
// (fifteen thousand numbers), one minute of a track read at a time to measure them (5.76 MB of bytes
// and their samples), and one piece of at most thirty seconds (2.88 MB of bytes, its samples, its
// 16 kHz copy and its WAV) — about twenty megabytes.
//
// SETTLING. When every track is done, the transcript is assembled and its filing begun in ONE batch:
// the gap lines (a lost track, one the ceiling refused, one whose audio was not there), every line
// renumbered into reading order, and the upload session recorded on the row — so it happens once. The
// document is rendered from the rows, written at the key the pipeline minted, and completed in one batch
// with the transcript's `ready` — and the transcript's SUMMARY begun, pending, in that same batch, so a
// ready transcript is never without one; then the staged tracks are RELEASED (they were kept past the
// filing only because the transcript reads them), ingest is driven exactly as for the audio, and the
// summary's first message is sent on this same queue (`summary-consumer.ts` decides whether it is written
// at all).
//
// A SPEECH MODEL THAT REFUSES FOR NOW is outlasted, not given up on: each refusal is counted on the row
// (`model_failures`, reset by any progress), the window is sent again after a delay that doubles from
// thirty seconds to fifteen minutes, and only `TRANSCRIPT_MODEL_FAILURE_LIMIT` refusals in a row — over
// an hour of an unavailable model — fail the transcript. A transcript that cannot be finished is `failed`
// with an Error ID; what happens to the staged tracks then depends on WHY. A failure a later attempt
// could get past (the model stayed unavailable, or the sweep found it stalled) KEEPS them under the
// seven-day retention a failed compose's staging has, because they are the only per-speaker copy of the
// audio. A refusal no retry can change releases them at once.
//
// THE WORDS ARE CONTENT. Nothing here logs a word, a speaker's name, the document's name or an object
// key; every Error ID is recorded against a fixed sentence and a code.

/** The most model calls one invocation makes before handing the next window on. */
export const TRANSCRIPT_PIECES_PER_INVOCATION = 8;

/** How much of a track is measured at once: five minutes of 48 kHz audio. */
export const TRANSCRIPT_REGION_SAMPLES = 5 * 60 * PCM_SAMPLE_RATE;

/** The most regions one invocation measures, so a long silent track is also crossed in bounded steps. */
export const TRANSCRIPT_REGIONS_PER_INVOCATION = 4;

/** How long a consumer's claim on a window holds: fifteen minutes, a consumer's longest run. */
export const TRANSCRIPT_CLAIM_LEASE_MILLISECONDS = 15 * 60 * 1000;

/**
 * HOW MANY TIMES IN A ROW A WINDOW MAY MEET A SPEECH MODEL THAT REFUSES FOR NOW (busy, unreachable)
 * before the transcript is failed with an Error ID. Counted on the row and reset by any progress, so a
 * transcript that moves between refusals is never failed by them. With the delays below, ten refusals
 * span about an hour and a quarter — longer than any outage of tens of minutes — and a model that is
 * down for good still ends in a record a person can read rather than a transcript pending forever.
 */
export const TRANSCRIPT_MODEL_FAILURE_LIMIT = 10;

/** The delay before the first retry after the model refused: thirty seconds. */
export const TRANSCRIPT_MODEL_RETRY_FIRST_SECONDS = 30;

/**
 * The longest delay between retries: fifteen minutes. Held under the sweep's stall window (thirty
 * minutes), so a transcript waiting on a scheduled retry is never mistaken for one nothing is moving.
 */
export const TRANSCRIPT_MODEL_RETRY_LONGEST_SECONDS = 15 * 60;

/** How long the window waits after its `failures`-th refusal in a row: doubling, up to the longest. */
export function transcriptModelRetryDelaySeconds(failures: number): number {
  return Math.min(
    TRANSCRIPT_MODEL_RETRY_LONGEST_SECONDS,
    TRANSCRIPT_MODEL_RETRY_FIRST_SECONDS * 2 ** Math.max(0, failures - 1),
  );
}

/** How long the document's upload session lives before the stale-upload sweep may abort it. */
export const TRANSCRIPT_UPLOAD_SESSION_LIFETIME_MILLISECONDS = 2 * 24 * 60 * 60 * 1000;

/** How much of a track is read from the bucket at once while measuring it: one minute. */
const MEASURE_BLOCK_SAMPLES = 60 * PCM_SAMPLE_RATE;

/** How many lines the document's render reads at once. */
const RENDER_PAGE_SIZE = 500;

/** The speech operation, which is all of the model port this consumer reaches. */
export type TranscriptionPort = Pick<InferencePort, "transcribe">;

/** What one invocation may be given, for a test: its model, and its bounds. */
export interface TranscriptOptions {
  readonly port?: TranscriptionPort;
  readonly piecesPerInvocation?: number;
  readonly regionsPerInvocation?: number;
  // How much of a track is measured at once, in staged samples — a whole number of twenty-millisecond
  // frames. A test shortens it to cross a region's edge without minutes of audio.
  readonly regionSamples?: number;
  readonly claimLeaseMilliseconds?: number;
}

/**
 * What one delivery did. `retrying` is a model that refused for now, with the window sent again after a
 * delay; `claimed-elsewhere` is a window another consumer's live lease holds at the cursor this delivery
 * read — one evicted mid-window by a deploy, most often — which the queue tries again once that lease
 * has run out rather than leaving it to the sweep.
 */
export type TranscriptOutcome =
  | "progressed"
  | "ready"
  | "failed"
  | "retrying"
  | "claimed-elsewhere"
  | "nothing-to-do";

/** An outcome, and how long the queue should wait before delivering the message again, if at all. */
interface WindowResult {
  readonly outcome: TranscriptOutcome;
  readonly retryAfterSeconds?: number;
}

/** A refusal the transcript cannot retry its way past: it is failed with an Error ID. */
class TranscriptRefusedError extends Error {}

/** The speech model refused for now — busy or unreachable — so the window is worth another attempt. */
class TranscriptionUnavailableError extends Error {}

/** The model port a deployment transcribes through: the platform's gateway, from the composition root. */
function transcriptionPortFor(env: Bindings, options: TranscriptOptions): TranscriptionPort {
  return options.port ?? deploymentInferencePort(env);
}

/** The queue consumer for the transcript's messages: one window of one transcript per message. */
export async function meetingTranscriptQueue(
  batch: MessageBatch<MeetingTranscriptMessage>,
  env: Bindings,
  options: TranscriptOptions = {},
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const result = await windowOf(env, message.body, options);
      if (result.retryAfterSeconds === undefined) {
        message.ack();
      } else {
        message.retry({ delaySeconds: result.retryAfterSeconds });
      }
    } catch (caught) {
      // Recorded through the standard pipeline and retried; a transcript that keeps failing is
      // dead-lettered, and the sweep hands one with no progress on again or fails it.
      recordRealtimeFailure(realtimeLoggerFor(env), "meetings.transcript", caught);
      message.retry({ delaySeconds: Math.min(60, 10 * message.attempts) });
    }
  }
}

/**
 * Moves one transcript on by one window — transcribing, assembling and filing as far as the window's
 * bounds allow, and handing the next window to the queue when there is more. Throws only for a failure
 * worth retrying; a transcript that can never be finished is failed in the record.
 */
export async function transcribeWindow(
  env: Bindings,
  message: MeetingTranscriptMessage,
  options: TranscriptOptions = {},
): Promise<TranscriptOutcome> {
  return (await windowOf(env, message, options)).outcome;
}

async function windowOf(
  env: Bindings,
  message: MeetingTranscriptMessage,
  options: TranscriptOptions,
): Promise<WindowResult> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const transcript = await readTranscriptById(database, message.transcriptId);
  // Ready or failed already — by an earlier delivery, or the sweep — or not this firm's.
  if (transcript === undefined || transcript.state !== "pending") {
    return { outcome: "nothing-to-do" };
  }

  const leaseMilliseconds = options.claimLeaseMilliseconds ?? TRANSCRIPT_CLAIM_LEASE_MILLISECONDS;
  const claimedAt = new Date().toISOString();
  try {
    await commitEffectBatch(
      database,
      claimTranscriptWindowEffect(database, { transcript, claimedAt, leaseMilliseconds }),
      { now: () => claimedAt },
    );
  } catch (caught) {
    if (caught instanceof GuardedWriteRefusedError && caught.guard === TRANSCRIPT_CLAIM_GUARD) {
      return await refusedClaim(database, transcript, leaseMilliseconds);
    }
    throw caught;
  }
  const bucketFor = async (): Promise<R2Bucket> =>
    (await resolveFirmBucketForFirmId(env, message.firmId)).bucket;
  try {
    return {
      outcome: await transcribeClaimedWindow(
        env,
        database,
        message,
        transcript,
        claimedAt,
        options,
      ),
    };
  } catch (caught) {
    if (caught instanceof TranscriptionUnavailableError) {
      return await modelUnavailable(env, database, message, transcript, claimedAt, caught);
    }
    if (
      !(caught instanceof TranscriptRefusedError) &&
      !(caught instanceof FileManagerValidationError)
    ) {
      throw caught;
    }
    // A TRANSCRIPT THAT CAN NEVER BE FINISHED: failed with an Error ID recorded against a fixed sentence
    // and a code — never a word, a name or a key. No retry changes a refusal, so the staging goes too.
    const failureErrorId = recordRealtimeFailure(
      realtimeLoggerFor(env),
      "meetings.transcript.refused",
      new Error(
        caught instanceof FileManagerValidationError
          ? `the upload pipeline refused the transcript (${caught.code})`
          : caught.message,
      ),
    );
    return {
      outcome: (await failMeetingTranscript(
        env,
        database,
        transcript.id,
        failureErrorId,
        bucketFor,
        {
          releaseStaging: true,
        },
      ))
        ? "failed"
        : "nothing-to-do",
    };
  } finally {
    // Let go of the claim unless the window's hand-on, the settle or a refusal already did, so a failure
    // the queue retries is picked up by the retry at once rather than after the lease runs out.
    try {
      await commitEffectBatch(
        database,
        {
          statements: [releaseTranscriptClaimStatement(database, { id: transcript.id, claimedAt })],
          outboxMessages: [],
        },
        { now: () => new Date().toISOString() },
      );
    } catch (caught) {
      recordRealtimeFailure(realtimeLoggerFor(env), "meetings.transcript.release", caught);
    }
  }
}

/**
 * WHY THE CLAIM WAS REFUSED, read back off the row. A window another consumer's LIVE lease holds at the
 * very cursor this delivery read — its holder evicted mid-window by a deploy, most often — is tried again
 * once the lease has run out, so the transcript waits at most the rest of a lease rather than the
 * sweep's stall window and one of its hand-ons. A cursor or state that moved means another delivery is
 * doing (or has done) the work, and this one has nothing to do.
 */
async function refusedClaim(
  database: ProxyBatchDatabase,
  read: MeetingTranscriptRow,
  leaseMilliseconds: number,
): Promise<WindowResult> {
  const now = await readTranscriptById(database, read.id);
  if (
    now === undefined ||
    now.state !== "pending" ||
    now.claimed_at === null ||
    now.cursor_track !== read.cursor_track ||
    now.cursor_sample !== read.cursor_sample ||
    now.segments_written !== read.segments_written
  ) {
    return { outcome: "nothing-to-do" };
  }
  const remaining = Date.parse(now.claimed_at) + leaseMilliseconds - Date.now();
  return {
    outcome: "claimed-elsewhere",
    retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)),
  };
}

/**
 * THE SPEECH MODEL REFUSED FOR NOW, with this consumer holding the window: the refusal is counted and the
 * claim let go in one guarded write, and the window is sent again after a delay that doubles with each
 * refusal in a row — on a NEW message, because the queue's own redelivery is bounded by its retry budget
 * (three), which would end the chain long before an outage of tens of minutes does. Past
 * `TRANSCRIPT_MODEL_FAILURE_LIMIT` the transcript is failed with an Error ID and its staged tracks are
 * KEPT for the retention a failed compose's are: a model that comes back could still read them.
 */
async function modelUnavailable(
  env: Bindings,
  database: ProxyBatchDatabase,
  message: MeetingTranscriptMessage,
  transcript: MeetingTranscriptRow,
  claimedAt: string,
  caught: TranscriptionUnavailableError,
): Promise<WindowResult> {
  const now = () => new Date().toISOString();
  try {
    await commitEffectBatch(
      database,
      transcriptModelFailureEffect(
        database,
        { transcriptId: transcript.id, claimedAt },
        { clock: { now }, randomSource: cryptoRandomSource },
      ),
      { now },
    );
  } catch (refused) {
    // The lease ran out and another consumer took the window: the refusal is theirs to count.
    if (
      refused instanceof GuardedWriteRefusedError &&
      refused.guard === TRANSCRIPT_MODEL_FAILURE_GUARD
    ) {
      return { outcome: "nothing-to-do" };
    }
    throw refused;
  }
  const failures = (await readTranscriptById(database, transcript.id))?.model_failures ?? 1;
  const failureErrorId = recordRealtimeFailure(
    realtimeLoggerFor(env),
    "meetings.transcript.model-unavailable",
    new Error(
      `the speech model refused for now (${caught.message}), ${String(failures)} times in a row without progress`,
    ),
  );
  if (failures >= TRANSCRIPT_MODEL_FAILURE_LIMIT) {
    return {
      outcome: (await failMeetingTranscript(
        env,
        database,
        transcript.id,
        failureErrorId,
        async () => (await resolveFirmBucketForFirmId(env, message.firmId)).bucket,
        { releaseStaging: false },
      ))
        ? "failed"
        : "nothing-to-do",
    };
  }
  const queue = env.MEETING_RECORDING_COMPOSE;
  if (queue === undefined) throw new Error("no recording queue is bound to send the retry to");
  await queue.send(message, { delaySeconds: transcriptModelRetryDelaySeconds(failures) });
  return { outcome: "retrying" };
}

/** The staged object of one track as the transcript reads it: where it is and how it lands. */
interface TrackAudio {
  readonly stagingKey: string;
  readonly spans: readonly PlacedTrackSpan[];
}

/**
 * Where a track's staged audio lands on the recording, stretch by stretch — or null for a track that
 * has none to read (it never staged anything, its staging was already released, or its object is gone).
 */
async function trackAudioOf(
  bucket: R2Bucket,
  recording: MeetingRecordingRow,
  track: MeetingRecordingTrackRow,
): Promise<TrackAudio | null> {
  if (track.staging_key === null || track.first_frame_at === null) return null;
  const object = await bucket.head(track.staging_key);
  if (object === null) return null;
  const segments = parseTrackSegments(track.segments);
  if (track.segments !== null && segments === null) {
    throw new TranscriptRefusedError("a staged track's stretches could not be read");
  }
  return {
    stagingKey: track.staging_key,
    spans: placeTrackSegments({
      startedAt: recording.started_at,
      firstFrameAt: track.first_frame_at,
      segments,
      objectSamples: Math.floor(object.size / PCM_BYTES_PER_SAMPLE),
    }),
  };
}

/** The stretch a staged sample is in, or the first after it; null past the last. */
function stretchAt(
  audio: TrackAudio,
  stagedSample: number,
): { readonly span: PlacedTrackSpan; readonly from: number } | null {
  for (const span of audio.spans) {
    if (span.stagedFromSample + span.samples > stagedSample) {
      return { span, from: Math.max(stagedSample, span.stagedFromSample) };
    }
  }
  return null;
}

/** A staged sample of a stretch as milliseconds on the recording's timeline. */
function timelineMilliseconds(span: PlacedTrackSpan, stagedSample: number): number {
  return Math.round(
    ((span.offset + stagedSample - span.stagedFromSample) * 1000) / PCM_SAMPLE_RATE,
  );
}

/** Reads `[from, to)` staged samples of one object, or refuses when the object has gone. */
async function readStagedSamples(
  bucket: R2Bucket,
  stagingKey: string,
  from: number,
  to: number,
): Promise<Int16Array> {
  const read = await bucket.get(stagingKey, {
    range: { offset: from * PCM_BYTES_PER_SAMPLE, length: (to - from) * PCM_BYTES_PER_SAMPLE },
  });
  // The staging is kept for exactly as long as this transcript is pending, so an object that went away
  // under it is a fault, not silence — composing on without it would file a transcript missing a voice
  // without saying so.
  if (read === null) {
    throw new TranscriptRefusedError(
      "a staged track vanished from the bucket during the transcript",
    );
  }
  return samplesFromPcmBytes(new Uint8Array(await read.arrayBuffer()));
}

/** The level of every frame of `[from, to)` of one staged object, read a minute at a time. */
async function measureRegion(
  bucket: R2Bucket,
  stagingKey: string,
  from: number,
  to: number,
): Promise<Float32Array> {
  const levels = new Float32Array(Math.ceil((to - from) / SPEECH_FRAME_SAMPLES));
  let atFrame = 0;
  for (let blockFrom = from; blockFrom < to; blockFrom += MEASURE_BLOCK_SAMPLES) {
    const block = await readStagedSamples(
      bucket,
      stagingKey,
      blockFrom,
      Math.min(to, blockFrom + MEASURE_BLOCK_SAMPLES),
    );
    // A block is a whole number of frames (a minute is three thousand), so frames never straddle two.
    atFrame += writeFrameLevels(block, levels, atFrame);
  }
  return levels;
}

/** One piece as the speech model takes it: 16 kHz mono 16-bit, in a WAV. */
function pieceAsWav(samples: Int16Array): Uint8Array {
  const downsampled = downsampleForTranscription(samples);
  const dataBytes = downsampled.length * PCM_BYTES_PER_SAMPLE;
  const wav = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  wav.set(wavHeader(dataBytes, TRANSCRIPTION_SAMPLE_RATE), 0);
  writePcmBytes(downsampled, wav, WAV_HEADER_BYTES);
  return wav;
}

/** The stay a track was, as its lines are attributed. */
function speakerOf(track: MeetingRecordingTrackRow): TranscriptTrackSpeaker {
  return {
    trackId: track.id,
    participantKind: track.participant_kind,
    participantId: track.participant_id,
    userId: track.user_id,
  };
}

/** The window this consumer has claimed: transcribed, handed on, assembled and filed — as far as it goes. */
async function transcribeClaimedWindow(
  env: Bindings,
  database: ProxyBatchDatabase,
  message: MeetingTranscriptMessage,
  claimed: MeetingTranscriptRow,
  claimedAt: string,
  options: TranscriptOptions,
): Promise<TranscriptOutcome> {
  const now = () => new Date().toISOString();
  const system = { clock: { now }, randomSource: cryptoRandomSource };
  const recording = await readRecordingById(database, claimed.recording_id);
  if (recording === undefined || recording.state !== "filed") {
    throw new TranscriptRefusedError("the transcript's recording is not filed");
  }
  const { bucket, bucketName } = await resolveFirmBucketForFirmId(env, message.firmId);
  const tracks = await listRecordingTracks(database, recording.id);
  const port = transcriptionPortFor(env, options);
  const piecesAllowed = options.piecesPerInvocation ?? TRANSCRIPT_PIECES_PER_INVOCATION;
  const regionsAllowed = options.regionsPerInvocation ?? TRANSCRIPT_REGIONS_PER_INVOCATION;
  const regionSamples = options.regionSamples ?? TRANSCRIPT_REGION_SAMPLES;
  let pieces = 0;
  let regions = 0;
  let cursor: TranscriptCursor = cursorOf(claimed);
  // The transcript's language once a piece long enough has named it, sent as every later piece's hint.
  let language = claimed.language;

  /**
   * Moves the cursor in the record — with a piece's lines, or past audio with nothing to send — and
   * answers where it now stands, or null when the claim was lost and this consumer must stop.
   */
  const advance = async (
    to: { readonly track: number; readonly sample: number },
    piece?: {
      readonly speaker: TranscriptTrackSpeaker;
      readonly lines: readonly PlacedLine[];
      readonly milliseconds: number;
      readonly modelId: string;
      readonly language: string | null;
    },
  ): Promise<TranscriptCursor | null> => {
    const effect = transcriptProgressEffect(
      database,
      {
        transcriptId: claimed.id,
        claimedAt,
        from: cursor,
        to,
        speaker: piece?.speaker ?? null,
        lines: piece?.lines ?? [],
        transcribedMilliseconds: piece?.milliseconds ?? 0,
        modelId: piece?.modelId ?? null,
        language: piece?.language ?? null,
        releaseClaim: false,
      },
      system,
    );
    try {
      await commitEffectBatch(database, effect, { now });
    } catch (caught) {
      if (
        caught instanceof GuardedWriteRefusedError &&
        caught.guard === TRANSCRIPT_PROGRESS_GUARD
      ) {
        return null;
      }
      throw caught;
    }
    return {
      track: to.track,
      sample: to.sample,
      segmentsWritten: cursor.segmentsWritten + (piece?.lines.length ?? 0),
    };
  };

  /** Lets go of the claim and sends the next window: the bounds of this one are spent. */
  const handOn = async (): Promise<TranscriptOutcome> => {
    await commitEffectBatch(
      database,
      {
        statements: [releaseTranscriptClaimStatement(database, { id: claimed.id, claimedAt })],
        outboxMessages: [],
      },
      { now },
    );
    const queue = env.MEETING_RECORDING_COMPOSE;
    if (queue === undefined)
      throw new Error("no recording queue is bound to hand the next window to");
    await queue.send(message);
    return "progressed";
  };

  while (cursor.track < tracks.length) {
    if (regions >= regionsAllowed || pieces >= piecesAllowed) return await handOn();
    const track = tracks[cursor.track]!;
    const audio = await trackAudioOf(bucket, recording, track);
    // A track part-way read whose object has gone is the fault `readStagedSamples` refuses, not a track
    // with nothing more to hear: moving on would let the settle write a first-to-last-frame gap over
    // lines already transcribed from it.
    if (audio === null && cursor.sample > 0) {
      throw new TranscriptRefusedError(
        "a staged track vanished from the bucket during the transcript",
      );
    }
    const stretch = audio === null ? null : stretchAt(audio, cursor.sample);
    if (audio === null || stretch === null) {
      // Nothing (more) of this track to hear: on to the next.
      const moved = await advance({ track: cursor.track + 1, sample: 0 });
      if (moved === null) return "nothing-to-do";
      cursor = moved;
      continue;
    }
    const stretchEnd = stretch.span.stagedFromSample + stretch.span.samples;
    const regionFrom = stretch.from;
    const regionTo = Math.min(stretchEnd, regionFrom + regionSamples);
    const final = regionTo === stretchEnd;
    const levels = await measureRegion(bucket, audio.stagingKey, regionFrom, regionTo);
    regions += 1;
    const plan = planSpeechPieces(levels, { final });

    for (const piece of plan.pieces) {
      const pieceFrom = regionFrom + framesToSamples(piece.fromFrame);
      const pieceTo = Math.min(regionTo, regionFrom + framesToSamples(piece.toFrame));
      if (pieceTo <= pieceFrom) continue;
      if (pieces >= piecesAllowed) {
        // The window's calls are spent mid-region: the next window begins at this piece.
        const moved = await advance({ track: cursor.track, sample: pieceFrom });
        if (moved === null) return "nothing-to-do";
        cursor = moved;
        return await handOn();
      }
      const samples = await readStagedSamples(bucket, audio.stagingKey, pieceFrom, pieceTo);
      const prompt = promptTail(await readLastTrackWords(database, claimed.id, track.id));
      const answer = await port.transcribe({
        audio: pieceAsWav(samples),
        firmId: message.firmId,
        ...(language === null ? {} : { language }),
        ...(prompt === null ? {} : { initialPrompt: prompt }),
      });
      pieces += 1;
      if (!answer.ok) {
        if (answer.problem?.retryable === true) {
          throw new TranscriptionUnavailableError(answer.problem.category);
        }
        throw new TranscriptRefusedError(
          `the speech model refused a piece (${answer.reason}${answer.problem === undefined ? "" : `, ${answer.problem.category}`})`,
        );
      }
      const lines = placeHeardSegments({
        piece: {
          startedMs: timelineMilliseconds(stretch.span, pieceFrom),
          endedMs: timelineMilliseconds(stretch.span, pieceTo),
        },
        text: answer.value.text,
        segments: answer.value.segments,
      });
      const milliseconds = ((pieceTo - pieceFrom) * 1000) / PCM_SAMPLE_RATE;
      // Only a piece long enough names the transcript's language; a short one's guess is not recorded.
      const named =
        language === null && milliseconds >= LANGUAGE_DETECTION_MINIMUM_MILLISECONDS
          ? answer.value.language
          : null;
      const moved = await advance(
        { track: cursor.track, sample: pieceTo },
        {
          speaker: speakerOf(track),
          lines,
          milliseconds,
          modelId: answer.value.modelId,
          language: named,
        },
      );
      if (moved === null) return "nothing-to-do";
      cursor = moved;
      language = language ?? named;
    }

    const resume = final ? stretchEnd : regionFrom + framesToSamples(plan.resumeFrame);
    if (resume > cursor.sample) {
      const moved = await advance({ track: cursor.track, sample: resume });
      if (moved === null) return "nothing-to-do";
      cursor = moved;
    }
  }

  return await settleTranscript(env, database, {
    firmId: message.firmId,
    transcriptId: claimed.id,
    recording,
    tracks,
    claimedAt,
    bucket,
    bucketName,
  });
}

/**
 * EVERY TRACK IS DONE: the transcript is assembled and its filing begun (once), the document rendered
 * from the rows and written at the key the pipeline minted, the upload completed in one batch with the
 * transcript's `ready`, ingest driven, and the staged tracks released.
 */
async function settleTranscript(
  env: Bindings,
  database: ProxyBatchDatabase,
  input: {
    readonly firmId: MeetingTranscriptMessage["firmId"];
    readonly transcriptId: MeetingTranscriptId;
    readonly recording: MeetingRecordingRow;
    readonly tracks: readonly MeetingRecordingTrackRow[];
    readonly claimedAt: string;
    readonly bucket: R2Bucket;
    readonly bucketName: string;
  },
): Promise<TranscriptOutcome> {
  const now = () => new Date().toISOString();
  const system = { clock: { now }, randomSource: cryptoRandomSource };
  const { recording, bucket } = input;
  const transcript = await readTranscriptById(database, input.transcriptId);
  if (transcript?.state !== "pending" || transcript.claimed_at !== input.claimedAt) {
    return "nothing-to-do";
  }
  const facts = await readRecordingFilingFacts(database, recording.id);
  if (facts === undefined) throw new TranscriptRefusedError("the recording's event is gone");
  const actorUserId = recording.started_by_user_id;

  let sessionId = transcript.upload_session_id as UploadSessionId | null;
  if (sessionId === null) {
    // WHERE THE TRANSCRIPT COULD NOT HEAR: a lost track, one the ceiling refused, and one that carried
    // audio the transcript found no object for — and, when nothing at all was heard, the whole of it.
    const audioMissing = new Set<MeetingRecordingTrackId>();
    for (const track of input.tracks) {
      // A LOST track is asked too: one whose audio is missing was not heard while it was captured, and
      // a gap from its last frame alone would leave that span unsaid.
      if (track.first_frame_at === null) continue;
      if (track.staging_key === null || (await bucket.head(track.staging_key)) === null) {
        audioMissing.add(track.id);
      }
    }
    const gaps = gapsForTracks(recording, input.tracks, audioMissing);
    if (!(await hasTranscriptSpeech(database, transcript.id))) {
      gaps.push(wholeRecordingGap(recording));
    }
    const initiated = await initiateUpload(
      database,
      {
        matterId: recording.matter_id,
        name: meetingDocumentFileName("Meeting transcript", "vtt", facts, recording.started_at),
        // Not declared: the document is rendered from the rows, and a filing resumed after a crash
        // renders it again — a speaker renamed in between changes its length, and a declared size the
        // bytes then disagreed with would be quarantined for it.
        declaredSize: null,
        declaredContentType: "text/vtt",
        uploadedBy: actorUserId,
        mode: "put",
        uploadKind: "interactive",
        expiresAt: new Date(
          Date.now() + TRANSCRIPT_UPLOAD_SESSION_LIFETIME_MILLISECONDS,
        ).toISOString(),
      },
      { clock: { now }, actorUserId, randomSource: cryptoRandomSource },
    );
    try {
      await commitEffectBatch(
        database,
        {
          statements: [
            ...initiated.effect.statements,
            ...assembleTranscriptStatements(
              database,
              {
                transcript,
                claimedAt: input.claimedAt,
                gaps,
                uploadSessionId: initiated.uploadSessionId,
              },
              system,
            ),
          ],
          outboxMessages: initiated.effect.outboxMessages,
        },
        { now },
      );
    } catch (caught) {
      if (caught instanceof GuardedWriteRefusedError && caught.guard === TRANSCRIPT_FILING_GUARD) {
        return "nothing-to-do";
      }
      throw caught;
    }
    sessionId = initiated.uploadSessionId as UploadSessionId;
  }

  const target = await readComposeTarget(database, sessionId);
  if (target === undefined)
    throw new TranscriptRefusedError("the transcript's upload session is gone");
  if (target.status !== "open") {
    throw new TranscriptRefusedError("the transcript's upload session is no longer open");
  }

  const document = await renderTranscriptDocument(database, transcript.id, facts.title);
  const dimensions = matterScopedObjectDimensions({
    objectClass: "working-document",
    matterId: recording.matter_id,
  });
  await bucket.put(target.r2Key, document.bytes, {
    customMetadata: dimensions,
    httpMetadata: { contentType: "text/vtt" },
  });

  // THE SUMMARY IS BEGUN WITH THE READY, so a transcript is never ready without one: whether it is then
  // written, and by which model, is the summary consumer's decision when it runs.
  const summaryBegun = beginSummaryStatements(
    database,
    { transcript, requestedByUserId: null },
    system,
  );

  let completed: Awaited<ReturnType<typeof completeUploadSession>>;
  try {
    completed = await completeUploadSession(database, target.sessionId, {
      clock: { now },
      actorUserId,
      randomSource: cryptoRandomSource,
    });
  } catch (caught) {
    // A session the pipeline will no longer complete — expired by the stale-upload sweep in between —
    // cannot be aborted by the failure either, so nothing would ever name the bytes just written: they
    // are let go of here, before the refusal fails the transcript.
    if (caught instanceof FileManagerValidationError) await bucket.delete(target.r2Key);
    throw caught;
  }
  try {
    await commitEffectBatch(
      database,
      {
        statements: [
          ...completed.effect.statements,
          ...readyTranscriptStatements(
            database,
            {
              transcript,
              fileId: target.fileId,
              fileVersionId: target.fileVersionId,
              segmentCount: document.segmentCount,
              wordCount: document.wordCount,
            },
            system,
          ),
          ...summaryBegun.statements,
        ],
        outboxMessages: completed.effect.outboxMessages,
      },
      { now },
    );
  } catch (caught) {
    // The sweep failed the transcript between this consumer's read and its filing: the failure aborted
    // the session, and the bytes just written at its key are let go of with it.
    if (caught instanceof GuardedWriteRefusedError && caught.guard === TRANSCRIPT_READY_GUARD) {
      await bucket.delete(target.r2Key);
      return "nothing-to-do";
    }
    throw caught;
  }

  // SETTLED, SO RELEASED — before ingest is driven, because a retry of this message reads `ready` and does
  // nothing, so anything after a throw here would wait for the sweep's day of grace.
  await releaseRecordingStaging(env, database, recording.id, bucket);
  // Drive ingest exactly as for the audio: sniff, scan, hash, then commit or quarantine. Best effort:
  // the document is filed, a redelivery could not drive it again, and a deployment's own object-created
  // event drives ingest without this message; the failure is recorded.
  try {
    await enqueueDevIngestEvent(env, input.bucketName, target.r2Key, document.bytes.byteLength);
  } catch (caught) {
    recordRealtimeFailure(realtimeLoggerFor(env), "meetings.transcript.ingest-hand-on", caught);
  }
  // The summary's first message, best effort for the same reason: a redelivery of this message reads
  // `ready` and does nothing, so a send that throws is recorded and leaves the summary pending — where a
  // member's request to run it again sends it on.
  const summaryMessage: MeetingSummaryMessage = {
    kind: "meeting-summary",
    firmId: input.firmId,
    meetingId: recording.meeting_id,
    recordingId: recording.id,
    transcriptId: transcript.id,
    summaryId: summaryBegun.summaryId,
  };
  try {
    const queue = env.MEETING_RECORDING_COMPOSE;
    if (queue === undefined) throw new Error("no recording queue is bound to send the summary to");
    await queue.send(summaryMessage);
  } catch (caught) {
    recordRealtimeFailure(realtimeLoggerFor(env), "meetings.transcript.summary-hand-on", caught);
  }
  return "ready";
}

/**
 * THE DOCUMENT, rendered from the ready-to-be-read rows a page at a time: the meeting's title in a NOTE
 * and one cue per line in reading order with the speaker's name, plus the counts the row records.
 */
async function renderTranscriptDocument(
  database: ProxyBatchDatabase,
  transcriptId: MeetingTranscriptId,
  title: string,
): Promise<{
  readonly bytes: Uint8Array;
  readonly segmentCount: number;
  readonly wordCount: number;
}> {
  const cues: WebVttCue[] = [];
  let wordCount = 0;
  let afterOrdinal = -1;
  for (;;) {
    const page = await listTranscriptSegments(database, transcriptId, {
      afterOrdinal,
      limit: RENDER_PAGE_SIZE,
    });
    for (const row of page.slice(0, RENDER_PAGE_SIZE)) {
      cues.push({
        kind: row.kind,
        startedMs: row.started_ms,
        endedMs: row.ended_ms,
        text: row.text,
        speakerName: row.display_name,
      });
      wordCount += countWords(row.text);
      afterOrdinal = row.ordinal;
    }
    if (page.length <= RENDER_PAGE_SIZE) break;
  }
  return {
    bytes: new TextEncoder().encode(renderWebVtt({ title, cues })),
    segmentCount: cues.length,
    wordCount,
  };
}

/**
 * THE STAGED TRACKS GO, now that the transcript has settled: they were kept past the filing only because
 * the transcript reads them. Objects first, rows second — a row that outlives its object names something
 * already gone, which the sweep clears; an object that outlived its row would be bytes nothing names. A
 * release that fails is recorded and left to the sweep.
 */
async function releaseRecordingStaging(
  env: Bindings,
  database: ProxyBatchDatabase,
  recordingId: MeetingRecordingRow["id"],
  bucket: R2Bucket,
): Promise<void> {
  try {
    const staged = await listStagedTracksOfRecording(database, recordingId);
    if (staged.length === 0) return;
    await bucket.delete(staged.map((track) => track.stagingKey));
    await commitEffectBatch(
      database,
      {
        statements: clearStagingKeysStatements(
          database,
          staged.map((track) => track.id),
          new Date().toISOString(),
        ),
        outboxMessages: [],
      },
      { now: () => new Date().toISOString() },
    );
  } catch (caught) {
    recordRealtimeFailure(realtimeLoggerFor(env), "meetings.transcript.release-staging", caught);
  }
}

/** How a failure ends: whether the staged tracks go with it, and, for the sweep, what it judged stalled. */
export interface TranscriptFailureOptions {
  // True for a refusal no retry can change; false for a failure a later attempt could get past (a model
  // that stayed unavailable, a transcript the sweep found stalled), which keeps the per-speaker audio for
  // the seven-day retention a failed compose's staging has.
  readonly releaseStaging: boolean;
  // The sweep's reading of a stalled transcript — its last progress and its claim — so a consumer that
  // claimed or moved it since is not failed under.
  readonly untouched?: { readonly progressAt: string | null; readonly claimedAt: string | null };
  readonly clock?: { now(): string };
}

/**
 * FAILS A TRANSCRIPT AND LETS GO OF WHAT IT MUST — the consumer's own refusals, a model that would not
 * answer, and the sweep's failure of a transcript that stopped moving, alike. In ONE batch: the
 * transcript `failed` with its Error ID (guarded on `pending`, on the upload session read here, and for
 * the sweep on what it judged stalled) and, when its filing had begun, the upload session aborted and the
 * pending version abandoned; then the object at the session's key deleted, and — only for a failure no
 * retry can change — the recording's staged tracks released. A failure that lost the race to a filing, a
 * consumer or another failure changes nothing and lets go of nothing. Answers whether this call is the
 * one that failed it. The filed audio is never touched.
 */
export async function failMeetingTranscript(
  env: Bindings,
  database: ProxyBatchDatabase,
  transcriptId: MeetingTranscriptId,
  failureErrorId: string,
  bucketFor: () => Promise<R2Bucket>,
  options: TranscriptFailureOptions,
): Promise<boolean> {
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  const transcript = await readTranscriptById(database, transcriptId);
  if (transcript === undefined || transcript.state !== "pending") return false;
  if (
    options.untouched !== undefined &&
    (transcript.progress_at !== options.untouched.progressAt ||
      transcript.claimed_at !== options.untouched.claimedAt)
  ) {
    return false;
  }
  const system = { clock, randomSource: cryptoRandomSource };
  const statements: EffectStatement[] = [
    ...failTranscriptEffect(
      database,
      {
        transcript,
        failureErrorId,
        ...(options.untouched === undefined ? {} : { untouched: options.untouched }),
      },
      system,
    ).statements,
  ];
  let documentKey: string | null = null;
  if (transcript.upload_session_id !== null) {
    try {
      const aborted = await abortUploadSession(
        database,
        transcript.upload_session_id as UploadSessionId,
        { ...system, actorUserId: null },
      );
      statements.push(...aborted.effect.statements);
      documentKey = aborted.r2Key;
    } catch (caught) {
      // A session no longer open — expired by the stale-upload sweep — has nothing left to let go of.
      if (!(caught instanceof FileManagerValidationError)) throw caught;
    }
  }
  try {
    await commitEffectBatch(
      database,
      { statements, outboxMessages: [] },
      { now: () => clock.now() },
    );
  } catch (caught) {
    if (caught instanceof GuardedWriteRefusedError && caught.guard === TRANSCRIPT_FAIL_GUARD) {
      return false;
    }
    throw caught;
  }
  let bucket: R2Bucket | null = null;
  try {
    bucket = await bucketFor();
    if (documentKey !== null) await bucket.delete(documentKey);
  } catch (caught) {
    recordRealtimeFailure(realtimeLoggerFor(env), "meetings.transcript.release", caught);
  }
  if (bucket !== null && options.releaseStaging) {
    await releaseRecordingStaging(env, database, transcript.recording_id, bucket);
  }
  return true;
}
