import { commitEffectBatch, GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId } from "@magna-carta/identifiers/types";
import {
  ABANDON_RECORDING_GUARD,
  abandonRecordingAfterRecorderLoss,
  composeRetryEffect,
} from "@magna-carta/meetings/recording-service";
import {
  clearStagingKeysStatements,
  hasRecordingsToTend,
  listExpiredStagingTracks,
  listRunningRecordingsStartedBefore,
  listStalledComposingRecordings,
} from "@magna-carta/meetings/recording-statements";
import type { MeetingRecordingRow } from "@magna-carta/meetings/recording-types";
import { transcriptRetryEffect } from "@magna-carta/meetings/transcript-service";
import { listStalledPendingTranscripts } from "@magna-carta/meetings/transcript-statements";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { listReachableActiveFirms } from "../scheduled.ts";
import type {
  MeetingRecordingComposeMessage,
  MeetingTranscriptMessage,
} from "./meeting-recorder.ts";
import { failRecordingCompose } from "./recording-compose-consumer.ts";
import { failMeetingTranscript } from "./transcript-consumer.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "./sfu/realtime-failure.ts";

// THE RECORDING SWEEP: what tends a recording when the part of the platform that should have moved it
// on did not. A recording never claims more than it captured and never fails silently, so each of the
// three things it looks for ends in a row a person can read:
//
//   * A recording still `recording` whose RECORDER HAS STOPPED WORKING — it has not completed a pass
//     over the room and the record for a window, or it never took the recording at all (a start whose
//     hand-over never arrived). Nothing else will ever stop it, and the room would light the mark over
//     nothing for the rest of the day. It is `abandoned`: the record says so with nobody behind it and
//     every open track lost, the recorder (if it answers) closes its adapters and COMPLETES its staged
//     uploads — so what it captured is kept, not composed, for the retention window below — and the
//     room is told it stopped so the mark clears for everybody still there.
//   * A recording `composing` that NOTHING HAS TOUCHED for a window — no window claimed, no progress,
//     no hand-on: a message that was lost, dead-lettered, or never sent because the queue was not
//     bound, or a recorder that never let go. A window being mixed is claimed, so it is never one of
//     these however long it takes. It is handed on again, and after a bounded number of hand-ons with
//     nothing moving in between it is `failed` with an Error ID, its upload session aborted and its
//     partial composite released (`failRecordingCompose`).
//   * A TRANSCRIPT still `pending` that NOTHING HAS TOUCHED for a window — its first message never
//     sent, or every delivery dead-lettered. It is handed on again on the same terms as a compose, and
//     after a bounded number of hand-ons with nothing moving in between it is `failed` with an Error ID
//     — which releases the recording's staged tracks, because a transcript stuck forever would
//     otherwise hold them forever.
//   * STAGED TRACKS nothing needs any more: a failed or abandoned recording's after a retention window
//     (they are the only copy of what was captured, so they are kept long enough for somebody to ask
//     about a retry), and a filed recording's once its transcript has settled and a grace has passed,
//     if the settle itself did not get to release them.
//
// IT RIDES THE TEN-MINUTE CRON, beside the status snapshot. Every window below is a multiple of that
// cadence, so one late pass costs a few minutes, never a day — and it is not on the five-minute sweep,
// which also runs on the tail of a request after a firm is provisioned.
//
// WHAT ONE PASS COSTS A FIRM THAT HAS NOTHING TO TEND is one read (`hasRecordingsToTend`), not three
// — and most firms have never recorded. It is not skipped on the `meetings.recordingEnabled` switch:
// a firm that switched recording off with a recording mid-compose still needs it filed and its staging
// released. The three duties are independent, so a fault in one — a queue that will not take a
// hand-on — never costs a firm the other two on that pass.

/**
 * HOW LONG A RECORDER MAY GO WITHOUT COMPLETING A PASS before its recording is abandoned. A working
 * recorder completes one every five seconds, so five minutes is sixty missed passes: no slow room, slow
 * database or recorder restart looks like that, and a recording left lit over nothing is cleared within
 * one sweep interval of it.
 */
