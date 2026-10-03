import { env } from "cloudflare:test";
import { writeFirmSettingStatement } from "@magna-carta/data-access/setting-statements";
import { uploadPolicyDefinition } from "@magna-carta/file-manager/upload-policy";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MeetingRecordingId,
  MeetingRecordingTrackId,
} from "@magna-carta/identifiers/types";
import {
  recordingStagingKey,
  type MeetingRecordingTrackSegment,
} from "@magna-carta/meetings/recording-types";
import { readWavHeader, WAV_HEADER_BYTES } from "@magna-carta/meetings/wav";
import { beforeAll, describe, expect, it } from "vitest";
import type { Bindings } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type { MeetingRecordingComposeMessage } from "../src/meetings/meeting-recorder.ts";
import {
  COMPOSE_PART_BYTES,
  composeWindow,
  failRecordingCompose,
  meetingRecordingComposeQueue,
  RECORDING_TITLE_MAXIMUM_CHARACTERS,
  recordingFileName,
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
  // The stretches the row records, when the test is about them; absent writes none, as a row staged
  // before stretches were recorded.
  readonly segments?: readonly MeetingRecordingTrackSegment[];
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
  inFirm: FirmId = firmId,
): Promise<{
  recordingId: MeetingRecordingId;
  stagingKeys: string[];
  trackIds: MeetingRecordingTrackId[];
}> {
  const database = firmDatabaseFor(env.FIRM_DATABASE, inFirm);
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
      Math.floor(
        Math.max(...tracks.map((track) => track.offsetSamples + track.samples.length)) / RATE,
      ),
    )
    .run();
  const stagingKeys: string[] = [];
  const trackIds: MeetingRecordingTrackId[] = [];
  for (const [index, track] of tracks.entries()) {
    const trackId = newIdentifier("meetingRecordingTrack") as MeetingRecordingTrackId;
    const key = recordingStagingKey(meeting.meetingId, recordingId, trackId);
    stagingKeys.push(key);
    trackIds.push(trackId);
    await env.R2.put(key, pcmBytes(track.samples));
    const firstFrameAt = new Date(
      Date.parse(startedAt) + (track.offsetSamples / RATE) * 1000,
    ).toISOString();
    await database
      .prepare(
        `INSERT INTO meeting_recording_track (id, recording_id, participant_kind, participant_id, ` +
          `user_id, track_name, staging_key, first_frame_at, last_frame_at, frames_received, state, ` +
          `segments, created_at, updated_at) ` +
          `VALUES (?1, ?2, 'member', ?3, ?4, ?5, ?6, ?7, ?7, 1, ?8, ?10, ?9, ?9)`,
      )
      .bind(
        trackId,
        recordingId,
        newIdentifier("meetingAttendance"),
        await seedMemberIn(inFirm, `Speaker ${String(index)}`),
        `participant-${String(index)}:microphone`,
        key,
        firstFrameAt,
        track.state,
        startedAt,
        track.segments === undefined ? null : JSON.stringify(track.segments),
      )
      .run();
  }
  return { recordingId, stagingKeys, trackIds };
}

/**
 * The deployment with the two queues the compose step sends to collected rather than delivered — and,
 * for a test that has to act at one exact moment of a compose, the firm's bucket with that moment
 * hooked.
 */
