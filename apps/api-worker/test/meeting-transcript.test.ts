import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MeetingRecordingId,
  MeetingTranscriptId,
  UserId,
} from "@magna-carta/identifiers/types";
import type { TranscribeInput } from "@magna-carta/inference/port";
import { createStubInferencePort } from "@magna-carta/inference/stub";
import { adapterError, capabilityUnsupported } from "@magna-carta/integrations/dispatch";
import { integrationProblem } from "@magna-carta/integrations/problem";
import { recordingStagingKey } from "@magna-carta/meetings/recording-types";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, type Bindings } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import type {
  MeetingRecordingComposeMessage,
  MeetingRecordingQueueMessage,
  MeetingTranscriptMessage,
} from "../src/meetings/meeting-recorder.ts";
import { composeWindow } from "../src/meetings/recording-compose-consumer.ts";
import {
  runRecordingSweep,
  TRANSCRIPT_STALL_MILLISECONDS,
} from "../src/meetings/recording-sweep.ts";
import {
  meetingTranscriptQueue,
  TRANSCRIPT_MODEL_ATTEMPTS,
  transcribeWindow,
  type TranscriptionPort,
} from "../src/meetings/transcript-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedRecordedMeeting, type RecordedMeeting } from "./support/meeting-recording-fixture.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// THE TRANSCRIPT OF A FILED RECORDING, against the test pool's own bucket, the firm's own database and
// the platform's deterministic stub of the speech model.
//
// What would be a real failure if it stopped holding: the compose filing a recording without beginning
// its transcript, or deleting the staged audio the transcript has still to read; a line attributed to
// anybody but the track it came from — a guest's to anybody but the guest's stay; the lines out of the
// order they were said in; a lost speaker's silence left unsaid; two deliveries of one window sending
// the same audio to the model twice; a model that will not answer holding the staging forever, or
// failing the transcript without an Error ID; the staging released before the transcript settles, or
// never; the document filed anywhere but beside the audio on the same matter, through the upload
// pipeline; and a transcript of a walled matter's recording reachable through the read.

const RATE = 48_000;
const app = createApp();
const base = "https://example.com";

let firmId: FirmId;
let ownerCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Transcript Firm" })).firmId;
  const owner = await seedCredentialedUser("transcript-owner@example.com", {
    userName: "Transcript Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Transcript Owner", firmId);
  ownerCookie = await signInForSessionCookie("transcript-owner@example.com");
});

function database(inFirm: FirmId = firmId) {
  return firmDatabaseFor(env.FIRM_DATABASE, inFirm);
}

/** Deterministic noise under a floor, with tone bursts standing above it where somebody speaks. */
function speech(seconds: number, bursts: readonly (readonly [number, number])[]): Int16Array {
  const samples = new Int16Array(Math.round(seconds * RATE));
  let state = 11;
  for (let index = 0; index < samples.length; index += 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    samples[index] = Math.round(((state / 2_147_483_648) * 2 - 1) * 100);
  }
  for (const [from, to] of bursts) {
    for (let index = Math.round(from * RATE); index < Math.round(to * RATE); index += 1) {
      samples[index] =
        (samples[index] ?? 0) + Math.round(8_000 * Math.sin((2 * Math.PI * 440 * index) / RATE));
    }
  }
  return samples;
}

function pcmBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

/** One staged track as a test writes it. */
interface StagedTrack {
  readonly speaker:
    | { readonly kind: "member"; readonly name: string }
    | {
        readonly kind: "guest";
        readonly stayId: string;
      };
  readonly offsetSeconds: number;
  readonly samples: Int16Array;
  readonly state: "closed" | "lost";
}