export const RECORDER_STALL_MILLISECONDS = 5 * 60 * 1000;

/**
 * HOW LONG A COMPOSE MAY GO UNTOUCHED before it is handed on again — measured from the latest of its
 * stop, its last window's claim, its last progress and its last hand-on. Twice the longest a queue
 * consumer may run (fifteen minutes, which is also how long a claim holds), so an invocation still
 * working is never raced by a second one.
 */
export const COMPOSE_STALL_MILLISECONDS = 30 * 60 * 1000;

/**
 * How many hand-ons in a row, with no progress between them, before the recording is failed. Progress
 * starts the count again, so a long recording nudged once is not one strike down for good.
 */
export const MAXIMUM_COMPOSE_ATTEMPTS = 3;

/**
 * HOW LONG A FAILED OR ABANDONED RECORDING'S STAGED TRACKS ARE KEPT: seven days, because they are the
 * only copy of what was captured and a retry is possible; after that the row keeps saying what
 * happened and the bytes go.
 */
export const UNSETTLED_STAGING_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long after a filed recording's transcript settled its leftover staged tracks are taken, if the
 * settle did not release them itself.
 */
export const FILED_STAGING_GRACE_MILLISECONDS = 24 * 60 * 60 * 1000;

/** What one pass did, in counts. */
export interface RecordingSweepReport {
  readonly abandoned: number;
  readonly composeRetried: number;
  readonly composeFailed: number;
  readonly transcriptRetried: number;
  readonly transcriptFailed: number;
  readonly stagingDeleted: number;
}

/**
 * HOW LONG A TRANSCRIPT MAY GO UNTOUCHED before it is handed on again — measured from the latest of its
 * creation, its last window's claim, its last progress and its last hand-on. The compose's figure, for
 * the compose's reason: twice the longest a consumer may run, so a window still being transcribed is
 * never raced.
 */
export const TRANSCRIPT_STALL_MILLISECONDS = 30 * 60 * 1000;

/** How many hand-ons in a row, with no progress between them, before a transcript is failed. */
export const MAXIMUM_TRANSCRIPT_ATTEMPTS = 3;

/** One pass over every active firm. A firm that fails is recorded and the pass goes on. */
export async function runRecordingSweep(
  env: Bindings,
  options: { readonly now?: () => number } = {},
): Promise<RecordingSweepReport> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const nowMilliseconds = options.now ?? (() => Date.now());
  const report = {
    abandoned: 0,
    composeRetried: 0,
    composeFailed: 0,
    transcriptRetried: 0,
    transcriptFailed: 0,
    stagingDeleted: 0,
  };
  for (const firm of await listReachableActiveFirms(env)) {
    try {
      await sweepFirm(env, firm, nowMilliseconds, report);
    } catch (caught) {
      logOperationFailed(logger, `cron:recording-sweep:${firm.firmId}`, caught, correlationId);
    }
  }
  return report;
}

