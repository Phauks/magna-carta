import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MeetingRecordingId, UserId } from "@magna-carta/identifiers/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type { MeetingRecordingComposeMessage } from "../src/meetings/meeting-recorder.ts";
import {
  RECORDING_SWEEP_BATCH,
  STAGING_SWEEP_BATCH,
} from "@magna-carta/meetings/recording-statements";
import {
  COMPOSE_STALL_MILLISECONDS,
  FILED_STAGING_GRACE_MILLISECONDS,
  MAXIMUM_COMPOSE_ATTEMPTS,
  RECORDER_STALL_MILLISECONDS,
  runRecordingSweep,
  UNSETTLED_STAGING_RETENTION_MILLISECONDS,
} from "../src/meetings/recording-sweep.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";
import { setMeetingSinkSigningKeyForTests } from "../src/meetings/sink-token.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  fakeAdapterService,
  seedRecordedMeeting,
  seedRunningRecording,
  type RecordedMeeting,
} from "./support/meeting-recording-fixture.ts";
import { seedFirmRow } from "./support/test-auth.ts";

// THE RECORDING SWEEP — the section of the design about failure, driven against the real recorder, the
// real room and the firm's own database.
//
// What would be a real failure if it stopped holding: a recording whose recorder is gone stays
// `recording` and the mark stays lit over nothing; a recording whose recorder is working is abandoned
// by mistake; a compose that stalled is never handed on, or is handed on forever; or staged audio is
// deleted while a retry is still possible, or kept for ever after it is not.

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm") as FirmId;
  await seedFirmRow(firmId);
  setSfuFetchForTests(fakeAdapterService([]));
  setMeetingSinkSigningKeyForTests("recording-sweep-test-signing-key");
});

afterAll(() => {
  setSfuFetchForTests(null);
  setMeetingSinkSigningKeyForTests(null);
});

function database(inFirm: FirmId = firmId) {
  return firmDatabaseFor(env.FIRM_DATABASE, inFirm);
}

/** A firm of its own, for a test about what one firm's pass may and may not reach. */
async function anotherFirm(): Promise<FirmId> {
  const id = newIdentifier("firm") as FirmId;
  await seedFirmRow(id);
  return id;
}

/**
 * A recording that stopped and was failed `ago` milliseconds back (or filed, with `state`), whose one
 * track still names a staged object the test has written to the bucket.
 */
async function settledWithStaging(
  meeting: RecordedMeeting,
  state: "failed" | "filed",
  ago: number,
): Promise<{ recordingId: MeetingRecordingId; trackId: string; stagingKey: string }> {
  const inFirm = meeting.firmId;
  const member = newIdentifier("user") as UserId;
  await database(inFirm)
    .prepare(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Staged', 'active', ?2)`,
    )
    .bind(member, new Date().toISOString())
    .run();
  const { recordingId, tracks } = await seedRunningRecording(meeting, [member]);
  const stagingKey = `meeting-recordings/${meeting.meetingId}/${recordingId}/${tracks[0]!.trackId}.pcm`;
  await env.R2.put(stagingKey, new Uint8Array(8));
  const at = new Date(Date.now() - ago).toISOString();
  await database(inFirm)
    .prepare(
      `UPDATE meeting_recording SET state = ?3, stopped_at = ?1, stop_reason = 'member', ` +
        `failure_error_id = CASE WHEN ?3 = 'failed' THEN 'error-under-test' ELSE NULL END, ` +
        `updated_at = ?1 WHERE id = ?2`,
    )
    .bind(at, recordingId, state)
    .run();
  await database(inFirm)
    .prepare(`UPDATE meeting_recording_track SET staging_key = ?1, state = 'closed' WHERE id = ?2`)
    .bind(stagingKey, tracks[0]!.trackId)
    .run();
  return { recordingId, trackId: tracks[0]!.trackId, stagingKey };
}

async function stagingKeyOf(trackId: string, inFirm: FirmId = firmId): Promise<string | null> {
  const row = await database(inFirm)
    .prepare(`SELECT staging_key FROM meeting_recording_track WHERE id = ?1`)
    .bind(trackId)
    .first<{ staging_key: string | null }>();
  return row?.staging_key ?? null;
}

/** The deployment with the compose queue collected rather than delivered. */
function sweepEnvironment(): { environment: Bindings; sent: MeetingRecordingComposeMessage[] } {
  const sent: MeetingRecordingComposeMessage[] = [];
  return {
    environment: {
      ...env,
      MEETING_RECORDING_COMPOSE: {
        send: async (message: MeetingRecordingComposeMessage) => {
          sent.push(message);
        },
      },
    } as unknown as Bindings,
    sent,
  };
}