/** A guest's stay in this meeting, under the name they typed at the door. */
async function seedGuestStay(meeting: RecordedMeeting, typedName: string): Promise<string> {
  const now = new Date().toISOString();
  const invitationId = newIdentifier("meetingGuestInvitation");
  const stayId = newIdentifier("meetingGuestStay");
  await database(meeting.firmId).batch([
    database(meeting.firmId)
      .prepare(
        `INSERT INTO meeting_guest_invitation (id, meeting_id, entity_kind, entity_id, invited_name, ` +
          `token_secret_hash, issued_by_user_id, expires_at, created_at, updated_at) VALUES ` +
          `(?1, ?2, 'person', ?3, ?4, ?5, ?6, '2099-01-01T00:00:00.000Z', ?7, ?7)`,
      )
      .bind(
        invitationId,
        meeting.meetingId,
        newIdentifier("directoryPerson"),
        typedName,
        "0".repeat(64),
        meeting.hostUserId,
        now,
      ),
    database(meeting.firmId)
      .prepare(
        `INSERT INTO meeting_guest_stay (id, meeting_id, invitation_id, confirmed_name, joined_at, ` +
          `waiting_from, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?5, ?5)`,
      )
      .bind(stayId, meeting.meetingId, invitationId, typedName, now),
  ]);
  return stayId;
}

/**
 * A stopped recording whose recorder has let go: each track's staged object complete in the bucket, its
 * row naming it with its first and last frame, and the captured length written — what the compose step
 * is handed.
 */
async function stoppedRecording(
  meeting: RecordedMeeting,
  startedAt: string,
  tracks: readonly StagedTrack[],
): Promise<{ recordingId: MeetingRecordingId; stagingKeys: string[] }> {
  const firm = database(meeting.firmId);
  const recordingId = newIdentifier("meetingRecording") as MeetingRecordingId;
  const lengthSeconds = Math.max(
    ...tracks.map((track) => track.offsetSeconds + track.samples.length / RATE),
  );
  const stoppedAt = new Date(Date.parse(startedAt) + lengthSeconds * 1000).toISOString();
  await firm
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
      Math.floor(lengthSeconds),
    )
    .run();
  const stagingKeys: string[] = [];
  for (const [index, track] of tracks.entries()) {
    const trackId = newIdentifier("meetingRecordingTrack");
    const key = recordingStagingKey(meeting.meetingId, recordingId, trackId);
    stagingKeys.push(key);
    await env.R2.put(key, pcmBytes(track.samples));
    const firstFrameAt = new Date(Date.parse(startedAt) + track.offsetSeconds * 1000).toISOString();
    const lastFrameAt = new Date(
      Date.parse(firstFrameAt) + (track.samples.length / RATE) * 1000,
    ).toISOString();
    let participantKind: "member" | "guest";
    let participantId: string;
    let userId: UserId | null;
    if (track.speaker.kind === "member") {
      participantKind = "member";
      participantId = newIdentifier("meetingAttendance");
      userId = newIdentifier("user") as UserId;
      await firm
        .prepare(
          `INSERT INTO member (user_id, display_name, status, created_at) VALUES (?1, ?2, 'active', ?3)`,
        )
        .bind(userId, track.speaker.name, startedAt)
        .run();
    } else {
      participantKind = "guest";
      participantId = track.speaker.stayId;
      userId = null;
    }
    await firm
      .prepare(
        `INSERT INTO meeting_recording_track (id, recording_id, participant_kind, participant_id, ` +
          `user_id, track_name, staging_key, first_frame_at, last_frame_at, frames_received, state, ` +
          `created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?11, ?11)`,
      )
      .bind(
        trackId,
        recordingId,
        participantKind,
        participantId,
        userId,
        `participant-${String(index)}:microphone`,
        key,
        firstFrameAt,
        lastFrameAt,
        track.state,
        startedAt,
      )
      .run();
  }
  return { recordingId, stagingKeys };
}

/** The deployment with the recording queue and the ingest queue collected rather than delivered. */
function collectingEnvironment(): {
  environment: Bindings;
  queued: MeetingRecordingQueueMessage[];
  ingested: { object: { key: string; size: number } }[];
} {
  const queued: MeetingRecordingQueueMessage[] = [];
  const ingested: { object: { key: string; size: number } }[] = [];
  const environment = {
    ...env,
    MEETING_RECORDING_COMPOSE: {
      send: async (message: MeetingRecordingQueueMessage) => {
        queued.push(message);
      },
    },
    FILES_INGEST: {
      send: async (message: { object: { key: string; size: number } }) => {
        ingested.push(message);
      },
    },
  } as unknown as Bindings;
  return { environment, queued, ingested };
}

