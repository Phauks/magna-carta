import { zonedReading } from "@magna-carta/civil-time/time-zone";
import {
  commitEffectBatch,
  GuardedWriteRefusedError,
  type EffectStatement,
} from "@magna-carta/data-access/effect-batch";
import { completeUploadSession, initiateUpload } from "@magna-carta/file-manager/file-service";
import { setUploadSessionR2UploadIdStatement } from "@magna-carta/file-manager/file-statements";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { UploadSessionId } from "@magna-carta/identifiers/types";
import { PCM_BYTES_PER_SAMPLE, PCM_SAMPLE_RATE } from "@magna-carta/meetings/pcm-frame";
import {
  PcmMixAccumulator,
  samplesFromPcmBytes,
  writePcmBytes,
} from "@magna-carta/meetings/pcm-mix";
import {
  beginComposeStatements,
  COMPOSE_BEGIN_GUARD,
  COMPOSE_PROGRESS_GUARD,
  composeProgressEffect,
  failComposeEffect,
  FILE_RECORDING_GUARD,
  fileRecordingStatements,
} from "@magna-carta/meetings/recording-service";
import {
  clearStagingKeysStatement,
  listRecordingTracks,
  readComposeTarget,
  readRecordingById,
  readRecordingFilingFacts,
} from "@magna-carta/meetings/recording-statements";
import type {
  MeetingRecordingComposePart,
  MeetingRecordingRow,
} from "@magna-carta/meetings/recording-types";
import { WAV_HEADER_BYTES, WAV_MAXIMUM_DATA_BYTES, wavHeader } from "@magna-carta/meetings/wav";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor } from "../firm-database/firm-database-proxy.ts";
import { resolveFirmBucketForFirmId } from "../files/firm-bucket.ts";
import { enqueueDevIngestEvent } from "../files/presign.ts";
import type { MeetingRecordingComposeMessage } from "./meeting-recorder.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "./sfu/realtime-failure.ts";

// THE COMPOSE STEP: a stopped recording's staged tracks mixed into ONE mono WAV and filed into the
// matter through the same untrusted-file pipeline every uploaded document goes through.
//
// A QUEUE CONSUMER, because mixing an hour of audio is exactly the heavy work that must stay off a
// request handler and out of the recorder's socket callbacks. And A WINDOW AT A TIME: one message
// composes a bounded span — ten one-minute parts — appends them to the composite's multipart upload,
// records the cursor on the recording's row, and sends the next message. So a four-hour deposition is
// twenty-four short invocations rather than one that outruns a consumer's budget, and a failure costs
// one window rather than the whole mix.
//
// THE LAYOUT IS FIXED BEFORE THE FIRST SAMPLE. The staged tracks are complete objects of known size
// by the time a recording is handed on (the recorder completes every upload before it lets go), and
// each lands on the composite at its first frame's offset from the recording's start — so the
// composite's length, and therefore the WAV header, is known up front. The header goes at the head of
// the first part; every part is one size and only the last is shorter, which is what R2 requires.
//
// FILING IS THE PIPELINE, UNCHANGED, on the email attachment's precedent: `initiateUpload` (multipart,
// the recording's matter, the interactive lane, a name made of the event's title and the recording's
// start in the event's own zone, `audio/wav`), the composite written at the key it minted,
// `completeUploadSession`, then the ingest queue — so the recording is sniffed, scanned, hashed and
// status-gated like every other document and nothing about the File Manager changes for it.
//
// MEMORY PER INVOCATION IS BOUNDED, and does not grow with the recording's length or its track count.
// Buffers are allocated once per invocation and reused for every part:
//
//   the sums of one part's samples        Int32Array, 2,880,000 samples x 4 bytes  =  11.52 MB
//   the mixed part, clamped                Int16Array, 2,880,000 samples x 2 bytes  =   5.76 MB
//   the part's bytes                       5,760,000 bytes                          =   5.76 MB
//   ONE track's span of the part, read     up to 5,760,000 bytes                    =   5.76 MB
//   that span as samples                   up to 2,880,000 samples x 2 bytes        =   5.76 MB
//   the part as the binding sends it       counted as a second copy                 =   5.76 MB
//                                                                                    ----------
//                                                                                     40.32 MB
//
// Tracks are read one at a time and let go of before the next, and parts are uploaded one at a time,
// so eleven tracks or one, ten minutes or twelve hours, the peak is the same forty megabytes — under a
// third of an isolate's 128 MB.
//
// A recording never claims more than it captured: a track that was LOST contributes its audio up to the
// loss and silence after it, a track that began late lands at its own offset with silence before it,
// and a track with nothing staged contributes nothing.