async function sweepFirm(
  env: Bindings,
  firm: {
    readonly firmId: string;
    readonly database: ProxyBatchDatabase;
    readonly bucketName: string | null;
  },
  nowMilliseconds: () => number,
  report: {
    abandoned: number;
    composeRetried: number;
    composeFailed: number;
    transcriptRetried: number;
    transcriptFailed: number;
    stagingDeleted: number;
  },
): Promise<void> {
  const database = firm.database;
  if (!(await hasRecordingsToTend(database))) return;
  const now = () => new Date(nowMilliseconds()).toISOString();
  const system = { clock: { now }, randomSource: cryptoRandomSource };
  const logger = realtimeLoggerFor(env);

  // A recorder that stopped working.
  try {
    const runningSince = new Date(nowMilliseconds() - RECORDER_STALL_MILLISECONDS).toISOString();
    for (const recording of await listRunningRecordingsStartedBefore(database, runningSince)) {
      if (!(await recorderHasStopped(env, firm.firmId, recording, nowMilliseconds()))) continue;
      if (await abandon(env, firm.firmId, database, recording, system)) report.abandoned += 1;
    }
  } catch (caught) {
    recordRealtimeFailure(logger, "meetings.recording.sweep-abandon", caught);
  }

  // A compose nothing has touched.
  try {
    const stalledSince = new Date(nowMilliseconds() - COMPOSE_STALL_MILLISECONDS).toISOString();
    for (const recording of await listStalledComposingRecordings(database, stalledSince)) {
      if (recording.compose_attempts >= MAXIMUM_COMPOSE_ATTEMPTS) {
        const failureErrorId = recordRealtimeFailure(
          logger,
          "meetings.recording.compose-stalled",
          new Error(
            `the recording was not composed after ${String(MAXIMUM_COMPOSE_ATTEMPTS)} attempts`,
          ),
        );
        const bucketFor = async (): Promise<R2Bucket> =>
          resolveFirmBucket(env, firm.bucketName).bucket;
        if (
          await failRecordingCompose(env, database, recording.id, failureErrorId, bucketFor, {
            now,
          })
        ) {
          report.composeFailed += 1;
        }
        continue;
      }
      // A deployment that binds no compose queue cannot compose at all; counting attempts there would
      // fail every recording it ever made. The recording waits, and is handed on once the queue exists.
      const queue = env.MEETING_RECORDING_COMPOSE;
      if (queue === undefined) continue;
      try {
        await commitEffectBatch(database, composeRetryEffect(database, recording.id, system), {
          now,
        });
        const message: MeetingRecordingComposeMessage = {
          kind: "meeting-recording-compose",
          firmId: firm.firmId as FirmId,
          meetingId: recording.meeting_id,
          recordingId: recording.id,
        };
        await queue.send(message);
        report.composeRetried += 1;
      } catch (caught) {
        // One hand-on that would not go is one recording waiting for the next pass — not every other
        // recording behind it, and not the staging below.
        recordRealtimeFailure(logger, "meetings.recording.sweep-hand-on", caught);
      }
    }
  } catch (caught) {
    recordRealtimeFailure(logger, "meetings.recording.sweep-compose", caught);
  }

  // A transcript nothing has touched.
  try {
    const stalledSince = new Date(nowMilliseconds() - TRANSCRIPT_STALL_MILLISECONDS).toISOString();
    for (const transcript of await listStalledPendingTranscripts(database, stalledSince)) {
      if (transcript.attempts >= MAXIMUM_TRANSCRIPT_ATTEMPTS) {
        const failureErrorId = recordRealtimeFailure(
          logger,
          "meetings.transcript.stalled",
          new Error(
            `the transcript was not finished after ${String(MAXIMUM_TRANSCRIPT_ATTEMPTS)} attempts`,
          ),
        );
        const bucketFor = async (): Promise<R2Bucket> =>
          resolveFirmBucket(env, firm.bucketName).bucket;
        if (
          await failMeetingTranscript(env, database, transcript.id, failureErrorId, bucketFor, {
            now,
          })
        ) {
          report.transcriptFailed += 1;
        }
        continue;
      }
      // No queue bound, no hand-on: counting attempts there would fail every transcript it ever made.
      const queue = env.MEETING_RECORDING_COMPOSE;
      if (queue === undefined) continue;
      try {
        await commitEffectBatch(database, transcriptRetryEffect(database, transcript.id, system), {
          now,
        });
        const message: MeetingTranscriptMessage = {
          kind: "meeting-transcript",
          firmId: firm.firmId as FirmId,
          meetingId: transcript.meeting_id,
          recordingId: transcript.recording_id,
          transcriptId: transcript.id,
        };
        await queue.send(message);
        report.transcriptRetried += 1;
      } catch (caught) {
        recordRealtimeFailure(logger, "meetings.transcript.sweep-hand-on", caught);
      }
    }
  } catch (caught) {
    recordRealtimeFailure(logger, "meetings.transcript.sweep", caught);
  }

  // Staged tracks nothing needs.
  try {
    const expired = await listExpiredStagingTracks(database, {
      unsettledBefore: new Date(
        nowMilliseconds() - UNSETTLED_STAGING_RETENTION_MILLISECONDS,
      ).toISOString(),
      filedBefore: new Date(nowMilliseconds() - FILED_STAGING_GRACE_MILLISECONDS).toISOString(),
    });
    if (expired.length > 0 && firm.bucketName !== null) {
      // Objects first, rows second: a row that outlives its object names something already gone,
      // which the next pass clears; an object that outlived its row would be bytes nothing names
      // again.
      const { bucket } = resolveFirmBucket(env, firm.bucketName);
      await bucket.delete(expired.map((track) => track.stagingKey));
      await commitEffectBatch(
        database,
        {
          statements: clearStagingKeysStatements(
            database,
            expired.map((track) => track.trackId),
            now(),
          ),
          outboxMessages: [],
        },
        { now },
      );
      report.stagingDeleted += expired.length;
    }
  } catch (caught) {
    recordRealtimeFailure(logger, "meetings.recording.sweep-staging", caught);
  }
}