/** The platform's stub speech model, with every call it was asked kept. */
function countingStub(): { port: TranscriptionPort; calls: TranscribeInput[] } {
  const stub = createStubInferencePort();
  const calls: TranscribeInput[] = [];
  return {
    calls,
    port: {
      transcribe: async (input) => {
        calls.push(input);
        return await stub.transcribe(input);
      },
    },
  };
}

/** Delivers a transcript's own hand-ons until it settles, as the queue would. */
async function drain(
  environment: Bindings,
  message: MeetingTranscriptMessage,
  port: TranscriptionPort,
  piecesPerInvocation?: number,
): Promise<string> {
  for (let delivery = 0; delivery < 40; delivery += 1) {
    const outcome = await transcribeWindow(environment, message, { port, piecesPerInvocation });
    if (outcome !== "progressed") return outcome;
  }
  throw new Error("the transcript never settled");
}

async function transcriptRow(transcriptId: string, inFirm: FirmId = firmId) {
  return await database(inFirm)
    .prepare(
      `SELECT state, file_id, file_version_id, failure_error_id, segment_count, word_count, ` +
        `claimed_at, attempts, model_id FROM meeting_transcript WHERE id = ?1`,
    )
    .bind(transcriptId)
    .first<{
      state: string;
      file_id: string | null;
      file_version_id: string | null;
      failure_error_id: string | null;
      segment_count: number | null;
      word_count: number | null;
      claimed_at: string | null;
      attempts: number;
      model_id: string | null;
    }>();
}