/** One part of the composite: sixty seconds of mono 48 kHz 16-bit audio, which is above R2's 5 MiB. */
export const COMPOSE_PART_BYTES = 60 * PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE;

/**
 * HOW MUCH ONE INVOCATION COMPOSES: ten parts, ten minutes of audio. Ten minutes is about two seconds
 * of mixing per track and a few seconds of reading and writing — well inside a queue consumer's budget
 * with room for a slow bucket — while keeping the number of hand-offs for the longest recording (twelve
 * hours) at seventy-two.
 */
export const COMPOSE_PARTS_PER_INVOCATION = 10;

/** The samples one part holds at most — the size every reused buffer is allocated at. */
const PART_SAMPLES = COMPOSE_PART_BYTES / PCM_BYTES_PER_SAMPLE;

/** One staged track as the composite places it. */
interface PlacedTrack {
  readonly stagingKey: string;
  // The composite sample the track's first staged sample lands on.
  readonly offset: number;
  readonly samples: number;
}

/** What one invocation is allowed to change, for a test that composes across a window boundary. */
export interface ComposeOptions {
  readonly partsPerInvocation?: number;
}

/** A refusal the compose cannot retry its way past: the recording is failed with an Error ID. */
class ComposeRefusedError extends Error {}

/** The queue consumer: one window of one recording per message. */
export async function meetingRecordingComposeQueue(
  batch: MessageBatch<MeetingRecordingComposeMessage>,
  env: Bindings,
  options: ComposeOptions = {},
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await composeWindow(env, message.body, options);
      message.ack();
    } catch (caught) {
      // Recorded through the standard pipeline and retried; a compose that keeps failing is
      // dead-lettered, and the sweep hands a recording with no progress on again or fails it.
      recordRealtimeFailure(realtimeLoggerFor(env), "meetings.recording.compose", caught);
      message.retry();
    }
  }
}

/**
 * Composes the next window of one recording — beginning the composite first if nothing has, and
 * filing it once the last part is up. Throws only for a failure worth retrying; a recording that can
 * never be composed is failed in the record and the message is done.
 */