function collectingEnvironment(bucket: R2Bucket = env.R2): {
  environment: Bindings;
  composeMessages: MeetingRecordingComposeMessage[];
  ingestMessages: { object: { key: string; size: number } }[];
} {
  const composeMessages: MeetingRecordingComposeMessage[] = [];
  const ingestMessages: { object: { key: string; size: number } }[] = [];
  const environment = {
    ...env,
    R2: bucket,
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

async function recordingRow(recordingId: string, inFirm: FirmId = firmId) {
  return await firmDatabaseFor(env.FIRM_DATABASE, inFirm)
    .prepare(
      `SELECT state, file_id, file_version_id, failure_error_id, compose_parts_done, ` +
        `compose_upload_session_id, compose_claimed_at, captured_seconds ` +
        `FROM meeting_recording WHERE id = ?1`,
    )
    .bind(recordingId)
    .first<{
      state: string;
      file_id: string | null;
      file_version_id: string | null;
      failure_error_id: string | null;
      compose_parts_done: number;
      compose_upload_session_id: string | null;
      compose_claimed_at: string | null;
      captured_seconds: number | null;
    }>();
}

function messageFor(meeting: RecordedMeeting, recordingId: MeetingRecordingId) {
  return {
    kind: "meeting-recording-compose",
    firmId: meeting.firmId,
    meetingId: meeting.meetingId,
    recordingId,
  } satisfies MeetingRecordingComposeMessage;
}

/** Delivers the compose's own hand-ons until it says it is done, as the queue would. */
async function drain(
  environment: Bindings,
  message: MeetingRecordingComposeMessage,
  options: { readonly partsPerInvocation?: number } = {},
): Promise<string> {
  for (let delivery = 0; delivery < 20; delivery += 1) {
    const outcome = await composeWindow(environment, message, options);
    if (outcome !== "progressed") return outcome;
  }
  throw new Error("the compose never settled");
}

/** The upload session and version a compose opened for a recording, and the key it writes at. */
async function compositeOf(recordingId: string, inFirm: FirmId = firmId) {
  return await firmDatabaseFor(env.FIRM_DATABASE, inFirm)
    .prepare(
      `SELECT upload_session.status AS session_status, upload_session.r2_upload_id AS upload_id, ` +
        `file_version.status AS version_status, file_version.r2_key AS r2_key ` +
        `FROM meeting_recording JOIN upload_session ` +
        `ON upload_session.id = meeting_recording.compose_upload_session_id ` +
        `JOIN file_version ON file_version.id = upload_session.file_version_id ` +
        `WHERE meeting_recording.id = ?1`,
    )
    .bind(recordingId)
    .first<{
      session_status: string;
      upload_id: string | null;
      version_status: string;
      r2_key: string;
    }>();
}

/** How many files a recording's compose has put on the matter, under the name it files them by. */
async function filesNamedLikeRecordings(meeting: RecordedMeeting): Promise<number> {
  const row = await firmDatabaseFor(env.FIRM_DATABASE, meeting.firmId)
    .prepare(
      `SELECT COUNT(*) AS count FROM file WHERE matter_id = ?1 AND name LIKE 'Meeting recording — %'`,
    )
    .bind(meeting.matterId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** A property of the runtime's own object, called on that object. */
function passThrough(target: object, property: string | symbol): unknown {
  const value: unknown = Reflect.get(target, property);
  return typeof value === "function"
    ? (value as (...args: unknown[]) => unknown).bind(target)
    : value;
}

/**
 * The bucket with one moment of a compose hooked: `before` runs (once, the first time) ahead of the
 * named operation on a key under `prefix` — by default `files/`, which is where the composite is
 * written, never a staged track. Every other call is the runtime's own.
 */
function bucketHookedAt(
  operation: "createMultipartUpload" | "uploadPart" | "head",
  before: (key: string) => Promise<void>,
  prefix = "files/",
): { bucket: R2Bucket; uploads: { key: string; uploadId: string }[] } {
  const bucket = env.R2;
  const uploads: { key: string; uploadId: string }[] = [];
  let fired = false;
  const once = async (key: string) => {
    if (fired || !key.startsWith(prefix)) return;
    fired = true;
    await before(key);
  };
  const hooked = new Proxy(bucket, {
    get(target, property) {
      if (property === "createMultipartUpload") {
        return async (key: string, options?: R2MultipartOptions) => {
          if (operation === "createMultipartUpload") await once(key);
          const upload = await target.createMultipartUpload(key, options);
          if (key.startsWith("files/")) uploads.push({ key, uploadId: upload.uploadId });
          return upload;
        };
      }
      if (property === "head") {
        return async (key: string) => {
          if (operation === "head") await once(key);
          return await target.head(key);
        };
      }
      if (property === "resumeMultipartUpload") {
        return (key: string, uploadId: string) => {
          const upload = target.resumeMultipartUpload(key, uploadId);
          return new Proxy(upload, {
            get(inner, name) {
              if (name !== "uploadPart") return passThrough(inner, name);
              return async (partNumber: number, value: Uint8Array) => {
                if (operation === "uploadPart") await once(key);
                return await inner.uploadPart(partNumber, value);
              };
            },
          });
        };
      }
      return passThrough(target, property);
    },
  });
  return { bucket: hooked, uploads };
}

/** A firm of its own, for a test that changes a firm-wide setting. */
async function anotherFirm(): Promise<FirmId> {
  const id = newIdentifier("firm") as FirmId;
  await seedFirmRow(id);
  return id;
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

describe("one window, one consumer", () => {
  it("never lets two deliveries of one window both compose it, and files exactly one composite", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const tracks: StagedTrack[] = [
      {
        offsetSamples: 0,
        samples: Int16Array.from({ length: FIRST_PART_SAMPLES + RATE }, (_, index) => index % 300),
        state: "closed",
      },
    ];
    const { recordingId } = await stoppedRecording(meeting, new Date().toISOString(), tracks);
    const message = messageFor(meeting, recordingId);
    const { environment, composeMessages } = collectingEnvironment();

    // The same message delivered twice at once: one claims the window and composes it, the other
    // stops at the claim having read nothing.
    const outcomes = await Promise.all([
      composeWindow(environment, message, { partsPerInvocation: 1 }),
      composeWindow(environment, message, { partsPerInvocation: 1 }),
    ]);
    expect(outcomes.toSorted()).toEqual(["nothing-to-do", "progressed"]);
    expect(composeMessages).toHaveLength(1);
    // The claim is let go with the progress, so the hand-on is picked up at once.
    expect(await recordingRow(recordingId)).toMatchObject({
      compose_parts_done: 1,
      compose_claimed_at: null,
    });

    expect(await drain(environment, message, { partsPerInvocation: 1 })).toBe("filed");
    expect(await filesNamedLikeRecordings(meeting)).toBe(1);
    const row = await recordingRow(recordingId);
    const file = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare(`SELECT r2_key FROM file_version WHERE id = ?1`)
      .bind(row?.file_version_id)
      .first<{ r2_key: string }>();
    const composite = new Uint8Array(await (await env.R2.get(file!.r2_key))!.arrayBuffer());
    const expected = expectedComposite(tracks);
    expect(composite.byteLength).toBe(WAV_HEADER_BYTES + expected.length * 2);
    const view = new DataView(composite.buffer, WAV_HEADER_BYTES);
    expect(view.getInt16((expected.length - 1) * 2, true)).toBe(expected[expected.length - 1]);
  });

  it("lets only one of two racing begins open the composite, and aborts the loser's upload", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const tracks: StagedTrack[] = [
      { offsetSamples: 0, samples: new Int16Array(RATE).fill(7), state: "closed" },
    ];
    const { recordingId } = await stoppedRecording(meeting, new Date().toISOString(), tracks);
    const message = messageFor(meeting, recordingId);
    const inner = collectingEnvironment();
    let secondOutcome: string | null = null;
    // THE FIRST BEGIN is paused at the instant it opens its multipart upload — after its session was
    // composed, before it is committed — and a second consumer whose lease on the window has run out
    // begins, commits and composes in that gap. The first then commits and is refused whole.
    const hooked = bucketHookedAt("createMultipartUpload", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      secondOutcome = await composeWindow(inner.environment, message, {
        claimLeaseMilliseconds: 0,
      });
    });
    const { environment } = collectingEnvironment(hooked.bucket);
    expect(await composeWindow(environment, message)).toBe("nothing-to-do");
    expect(secondOutcome).toBe("filed");
    expect(await filesNamedLikeRecordings(meeting)).toBe(1);
    // The loser's upload was opened and let go of: nothing can be written into it any more.
    const loser = hooked.uploads[0]!;
    const winner = await compositeOf(recordingId);
    expect(loser.uploadId).not.toBe(winner?.upload_id);
    await expect(
      env.R2.resumeMultipartUpload(loser.key, loser.uploadId).uploadPart(1, new Uint8Array(8)),
    ).rejects.toThrow();
    expect((await recordingRow(recordingId))?.state).toBe("filed");
  });
});

describe("a compose that can never finish", () => {
  it("is failed by the sweep while it files — the session aborted, the version abandoned, nothing left at the key", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const tracks: StagedTrack[] = [
      { offsetSamples: 0, samples: new Int16Array(2 * RATE).fill(9), state: "closed" },
    ];
    const { recordingId } = await stoppedRecording(meeting, new Date().toISOString(), tracks);
    const message = messageFor(meeting, recordingId);
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    // Every part is up and the compose is about to complete the composite when the sweep's failure
    // lands — committed, its upload aborted, its key cleared.
    const hooked = bucketHookedAt("head", async () => {
      expect(
        await failRecordingCompose(
          env,
          database,
          recordingId,
          "error_sweepUnderTest",
          async () => env.R2,
        ),
      ).toBe(true);
    });
    const { environment, ingestMessages } = collectingEnvironment(hooked.bucket);
    await expect(composeWindow(environment, message)).rejects.toThrow();

    const row = await recordingRow(recordingId);
    expect(row).toMatchObject({ state: "failed", failure_error_id: "error_sweepUnderTest" });
    expect(row?.file_id).toBeNull();
    const composite = await compositeOf(recordingId);
    expect(composite).toMatchObject({ session_status: "aborted", version_status: "abandoned" });
    expect(await env.R2.head(composite!.r2_key)).toBeNull();
    expect(ingestMessages).toEqual([]);
    // The queue's retry finds a recording that is settled, and does nothing.
    expect(await composeWindow(environment, message)).toBe("nothing-to-do");
    // And a second failure — the sweep's next pass, or the compose's own — changes nothing.
    expect(
      await failRecordingCompose(env, database, recordingId, "error_late", async () => env.R2),
    ).toBe(false);
    expect((await recordingRow(recordingId))?.failure_error_id).toBe("error_sweepUnderTest");
  });

  it("reads the record again before completing, and completes nothing for a recording failed since its window was claimed", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const tracks: StagedTrack[] = [
      { offsetSamples: 0, samples: new Int16Array(RATE).fill(4), state: "closed" },
    ];
    const { recordingId } = await stoppedRecording(meeting, new Date().toISOString(), tracks);
    const message = messageFor(meeting, recordingId);
    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);

    // A delivery that uploads every part and is cut off just before it completes the composite.
    const cutOff = bucketHookedAt("head", async () => {
      throw new Error("the invocation was cut off");
    });
    await expect(
      composeWindow(collectingEnvironment(cutOff.bucket).environment, message),
    ).rejects.toThrow("cut off");
    expect(await recordingRow(recordingId)).toMatchObject({
      state: "composing",
      compose_parts_done: 1,
      compose_claimed_at: null,
    });

    // The retry claims the window, and while it lays the tracks out the recording is failed — the
    // record alone, as a sweep that has committed and not yet reached the bucket leaves it.
    const failedMeanwhile = bucketHookedAt(
      "head",
      async () => {
        await database
          .prepare(
            `UPDATE meeting_recording SET state = 'failed', failure_error_id = 'error_recordOnly' WHERE id = ?1`,
          )
          .bind(recordingId)
          .run();
      },
      "meeting-recordings/",
    );
    const { environment, ingestMessages } = collectingEnvironment(failedMeanwhile.bucket);
    expect(await composeWindow(environment, message)).toBe("nothing-to-do");
    // Never completed into a document the record says does not exist.
    const composite = await compositeOf(recordingId);
    expect(await env.R2.head(composite!.r2_key)).toBeNull();
    expect(ingestMessages).toEqual([]);
    expect((await recordingRow(recordingId))?.file_id).toBeNull();
  });

  it("is failed with an Error ID when the upload pipeline refuses the composite, and opens nothing", async () => {
    const strictFirm = await anotherFirm();
    const meeting = await seedRecordedMeeting(strictFirm);
    const database = firmDatabaseFor(env.FIRM_DATABASE, strictFirm);
    await writeFirmSettingStatement(
      database,
      uploadPolicyDefinition,
      { ...uploadPolicyDefinition.defaultValue, maxSizeBytes: 1_000 },
      new Date().toISOString(),
    ).run();
    const { recordingId } = await stoppedRecording(
      meeting,
      new Date().toISOString(),
      [{ offsetSamples: 0, samples: new Int16Array(RATE).fill(3), state: "closed" }],
      strictFirm,
    );
    const { environment } = collectingEnvironment();
    expect(await composeWindow(environment, messageFor(meeting, recordingId))).toBe("failed");
    const row = await recordingRow(recordingId, strictFirm);
    expect(row?.state).toBe("failed");
    expect(row?.failure_error_id).toMatch(/^error_/);
    expect(row?.compose_upload_session_id).toBeNull();
    expect(await filesNamedLikeRecordings(meeting)).toBe(0);
  });

  it("refuses a recording too long for a WAV to describe before opening anything", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    // A track whose stretch the wall clock places thirteen hours in: past what a WAV can describe.
    const { recordingId } = await stoppedRecording(meeting, new Date().toISOString(), [
      { offsetSamples: 13 * 3600 * RATE, samples: new Int16Array(RATE).fill(2), state: "closed" },
    ]);
    const { environment } = collectingEnvironment();
    expect(await composeWindow(environment, messageFor(meeting, recordingId))).toBe("failed");
    const row = await recordingRow(recordingId);
    expect(row?.state).toBe("failed");
    expect(row?.compose_upload_session_id).toBeNull();
    expect(await filesNamedLikeRecordings(meeting)).toBe(0);
  });

  it("composes without a staged object missing when it begins, says so, and claims only what it filed", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const tracks: StagedTrack[] = [
      { offsetSamples: 0, samples: new Int16Array(2 * RATE).fill(100), state: "closed" },
      // The longer track — the one the recorder's captured length was measured to — is gone.
      { offsetSamples: RATE, samples: new Int16Array(5 * RATE).fill(200), state: "closed" },
    ];
    const { recordingId, stagingKeys, trackIds } = await stoppedRecording(
      meeting,
      new Date().toISOString(),
      tracks,
    );
    expect((await recordingRow(recordingId))?.captured_seconds).toBe(6);
    await env.R2.delete(stagingKeys[1]!);
    const { environment } = collectingEnvironment();
    expect(await drain(environment, messageFor(meeting, recordingId))).toBe("filed");
    const row = await recordingRow(recordingId);
    // Filed, with the fault on the way named, and the captured length brought down to the document.
    expect(row?.state).toBe("filed");
    expect(row?.failure_error_id).toMatch(/^error_/);
    expect(row?.captured_seconds).toBe(2);
    const missing = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare(`SELECT staging_key FROM meeting_recording_track WHERE id = ?1`)
      .bind(trackIds[1])
      .first<{ staging_key: string | null }>();
    expect(missing?.staging_key).toBeNull();
  });

  it("fails a recording whose staged object vanishes once the compose has begun, and lets go of the composite", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const tracks: StagedTrack[] = [
      {
        offsetSamples: 0,
        samples: new Int16Array(FIRST_PART_SAMPLES + RATE).fill(5),
        state: "closed",
      },
      { offsetSamples: 0, samples: new Int16Array(RATE).fill(6), state: "closed" },
    ];
    const { recordingId, stagingKeys } = await stoppedRecording(
      meeting,
      new Date().toISOString(),
      tracks,
    );
    const message = messageFor(meeting, recordingId);
    const { environment } = collectingEnvironment();
    expect(await composeWindow(environment, message, { partsPerInvocation: 1 })).toBe("progressed");
    await env.R2.delete(stagingKeys[1]!);
    expect(await composeWindow(environment, message, { partsPerInvocation: 1 })).toBe("failed");
    expect((await recordingRow(recordingId))?.state).toBe("failed");
    expect(await compositeOf(recordingId)).toMatchObject({
      session_status: "aborted",
      version_status: "abandoned",
    });
  });

  it("fails rather than write a composite whose header disagrees with its data when a staged object changes", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const tracks: StagedTrack[] = [
      {
        offsetSamples: 0,
        samples: new Int16Array(FIRST_PART_SAMPLES + RATE).fill(5),
        state: "closed",
      },
    ];
    const { recordingId, stagingKeys } = await stoppedRecording(
      meeting,
      new Date().toISOString(),
      tracks,
    );
    const message = messageFor(meeting, recordingId);
    const { environment } = collectingEnvironment();
    expect(await composeWindow(environment, message, { partsPerInvocation: 1 })).toBe("progressed");
    // The first part's header already says the length the compose began with.
    await env.R2.put(stagingKeys[0]!, pcmBytes(new Int16Array(FIRST_PART_SAMPLES + 3 * RATE)));
    expect(await composeWindow(environment, message, { partsPerInvocation: 1 })).toBe("failed");
    expect(await compositeOf(recordingId)).toMatchObject({ session_status: "aborted" });
  });
});

