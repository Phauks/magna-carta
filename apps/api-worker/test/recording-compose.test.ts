import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MeetingRecordingId,
  MeetingRecordingTrackId,
} from "@magna-carta/identifiers/types";
import { recordingStagingKey } from "@magna-carta/meetings/recording-types";
import { readWavHeader, WAV_HEADER_BYTES } from "@magna-carta/meetings/wav";
import { beforeAll, describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type { MeetingRecordingComposeMessage } from "../src/meetings/meeting-recorder.ts";
import {
  COMPOSE_PART_BYTES,
  composeWindow,
  meetingRecordingComposeQueue,
} from "../src/meetings/recording-compose-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  seedMemberIn,
  seedRecordedMeeting,
  type RecordedMeeting,
} from "./support/meeting-recording-fixture.ts";
import { seedFirmRow } from "./support/test-auth.ts";

// THE COMPOSE STEP, against the test pool's own bucket and the firm's own database.
//
// What would be a real failure if it stopped holding: the composite's samples are anything but the
// saturated sum of every track at its own offset — a track one sample early, a sum that wraps, a lost
// track's missing span filled with anything but silence — across the boundary where one window's
// invocation hands on to the next; the header's lengths do not match the data; the recording is filed
// anywhere but through the upload pipeline, as a file on the recording's own matter, scanned like any
// upload; or the staged tracks outlive the filing.

const RATE = 48_000;
// One part holds the header and this many samples; anything past it is in the second part.
const FIRST_PART_SAMPLES = (COMPOSE_PART_BYTES - WAV_HEADER_BYTES) / 2;

let firmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = newIdentifier("firm") as FirmId;
  await seedFirmRow(firmId);
});

/** One staged track as a test writes it: where it lands, what it holds, and the state it ended in. */
interface StagedTrack {
  readonly offsetSamples: number;
  readonly samples: Int16Array;
  readonly state: "closed" | "lost";
}

function pcmBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

/** The composite a recording of these tracks must produce: the sum at each offset, clamped once. */
function expectedComposite(tracks: readonly StagedTrack[]): Int16Array {
  const length = Math.max(...tracks.map((track) => track.offsetSamples + track.samples.length));
  const sums = new Int32Array(length);
  for (const track of tracks) {
    track.samples.forEach((value, index) => {
      sums[track.offsetSamples + index] = (sums[track.offsetSamples + index] ?? 0) + value;
    });
  }
  return Int16Array.from(sums, (sum) => Math.max(-32_768, Math.min(32_767, sum)));
}

/**
 * A stopped recording whose recorder has let go — every track's staged object complete in the firm's
 * bucket at the key the recorder mints, its row naming it, and the captured length written — exactly
 * what the compose step is handed.
 */
async function stoppedRecording(
  meeting: RecordedMeeting,
  startedAt: string,
  tracks: readonly StagedTrack[],
): Promise<{ recordingId: MeetingRecordingId; stagingKeys: string[] }> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const recordingId = newIdentifier("meetingRecording") as MeetingRecordingId;
  const stoppedAt = new Date(Date.parse(startedAt) + 120_000).toISOString();
  await database
    .prepare(
      `INSERT INTO meeting_recording (id, meeting_id, matter_id, breakout_id, state, started_by_user_id, ` +
        `started_at, stopped_by_user_id, stopped_at, stop_reason, track_count, captured_seconds, ` +
        `created_at, updated_at) VALUES (?1, ?2, ?3, NULL, 'composing', ?4, ?5, ?4, ?6, 'member', ?7, ` +
        `?8, ?5, ?6)`,
    )
    .bind(
      recordingId,
      meeting.meetingId,
      meeting.matterId,
      meeting.hostUserId,
      startedAt,
      stoppedAt,
      tracks.length,
      Math.floor(expectedComposite(tracks).length / RATE),
    )
    .run();
  const stagingKeys: string[] = [];
  for (const [index, track] of tracks.entries()) {
    const trackId = newIdentifier("meetingRecordingTrack") as MeetingRecordingTrackId;
    const key = recordingStagingKey(meeting.meetingId, recordingId, trackId);
    stagingKeys.push(key);
    await env.R2.put(key, pcmBytes(track.samples));
    const firstFrameAt = new Date(
      Date.parse(startedAt) + (track.offsetSamples / RATE) * 1000,
    ).toISOString();
    await database
      .prepare(
        `INSERT INTO meeting_recording_track (id, recording_id, participant_kind, participant_id, ` +
          `user_id, track_name, staging_key, first_frame_at, last_frame_at, frames_received, state, ` +
          `created_at, updated_at) VALUES (?1, ?2, 'member', ?3, ?4, ?5, ?6, ?7, ?7, 1, ?8, ?9, ?9)`,
      )
      .bind(
        trackId,
        recordingId,
        newIdentifier("meetingAttendance"),
        await seedMemberIn(firmId, `Speaker ${String(index)}`),
        `participant-${String(index)}:microphone`,
        key,
        firstFrameAt,
        track.state,
        startedAt,
      )
      .run();
  }
  return { recordingId, stagingKeys };
}