export async function composeWindow(
  env: Bindings,
  message: MeetingRecordingComposeMessage,
  options: ComposeOptions = {},
): Promise<"progressed" | "filed" | "failed" | "nothing-to-do"> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, message.firmId);
  const recording = await readRecordingById(database, message.recordingId);
  // Filed, failed or abandoned already — by an earlier delivery, or a sweep — or not this firm's.
  if (recording === undefined || recording.state !== "composing") return "nothing-to-do";
  // THE RECORDER HAS NOT LET GO YET: it writes what was captured as the last thing it does before it
  // hands a recording on, and staged tracks it has not completed are not objects anything can read.
  // The recorder sends its own message once it has; the sweep counts this toward a stall.
  if (recording.captured_seconds === null) return "nothing-to-do";

  const now = () => new Date().toISOString();
  const system = { clock: { now }, randomSource: cryptoRandomSource };
  try {
    const { bucket, bucketName } = await resolveFirmBucketForFirmId(env, message.firmId);
    const placed = await placeTracks(bucket, recording, database);
    const dataBytes = composedSamples(placed) * PCM_BYTES_PER_SAMPLE;
    if (dataBytes === 0) {
      throw new ComposeRefusedError("none of the recording's staged tracks holds any audio");
    }
    if (dataBytes > WAV_MAXIMUM_DATA_BYTES) {
      throw new ComposeRefusedError("the composed recording is longer than a WAV can describe");
    }
    const totalBytes = WAV_HEADER_BYTES + dataBytes;

    let sessionId = recording.compose_upload_session_id;
    if (sessionId === null) {
      sessionId = await beginComposite(database, bucket, recording, totalBytes);
      if (sessionId === null) return "nothing-to-do";
    }
    const target = await readComposeTarget(database, sessionId as UploadSessionId);
    if (target === undefined || target.r2UploadId === null) {
      throw new ComposeRefusedError("the composite's upload session is gone");
    }
    const upload = bucket.resumeMultipartUpload(target.r2Key, target.r2UploadId);

    const partCount = Math.ceil(totalBytes / COMPOSE_PART_BYTES);
    const parts: MeetingRecordingComposePart[] =
      recording.compose_parts === null
        ? []
        : (JSON.parse(recording.compose_parts) as MeetingRecordingComposePart[]);
    const fromPartsDone = recording.compose_parts_done;
    if (parts.length !== fromPartsDone) {
      throw new ComposeRefusedError("the composite's recorded parts do not match its cursor");
    }

    if (fromPartsDone < partCount) {
      const perInvocation = options.partsPerInvocation ?? COMPOSE_PARTS_PER_INVOCATION;
      const untilPart = Math.min(partCount, fromPartsDone + perInvocation);
      const buffers = {
        sums: new Int32Array(PART_SAMPLES),
        mixed: new Int16Array(PART_SAMPLES),
        part: new Uint8Array(COMPOSE_PART_BYTES),
      };
      for (let partIndex = fromPartsDone; partIndex < untilPart; partIndex += 1) {
        const bytes = await composePart(bucket, placed, partIndex, totalBytes, buffers);
        const uploaded = await upload.uploadPart(partIndex + 1, bytes);
        parts.push({ partNumber: uploaded.partNumber, etag: uploaded.etag });
      }
      try {
        await commitEffectBatch(
          database,
          composeProgressEffect(
            database,
            { recordingId: recording.id, fromPartsDone, parts },
            system,
          ),
          { now },
        );
      } catch (caught) {
        // Another delivery of this message moved the cursor first; it carries on, this one stops.
        if (caught instanceof GuardedWriteRefusedError && caught.guard === COMPOSE_PROGRESS_GUARD) {
          return "nothing-to-do";
        }
        throw caught;
      }
      if (untilPart < partCount) {
        const queue = env.MEETING_RECORDING_COMPOSE;
        if (queue === undefined)
          throw new Error("no compose queue is bound to hand the next window to");
        await queue.send(message);
        return "progressed";
      }
    }

    // EVERY PART IS UP: complete the composite — unless an earlier delivery already did and was cut off
    // before it could file it, in which case the object is there, whole, at its key.
    const existing = await bucket.head(target.r2Key);
    if (existing === null || existing.size !== totalBytes) {
      await upload.complete(
        parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
      );
    }
    return await fileComposite(env, database, recording, {
      bucket,
      bucketName,
      target,
      totalBytes,
    });
  } catch (caught) {
    if (
      !(caught instanceof ComposeRefusedError) &&
      !(caught instanceof FileManagerValidationError)
    ) {
      throw caught;
    }
    // A RECORDING THAT CAN NEVER BE COMPOSED: failed in the record with an Error ID. The message the
    // pipeline recorded is a fixed sentence and a code — never the document's name, which is the
    // event's title.
    const failureErrorId = recordRealtimeFailure(
      realtimeLoggerFor(env),
      "meetings.recording.compose-refused",
      new Error(
        caught instanceof FileManagerValidationError
          ? `the upload pipeline refused the composed recording (${caught.code})`
          : caught.message,
      ),
    );
    await commitEffectBatch(
      database,
      failComposeEffect(database, { recording, failureErrorId }, system),
      { now },
    );
    return "failed";
  }
}

/**
 * Where each staged track lands on the composite: its first frame's offset from the recording's start,
 * and as many samples as its staged object holds. A track whose object is not there — nothing was
 * staged, or the recorder could not complete its upload — contributes nothing.
 */
async function placeTracks(
  bucket: R2Bucket,
  recording: MeetingRecordingRow,
  database: ReturnType<typeof firmDatabaseFor>,
): Promise<PlacedTrack[]> {
  const startedAt = Date.parse(recording.started_at);
  const placed: PlacedTrack[] = [];
  for (const track of await listRecordingTracks(database, recording.id)) {
    if (track.staging_key === null || track.first_frame_at === null) continue;
    const object = await bucket.head(track.staging_key);
    if (object === null) continue;
    const samples = Math.floor(object.size / PCM_BYTES_PER_SAMPLE);
    if (samples === 0) continue;
    const offset = Math.max(
      0,
      Math.round(((Date.parse(track.first_frame_at) - startedAt) / 1000) * PCM_SAMPLE_RATE),
    );
    placed.push({ stagingKey: track.staging_key, offset, samples });
  }
  return placed;
}

/** The composite's length in samples: as far as any track reaches. */
function composedSamples(placed: readonly PlacedTrack[]): number {
  return placed.reduce((furthest, track) => Math.max(furthest, track.offset + track.samples), 0);
}