describe("a participant who left and came back", () => {
  it("places each stretch of one staged object at its own instant, and never the padding between", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    // One object: a second of audio, the silence that closed it to a "part boundary" (here three
    // seconds, so the test stays small), then a second more after the return — which was two seconds
    // in, not four.
    const object = new Int16Array(5 * RATE);
    object.fill(1_000, 0, RATE);
    object.fill(2_000, 4 * RATE, 5 * RATE);
    const startedAt = "2026-10-02T16:30:00.000Z";
    const at = (seconds: number) => new Date(Date.parse(startedAt) + seconds * 1000).toISOString();
    const { recordingId } = await stoppedRecording(meeting, startedAt, [
      {
        offsetSamples: 0,
        samples: object,
        state: "closed",
        segments: [
          { stagedFromSample: 0, at: at(0), stagedToSample: RATE },
          { stagedFromSample: 4 * RATE, at: at(2), stagedToSample: null },
        ],
      },
    ]);
    const { environment } = collectingEnvironment();
    expect(await drain(environment, messageFor(meeting, recordingId))).toBe("filed");
    const row = await recordingRow(recordingId);
    const version = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare(`SELECT r2_key FROM file_version WHERE id = ?1`)
      .bind(row?.file_version_id)
      .first<{ r2_key: string }>();
    const composite = new Uint8Array(await (await env.R2.get(version!.r2_key))!.arrayBuffer());
    // Three seconds — not five: the padding is not time anybody spent.
    expect(composite.byteLength).toBe(WAV_HEADER_BYTES + 3 * RATE * 2);
    const view = new DataView(composite.buffer, WAV_HEADER_BYTES);
    const sample = (seconds: number) => view.getInt16(Math.round(seconds * RATE) * 2, true);
    expect([sample(0.5), sample(1.5), sample(2.5)]).toEqual([1_000, 0, 2_000]);
  });
});