async function stagingStillNamed(recordingId: string, inFirm: FirmId = firmId): Promise<number> {
  const row = await database(inFirm)
    .prepare(
      `SELECT COUNT(*) AS count FROM meeting_recording_track WHERE recording_id = ?1 AND staging_key IS NOT NULL`,
    )
    .bind(recordingId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function objectsPresent(keys: readonly string[]): Promise<number> {
  let present = 0;
  for (const key of keys) if ((await env.R2.head(key)) !== null) present += 1;
  return present;
}

/** Composes a stopped recording until it is filed, as the queue would. */
async function composeToFiled(
  environment: Bindings,
  meeting: RecordedMeeting,
  recordingId: MeetingRecordingId,
): Promise<void> {
  const message: MeetingRecordingComposeMessage = {
    kind: "meeting-recording-compose",
    firmId: meeting.firmId,
    meetingId: meeting.meetingId,
    recordingId,
  };
  for (let delivery = 0; delivery < 10; delivery += 1) {
    const outcome = await composeWindow(environment, message);
    if (outcome === "filed") return;
    if (outcome !== "progressed") throw new Error(`the compose ended ${outcome}`);
  }
  throw new Error("the compose never filed");
}

/** The transcript message the compose handed on for a recording. */
function transcriptMessageIn(
  queued: readonly MeetingRecordingQueueMessage[],
  recordingId: string,
): MeetingTranscriptMessage {
  const message = queued.find(
    (one): one is MeetingTranscriptMessage =>
      one.kind === "meeting-transcript" && one.recordingId === recordingId,
  );
  if (message === undefined) throw new Error("the compose handed no transcript on");
  return message;
}

/** A filed recording of one member speaking twice, its transcript pending and its message in hand. */
async function filedRecordingAwaitingTranscript(inFirm: FirmId = firmId): Promise<{
  meeting: RecordedMeeting;
  recordingId: MeetingRecordingId;
  stagingKeys: string[];
  message: MeetingTranscriptMessage;
  environment: Bindings;
  queued: MeetingRecordingQueueMessage[];
}> {
  const meeting = await seedRecordedMeeting(inFirm);
  const { recordingId, stagingKeys } = await stoppedRecording(meeting, new Date().toISOString(), [
    {
      speaker: { kind: "member", name: "Solo Speaker" },
      offsetSeconds: 0,
      samples: speech(8, [
        [1, 2],
        [5, 6],
      ]),
      state: "closed",
    },
  ]);
  const { environment, queued } = collectingEnvironment();
  await composeToFiled(environment, meeting, recordingId);
  return {
    meeting,
    recordingId,
    stagingKeys,
    message: transcriptMessageIn(queued, recordingId),
    environment,
    queued,
  };
}

// Shared by the read's tests below: the meeting and recording the first test transcribes.
let transcribedMeeting: RecordedMeeting;
let transcribedRecordingId: MeetingRecordingId;
let guestStayId: string;

describe("a filed recording's transcript", () => {
  it("is begun by the filing, reads each track's own audio, and is filed beside the audio — staging released only when it settles", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    transcribedMeeting = meeting;
    guestStayId = await seedGuestStay(meeting, "Gail Guest");
    // 09:30 in Los Angeles, the event's own zone.
    const startedAt = "2026-10-02T16:30:00.000Z";
    const { recordingId, stagingKeys } = await stoppedRecording(meeting, startedAt, [
      // A member who speaks at 1 s and again at 10 s.
      {
        speaker: { kind: "member", name: "Ana Herrera" },
        offsetSeconds: 0,
        samples: speech(14, [
          [1, 2.5],
          [10, 11],
        ]),
        state: "closed",
      },
      // A guest who joined 2 s in and answered half a second later — on the recording, 2.5 s to 4 s.
      {
        speaker: { kind: "guest", stayId: guestStayId },
        offsetSeconds: 2,
        samples: speech(6, [[0.5, 2]]),
        state: "closed",
      },
      // A member whose socket was lost 1.5 s in and never came back.
      {
        speaker: { kind: "member", name: "Lost Speaker" },
        offsetSeconds: 0,
        samples: speech(1.5, []),
        state: "lost",
      },
    ]);
    transcribedRecordingId = recordingId;
    const { environment, queued, ingested } = collectingEnvironment();

    // THE FILING BEGINS THE TRANSCRIPT, and the staging stays for it.
    await composeToFiled(environment, meeting, recordingId);
    const message = transcriptMessageIn(queued, recordingId);
    expect(message).toMatchObject({
      kind: "meeting-transcript",
      firmId,
      meetingId: meeting.meetingId,
      recordingId,
    });
    expect((await transcriptRow(message.transcriptId))?.state).toBe("pending");
    expect(await objectsPresent(stagingKeys)).toBe(3);
    expect(await stagingStillNamed(recordingId)).toBe(3);

    // ONE PIECE PER WINDOW, so the window boundary is crossed: after the first, nothing is settled and
    // nothing is released.
    const { port, calls } = countingStub();
    expect(await transcribeWindow(environment, message, { port, piecesPerInvocation: 1 })).toBe(
      "progressed",
    );
    expect(calls).toHaveLength(1);
    expect((await transcriptRow(message.transcriptId))?.state).toBe("pending");
    expect(await objectsPresent(stagingKeys)).toBe(3);
    // The window handed itself on, and let go of its claim first.
    expect(queued.filter((one) => one.kind === "meeting-transcript")).toHaveLength(2);
    expect((await transcriptRow(message.transcriptId))?.claimed_at).toBeNull();

    expect(await drain(environment, message, port, 1)).toBe("ready");
    // Three pieces of speech in all — the member's two and the guest's one; the lost track had none.
    expect(calls).toHaveLength(3);
    // Every piece went as a 16 kHz mono WAV, and the member's second piece was prompted with the end
    // of their first one's words.
    for (const call of calls) {
      const view = new DataView(call.audio.buffer, call.audio.byteOffset);
      expect(view.getUint32(24, true)).toBe(16_000);
      expect(view.getUint16(22, true)).toBe(1);
    }
    // Only a track's SECOND piece is prompted, with the end of its first piece's words: the member's.
    const prompted = calls.filter((call) => call.initialPrompt !== undefined);
    expect(prompted).toHaveLength(1);
    expect(prompted[0]!.initialPrompt).toContain("[stub inference]");

    const row = await transcriptRow(message.transcriptId);
    expect(row).toMatchObject({ state: "ready", segment_count: 4, claimed_at: null });
    expect(row?.model_id).not.toBeNull();

    // THE LINES, in the order they were said, each attributed to its own track — the guest to the
    // guest's stay — and the lost speaker's silence said as a gap.
    const { results: lines } = await database()
      .prepare(
        `SELECT ordinal, kind, participant_kind, participant_id, user_id, started_ms, ended_ms ` +
          `FROM meeting_transcript_segment WHERE transcript_id = ?1 ORDER BY ordinal`,
      )
      .bind(message.transcriptId)
      .all<{
        ordinal: number;
        kind: string;
        participant_kind: string | null;
        participant_id: string | null;
        user_id: string | null;
        started_ms: number;
        ended_ms: number;
      }>();
    expect(lines.map((line) => [line.ordinal, line.kind, line.participant_kind])).toEqual([
      [0, "speech", "member"],
      [1, "gap", "member"],
      [2, "speech", "guest"],
      [3, "speech", "member"],
    ]);
    // Placed on the recording's own timeline: a pre-roll before each burst.
    expect(lines[0]!.started_ms).toBeGreaterThanOrEqual(850);
    expect(lines[0]!.started_ms).toBeLessThanOrEqual(950);
    // The gap runs from the lost speaker's last frame to the stop.
    expect(lines[1]).toMatchObject({ started_ms: 1_500, ended_ms: 14_000 });
    expect(lines[2]).toMatchObject({ participant_id: guestStayId, user_id: null });
    expect(lines[2]!.started_ms).toBeGreaterThanOrEqual(2_350);
    expect(lines[2]!.started_ms).toBeLessThanOrEqual(2_450);
    expect(lines[3]!.started_ms).toBeGreaterThanOrEqual(9_850);

    // THE DOCUMENT: on the recording's own matter, through the pipeline, named after the event.
    const file = await database()
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
    expect(file).toMatchObject({
      matter_id: meeting.matterId,
      name: "Meeting transcript — Settlement conference — 2026-10-02 09:30.vtt",
      content_type: "text/vtt",
      session_status: "completed",
    });
    const document = await (await env.R2.get(file!.r2_key))!.text();
    expect(document.startsWith("WEBVTT\n\nNOTE Meeting transcript — Settlement conference\n")).toBe(
      true,
    );
    expect(document).toContain("<v Ana Herrera>");
    expect(document).toContain("<v Gail Guest>");
    expect(document).toContain("[Audio from Lost Speaker was not captured]");
    // Ingest is driven exactly as for an uploaded file.
    expect(ingested).toContainEqual(
      expect.objectContaining({
        object: { key: file!.r2_key, size: new TextEncoder().encode(document).byteLength },
      }),
    );

    // SETTLED, SO RELEASED: the staged tracks are gone and the rows no longer name them.
    expect(await objectsPresent(stagingKeys)).toBe(0);
    expect(await stagingStillNamed(recordingId)).toBe(0);

    // ONE audit row for the transcript, of handles and counts only.
    const audit = await database()
      .prepare(
        `SELECT metadata FROM audit_log WHERE event = 'meetings.transcript.ready' AND subject_id = ?1`,
      )
      .bind(message.transcriptId)
      .all<{ metadata: string }>();
    expect(audit.results).toHaveLength(1);
    expect(Object.keys(JSON.parse(audit.results[0]!.metadata) as object).toSorted()).toEqual([
      "fileId",
      "fileVersionId",
      "meetingId",
      "readyAt",
      "recordingId",
      "segmentCount",
      "wordCount",
    ]);

    // A redelivery of a message whose transcript is ready changes nothing and asks the model nothing.
    expect(await transcribeWindow(environment, message, { port })).toBe("nothing-to-do");
    expect(calls).toHaveLength(3);
  });

  it("sends each piece to the model once however many deliveries of one window arrive together", async () => {
    const { message, environment, stagingKeys } = await filedRecordingAwaitingTranscript();
    const calls: TranscribeInput[] = [];
    const stub = createStubInferencePort();
    const slow: TranscriptionPort = {
      transcribe: async (input) => {
        calls.push(input);
        // Long enough that the second delivery arrives while the first is still with the model.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return await stub.transcribe(input);
      },
    };
    const outcomes = await Promise.all([
      transcribeWindow(environment, message, { port: slow }),
      transcribeWindow(environment, message, { port: slow }),
    ]);
    expect(outcomes.toSorted()).toEqual(["nothing-to-do", "ready"]);
    // Two bursts, two pieces: each sent once.
    expect(calls).toHaveLength(2);
    expect((await transcriptRow(message.transcriptId))?.segment_count).toBe(2);
    expect(await objectsPresent(stagingKeys)).toBe(0);
  });
});

/** A batch of one transcript message, delivered for the given time, recording what was done to it. */
function deliveredAs(message: MeetingTranscriptMessage, attempts: number) {
  const done: string[] = [];
  const batch = {
    queue: "magna-carta-production-meeting-recording-compose",
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    messages: [
      {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        body: message,
        attempts,
        ack: () => done.push("ack"),
        retry: () => done.push("retry"),
      },
    ],
    ackAll: () => done.push("ack"),
    retryAll: () => done.push("retry"),
  } as unknown as MessageBatch<MeetingTranscriptMessage>;
  return { batch, done };
}

describe("a speech model that will not answer", () => {
  it("is retried while deliveries remain, then fails the transcript with an Error ID and releases the staging", async () => {
    const { message, environment, stagingKeys, recordingId } =
      await filedRecordingAwaitingTranscript();
    let asked = 0;
    const busy: TranscriptionPort = {
      transcribe: async () => {
        asked += 1;
        return adapterError(integrationProblem("upstream", 503, "The speech model is busy"));
      },
    };

    const first = deliveredAs(message, 1);
    await meetingTranscriptQueue(first.batch, environment, { port: busy });
    expect(first.done).toEqual(["retry"]);
    expect(asked).toBe(1);
    // Still pending, its claim let go for the retry, and its staging kept.
    expect(await transcriptRow(message.transcriptId)).toMatchObject({
      state: "pending",
      claimed_at: null,
    });
    expect(await objectsPresent(stagingKeys)).toBe(1);

    const last = deliveredAs(message, TRANSCRIPT_MODEL_ATTEMPTS);
    await meetingTranscriptQueue(last.batch, environment, { port: busy });
    expect(last.done).toEqual(["ack"]);
    const row = await transcriptRow(message.transcriptId);
    expect(row?.state).toBe("failed");
    expect(row?.failure_error_id).toMatch(/\S/u);
    // A failed transcript settles as surely as a ready one: the staging is released.
    expect(await objectsPresent(stagingKeys)).toBe(0);
    expect(await stagingStillNamed(recordingId)).toBe(0);
    // The recording is filed and untouched.
    const recording = await database()
      .prepare(`SELECT state FROM meeting_recording WHERE id = ?1`)
      .bind(recordingId)
      .first<{ state: string }>();
    expect(recording?.state).toBe("filed");
  });

  it("fails at once on a refusal no retry can change, with an Error ID", async () => {
    const { message, environment, stagingKeys } = await filedRecordingAwaitingTranscript();
    const refusing: TranscriptionPort = { transcribe: async () => capabilityUnsupported() };
    expect(await transcribeWindow(environment, message, { port: refusing })).toBe("failed");
    expect((await transcriptRow(message.transcriptId))?.failure_error_id).toMatch(/\S/u);
    expect(await objectsPresent(stagingKeys)).toBe(0);
  });
});

describe("the sweep and a transcript that stopped moving", () => {
  it("keeps a filed recording's staging while its transcript is pending, hands it on, and fails it after its attempts — releasing the staging", async () => {
    const sweepFirm = (await seedFirm({ name: "Transcript Sweep Firm" })).firmId;
    const { message, environment, queued, stagingKeys, recordingId } =
      await filedRecordingAwaitingTranscript(sweepFirm);
    // Nothing touched it for longer than the stall window, and far longer than the filed grace.
    const twoDaysOn = () => Date.now() + 2 * 24 * 60 * 60 * 1000;
    await runRecordingSweep(environment, { now: twoDaysOn });
    // HANDED ON, NOT RELEASED: a pending transcript still reads the staging.
    expect(await transcriptRow(message.transcriptId, sweepFirm)).toMatchObject({
      state: "pending",
      attempts: 1,
    });
    expect(await objectsPresent(stagingKeys)).toBe(1);
    expect(await stagingStillNamed(recordingId, sweepFirm)).toBe(1);
    expect(
      queued.filter((one) => one.kind === "meeting-transcript" && one.recordingId === recordingId),
    ).toHaveLength(2);

    // Two more hand-ons with nothing moving in between, and the next pass fails it.
    for (let pass = 1; pass <= 3; pass += 1) {
      await runRecordingSweep(environment, {
        now: () => twoDaysOn() + pass * (TRANSCRIPT_STALL_MILLISECONDS + 60_000),
      });
    }
    const row = await transcriptRow(message.transcriptId, sweepFirm);
    expect(row?.state).toBe("failed");
    expect(row?.failure_error_id).toMatch(/\S/u);
    expect(await objectsPresent(stagingKeys)).toBe(0);
    expect(await stagingStillNamed(recordingId, sweepFirm)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------------------------

async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return await app.request(`${base}${path}`, { method: "GET", headers: { cookie } }, env);
}

interface TranscriptPage {
  transcript: { id: string; state: string; segmentCount: number | null; fileId: string | null };
  data: {
    ordinal: number;
    kind: string;
    text: string;
    speaker: {
      participantKind: string;
      participantId: string;
      userId: string | null;
      displayName: string;
    } | null;
  }[];
  nextCursor: string | null;
}

/** A filed recording with a ready transcript of `count` lines, seeded straight onto the record. */
async function readyTranscriptOf(
  meeting: RecordedMeeting,
  count: number,
): Promise<{ recordingId: string; transcriptId: MeetingTranscriptId }> {
  const firm = database(meeting.firmId);
  const now = new Date().toISOString();
  const recordingId = newIdentifier("meetingRecording");
  const transcriptId = newIdentifier("meetingTranscript") as MeetingTranscriptId;
  const fileId = newIdentifier("file");
  await firm.batch([
    firm
      .prepare(
        `INSERT INTO meeting_recording (id, meeting_id, matter_id, state, started_by_user_id, ` +
          `started_at, stopped_at, stop_reason, track_count, captured_seconds, created_at, updated_at) ` +
          `VALUES (?1, ?2, ?3, 'filed', ?4, ?5, ?5, 'member', 1, 60, ?5, ?5)`,
      )
      .bind(recordingId, meeting.meetingId, meeting.matterId, meeting.hostUserId, now),
    firm
      .prepare(
        `INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, 'x.vtt', ?3, ?3)`,
      )
      .bind(fileId, meeting.matterId, now),
    firm
      .prepare(
        `INSERT INTO meeting_transcript (id, meeting_id, recording_id, state, segment_count, ` +
          `file_id, created_at, updated_at) VALUES (?1, ?2, ?3, 'ready', ?4, ?5, ?6, ?6)`,
      )
      .bind(transcriptId, meeting.meetingId, recordingId, count, fileId, now),
    ...Array.from({ length: count }, (_, ordinal) =>
      firm
        .prepare(
          `INSERT INTO meeting_transcript_segment (id, transcript_id, ordinal, kind, ` +
            `participant_kind, participant_id, user_id, started_ms, ended_ms, text, created_at) ` +
            `VALUES (?1, ?2, ?3, 'speech', 'member', ?4, ?5, ?6, ?6, ?7, ?8)`,
        )
        .bind(
          newIdentifier("meetingTranscriptSegment"),
          transcriptId,
          ordinal,
          newIdentifier("meetingAttendance"),
          meeting.hostUserId,
          ordinal * 1000,
          `line ${String(ordinal)}`,
          now,
        ),
    ),
  ]);
  return { recordingId, transcriptId };
}

describe("reading a transcript", () => {
  it("answers the transcript's lines in order, a guest's line attributed to the guest's stay, and the list entry says where it stands", async () => {
    const page = await get(
      `/api/v1/meetings/${transcribedMeeting.meetingId}/recordings/${transcribedRecordingId}/transcript`,
    );
    expect(page.status).toBe(200);
    const body = await readJson<TranscriptPage>(page);
    expect(body.transcript).toMatchObject({ state: "ready", segmentCount: 4 });
    expect(body.data.map((line) => [line.ordinal, line.kind])).toEqual([
      [0, "speech"],
      [1, "gap"],
      [2, "speech"],
      [3, "speech"],
    ]);
    expect(body.data[2]!.speaker).toEqual({
      participantKind: "guest",
      participantId: guestStayId,
      userId: null,
      displayName: "Gail Guest",
    });
    expect(body.data[0]!.speaker?.displayName).toBe("Ana Herrera");
    expect(body.data[1]).toMatchObject({ text: "", speaker: { displayName: "Lost Speaker" } });
    expect(body.nextCursor).toBeNull();

    const list = await readJson<{
      data: { id: string; transcriptId: string | null; transcript: unknown }[];
    }>(await get(`/api/v1/meetings/${transcribedMeeting.meetingId}/recordings`));
    const entry = list.data.find((one) => one.id === transcribedRecordingId);
    expect(entry?.transcript).toEqual({
      id: body.transcript.id,
      state: "ready",
      fileId: body.transcript.fileId,
    });
    expect(entry?.transcriptId).toBe(body.transcript.id);
  });

  it("pages a long transcript by cursor", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const { recordingId } = await readyTranscriptOf(meeting, 205);
    const path = `/api/v1/meetings/${meeting.meetingId}/recordings/${recordingId}/transcript`;
    const first = await readJson<TranscriptPage>(await get(path));
    expect(first.data).toHaveLength(200);
    expect(first.data[199]!.ordinal).toBe(199);
    expect(first.nextCursor).not.toBeNull();
    const second = await readJson<TranscriptPage>(
      await get(`${path}?cursor=${encodeURIComponent(first.nextCursor!)}`),
    );
    expect(second.data.map((line) => line.ordinal)).toEqual([200, 201, 202, 203, 204]);
    expect(second.nextCursor).toBeNull();
  });

  it("answers a pending transcript's header with no lines, and a recording with none as not found", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const { recordingId, transcriptId } = await readyTranscriptOf(meeting, 3);
    await database()
      .prepare(`UPDATE meeting_transcript SET state = 'pending', file_id = NULL WHERE id = ?1`)
      .bind(transcriptId)
      .run();
    const pending = await readJson<TranscriptPage>(
      await get(`/api/v1/meetings/${meeting.meetingId}/recordings/${recordingId}/transcript`),
    );
    expect(pending).toMatchObject({ transcript: { state: "pending" }, data: [], nextCursor: null });

    const other = await readyTranscriptOf(meeting, 0);
    await database()
      .prepare(`DELETE FROM meeting_transcript WHERE id = ?1`)
      .bind(other.transcriptId)
      .run();
    expect(
      (
        await get(
          `/api/v1/meetings/${meeting.meetingId}/recordings/${other.recordingId}/transcript`,
        )
      ).status,
    ).toBe(404);
  });

  it("does not reach the transcript of a recording on a walled matter, nor one under another meeting", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const { recordingId } = await readyTranscriptOf(meeting, 2);
    // Under a meeting it does not belong to: as absent as one that names nothing.
    expect(
      (
        await get(
          `/api/v1/meetings/${transcribedMeeting.meetingId}/recordings/${recordingId}/transcript`,
        )
      ).status,
    ).toBe(404);
    // Wall the matter: the platform-owned holding key is exactly what the visibility predicate excludes.
    await database()
      .prepare(`UPDATE matter SET system_key = 'custody-holding' WHERE id = ?1`)
      .bind(meeting.matterId)
      .run();
    expect(
      (await get(`/api/v1/meetings/${meeting.meetingId}/recordings/${recordingId}/transcript`))
        .status,
    ).toBe(404);
  });
});