/**
 * ONE PART OF THE COMPOSITE: the header at the head of the first, then this part's samples mixed from
 * every track that reaches them. Answers a view of `buffers.part` for a whole part, or a fresh array for
 * the short last one.
 */
async function composePart(
  bucket: R2Bucket,
  placed: readonly PlacedTrack[],
  partIndex: number,
  totalBytes: number,
  buffers: { readonly sums: Int32Array; readonly mixed: Int16Array; readonly part: Uint8Array },
): Promise<Uint8Array> {
  const byteStart = partIndex * COMPOSE_PART_BYTES;
  const byteEnd = Math.min(totalBytes, byteStart + COMPOSE_PART_BYTES);
  const bytes =
    byteEnd - byteStart === COMPOSE_PART_BYTES ? buffers.part : new Uint8Array(byteEnd - byteStart);
  let writeAt = 0;
  if (partIndex === 0) {
    bytes.set(wavHeader(totalBytes - WAV_HEADER_BYTES), 0);
    writeAt = WAV_HEADER_BYTES;
  }
  // Both ends are even byte offsets past the header, so they are whole samples.
  const windowStart = (byteStart + writeAt - WAV_HEADER_BYTES) / PCM_BYTES_PER_SAMPLE;
  const windowLength = (byteEnd - byteStart - writeAt) / PCM_BYTES_PER_SAMPLE;
  const mix = new PcmMixAccumulator(windowLength, buffers.sums);
  for (const track of placed) {
    const from = Math.max(windowStart, track.offset);
    const to = Math.min(windowStart + windowLength, track.offset + track.samples);
    if (to <= from) continue;
    const span = await bucket.get(track.stagingKey, {
      range: {
        offset: (from - track.offset) * PCM_BYTES_PER_SAMPLE,
        length: (to - from) * PCM_BYTES_PER_SAMPLE,
      },
    });
    // An object that went away under the compose is a fault worth retrying, not silence.
    if (span === null) throw new Error("a staged track could not be read");
    mix.add({
      samples: samplesFromPcmBytes(new Uint8Array(await span.arrayBuffer())),
      offset: from - windowStart,
    });
  }
  writePcmBytes(mix.finish(buffers.mixed), bytes, writeAt);
  return bytes;
}

/**
 * THE COMPOSITE'S UPLOAD SESSION, begun through the pipeline: a pending version on the matter, its key,
 * and a multipart upload at that key — recorded on the recording in the SAME batch as the session, so a
 * second invocation beginning the same recording is refused whole and lets go of its own upload.
 * Answers the session, or null when another invocation began first.
 *
 * The member who started the recording is the one the pipeline records as uploading it: the recording
 * is theirs, and the document is what their pressing Record produced.
 */
async function beginComposite(
  database: ReturnType<typeof firmDatabaseFor>,
  bucket: R2Bucket,
  recording: MeetingRecordingRow,
  totalBytes: number,
): Promise<string | null> {
  const now = () => new Date().toISOString();
  const facts = await readRecordingFilingFacts(database, recording.id);
  if (facts === undefined) throw new ComposeRefusedError("the recording's event is gone");
  const actorUserId = recording.started_by_user_id;
  const initiated = await initiateUpload(
    database,
    {
      matterId: recording.matter_id,
      name: recordingFileName(facts, recording.started_at),
      declaredSize: totalBytes,
      declaredContentType: "audio/wav",
      uploadedBy: actorUserId,
      mode: "multipart",
      uploadKind: "interactive",
    },
    { clock: { now }, actorUserId, randomSource: cryptoRandomSource },
  );
  // Stamped at create with the dimensions the pipeline minted for the document, because a multipart
  // object's metadata is fixed there and nowhere else.
  const upload = await bucket.createMultipartUpload(initiated.r2Key, {
    customMetadata: initiated.dimensions,
    httpMetadata: { contentType: "audio/wav" },
  });
  const statements: EffectStatement[] = [
    ...initiated.effect.statements,
    setUploadSessionR2UploadIdStatement(
      database,
      initiated.uploadSessionId as UploadSessionId,
      upload.uploadId,
    ),
    ...beginComposeStatements(
      database,
      { recordingId: recording.id, uploadSessionId: initiated.uploadSessionId },
      { clock: { now }, randomSource: cryptoRandomSource },
    ),
  ];
  try {
    await commitEffectBatch(database, { statements, outboxMessages: [] }, { now });
  } catch (caught) {
    // Whatever stopped the batch, nothing it would have recorded exists — so nothing names the upload
    // just opened, and it is let go of rather than left to hold its parts.
    try {
      await upload.abort();
    } catch {
      // The abandoned-upload reclaim behind every multipart upload is the backstop.
    }
    if (caught instanceof GuardedWriteRefusedError && caught.guard === COMPOSE_BEGIN_GUARD) {
      return null;
    }
    throw caught;
  }
  return initiated.uploadSessionId;
}