/**
 * WHETHER A RUNNING RECORDING'S RECORDER HAS STOPPED WORKING: it holds no running recording (never
 * took it, or already let go), or its last completed pass is older than the stall window. A recorder
 * that cannot be asked this pass decides nothing — the next pass asks again — because abandoning a
 * recording on one failed call would abort the uploads of a recorder that may be working.
 */
async function recorderHasStopped(
  env: Bindings,
  firmId: string,
  recording: MeetingRecordingRow,
  nowMilliseconds: number,
): Promise<boolean> {
  const recorders = env.MEETING_RECORDER;
  // A deployment with no recorder has nothing capturing anything.
  if (recorders === undefined) return true;
  try {
    const heartbeat = await recorders
      .get(recorders.idFromName(`${firmId}:${recording.id}`))
      .heartbeat();
    return (
      heartbeat.state !== "recording" ||
      heartbeat.reconciledAt === null ||
      nowMilliseconds - heartbeat.reconciledAt >= RECORDER_STALL_MILLISECONDS
    );
  } catch (caught) {
    recordRealtimeFailure(realtimeLoggerFor(env), "meetings.recording.sweep-heartbeat", caught);
    return false;
  }
}

/**
 * ABANDONS ONE RECORDING: the record first (so a recorder that wakes reads that it stopped), then the
 * recorder lets go of its adapters and keeps what it captured, then the room clears the mark. Answers whether this
 * pass is the one that abandoned it — a stop that committed first is kept, and announced by its maker.
 */
async function abandon(
  env: Bindings,
  firmId: string,
  database: ProxyBatchDatabase,
  recording: MeetingRecordingRow,
  system: { readonly clock: { now(): string }; readonly randomSource: typeof cryptoRandomSource },
): Promise<boolean> {
  const abandoned = await abandonRecordingAfterRecorderLoss(database, recording.id, system);
  if (abandoned === undefined) return false;
  try {
    await commitEffectBatch(database, abandoned.effect, { now: () => system.clock.now() });
  } catch (caught) {
    if (caught instanceof GuardedWriteRefusedError && caught.guard === ABANDON_RECORDING_GUARD) {
      return false;
    }
    throw caught;
  }
  const recorders = env.MEETING_RECORDER;
  if (recorders !== undefined) {
    try {
      await recorders.get(recorders.idFromName(`${firmId}:${recording.id}`)).abandon();
    } catch (caught) {
      // The record already says abandoned; a recorder that wakes later reads that and settles.
      recordRealtimeFailure(realtimeLoggerFor(env), "meetings.recording.sweep-abandon", caught);
    }
  }
  try {
    const room = env.MEETING_ROOM.get(
      env.MEETING_ROOM.idFromName(`${firmId}:${recording.meeting_id}`),
    );
    await room.recordingStopped({
      firmId,
      meetingId: recording.meeting_id,
      recordingId: recording.id,
      at: abandoned.recording.stopped_at ?? system.clock.now(),
      by: null,
    });
  } catch (caught) {
    recordRealtimeFailure(realtimeLoggerFor(env), "meetings.recording.sweep-announce", caught);
  }
  return true;
}