describe("the filed document's name", () => {
  it("reads a zone the runtime cannot resolve in UTC, and says so", () => {
    expect(
      recordingFileName({ title: "Deposition", timeZone: "Not/AZone" }, "2026-10-02T16:30:00.000Z"),
    ).toBe("Meeting recording — Deposition — 2026-10-02 16:30 UTC.wav");
  });

  it("takes controls, bidirectional overrides, invisible marks and path separators out of a hostile title, and cuts it short", () => {
    const name = recordingFileName(
      {
        title: "  ../../etc\\passwd\u0000\nRe:\u202Egpj.exe\u2066 deposition\u200B\u0085 ",
        timeZone: "America/Los_Angeles",
      },
      "2026-10-02T16:30:00.000Z",
    );
    expect(name).toBe(
      "Meeting recording — ..-..-etc-passwd Re:gpj.exe deposition — 2026-10-02 09:30.wav",
    );
    // Every character of the name is printable, visible and not a path separator.
    const forbidden = (code: number) =>
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x200b && code <= 0x200f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0x2f ||
      code === 0x5c;
    expect(
      Array.from(name).filter((character) => forbidden(character.codePointAt(0) ?? 0)),
    ).toEqual([]);

    const long = recordingFileName(
      { title: "Hearing ".repeat(60), timeZone: "UTC" },
      "2026-10-02T16:30:00.000Z",
    );
    const title = long.slice("Meeting recording — ".length, long.indexOf(" — 2026"));
    expect(Array.from(title)).toHaveLength(RECORDING_TITLE_MAXIMUM_CHARACTERS);
    expect(title.endsWith("…")).toBe(true);

    // A title with nothing printable left is named rather than left as a gap.
    expect(
      recordingFileName({ title: "\u202E\u0000", timeZone: "UTC" }, "2026-10-02T16:30:00.000Z"),
    ).toBe("Meeting recording — Untitled meeting — 2026-10-02 16:30.wav");
  });
});