/**
 * THE FILED DOCUMENT'S NAME: `Meeting recording — <event title> — <YYYY-MM-DD HH:mm>.wav`, the start
 * read in the event's own zone — the wall clock the people in the meeting were looking at. A zone the
 * runtime cannot resolve is read in UTC and says so, rather than failing the filing over a label.
 */
export function recordingFileName(
  facts: { readonly title: string; readonly timeZone: string },
  startedAt: string,
): string {
  const instant = Date.parse(startedAt);
  let reading: { readonly civilDate: string; readonly wallClockTime: string };
  let zoneNote = "";
  try {
    reading = zonedReading(instant, facts.timeZone);
  } catch {
    reading = zonedReading(instant, "UTC");
    zoneNote = " UTC";
  }
  return `Meeting recording — ${facts.title} — ${reading.civilDate} ${reading.wallClockTime}${zoneNote}.wav`;
}

/**
 * FILES THE COMPLETED COMPOSITE: the upload session completed and the recording `filed` — in ONE batch,
 * so the record never says filed over a document the pipeline does not have — then the ingest queue,
 * then the staged tracks deleted and the rows told so.
 */
async function fileComposite(
  env: Bindings,
  database: ReturnType<typeof firmDatabaseFor>,
  recording: MeetingRecordingRow,
  composite: {
    readonly bucket: R2Bucket;
    readonly bucketName: string;
    readonly target: NonNullable<Awaited<ReturnType<typeof readComposeTarget>>>;
    readonly totalBytes: number;
  },
): Promise<"filed" | "nothing-to-do"> {
  const now = () => new Date().toISOString();
  const actorUserId = recording.started_by_user_id;
  const completed = await completeUploadSession(database, composite.target.sessionId, {
    clock: { now },
    actorUserId,
    randomSource: cryptoRandomSource,
  });
  try {
    await commitEffectBatch(
      database,
      {
        statements: [
          ...completed.effect.statements,
          ...fileRecordingStatements(
            database,
            {
              recording,
              fileId: composite.target.fileId,
              fileVersionId: composite.target.fileVersionId,
            },
            { clock: { now }, randomSource: cryptoRandomSource },
          ),
        ],
        outboxMessages: completed.effect.outboxMessages,
      },
      { now },
    );
  } catch (caught) {
    // The recording moved on — a sweep failed it — between this invocation's read and its filing.
    // The record keeps that outcome; the composite stays an unfinished upload nothing names.
    if (caught instanceof GuardedWriteRefusedError && caught.guard === FILE_RECORDING_GUARD) {
      return "nothing-to-do";
    }
    throw caught;
  }

  // Drive ingest: the bytes were written server-side, so the object-created event the ingest consumer
  // processes is sent here — sniff, scan, hash, then commit or quarantine. Idempotent at the consumer.
  await enqueueDevIngestEvent(
    env,
    composite.bucketName,
    composite.target.r2Key,
    composite.totalBytes,
  );

  // The transcript slice enqueues `meeting-transcript` here, once the recording is on the matter.

  // THE STAGED TRACKS GO: the composite is the record now. A delete that fails leaves the row naming
  // the object, and the sweep takes it on a later pass.
  const tracks = await listRecordingTracks(database, recording.id);
  const staged = tracks.flatMap((track) =>
    track.staging_key === null ? [] : [{ id: track.id, key: track.staging_key }],
  );
  if (staged.length > 0) {
    try {
      await composite.bucket.delete(staged.map((track) => track.key));
      await commitEffectBatch(
        database,
        {
          statements: [
            clearStagingKeysStatement(
              database,
              staged.map((track) => track.id),
              now(),
            ),
          ],
          outboxMessages: [],
        },
        { now },
      );
    } catch (caught) {
      recordRealtimeFailure(realtimeLoggerFor(env), "meetings.recording.delete-staging", caught);
    }
  }
  return "filed";
}
