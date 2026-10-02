import { commitEffectBatch, GuardedWriteRefusedError } from "@magna-carta/data-access/effect-batch";
import { cryptoRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId } from "@magna-carta/identifiers/types";
import {
  ABANDON_RECORDING_GUARD,
  abandonRecordingAfterRecorderLoss,
  composeRetryEffect,
  failComposeEffect,
} from "@magna-carta/meetings/recording-service";
import {
  clearStagingKeysStatement,
  listExpiredStagingTracks,
  listRunningRecordingsStartedBefore,
  listStalledComposingRecordings,
} from "@magna-carta/meetings/recording-statements";
import type { MeetingRecordingRow } from "@magna-carta/meetings/recording-types";
import { newCorrelationId } from "@magna-carta/telemetry/ids";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import { createWorkersLogger } from "@magna-carta/telemetry/workers-logger";
import type { Bindings } from "../app.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { resolveFirmBucket } from "../files/firm-bucket.ts";
import { listReachableActiveFirms } from "../scheduled.ts";
import type { MeetingRecordingComposeMessage } from "./meeting-recorder.ts";
import { realtimeLoggerFor, recordRealtimeFailure } from "./sfu/realtime-failure.ts";

// THE RECORDING SWEEP: what tends a recording when the part of the platform that should have moved it
// on did not. A recording never claims more than it captured and never fails silently, so each of the
// three things it looks for ends in a row a person can read:
//
//   * A recording still `recording` whose RECORDER HAS STOPPED WORKING — it has not completed a pass
//     over the room and the record for a window, or it never took the recording at all (a start whose
//     hand-over never arrived). Nothing else will ever stop it, and the room would light the mark over
//     nothing for the rest of the day. It is `abandoned`: the record says so with nobody behind it and
//     every open track lost, the recorder (if it answers) closes its adapters and aborts its staged
//     uploads, and the room is told it stopped so the mark clears for everybody still there.
//   * A recording `composing` that has made NO PROGRESS for a window — a message that was lost,
//     dead-lettered, or never sent because the queue was not bound, or a recorder that never let go.
//     It is handed on again, and after a bounded number of attempts it is `failed` with an Error ID.
//   * STAGED TRACKS nothing needs any more: a failed or abandoned recording's after a retention window
//     (they are the only copy of what was captured, so they are kept long enough for somebody to ask
//     about a retry), and a filed recording's whose own compose did not get to delete them.
//
// IT RIDES THE TEN-MINUTE CRON, beside the status snapshot. Every window below is a multiple of that
// cadence, so one late pass costs a few minutes, never a day — and it is not on the five-minute sweep,
// which also runs on the tail of a request after a firm is provisioned.

/**
 * HOW LONG A RECORDER MAY GO WITHOUT COMPLETING A PASS before its recording is abandoned. A working
 * recorder completes one every five seconds, so five minutes is sixty missed passes: no slow room, slow
 * database or recorder restart looks like that, and a recording left lit over nothing is cleared within
 * one sweep interval of it.
 */
export const RECORDER_STALL_MILLISECONDS = 5 * 60 * 1000;

/**
 * HOW LONG A COMPOSE MAY GO WITHOUT PROGRESS before it is handed on again. Twice the longest a queue
 * consumer may run (fifteen minutes), so an invocation still working is never raced by a second one.
 */
export const COMPOSE_STALL_MILLISECONDS = 30 * 60 * 1000;

/** How many times a stalled compose is handed on before the recording is failed. */
export const MAXIMUM_COMPOSE_ATTEMPTS = 3;

/**
 * HOW LONG A FAILED OR ABANDONED RECORDING'S STAGED TRACKS ARE KEPT: seven days, because they are the
 * only copy of what was captured and a retry is possible; after that the row keeps saying what
 * happened and the bytes go.
 */
export const UNSETTLED_STAGING_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

/** How long after filing a recording's leftover staged tracks are taken, if its compose did not. */
export const FILED_STAGING_GRACE_MILLISECONDS = 24 * 60 * 60 * 1000;

