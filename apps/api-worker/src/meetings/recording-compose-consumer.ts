import { zonedReading } from "@magna-carta/civil-time/time-zone";
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
import { setUploadSessionR2UploadIdStatement } from "@magna-carta/file-manager/file-statements";
import { FileManagerValidationError } from "@magna-carta/file-manager/validation";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type {
  MeetingRecordingId,
  MeetingRecordingTrackId,
  UploadSessionId,
} from "@magna-carta/identifiers/types";
import { PCM_BYTES_PER_SAMPLE, PCM_SAMPLE_RATE } from "@magna-carta/meetings/pcm-frame";
import {
  PcmMixAccumulator,
  samplesFromPcmBytes,
  writePcmBytes,
} from "@magna-carta/meetings/pcm-mix";
import {
  beginComposeStatements,
  claimComposeWindowEffect,
  COMPOSE_BEGIN_GUARD,
  COMPOSE_CLAIM_GUARD,
  COMPOSE_PROGRESS_GUARD,
  composeProgressEffect,
  FAIL_COMPOSE_GUARD,
  failComposeEffect,
  FILE_RECORDING_GUARD,
  fileRecordingStatements,
} from "@magna-carta/meetings/recording-service";
import {
  clearStagingKeysStatements,
  listRecordingTracks,
  readComposeTarget,
  readRecordingById,
  readRecordingFilingFacts,
  recordFaultOnTheWayStatement,
  releaseComposeClaimStatement,
} from "@magna-carta/meetings/recording-statements";
import {
  parseTrackSegments,
  placeTrackSegments,
  type MeetingRecordingComposePart,
  type MeetingRecordingRow,
} from "@magna-carta/meetings/recording-types";
import { WAV_HEADER_BYTES, WAV_MAXIMUM_DATA_BYTES, wavHeader } from "@magna-carta/meetings/wav";
import type { Bindings } from "../app.ts";
import { firmDatabaseFor, type ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
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
// each STRETCH of each lands on the composite at its own instant's offset from the recording's start
// (`placeTrackSegments` — a participant who left and came back is two stretches of one object, and the
// silence that closed the first is never read as time) — so the composite's length, and therefore the
// WAV header, is known up front. The header goes at the head of the first part; every part is one size
// and only the last is shorter, which is what R2 requires. Each window lays the tracks out again from
// the bucket, and a layout whose length differs from the size the upload session was declared at when
// the compose began is REFUSED: the header already written says that size, and a file whose header and
// data disagree is one ingest quarantines. A staged object missing when the compose BEGINS is composed
// without, with an Error ID on the row saying so; one that vanishes once the compose has begun fails the
// recording, because the windows already written placed it.
//
// ONE CONSUMER PER WINDOW. A window is CLAIMED on the recording's row before a byte is read — a lease
// as long as a consumer can run, released when the window's progress is recorded — so a second delivery
// of one message, or a sweep's hand-on racing the queue's own, stops at the claim rather than writing
// the same parts of the composite beside the first. The cursor guard behind it still settles any two
// that got past it.
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
// and a track with nothing staged contributes nothing. When the filed composite is shorter than what the
// recorder counted — a staged object was missing — the row's captured length is brought down to it.
//
// A COMPOSE THAT CANNOT FINISH LEAVES NOTHING BEHIND: the recording is failed in the same batch as its
// upload session is aborted and its pending version abandoned, and the multipart upload at the key is
// aborted (and any object completed there deleted) once that has committed — so a failed recording
// never holds gigabytes of parts nothing will ever name. The session is opened with an expiry as well,
// the stale-upload sweep's backstop for a compose that dies without failing.

/** One part of the composite: sixty seconds of mono 48 kHz 16-bit audio, which is above R2's 5 MiB. */
export const COMPOSE_PART_BYTES = 60 * PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE;

/**
 * HOW MUCH ONE INVOCATION COMPOSES: ten parts, ten minutes of audio. Ten minutes is about two seconds
 * of mixing per track and a few seconds of reading and writing — well inside a queue consumer's budget
 * with room for a slow bucket — while keeping the number of hand-offs for the longest recording (twelve
 * hours) at seventy-two.
 */
export const COMPOSE_PARTS_PER_INVOCATION = 10;

/**
 * HOW LONG A CONSUMER'S CLAIM ON A WINDOW HOLDS against another delivery: fifteen minutes, the longest
 * a queue consumer may run. A holder past it is gone, so its window is anybody's — and the sweep, which
 * hands on a compose nothing has claimed or moved for twice this, never races a holder still working.
 */
export const COMPOSE_CLAIM_LEASE_MILLISECONDS = 15 * 60 * 1000;

/**
 * HOW LONG THE COMPOSITE'S UPLOAD SESSION LIVES before the stale-upload sweep may abort it: two days.
 * A backstop, not the way a compose ends — a working compose files within hours and a failing one is
 * failed by the recording sweep, which aborts the session itself — sized so that no compose the sweep
 * is still nudging along has its session expire under it.
 */
export const COMPOSE_UPLOAD_SESSION_LIFETIME_MILLISECONDS = 2 * 24 * 60 * 60 * 1000;

/**
 * THE LONGEST AN EVENT'S TITLE RUNS IN A RECORDING'S FILE NAME, in characters. A title may be three
 * hundred characters long, and a file name built from all of it is one a file system or a download
 * truncates for us, somewhere that may cut the date off.
 */
export const RECORDING_TITLE_MAXIMUM_CHARACTERS = 120;

/** The samples one part holds at most — the size every reused buffer is allocated at. */
const PART_SAMPLES = COMPOSE_PART_BYTES / PCM_BYTES_PER_SAMPLE;

/** One run of one staged track as the composite places it. */
interface PlacedSpan {
  readonly stagingKey: string;
  // The staged sample the run begins at.
  readonly stagedFromSample: number;
  // The composite sample that staged sample lands on.
  readonly offset: number;
  readonly samples: number;
}

/** What one invocation is allowed to change, for a test that composes across a window boundary. */
export interface ComposeOptions {
  readonly partsPerInvocation?: number;
  readonly claimLeaseMilliseconds?: number;
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

  // THE CLAIM: this consumer, and nobody else, composes the window the cursor is at.
  const claimedAt = new Date().toISOString();
  try {
    await commitEffectBatch(
      database,
      claimComposeWindowEffect(database, {
        recordingId: recording.id,
        partsDone: recording.compose_parts_done,
        claimedAt,
        leaseMilliseconds: options.claimLeaseMilliseconds ?? COMPOSE_CLAIM_LEASE_MILLISECONDS,
      }),
      { now: () => claimedAt },
    );
  } catch (caught) {
    // Another delivery holds this window, the cursor moved, or the recording settled: it is theirs.
    if (caught instanceof GuardedWriteRefusedError && caught.guard === COMPOSE_CLAIM_GUARD) {
      return "nothing-to-do";
    }
    throw caught;
  }
  try {
    return await composeClaimedWindow(env, database, message, recording, claimedAt, options);
  } finally {
    // Let go of the claim unless the window's own progress or the filing already did — so a failure
    // the queue retries is picked up by the retry at once rather than after the lease runs out.
    try {
      await commitEffectBatch(
        database,
        {
          statements: [releaseComposeClaimStatement(database, { id: recording.id, claimedAt })],
          outboxMessages: [],
        },
        { now: () => new Date().toISOString() },
      );
    } catch (caught) {
      recordRealtimeFailure(realtimeLoggerFor(env), "meetings.recording.compose-release", caught);
    }
  }
}

/** The window this consumer has claimed: composed, handed on, filed — or failed when it never can be. */
async function composeClaimedWindow(
  env: Bindings,
  database: ProxyBatchDatabase,
  message: MeetingRecordingComposeMessage,
  recording: MeetingRecordingRow,
  claimedAt: string,
  options: ComposeOptions,
): Promise<"progressed" | "filed" | "failed" | "nothing-to-do"> {
  const now = () => new Date().toISOString();
  const system = { clock: { now }, randomSource: cryptoRandomSource };
  let bucketHandle: R2Bucket | null = null;
  const bucketFor = async (): Promise<R2Bucket> => {
    bucketHandle ??= (await resolveFirmBucketForFirmId(env, message.firmId)).bucket;
    return bucketHandle;
  };
  try {
    const { bucket, bucketName } = await resolveFirmBucketForFirmId(env, message.firmId);
    bucketHandle = bucket;
    let sessionId = recording.compose_upload_session_id;
    const layout = await placeTracks(bucket, recording, database);
    if (sessionId !== null && layout.missing.length > 0) {
      throw new ComposeRefusedError("a staged track vanished from the bucket during the compose");
    }
    const dataBytes = composedSamples(layout.spans) * PCM_BYTES_PER_SAMPLE;
    if (dataBytes === 0) {
      throw new ComposeRefusedError("none of the recording's staged tracks holds any audio");
    }
    if (dataBytes > WAV_MAXIMUM_DATA_BYTES) {
      throw new ComposeRefusedError("the composed recording is longer than a WAV can describe");
    }
    const totalBytes = WAV_HEADER_BYTES + dataBytes;

    if (sessionId === null) {
      sessionId = await beginComposite(
        env,
        database,
        bucket,
        recording,
        totalBytes,
        layout.missing,
      );
      if (sessionId === null) return "nothing-to-do";
    }
    const target = await readComposeTarget(database, sessionId as UploadSessionId);
    if (target === undefined || target.r2UploadId === null) {
      throw new ComposeRefusedError("the composite's upload session is gone");
    }
    if (target.status !== "open") {
      throw new ComposeRefusedError("the composite's upload session is no longer open");
    }
    // THE HEADER ALREADY WRITTEN SAYS THIS SIZE: a layout that differs is refused, never written.
    if (target.declaredSize !== totalBytes) {
      throw new ComposeRefusedError("the staged tracks changed after the compose began");
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
        const bytes = await composePart(bucket, layout.spans, partIndex, totalBytes, buffers);
        const uploaded = await upload.uploadPart(partIndex + 1, bytes);
        parts.push({ partNumber: uploaded.partNumber, etag: uploaded.etag });
      }
      const handsOn = untilPart < partCount;
      try {
        await commitEffectBatch(
          database,
          composeProgressEffect(
            database,
            { recordingId: recording.id, fromPartsDone, parts, releaseClaim: handsOn },
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
      if (handsOn) {
        const queue = env.MEETING_RECORDING_COMPOSE;
        if (queue === undefined)
          throw new Error("no compose queue is bound to hand the next window to");
        await queue.send(message);
        return "progressed";
      }
    }

    // THE RECORD AGAIN, IMMEDIATELY BEFORE THE COMPOSITE BECOMES AN OBJECT. Completing the upload is
    // what makes the document real — in a deployment, the bucket's own event drives ingest from it — so
    // a recording the sweep failed while this window was mixing must not be completed into a document
    // the record says does not exist. Still ours, and still composing, or nothing more is done.
    const current = await readRecordingById(database, recording.id);
    if (current?.state !== "composing" || current.compose_claimed_at !== claimedAt) {
      return "nothing-to-do";
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
      composedSeconds: Math.floor(dataBytes / PCM_BYTES_PER_SAMPLE / PCM_SAMPLE_RATE),
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
    return (await failRecordingCompose(env, database, recording.id, failureErrorId, bucketFor))
      ? "failed"
      : "nothing-to-do";
  }
}

/**
 * FAILS A COMPOSE AND LETS GO OF EVERYTHING IT HELD — the compose step's own refusal and the sweep's
 * failure of a compose that stopped moving, both. In ONE batch: the recording `failed` with its Error ID
 * (guarded on `composing`) and, when the compose had begun, its upload session aborted and the pending
 * version abandoned through the file manager's own abort; then, once that has committed, the multipart
 * upload at the key aborted and any object a completion had already left there deleted. A failure that
 * lost the race — the recording filed, failed or abandoned first — changes nothing and lets go of
 * nothing, because what it would let go of is now somebody else's record. Answers whether this call is
 * the one that failed it.
 *
 * The staged tracks are NOT released: they are the only copy of what was captured, and the sweep
 * deletes them after its retention window.
 */
export async function failRecordingCompose(
  env: Bindings,
  database: ProxyBatchDatabase,
  recordingId: MeetingRecordingId,
  failureErrorId: string,
  bucketFor: () => Promise<R2Bucket>,
  clock: { now(): string } = { now: () => new Date().toISOString() },
): Promise<boolean> {
  const recording = await readRecordingById(database, recordingId);
  if (recording === undefined || recording.state !== "composing") return false;
  const system = { clock, randomSource: cryptoRandomSource };
  const statements: EffectStatement[] = [
    ...failComposeEffect(database, { recording, failureErrorId }, system).statements,
  ];
  let composite: { readonly key: string; readonly uploadId: string | null } | null = null;
  if (recording.compose_upload_session_id !== null) {
    try {
      const aborted = await abortUploadSession(
        database,
        recording.compose_upload_session_id as UploadSessionId,
        { ...system, actorUserId: recording.started_by_user_id },
      );
      statements.push(...aborted.effect.statements);
      composite = { key: aborted.r2Key, uploadId: aborted.r2UploadId };
    } catch (caught) {
      // A session no longer open — expired by the stale-upload sweep, which aborted its upload itself —
      // has nothing left for this failure to let go of.
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
    if (caught instanceof GuardedWriteRefusedError && caught.guard === FAIL_COMPOSE_GUARD) {
      return false;
    }
    throw caught;
  }
  if (composite !== null) {
    try {
      const bucket = await bucketFor();
      if (composite.uploadId !== null) {
        try {
          await bucket.resumeMultipartUpload(composite.key, composite.uploadId).abort();
        } catch {
          // Already completed, or already aborted: the delete below covers the first.
        }
      }
      // A completion that landed before the abort left an object for a version now abandoned; ingest
      // skips a version that is not pending, and the bytes go with it here.
      await bucket.delete(composite.key);
    } catch (caught) {
      recordRealtimeFailure(realtimeLoggerFor(env), "meetings.recording.compose-release", caught);
    }
  }
  return true;
}

/**
 * Where each staged track lands on the composite, stretch by stretch, and which tracks' objects are not
 * in the bucket. A track that never staged anything (no key, or no first frame) contributes nothing and
 * is not missing; one whose row names an object the bucket does not hold is missing, and the caller
 * decides what that means for where the compose has got to.
 */
async function placeTracks(
  bucket: R2Bucket,
  recording: MeetingRecordingRow,
  database: ProxyBatchDatabase,
): Promise<{ spans: PlacedSpan[]; missing: MeetingRecordingTrackId[] }> {
  const spans: PlacedSpan[] = [];
  const missing: MeetingRecordingTrackId[] = [];
  for (const track of await listRecordingTracks(database, recording.id)) {
    if (track.staging_key === null || track.first_frame_at === null) continue;
    const object = await bucket.head(track.staging_key);
    if (object === null) {
      missing.push(track.id);
      continue;
    }
    const segments = parseTrackSegments(track.segments);
    if (track.segments !== null && segments === null) {
      throw new ComposeRefusedError("a staged track's stretches could not be read");
    }
    for (const span of placeTrackSegments({
      startedAt: recording.started_at,
      firstFrameAt: track.first_frame_at,
      segments,
      objectSamples: Math.floor(object.size / PCM_BYTES_PER_SAMPLE),
    })) {
      spans.push({ stagingKey: track.staging_key, ...span });
    }
  }
  return { spans, missing };
}

/** The composite's length in samples: as far as any run reaches. */
function composedSamples(spans: readonly PlacedSpan[]): number {
  return spans.reduce((furthest, span) => Math.max(furthest, span.offset + span.samples), 0);
}

/**
 * ONE PART OF THE COMPOSITE: the header at the head of the first, then this part's samples mixed from
 * every run that reaches them. Answers a view of `buffers.part` for a whole part, or a fresh array for
 * the short last one.
 */
async function composePart(
  bucket: R2Bucket,
  spans: readonly PlacedSpan[],
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
  for (const span of spans) {
    const from = Math.max(windowStart, span.offset);
    const to = Math.min(windowStart + windowLength, span.offset + span.samples);
    if (to <= from) continue;
    const read = await bucket.get(span.stagingKey, {
      range: {
        offset: (span.stagedFromSample + from - span.offset) * PCM_BYTES_PER_SAMPLE,
        length: (to - from) * PCM_BYTES_PER_SAMPLE,
      },
    });
    // AN OBJECT THAT WENT AWAY UNDER THE COMPOSE is not silence: the windows already written placed it,
    // and composing on without it would file a recording that drops a speaker part of the way through.
    if (read === null) {
      throw new ComposeRefusedError("a staged track vanished from the bucket during the compose");
    }
    mix.add({
      samples: samplesFromPcmBytes(new Uint8Array(await read.arrayBuffer())),
      offset: from - windowStart,
    });
  }
  writePcmBytes(mix.finish(buffers.mixed), bytes, writeAt);
  return bytes;
}

/**
 * THE COMPOSITE'S UPLOAD SESSION, begun through the pipeline: a pending version on the matter, its key,
 * and a multipart upload at that key — recorded on the recording in the SAME batch as the session, so a
 * second invocation beginning the same recording is refused whole and lets go of its own upload. A
 * staged track whose object was not there is recorded in the same batch: its row stops naming the
 * object, and the recording carries the Error ID of the fault. Answers the session, or null when another
 * invocation began first.
 *
 * The member who started the recording is the one the pipeline records as uploading it: the recording
 * is theirs, and the document is what their pressing Record produced.
 */
async function beginComposite(
  env: Bindings,
  database: ProxyBatchDatabase,
  bucket: R2Bucket,
  recording: MeetingRecordingRow,
  totalBytes: number,
  missing: readonly MeetingRecordingTrackId[],
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
      expiresAt: new Date(Date.now() + COMPOSE_UPLOAD_SESSION_LIFETIME_MILLISECONDS).toISOString(),
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
  if (missing.length > 0) {
    // A STAGED TRACK THAT IS NOT THERE is composed without, and said so: an Error ID on the row (a
    // fault on the way, not the outcome) and the track's row no longer naming an object. The
    // captured length is brought down to what was filed when the recording is.
    const failureErrorId = recordRealtimeFailure(
      realtimeLoggerFor(env),
      "meetings.recording.compose-track-missing",
      new Error("a staged track was not in the bucket when the compose began"),
    );
    statements.push(
      recordFaultOnTheWayStatement(database, { id: recording.id, failureErrorId, now: now() }),
      ...clearStagingKeysStatements(database, missing, now()),
    );
  }
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

// Characters an event's title may carry that have no place in a file name: the C0 and C1 controls
// (a newline or a NUL in a name breaks every tool that lists it), the bidirectional controls (an
// override can make "gpj.exe" read as "exe.jpg" on screen), and the invisible joiners and marks that
// make two names look identical while differing.
const INVISIBLE_IN_FILE_NAME = new Set([
  0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
  0x2067, 0x2068, 0x2069, 0xfeff,
]);

/**
 * AN EVENT'S TITLE AS A FILE NAME MAY CARRY IT. A title is whatever a member typed, and the file name
 * is read by every operating system, archive tool and court filing system the document travels to:
 * controls and line breaks become spaces, bidirectional controls and invisible characters are removed,
 * a path separator becomes a hyphen (a name with a "/" in it is a folder to half the tools that see it),
 * runs of space become one, and the result is cut at `RECORDING_TITLE_MAXIMUM_CHARACTERS` — by
 * character, never inside one — with an ellipsis saying it was. A title with nothing left is named as
 * an untitled meeting rather than leaving a gap in the name.
 */
export function recordingTitleForFileName(title: string): string {
  let cleaned = "";
  for (const character of title.normalize("NFC")) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      cleaned += " ";
    } else if (INVISIBLE_IN_FILE_NAME.has(code)) {
      continue;
    } else if (character === "/" || character === "\\") {
      cleaned += "-";
    } else {
      cleaned += character;
    }
  }
  cleaned = cleaned.replace(/\s+/gu, " ").trim();
  const characters = Array.from(cleaned);
  if (characters.length > RECORDING_TITLE_MAXIMUM_CHARACTERS) {
    cleaned = `${characters
      .slice(0, RECORDING_TITLE_MAXIMUM_CHARACTERS - 1)
      .join("")
      .trimEnd()}…`;
  }
  return cleaned === "" ? "Untitled meeting" : cleaned;
}

/**
 * THE FILED DOCUMENT'S NAME: `Meeting recording — <event title> — <YYYY-MM-DD HH:mm>.wav`, the start
 * read in the event's own zone — the wall clock the people in the meeting were looking at. A zone the
 * runtime cannot resolve is read in UTC and says so, rather than failing the filing over a label. The
 * title is made safe for a file name first (`recordingTitleForFileName`).
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
  return `Meeting recording — ${recordingTitleForFileName(facts.title)} — ${reading.civilDate} ${reading.wallClockTime}${zoneNote}.wav`;
}

/**
 * FILES THE COMPLETED COMPOSITE: the upload session completed and the recording `filed` — in ONE batch,
 * so the record never says filed over a document the pipeline does not have — then the ingest queue,
 * then the staged tracks deleted and the rows told so.
 */
async function fileComposite(
  env: Bindings,
  database: ProxyBatchDatabase,
  recording: MeetingRecordingRow,
  composite: {
    readonly bucket: R2Bucket;
    readonly bucketName: string;
    readonly target: NonNullable<Awaited<ReturnType<typeof readComposeTarget>>>;
    readonly totalBytes: number;
    readonly composedSeconds: number;
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
              composedSeconds: composite.composedSeconds,
            },
            { clock: { now }, randomSource: cryptoRandomSource },
          ),
        ],
        outboxMessages: completed.effect.outboxMessages,
      },
      { now },
    );
  } catch (caught) {
    // The recording moved on — a sweep failed it — between this invocation's last read and its filing.
    // The record keeps that outcome, and that failure aborted the session and deletes what is at the key.
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
          statements: clearStagingKeysStatements(
            database,
            staged.map((track) => track.id),
            now(),
          ),
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