/** The deployment with the two queues the compose step sends to collected rather than delivered. */
function collectingEnvironment(): {
  environment: Bindings;
  composeMessages: MeetingRecordingComposeMessage[];
  ingestMessages: { object: { key: string; size: number } }[];
} {
  const composeMessages: MeetingRecordingComposeMessage[] = [];
  const ingestMessages: { object: { key: string; size: number } }[] = [];
  const environment = {
    ...env,
    MEETING_RECORDING_COMPOSE: {
      send: async (message: MeetingRecordingComposeMessage) => {
        composeMessages.push(message);
      },
    },
    FILES_INGEST: {
      send: async (message: { object: { key: string; size: number } }) => {
        ingestMessages.push(message);
      },
    },
  } as unknown as Bindings;
  return { environment, composeMessages, ingestMessages };
}

async function recordingRow(recordingId: string) {
  return await firmDatabaseFor(env.FIRM_DATABASE, firmId)
    .prepare(
      `SELECT state, file_id, file_version_id, failure_error_id, compose_parts_done, ` +
        `compose_upload_session_id FROM meeting_recording WHERE id = ?1`,
    )
    .bind(recordingId)
    .first<{
      state: string;
      file_id: string | null;
      file_version_id: string | null;
      failure_error_id: string | null;
      compose_parts_done: number;
      compose_upload_session_id: string | null;
    }>();
}