/** What one pass did, in counts. */
export interface RecordingSweepReport {
  readonly abandoned: number;
  readonly composeRetried: number;
  readonly composeFailed: number;
  readonly stagingDeleted: number;
}

/** One pass over every active firm. A firm that fails is recorded and the pass goes on. */
export async function runRecordingSweep(
  env: Bindings,
  options: { readonly now?: () => number } = {},
): Promise<RecordingSweepReport> {
  const logger = createWorkersLogger(env.TELEMETRY);
  const correlationId = newCorrelationId();
  const nowMilliseconds = options.now ?? (() => Date.now());
  const report = { abandoned: 0, composeRetried: 0, composeFailed: 0, stagingDeleted: 0 };
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
    stagingDeleted: number;
  },
): Promise<void> {
  const database = firm.database;
  const now = () => new Date(nowMilliseconds()).toISOString();
  const system = { clock: { now }, randomSource: cryptoRandomSource };

  // A recorder that stopped working.
  const runningSince = new Date(nowMilliseconds() - RECORDER_STALL_MILLISECONDS).toISOString();
  for (const recording of await listRunningRecordingsStartedBefore(database, runningSince)) {
    if (!(await recorderHasStopped(env, firm.firmId, recording, nowMilliseconds()))) continue;
    if (await abandon(env, firm.firmId, database, recording, system)) report.abandoned += 1;
  }

  // A compose with no progress.
  const stalledSince = new Date(nowMilliseconds() - COMPOSE_STALL_MILLISECONDS).toISOString();
  for (const recording of await listStalledComposingRecordings(database, stalledSince)) {
    if (recording.compose_attempts >= MAXIMUM_COMPOSE_ATTEMPTS) {
      const failureErrorId = recordRealtimeFailure(
        realtimeLoggerFor(env),
        "meetings.recording.compose-stalled",
        new Error(
          `the recording was not composed after ${String(MAXIMUM_COMPOSE_ATTEMPTS)} attempts`,
        ),
      );
      await commitEffectBatch(
        database,
        failComposeEffect(database, { recording, failureErrorId }, system),
        { now },
      );
      report.composeFailed += 1;
      continue;
    }
    // A deployment that binds no compose queue cannot compose at all; counting attempts there would
    // fail every recording it ever made. The recording waits, and is handed on once the queue exists.
    const queue = env.MEETING_RECORDING_COMPOSE;
    if (queue === undefined) continue;
    await commitEffectBatch(database, composeRetryEffect(database, recording.id, system), { now });
    const message: MeetingRecordingComposeMessage = {
      kind: "meeting-recording-compose",
      firmId: firm.firmId as FirmId,
      meetingId: recording.meeting_id,
      recordingId: recording.id,
    };
    await queue.send(message);
    report.composeRetried += 1;
  }

  // Staged tracks nothing needs.
  const expired = await listExpiredStagingTracks(database, {
    unsettledBefore: new Date(
      nowMilliseconds() - UNSETTLED_STAGING_RETENTION_MILLISECONDS,
    ).toISOString(),
    filedBefore: new Date(nowMilliseconds() - FILED_STAGING_GRACE_MILLISECONDS).toISOString(),
  });
  if (expired.length > 0 && firm.bucketName !== null) {
    // Objects first, rows second: a row that outlives its object names something already gone, which
    // the next pass clears; an object that outlived its row would be bytes nothing names again.
    const { bucket } = resolveFirmBucket(env, firm.bucketName);
    await bucket.delete(expired.map((track) => track.stagingKey));
    await commitEffectBatch(
      database,
      {
        statements: [
          clearStagingKeysStatement(
            database,
            expired.map((track) => track.trackId),
            now(),
          ),
        ],
        outboxMessages: [],
      },
      { now },
    );
    report.stagingDeleted += expired.length;
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
 * recorder lets go of its adapters and uploads, then the room clears the mark. Answers whether this
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