async function recordingRow(recordingId: string, inFirm: FirmId = firmId) {
  return await database(inFirm)
    .prepare(
      `SELECT state, stop_reason, stopped_by_user_id, failure_error_id, compose_attempts ` +
        `FROM meeting_recording WHERE id = ?1`,
    )
    .bind(recordingId)
    .first<{
      state: string;
      stop_reason: string | null;
      stopped_by_user_id: string | null;
      failure_error_id: string | null;
      compose_attempts: number;
    }>();
}

async function auditCount(event: string, recordingId: string): Promise<number> {
  const row = await database()
    .prepare(`SELECT COUNT(*) AS count FROM audit_log WHERE event = ?1 AND subject_id = ?2`)
    .bind(event, recordingId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** A running recording begun a while ago, which the room holds and is showing the mark for. */
async function runningForAWhile(meeting: RecordedMeeting): Promise<MeetingRecordingId> {
  const member = newIdentifier("user") as UserId;
  await database()
    .prepare(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Recorded', 'active', ?2)`,
    )
    .bind(member, new Date().toISOString())
    .run();
  const { recordingId } = await seedRunningRecording(meeting, [member]);
  const startedAt = new Date(Date.now() - 2 * RECORDER_STALL_MILLISECONDS).toISOString();
  await database()
    .prepare(`UPDATE meeting_recording SET started_at = ?1 WHERE id = ?2`)
    .bind(startedAt, recordingId)
    .run();
  await env.MEETING_ROOM.get(
    env.MEETING_ROOM.idFromName(`${firmId}:${meeting.meetingId}`),
  ).recordingStarted({
    firmId,
    meetingId: meeting.meetingId,
    recordingId,
    at: startedAt,
    by: { userId: meeting.hostUserId, displayName: "A Host" },
  });
  return recordingId;
}

function roomOf(meeting: RecordedMeeting) {
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meeting.meetingId}`));
}

describe("a recording whose recorder is gone", () => {
  it("is abandoned with nobody behind it, its open tracks lost, and the room's mark cleared", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    // The start's hand-over to the recorder never arrived: nothing is capturing this recording.
    const recordingId = await runningForAWhile(meeting);
    expect((await roomOf(meeting).runningRecording())?.recordingId).toBe(recordingId);

    const { environment } = sweepEnvironment();
    const report = await runRecordingSweep(environment);
    expect(report.abandoned).toBeGreaterThanOrEqual(1);
    expect(await recordingRow(recordingId)).toMatchObject({
      state: "abandoned",
      stop_reason: "abandoned",
      stopped_by_user_id: null,
    });
    const { results } = await database()
      .prepare(`SELECT state FROM meeting_recording_track WHERE recording_id = ?1`)
      .bind(recordingId)
      .all<{ state: string }>();
    expect(results.map((one) => one.state)).toEqual(["lost"]);
    expect(await auditCount("meetings.recording.abandoned", recordingId)).toBe(1);
    // The mark clears for everybody, rather than lying for the rest of the day.
    expect(await roomOf(meeting).runningRecording()).toBeNull();

    // Abandoned once: a second pass finds nothing running.
    await runRecordingSweep(environment);
    expect(await auditCount("meetings.recording.abandoned", recordingId)).toBe(1);
  });

  it("leaves alone a recording whose recorder is working", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const recordingId = await runningForAWhile(meeting);
    const recorders = env.MEETING_RECORDER!;
    const recorder = recorders.get(recorders.idFromName(`${firmId}:${recordingId}`));
    await recorder.start({
      firmId,
      meetingId: meeting.meetingId,
      matterId: meeting.matterId,
      recordingId,
      startedAt: new Date().toISOString(),
      ceiling: 11,
      tracks: [],
    });
    expect((await recorder.heartbeat()).state).toBe("recording");

    const { environment } = sweepEnvironment();
    await runRecordingSweep(environment);
    expect((await recordingRow(recordingId))?.state).toBe("recording");
    expect((await roomOf(meeting).runningRecording())?.recordingId).toBe(recordingId);

    // A recorder whose last pass is older than the window has stopped working, whatever it holds.
    await runRecordingSweep(environment, {
      now: () => Date.now() + 2 * RECORDER_STALL_MILLISECONDS,
    });
    expect((await recordingRow(recordingId))?.state).toBe("abandoned");
    // It let go of the recording when the sweep told it to, and composes nothing.
    expect((await recorder.heartbeat()).state).toBe("stopped");
  });
});

describe("a compose with no progress", () => {
  async function composingSince(meeting: RecordedMeeting, attempts: number) {
    const { recordingId } = await seedRunningRecording(meeting, []);
    const stoppedAt = new Date(Date.now() - 2 * COMPOSE_STALL_MILLISECONDS).toISOString();
    await database(meeting.firmId)
      .prepare(
        `UPDATE meeting_recording SET state = 'composing', stopped_at = ?1, stop_reason = 'member', ` +
          `captured_seconds = 4, compose_attempts = ?2, updated_at = ?1 WHERE id = ?3`,
      )
      .bind(stoppedAt, attempts, recordingId)
      .run();
    return recordingId;
  }

  it("is handed on again, one attempt counted", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const recordingId = await composingSince(meeting, 0);
    const { environment, sent } = sweepEnvironment();
    await runRecordingSweep(environment);
    expect(sent).toContainEqual({
      kind: "meeting-recording-compose",
      firmId,
      meetingId: meeting.meetingId,
      recordingId,
    });
    expect(await recordingRow(recordingId)).toMatchObject({
      state: "composing",
      compose_attempts: 1,
    });
    // Measured afresh from the hand-on: the next pass inside the window leaves it to work.
    await runRecordingSweep(environment);
    expect(sent.filter((one) => one.recordingId === recordingId)).toHaveLength(1);
  });

  it("is failed with an Error ID after the bounded number of attempts, once", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const recordingId = await composingSince(meeting, MAXIMUM_COMPOSE_ATTEMPTS);
    const { environment, sent } = sweepEnvironment();
    await runRecordingSweep(environment);
    expect(sent.filter((one) => one.recordingId === recordingId)).toEqual([]);
    const row = await recordingRow(recordingId);
    expect(row?.state).toBe("failed");
    expect(row?.failure_error_id).toMatch(/\S/);
    expect(await auditCount("meetings.recording.failed", recordingId)).toBe(1);
  });

  it("waits, rather than counting attempts, where no compose queue is bound", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const recordingId = await composingSince(meeting, 0);
    const unbound = { ...env, MEETING_RECORDING_COMPOSE: undefined } as unknown as Bindings;
    await runRecordingSweep(unbound);
    expect(await recordingRow(recordingId)).toMatchObject({
      state: "composing",
      compose_attempts: 0,
    });
  });
});

describe("staged tracks nothing needs", () => {
  it("keeps a failed recording's staging through the retention window, and deletes it after", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const member = newIdentifier("user") as UserId;
    await database()
      .prepare(
        `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, 'Staged', 'active', ?2)`,
      )
      .bind(member, new Date().toISOString())
      .run();
    const { recordingId, tracks } = await seedRunningRecording(meeting, [member]);
    const stagingKey = `meeting-recordings/${meeting.meetingId}/${recordingId}/${tracks[0]!.trackId}.pcm`;
    await env.R2.put(stagingKey, new Uint8Array(8));
    const now = new Date().toISOString();
    await database()
      .prepare(
        `UPDATE meeting_recording SET state = 'failed', stopped_at = ?1, stop_reason = 'member', ` +
          `failure_error_id = 'error-under-test', updated_at = ?1 WHERE id = ?2`,
      )
      .bind(now, recordingId)
      .run();
    await database()
      .prepare(
        `UPDATE meeting_recording_track SET staging_key = ?1, state = 'closed' WHERE id = ?2`,
      )
      .bind(stagingKey, tracks[0]!.trackId)
      .run();

    const { environment } = sweepEnvironment();
    // Inside the window: the only copy of what was captured is kept for a retry.
    await runRecordingSweep(environment);
    expect(await env.R2.head(stagingKey)).not.toBeNull();

    // Past it: the bytes go, and the row stops naming them.
    await runRecordingSweep(environment, {
      now: () => Date.now() + UNSETTLED_STAGING_RETENTION_MILLISECONDS + 60_000,
    });
    expect(await env.R2.head(stagingKey)).toBeNull();
    const track = await database()
      .prepare(`SELECT staging_key FROM meeting_recording_track WHERE id = ?1`)
      .bind(tracks[0]!.trackId)
      .first<{ staging_key: string | null }>();
    expect(track?.staging_key).toBeNull();
  });
});

describe("one firm's pass", () => {
  it("reaches only that firm's records and objects, and names that firm on what it hands on", async () => {
    const [firstFirm, secondFirm] = [await anotherFirm(), await anotherFirm()];
    const first = await seedRecordedMeeting(firstFirm);
    const second = await seedRecordedMeeting(secondFirm);
    // Each firm: a compose nothing has touched, and a failed recording's staging. The first firm's
    // is past the retention window; the second firm's is not.
    const stoppedLongAgo = new Date(Date.now() - 2 * COMPOSE_STALL_MILLISECONDS).toISOString();
    const stalled = async (meeting: RecordedMeeting) => {
      const { recordingId } = await seedRunningRecording(meeting, []);
      await database(meeting.firmId)
        .prepare(
          `UPDATE meeting_recording SET state = 'composing', stopped_at = ?1, stop_reason = 'member', ` +
            `captured_seconds = 4, updated_at = ?1 WHERE id = ?2`,
        )
        .bind(stoppedLongAgo, recordingId)
        .run();
      return recordingId;
    };
    const firstComposing = await stalled(first);
    const secondComposing = await stalled(second);
    const expiredStaging = await settledWithStaging(
      first,
      "failed",
      UNSETTLED_STAGING_RETENTION_MILLISECONDS + 60_000,
    );
    const keptStaging = await settledWithStaging(second, "failed", 60_000);

    const { environment, sent } = sweepEnvironment();
    await runRecordingSweep(environment);

    expect(sent).toContainEqual({
      kind: "meeting-recording-compose",
      firmId: firstFirm,
      meetingId: first.meetingId,
      recordingId: firstComposing,
    });
    expect(sent).toContainEqual({
      kind: "meeting-recording-compose",
      firmId: secondFirm,
      meetingId: second.meetingId,
      recordingId: secondComposing,
    });
    // Each recording is counted in its own firm's database, and only there.
    expect((await recordingRow(firstComposing, firstFirm))?.compose_attempts).toBe(1);
    expect((await recordingRow(secondComposing, secondFirm))?.compose_attempts).toBe(1);
    expect(await recordingRow(firstComposing, secondFirm)).toBeNull();
    // The first firm's expired staging went; the second firm's, inside its window, did not.
    expect(await env.R2.head(expiredStaging.stagingKey)).toBeNull();
    expect(await stagingKeyOf(expiredStaging.trackId, firstFirm)).toBeNull();
    expect(await env.R2.head(keptStaging.stagingKey)).not.toBeNull();
    expect(await stagingKeyOf(keptStaging.trackId, secondFirm)).toBe(keptStaging.stagingKey);
  });

  it("does not let one hand-on the queue refuses cost the rest of the pass", async () => {
    const inFirm = await anotherFirm();
    const meeting = await seedRecordedMeeting(inFirm);
    const { recordingId } = await seedRunningRecording(meeting, []);
    const stoppedLongAgo = new Date(Date.now() - 2 * COMPOSE_STALL_MILLISECONDS).toISOString();
    await database(inFirm)
      .prepare(
        `UPDATE meeting_recording SET state = 'composing', stopped_at = ?1, stop_reason = 'member', ` +
          `captured_seconds = 4, updated_at = ?1 WHERE id = ?2`,
      )
      .bind(stoppedLongAgo, recordingId)
      .run();
    const expired = await settledWithStaging(
      meeting,
      "failed",
      UNSETTLED_STAGING_RETENTION_MILLISECONDS + 60_000,
    );
    const refusing = {
      ...env,
      MEETING_RECORDING_COMPOSE: {
        send: async () => {
          throw new Error("the queue refused the message");
        },
      },
    } as unknown as Bindings;
    await runRecordingSweep(refusing);
    expect(await env.R2.head(expired.stagingKey)).toBeNull();
    expect(await stagingKeyOf(expired.trackId, inFirm)).toBeNull();
  });
});

describe("a recorder the sweep cannot reach", () => {
  it("decides nothing on a heartbeat that does not answer, and abandons once it can tell", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const recordingId = await runningForAWhile(meeting);
    const unreachable = {
      ...env,
      MEETING_RECORDER: {
        idFromName: (name: string) => env.MEETING_RECORDER!.idFromName(name),
        get: () => ({
          heartbeat: async () => {
            throw new Error("the recorder could not be reached");
          },
        }),
      },
    } as unknown as Bindings;
    await runRecordingSweep(unreachable);
    // One failed call is not evidence the recorder stopped working: it may be capturing right now.
    expect((await recordingRow(recordingId))?.state).toBe("recording");
    expect((await roomOf(meeting).runningRecording())?.recordingId).toBe(recordingId);

    await runRecordingSweep(sweepEnvironment().environment);
    expect((await recordingRow(recordingId))?.state).toBe("abandoned");
  });
});

describe("a filed recording's leftover staging", () => {
  it("is kept through a day's grace, and deleted after it", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const { trackId, stagingKey } = await settledWithStaging(meeting, "filed", 60_000);
    const { environment } = sweepEnvironment();
    await runRecordingSweep(environment);
    expect(await env.R2.head(stagingKey)).not.toBeNull();
    await runRecordingSweep(environment, {
      now: () => Date.now() + FILED_STAGING_GRACE_MILLISECONDS + 60_000,
    });
    expect(await env.R2.head(stagingKey)).toBeNull();
    expect(await stagingKeyOf(trackId)).toBeNull();
  });
});

describe("one pass is bounded", () => {
  it("hands on at most a batch of stalled composes and deletes at most a batch of staged objects per firm", async () => {
    const inFirm = await anotherFirm();
    const meeting = await seedRecordedMeeting(inFirm);
    const stoppedLongAgo = new Date(Date.now() - 2 * COMPOSE_STALL_MILLISECONDS).toISOString();
    const recordings = Array.from(
      { length: RECORDING_SWEEP_BATCH + 1 },
      () => newIdentifier("meetingRecording") as MeetingRecordingId,
    );
    await database(inFirm).batch(
      recordings.map((recordingId) =>
        database(inFirm)
          .prepare(
            `INSERT INTO meeting_recording (id, meeting_id, matter_id, breakout_id, state, ` +
              `started_by_user_id, started_at, stopped_at, stop_reason, track_count, captured_seconds, ` +
              `created_at, updated_at) VALUES (?1, ?2, ?3, NULL, 'composing', ?4, ?5, ?5, 'member', 0, 4, ?5, ?5)`,
          )
          .bind(
            recordingId,
            meeting.meetingId,
            meeting.matterId,
            meeting.hostUserId,
            stoppedLongAgo,
          ),
      ),
    );
    // One failed recording, long settled, naming more staged objects than one pass deletes.
    const failedId = newIdentifier("meetingRecording") as MeetingRecordingId;
    const longAgo = new Date(
      Date.now() - UNSETTLED_STAGING_RETENTION_MILLISECONDS - 60_000,
    ).toISOString();
    await database(inFirm)
      .prepare(
        `INSERT INTO meeting_recording (id, meeting_id, matter_id, breakout_id, state, ` +
          `started_by_user_id, started_at, stopped_at, stop_reason, track_count, failure_error_id, ` +
          `created_at, updated_at) VALUES (?1, ?2, ?3, NULL, 'failed', ?4, ?5, ?5, 'member', 0, ` +
          `'error-under-test', ?5, ?5)`,
      )
      .bind(failedId, meeting.meetingId, meeting.matterId, meeting.hostUserId, longAgo)
      .run();
    await database(inFirm).batch(
      Array.from({ length: STAGING_SWEEP_BATCH + 1 }, (_, index) =>
        database(inFirm)
          .prepare(
            `INSERT INTO meeting_recording_track (id, recording_id, participant_kind, participant_id, ` +
              `user_id, track_name, staging_key, state, created_at, updated_at) ` +
              `VALUES (?1, ?2, 'guest', ?3, NULL, ?4, ?5, 'closed', ?6, ?6)`,
          )
          .bind(
            newIdentifier("meetingRecordingTrack"),
            failedId,
            newIdentifier("meetingGuestStay"),
            `guest-${String(index)}:microphone`,
            `meeting-recordings/${meeting.meetingId}/${failedId}/staged-${String(index)}.pcm`,
            longAgo,
          ),
      ),
    );

    const { environment, sent } = sweepEnvironment();
    await runRecordingSweep(environment);
    expect(sent.filter((one) => one.firmId === inFirm)).toHaveLength(RECORDING_SWEEP_BATCH);
    const remaining = await database(inFirm)
      .prepare(
        `SELECT COUNT(*) AS count FROM meeting_recording_track WHERE recording_id = ?1 AND staging_key IS NOT NULL`,
      )
      .bind(failedId)
      .first<{ count: number }>();
    expect(remaining?.count).toBe(1);

    // The next pass takes the one left over first: the batch just handed on goes to the back.
    const handedOn = new Set(sent.map((one) => one.recordingId));
    const leftOver = recordings.filter((recordingId) => !handedOn.has(recordingId));
    expect(leftOver).toHaveLength(1);
    sent.length = 0;
    await runRecordingSweep(environment, {
      now: () => Date.now() + 2 * COMPOSE_STALL_MILLISECONDS,
    });
    expect(sent.map((one) => one.recordingId)).toContain(leftOver[0]);
  });
});
