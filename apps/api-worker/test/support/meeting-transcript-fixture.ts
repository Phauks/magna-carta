import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MeetingRecordingId, UserId } from "@magna-carta/identifiers/types";
import type { TranscribeInput } from "@magna-carta/inference/port";
import { createStubInferencePort } from "@magna-carta/inference/stub";
import { recordingStagingKey } from "@magna-carta/meetings/recording-types";
import type { Bindings } from "../../src/bindings.ts";
import { firmDatabaseFor } from "../../src/firm-database/firm-database-proxy.ts";
import type {
  MeetingRecordingComposeMessage,
  MeetingRecordingQueueMessage,
  MeetingTranscriptMessage,
} from "../../src/meetings/meeting-recorder.ts";
import { composeWindow } from "../../src/meetings/recording-compose-consumer.ts";
import {
  transcribeWindow,
  type TranscriptionPort,
  type TranscriptOptions,
} from "../../src/meetings/transcript-consumer.ts";
import { seedRecordedMeeting, type RecordedMeeting } from "./meeting-recording-fixture.ts";

// The shared scaffolding of the transcript suites: staged tracks written into the test pool's own
// bucket as the recorder would leave them, a recording composed until it is filed (which begins its
// transcript), the deployment with its queues collected rather than delivered, and the platform's stub
// speech model with every call it was asked kept. Every row is written straight through the
// firm-scoped data-access proxy in the shape the services write it.

export const RATE = 48_000;

export function firmDatabase(firmId: FirmId) {
  return firmDatabaseFor(env.FIRM_DATABASE, firmId);
}