describe("composing a recording", () => {
  it("mixes three tracks — one late, one lost — into a WAV of their saturated sum across a window boundary, and files it on the matter", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    // 09:30 in Los Angeles, the event's own zone.
    const startedAt = "2026-10-02T16:30:00.000Z";
    const tracks: StagedTrack[] = [
      // From the first instant, varying, and long enough to run past the first part.
      {
        offsetSamples: 0,
        samples: Int16Array.from(
          { length: FIRST_PART_SAMPLES + RATE },
          (_, index) => ((index % 200) - 100) * 100,
        ),
        state: "closed",
      },
      // A second late, and loud: where it overlaps the first the sum passes the 16-bit limit.
      {
        offsetSamples: RATE,
        samples: new Int16Array(FIRST_PART_SAMPLES - RATE / 2).fill(25_000),
        state: "closed",
      },
      // Half a second in, LOST two seconds later: its audio up to the loss, silence after it.
      {
        offsetSamples: RATE / 2,
        samples: new Int16Array(2 * RATE).fill(-3_000),
        state: "lost",
      },
    ];
    const { recordingId, stagingKeys } = await stoppedRecording(meeting, startedAt, tracks);
    const message: MeetingRecordingComposeMessage = {
      kind: "meeting-recording-compose",
      firmId,
      meetingId: meeting.meetingId,
      recordingId,
    };
    const { environment, composeMessages, ingestMessages } = collectingEnvironment();

    // ONE PART PER INVOCATION here, so the window boundary is also the hand-off between invocations.
    expect(await composeWindow(environment, message, { partsPerInvocation: 1 })).toBe("progressed");
    expect(composeMessages).toEqual([message]);
    expect(await recordingRow(recordingId)).toMatchObject({
      state: "composing",
      compose_parts_done: 1,
    });

    // The next window, as the queue would deliver the re-enqueued message.
    expect(await composeWindow(environment, message, { partsPerInvocation: 1 })).toBe("filed");
    expect(composeMessages).toHaveLength(1);

    const row = await recordingRow(recordingId);
    expect(row).toMatchObject({ state: "filed", compose_parts_done: 2 });
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const file = await database
      .prepare(
        `SELECT file.matter_id AS matter_id, file.name AS name, file_version.r2_key AS r2_key, ` +
          `file_version.declared_content_type AS content_type, upload_session.status AS session_status ` +
          `FROM file JOIN file_version ON file_version.file_id = file.id ` +
          `JOIN upload_session ON upload_session.file_version_id = file_version.id ` +
          `WHERE file.id = ?1 AND file_version.id = ?2`,
      )
      .bind(row?.file_id, row?.file_version_id)
      .first<{
        matter_id: string;
        name: string;
        r2_key: string;
        content_type: string;
        session_status: string;
      }>();
    // THROUGH THE PIPELINE: a file on the recording's own matter, its version waiting on the scan.
    expect(file).toMatchObject({
      matter_id: meeting.matterId,
      name: "Meeting recording — Settlement conference — 2026-10-02 09:30.wav",
      content_type: "audio/wav",
      session_status: "completed",
    });

    // THE BYTES: a header whose lengths match the data, and the saturated sum, sample for sample.
    const composite = new Uint8Array(await (await env.R2.get(file!.r2_key))!.arrayBuffer());
    const expected = expectedComposite(tracks);
    expect(composite.byteLength).toBe(WAV_HEADER_BYTES + expected.length * 2);
    expect(readWavHeader(composite)).toMatchObject({
      channels: 1,
      sampleRate: RATE,
      bitsPerSample: 16,
      dataBytes: expected.length * 2,
      riffBytes: 36 + expected.length * 2,
    });
    const view = new DataView(composite.buffer, WAV_HEADER_BYTES);
    let mismatches = 0;
    let firstMismatch = -1;
    for (let index = 0; index < expected.length; index += 1) {
      if (view.getInt16(index * 2, true) !== expected[index]) {
        mismatches += 1;
        if (firstMismatch < 0) firstMismatch = index;
      }
    }
    expect({ mismatches, firstMismatch }).toEqual({ mismatches: 0, firstMismatch: -1 });
    // And the cases the sum is about, named: the overlap saturates, and the lost track's span is the
    // other two alone once it was lost.
    // Past the loss, where the first track peaks: 9,900 + 25,000 is past the limit and clamps.
    const peak = RATE / 2 + 2 * RATE + 199;
    expect(peak % 200).toBe(199);
    expect(view.getInt16(peak * 2, true)).toBe(32_767);
    expect(view.getInt16((RATE / 2 + 2 * RATE + 10) * 2, true)).toBe(
      (((RATE / 2 + 2 * RATE + 10) % 200) - 100) * 100 + 25_000,
    );

    // INGEST is driven exactly as for an uploaded file.
    expect(ingestMessages).toEqual([
      expect.objectContaining({ object: { key: file!.r2_key, size: composite.byteLength } }),
    ]);
    // THE STAGED TRACKS ARE GONE, and the rows no longer name them.
    for (const key of stagingKeys) expect(await env.R2.head(key)).toBeNull();
    const { results } = await database
      .prepare(`SELECT staging_key FROM meeting_recording_track WHERE recording_id = ?1`)
      .bind(recordingId)
      .all<{ staging_key: string | null }>();
    expect(results.map((one) => one.staging_key)).toEqual([null, null, null]);
    // ONE audit row for the filing, of handles only.
    const audit = await database
      .prepare(
        `SELECT metadata FROM audit_log WHERE event = 'meetings.recording.filed' AND subject_id = ?1`,
      )
      .bind(recordingId)
      .all<{ metadata: string }>();
    expect(audit.results).toHaveLength(1);
    expect(Object.keys(JSON.parse(audit.results[0]!.metadata) as object).toSorted()).toEqual([
      "fileId",
      "fileVersionId",
      "filedAt",
      "meetingId",
    ]);

    // A redelivery of a message whose recording is filed changes nothing.
    expect(await composeWindow(environment, message)).toBe("nothing-to-do");
  });

  it("waits for a recorder that has not let go, and fails a recording with nothing staged", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const startedAt = new Date().toISOString();
    const { recordingId, stagingKeys } = await stoppedRecording(meeting, startedAt, [
      { offsetSamples: 0, samples: new Int16Array(RATE).fill(1), state: "closed" },
    ]);
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const message: MeetingRecordingComposeMessage = {
      kind: "meeting-recording-compose",
      firmId,
      meetingId: meeting.meetingId,
      recordingId,
    };
    const { environment } = collectingEnvironment();

    // Not yet let go of: the captured length is the recorder's last word, and it has not said it.
    await database
      .prepare(`UPDATE meeting_recording SET captured_seconds = NULL WHERE id = ?1`)
      .bind(recordingId)
      .run();
    expect(await composeWindow(environment, message)).toBe("nothing-to-do");
    expect(await recordingRow(recordingId)).toMatchObject({ state: "composing" });

    // Let go of, with nothing in the bucket: failed with an Error ID, and nothing filed.
    await database
      .prepare(`UPDATE meeting_recording SET captured_seconds = 1 WHERE id = ?1`)
      .bind(recordingId)
      .run();
    await env.R2.delete(stagingKeys);
    const batch = {
      queue: "magna-carta-production-meeting-recording-compose",
      messages: [{ body: message, ack: () => {}, retry: () => {} }],
    } as unknown as MessageBatch<MeetingRecordingComposeMessage>;
    await meetingRecordingComposeQueue(batch, environment);
    const row = await recordingRow(recordingId);
    expect(row?.state).toBe("failed");
    expect(row?.failure_error_id).toMatch(/\S/);
    expect(row?.file_id).toBeNull();
  });
});