/** Deterministic noise under a floor, with tone bursts standing above it where somebody speaks. */
export function speech(
  seconds: number,
  bursts: readonly (readonly [number, number])[],
): Int16Array {
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

export function pcmBytes(samples: Int16Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}

/** One staged track as a test writes it. */
export interface StagedTrack {
  readonly speaker:
    | { readonly kind: "member"; readonly name: string }
    | {
        readonly kind: "guest";
        readonly stayId: string;
      };
  readonly offsetSeconds: number;
  readonly samples: Int16Array;
  readonly state: "closed" | "lost";
  // The track's stretches as the recorder writes them (`MeetingRecordingTrackSegment[]`), for a
  // participant who left and came back; absent is one stretch from the first frame.
  readonly segments?: readonly {
    readonly stagedFromSample: number;
    readonly at: string;
    readonly stagedToSample: number | null;
  }[];
  // The instant of the track's last frame, when it is not the end of its samples from its first.
  readonly lastFrameAt?: string;
}

/** A guest's stay in this meeting, under the name they typed at the door. */
export async function seedGuestStay(meeting: RecordedMeeting, typedName: string): Promise<string> {
  const database = firmDatabase(meeting.firmId);
  const now = new Date().toISOString();
  const invitationId = newIdentifier("meetingGuestInvitation");
  const stayId = newIdentifier("meetingGuestStay");
  await database.batch([
    database
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
    database
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
export async function stoppedRecording(
  meeting: RecordedMeeting,
  startedAt: string,
  tracks: readonly StagedTrack[],
): Promise<{ recordingId: MeetingRecordingId; stagingKeys: string[]; trackIds: string[] }> {
  const firm = firmDatabase(meeting.firmId);
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
  const trackIds: string[] = [];
  for (const [index, track] of tracks.entries()) {
    const trackId = newIdentifier("meetingRecordingTrack");
    trackIds.push(trackId);
    const key = recordingStagingKey(meeting.meetingId, recordingId, trackId);
    stagingKeys.push(key);
    await env.R2.put(key, pcmBytes(track.samples));
    const firstFrameAt = new Date(Date.parse(startedAt) + track.offsetSeconds * 1000).toISOString();
    const lastFrameAt =
      track.lastFrameAt ??
      new Date(Date.parse(firstFrameAt) + (track.samples.length / RATE) * 1000).toISOString();
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
          `segments, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?11, ` +
          `?12, ?12)`,
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
        track.segments === undefined ? null : JSON.stringify(track.segments),
        startedAt,
      )
      .run();
  }
  return { recordingId, stagingKeys, trackIds };
}

/** What a send to the recording queue was asked to wait before delivery, beside the message. */
export interface QueuedSend {
  readonly message: MeetingRecordingQueueMessage;
  readonly delaySeconds: number | undefined;
}

/** The deployment with the recording queue and the ingest queue collected rather than delivered. */
export function collectingEnvironment(base: Partial<Bindings> = {}): {
  environment: Bindings;
  queued: MeetingRecordingQueueMessage[];
  sends: QueuedSend[];
  ingested: { object: { key: string; size: number } }[];
} {
  const queued: MeetingRecordingQueueMessage[] = [];
  const sends: QueuedSend[] = [];
  const ingested: { object: { key: string; size: number } }[] = [];
  const environment = {
    ...env,
    MEETING_RECORDING_COMPOSE: {
      send: async (
        message: MeetingRecordingQueueMessage,
        options?: { readonly delaySeconds?: number },
      ) => {
        queued.push(message);
        sends.push({ message, delaySeconds: options?.delaySeconds });
      },
    },
    FILES_INGEST: {
      send: async (message: { object: { key: string; size: number } }) => {
        ingested.push(message);
      },
    },
    ...base,
  } as unknown as Bindings;
  return { environment, queued, sends, ingested };
}

/** The platform's stub speech model, with every call it was asked kept. */
export function countingStub(): { port: TranscriptionPort; calls: TranscribeInput[] } {
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

/** The playing time of a 16 kHz mono 16-bit WAV the consumer sent, in milliseconds. */
export function wavMilliseconds(audio: Uint8Array): number {
  return ((audio.byteLength - 44) / 2 / 16_000) * 1000;
}

/** Delivers a transcript's own hand-ons until it settles, as the queue would. */
export async function drain(
  environment: Bindings,
  message: MeetingTranscriptMessage,
  port: TranscriptionPort,
  piecesPerInvocation?: number,
  options: TranscriptOptions = {},
): Promise<string> {
  for (let delivery = 0; delivery < 60; delivery += 1) {
    const outcome = await transcribeWindow(environment, message, {
      port,
      piecesPerInvocation,
      ...options,
    });
    if (outcome !== "progressed") return outcome;
  }
  throw new Error("the transcript never settled");
}

export async function transcriptRow(transcriptId: string, firmId: FirmId) {
  return await firmDatabase(firmId)
    .prepare(
      `SELECT state, file_id, file_version_id, failure_error_id, segment_count, word_count, ` +
        `claimed_at, attempts, model_failures, model_id, language, transcribed_milliseconds, ` +
        `upload_session_id FROM meeting_transcript WHERE id = ?1`,
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
      model_failures: number;
      model_id: string | null;
      language: string | null;
      transcribed_milliseconds: number;
      upload_session_id: string | null;
    }>();
}

/** A transcript's lines in their stored order, as the read would place them. */
export async function transcriptLines(transcriptId: string, firmId: FirmId) {
  const { results } = await firmDatabase(firmId)
    .prepare(
      `SELECT ordinal, kind, participant_kind, participant_id, user_id, track_id, started_ms, ` +
        `ended_ms, text FROM meeting_transcript_segment WHERE transcript_id = ?1 ORDER BY ordinal`,
    )
    .bind(transcriptId)
    .all<{
      ordinal: number;
      kind: string;
      participant_kind: string | null;
      participant_id: string | null;
      user_id: string | null;
      track_id: string | null;
      started_ms: number;
      ended_ms: number;
      text: string;
    }>();
  return results;
}

export async function stagingStillNamed(recordingId: string, firmId: FirmId): Promise<number> {
  const row = await firmDatabase(firmId)
    .prepare(
      `SELECT COUNT(*) AS count FROM meeting_recording_track WHERE recording_id = ?1 AND staging_key IS NOT NULL`,
    )
    .bind(recordingId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function objectsPresent(keys: readonly string[]): Promise<number> {
  let present = 0;
  for (const key of keys) if ((await env.R2.head(key)) !== null) present += 1;
  return present;
}

/** Composes a stopped recording until it is filed, as the queue would. */
export async function composeToFiled(
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
export function transcriptMessageIn(
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

/**
 * A filed recording of the given tracks — by default one member speaking twice — its transcript pending
 * and its message in hand.
 */
export async function filedRecordingAwaitingTranscript(
  firmId: FirmId,
  tracks?: readonly StagedTrack[],
  base: Partial<Bindings> = {},
  startedAt: string = new Date().toISOString(),
): Promise<{
  meeting: RecordedMeeting;
  recordingId: MeetingRecordingId;
  stagingKeys: string[];
  trackIds: string[];
  message: MeetingTranscriptMessage;
  environment: Bindings;
  queued: MeetingRecordingQueueMessage[];
  sends: QueuedSend[];
  ingested: { object: { key: string; size: number } }[];
}> {
  const meeting = await seedRecordedMeeting(firmId);
  const { recordingId, stagingKeys, trackIds } = await stoppedRecording(
    meeting,
    startedAt,
    tracks ?? [
      {
        speaker: { kind: "member", name: "Solo Speaker" },
        offsetSeconds: 0,
        samples: speech(8, [
          [1, 2],
          [5, 6],
        ]),
        state: "closed",
      },
    ],
  );
  const { environment, queued, sends, ingested } = collectingEnvironment(base);
  await composeToFiled(environment, meeting, recordingId);
  return {
    meeting,
    recordingId,
    stagingKeys,
    trackIds,
    message: transcriptMessageIn(queued, recordingId),
    environment,
    queued,
    sends,
    ingested,
  };
}

/** A batch of one transcript message, delivered for the given time, recording what was done to it. */
export function deliveredAs(message: MeetingTranscriptMessage, attempts: number) {
  const done: { readonly act: "ack" | "retry"; readonly delaySeconds?: number }[] = [];
  const batch = {
    queue: "magna-carta-production-meeting-recording-compose",
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    messages: [
      {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        body: message,
        attempts,
        ack: () => done.push({ act: "ack" }),
        retry: (options?: { readonly delaySeconds?: number }) =>
          done.push({ act: "retry", delaySeconds: options?.delaySeconds }),
      },
    ],
    ackAll: () => done.push({ act: "ack" }),
    retryAll: () => done.push({ act: "retry" }),
  } as unknown as MessageBatch<MeetingTranscriptMessage>;
  return { batch, done };
}
