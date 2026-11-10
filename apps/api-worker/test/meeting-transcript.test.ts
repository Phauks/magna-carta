import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MeetingRecordingId,
  MeetingTranscriptId,
} from "@magna-carta/identifiers/types";
import type { TranscribeInput } from "@magna-carta/inference/port";
import { createStubInferencePort } from "@magna-carta/inference/stub";
import { adapterError, capabilityUnsupported } from "@magna-carta/integrations/dispatch";
import { integrationProblem } from "@magna-carta/integrations/problem";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  runRecordingSweep,
  TRANSCRIPT_STALL_MILLISECONDS,
  UNSETTLED_STAGING_RETENTION_MILLISECONDS,
} from "../src/meetings/recording-sweep.ts";
import {
  failMeetingTranscript,
  meetingTranscriptQueue,
  TRANSCRIPT_MODEL_FAILURE_LIMIT,
  transcribeWindow,
  transcriptModelRetryDelaySeconds,
  type TranscriptionPort,
} from "../src/meetings/transcript-consumer.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedRecordedMeeting, type RecordedMeeting } from "./support/meeting-recording-fixture.ts";
import {
  collectingEnvironment,
  composeToFiled,
  countingStub,
  deliveredAs,
  drain,
  filedRecordingAwaitingTranscript as filedRecordingIn,
  objectsPresent,
  seedGuestStay,
  speech,
  stagingStillNamed as stagingStillNamedIn,
  stoppedRecording,
  transcriptMessageIn,
  transcriptRow as transcriptRowIn,
} from "./support/meeting-transcript-fixture.ts";
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

async function transcriptRow(transcriptId: string, inFirm: FirmId = firmId) {
  return await transcriptRowIn(transcriptId, inFirm);
}

async function stagingStillNamed(recordingId: string, inFirm: FirmId = firmId): Promise<number> {
  return await stagingStillNamedIn(recordingId, inFirm);
}

/** A filed recording of one member speaking twice, its transcript pending and its message in hand. */
async function filedRecordingAwaitingTranscript(inFirm: FirmId = firmId) {
  return await filedRecordingIn(inFirm);
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
    // One delivery transcribes; the other finds the window claimed under a live lease at the cursor it
    // read (`claimed-elsewhere`, which the queue retries once the lease runs out) or, if it read the row
    // after the first had moved on, nothing to do. Never both sending audio.
    expect(outcomes).toContain("ready");
    expect(["claimed-elsewhere", "nothing-to-do"]).toContain(
      outcomes.find((outcome) => outcome !== "ready"),
    );
    // Two bursts, two pieces: each sent once.
    expect(calls).toHaveLength(2);
    expect((await transcriptRow(message.transcriptId))?.segment_count).toBe(2);
    expect(await objectsPresent(stagingKeys)).toBe(0);
  });
});

describe("a speech model that will not answer", () => {
  it("is outlasted: each refusal counted on the row and retried after a delay that doubles — and only a run of them fails the transcript, keeping the staging", async () => {
    const { message, environment, sends, stagingKeys, recordingId } =
      await filedRecordingAwaitingTranscript();
    let asked = 0;
    const busy: TranscriptionPort = {
      transcribe: async () => {
        asked += 1;
        return adapterError(integrationProblem("upstream", 503, "The speech model is busy"));
      },
    };

    const delays: (number | undefined)[] = [];
    for (let refusal = 1; refusal < TRANSCRIPT_MODEL_FAILURE_LIMIT; refusal += 1) {
      // The delivery count is not the measure: a message delivered for the fifth time is still retried.
      const delivery = deliveredAs(message, 5);
      const sent = sends.length;
      await meetingTranscriptQueue(delivery.batch, environment, { port: busy });
      // Acknowledged, and sent again on a NEW message with its delay — the queue's own redelivery is
      // bounded at three, which an outage of tens of minutes would outlast.
      expect(delivery.done).toEqual([{ act: "ack" }]);
      expect(sends).toHaveLength(sent + 1);
      delays.push(sends.at(-1)!.delaySeconds);
      expect(await transcriptRow(message.transcriptId)).toMatchObject({
        state: "pending",
        model_failures: refusal,
        claimed_at: null,
      });
    }
    expect(asked).toBe(TRANSCRIPT_MODEL_FAILURE_LIMIT - 1);
    expect(delays).toEqual([30, 60, 120, 240, 480, 900, 900, 900, 900]);
    expect(delays.map((_, index) => transcriptModelRetryDelaySeconds(index + 1))).toEqual(delays);
    // More than an hour of an unavailable model before the transcript gives up.
    expect(delays.reduce<number>((sum, delay) => sum + (delay ?? 0), 0)).toBeGreaterThan(60 * 60);
    // The staging stayed throughout.
    expect(await objectsPresent(stagingKeys)).toBe(1);

    const last = deliveredAs(message, 1);
    await meetingTranscriptQueue(last.batch, environment, { port: busy });
    expect(last.done).toEqual([{ act: "ack" }]);
    const row = await transcriptRow(message.transcriptId);
    expect(row?.state).toBe("failed");
    expect(row?.failure_error_id).toMatch(/\S/u);
    // A failure a returning model could get past KEEPS the per-speaker audio, under the retention a
    // failed compose's staging has — not released at once.
    expect(await objectsPresent(stagingKeys)).toBe(1);
    expect(await stagingStillNamed(recordingId)).toBe(1);
    // The recording is filed and untouched.
    const recording = await database()
      .prepare(`SELECT state FROM meeting_recording WHERE id = ?1`)
      .bind(recordingId)
      .first<{ state: string }>();
    expect(recording?.state).toBe("filed");

    // A day on, the filed grace has passed but not the retention: still kept.
    await runRecordingSweep(environment, { now: () => Date.now() + 2 * 24 * 60 * 60 * 1000 });
    expect(await objectsPresent(stagingKeys)).toBe(1);
    // Past the retention, released.
    await runRecordingSweep(environment, {
      now: () => Date.now() + UNSETTLED_STAGING_RETENTION_MILLISECONDS + 60 * 60 * 1000,
    });
    expect(await objectsPresent(stagingKeys)).toBe(0);
    expect(await stagingStillNamed(recordingId)).toBe(0);
  });

  it("is never failed by refusals that come between progress — each piece's progress resets the count", async () => {
    // Four utterances, so four pieces; the model refuses every other call.
    const { message, environment } = await filedRecordingIn(firmId, [
      {
        speaker: { kind: "member", name: "Patient Speaker" },
        offsetSeconds: 0,
        samples: speech(16, [
          [1, 2],
          [5, 6],
          [9, 10],
          [13, 14],
        ]),
        state: "closed",
      },
    ]);
    const stub = createStubInferencePort();
    let call = 0;
    const flaky: TranscriptionPort = {
      transcribe: async (input) => {
        call += 1;
        if (call % 2 === 0) {
          return adapterError(integrationProblem("upstream", 503, "The speech model is busy"));
        }
        return await stub.transcribe(input);
      },
    };
    // Every delivery is the third or later — the old rule failed the transcript on the first refusal
    // of a third delivery, although each delivery had moved it on.
    const failuresSeen: number[] = [];
    for (let delivery = 0; delivery < 20; delivery += 1) {
      const batch = deliveredAs(message, 3 + delivery);
      await meetingTranscriptQueue(batch.batch, environment, { port: flaky });
      const row = await transcriptRow(message.transcriptId);
      failuresSeen.push(row?.model_failures ?? -1);
      if (row?.state !== "pending") break;
    }
    expect((await transcriptRow(message.transcriptId))?.state).toBe("ready");
    expect(Math.max(...failuresSeen)).toBe(1);
    expect((await transcriptRow(message.transcriptId))?.segment_count).toBe(4);
  });

  it("fails at once on a refusal no retry can change, with an Error ID, and releases the staging", async () => {
    const { message, environment, stagingKeys } = await filedRecordingAwaitingTranscript();
    const refusing: TranscriptionPort = { transcribe: async () => capabilityUnsupported() };
    expect(await transcribeWindow(environment, message, { port: refusing })).toBe("failed");
    expect((await transcriptRow(message.transcriptId))?.failure_error_id).toMatch(/\S/u);
    expect(await objectsPresent(stagingKeys)).toBe(0);
  });
});

describe("the sweep and a transcript that stopped moving", () => {
  it("keeps a filed recording's staging while its transcript is pending, hands it on, and fails it after its attempts — keeping the staging for the retention", async () => {
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
    // A stall is something a later attempt could get past: the staging is KEPT, and goes only once the
    // retention a failed recording's staging has is over.
    expect(await objectsPresent(stagingKeys)).toBe(1);
    expect(await stagingStillNamed(recordingId, sweepFirm)).toBe(1);
    await runRecordingSweep(environment, {
      now: () => twoDaysOn() + UNSETTLED_STAGING_RETENTION_MILLISECONDS + 24 * 60 * 60 * 1000,
    });
    expect(await objectsPresent(stagingKeys)).toBe(0);
    expect(await stagingStillNamed(recordingId, sweepFirm)).toBe(0);
  });

  it("does not fail a transcript a consumer claimed after the sweep judged it stalled", async () => {
    const sweepFirm = (await seedFirm({ name: "Transcript Sweep Race Firm" })).firmId;
    const { message, environment } = await filedRecordingAwaitingTranscript(sweepFirm);
    // Three hand-ons with nothing between: the next pass would fail it.
    const twoDaysOn = () => Date.now() + 2 * 24 * 60 * 60 * 1000;
    for (let pass = 0; pass < 3; pass += 1) {
      await runRecordingSweep(environment, {
        now: () => twoDaysOn() + pass * (TRANSCRIPT_STALL_MILLISECONDS + 60_000),
      });
    }
    expect((await transcriptRow(message.transcriptId, sweepFirm))?.attempts).toBe(3);
    // The next pass reads it stalled — and between that read and its failure a consumer claims it.
    const asTheSweepReadIt = (await database(sweepFirm)
      .prepare(`SELECT progress_at, claimed_at FROM meeting_transcript WHERE id = ?1`)
      .bind(message.transcriptId)
      .first<{ progress_at: string | null; claimed_at: string | null }>())!;
    await database(sweepFirm)
      .prepare(`UPDATE meeting_transcript SET claimed_at = ?1 WHERE id = ?2`)
      .bind(new Date().toISOString(), message.transcriptId)
      .run();
    expect(
      await failMeetingTranscript(
        environment,
        database(sweepFirm),
        message.transcriptId,
        "error-from-the-sweep",
        async () => env.R2,
        {
          releaseStaging: false,
          untouched: {
            progressAt: asTheSweepReadIt.progress_at,
            claimedAt: asTheSweepReadIt.claimed_at,
          },
        },
      ),
    ).toBe(false);
    expect((await transcriptRow(message.transcriptId, sweepFirm))?.state).toBe("pending");
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

/**
 * A filed recording with a ready transcript of `count` lines, seeded straight onto the record — with the
 * WebVTT document it filed as a clean, current version on the recording's matter.
 */
async function readyTranscriptOf(
  meeting: RecordedMeeting,
  count: number,
): Promise<{
  recordingId: string;
  transcriptId: MeetingTranscriptId;
  fileId: string;
  fileVersionId: string;
}> {
  const firm = database(meeting.firmId);
  const now = new Date().toISOString();
  const recordingId = newIdentifier("meetingRecording");
  const transcriptId = newIdentifier("meetingTranscript") as MeetingTranscriptId;
  const fileId = newIdentifier("file");
  const fileVersionId = newIdentifier("fileVersion");
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
        `INSERT INTO file_version (id, file_id, version_number, r2_key, status, scan_verdict, ` +
          `created_at) VALUES (?1, ?2, 1, ?3, 'clean', 'clean', ?4)`,
      )
      .bind(fileVersionId, fileId, `files/${fileVersionId}`, now),
    firm
      .prepare(`UPDATE file SET current_version_id = ?1 WHERE id = ?2`)
      .bind(fileVersionId, fileId),
    firm
      .prepare(
        `INSERT INTO meeting_transcript (id, meeting_id, recording_id, state, segment_count, ` +
          `file_id, file_version_id, created_at, updated_at) VALUES (?1, ?2, ?3, 'ready', ?4, ?5, ?6, ` +
          `?7, ?7)`,
      )
      .bind(transcriptId, meeting.meetingId, recordingId, count, fileId, fileVersionId, now),
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
  return { recordingId, transcriptId, fileId, fileVersionId };
}

/** The audit rows of every read of one transcript, oldest first. */
async function readAudits(transcriptId: string, inFirm: FirmId = firmId) {
  const { results } = await database(inFirm)
    .prepare(
      `SELECT actor_user_id, metadata FROM audit_log WHERE event = 'meetings.transcript.read' ` +
        `AND subject_id = ?1 ORDER BY created_at, id`,
    )
    .bind(transcriptId)
    .all<{ actor_user_id: string | null; metadata: string }>();
  return results;
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

  it("withholds the lines of a transcript whose document is in the trash or held by the scan, and says why", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const trashed = await readyTranscriptOf(meeting, 2);
    const held = await readyTranscriptOf(meeting, 2);
    const purged = await readyTranscriptOf(meeting, 2);
    await database()
      .prepare(`UPDATE file SET deleted_at = ?1 WHERE id = ?2`)
      .bind(new Date().toISOString(), trashed.fileId)
      .run();
    await database()
      .prepare(`UPDATE file_version SET status = 'quarantined' WHERE id = ?1`)
      .bind(held.fileVersionId)
      .run();
    // A version that is no longer there at all — what a purge leaves — is unavailable.
    await database()
      .prepare(`UPDATE meeting_transcript SET file_version_id = NULL WHERE id = ?1`)
      .bind(purged.transcriptId)
      .run();
    for (const [seeded, reason] of [
      [trashed, "removed"],
      [held, "held"],
      [purged, "unavailable"],
    ] as const) {
      const page = await readJson<TranscriptPage & { linesWithheld: string | null }>(
        await get(
          `/api/v1/meetings/${meeting.meetingId}/recordings/${seeded.recordingId}/transcript`,
        ),
      );
      expect(page).toMatchObject({
        transcript: { state: "ready" },
        data: [],
        nextCursor: null,
        linesWithheld: reason,
      });
      // Nothing was read, so nothing is audited.
      expect(await readAudits(seeded.transcriptId)).toEqual([]);
    }
  });

  it("writes one audit row per page of lines read, naming identifiers and never a word", async () => {
    const meeting = await seedRecordedMeeting(firmId);
    const { recordingId, transcriptId, fileId, fileVersionId } = await readyTranscriptOf(
      meeting,
      203,
    );
    const path = `/api/v1/meetings/${meeting.meetingId}/recordings/${recordingId}/transcript`;
    const first = await readJson<TranscriptPage & { linesWithheld: string | null }>(
      await get(path),
    );
    expect(first.linesWithheld).toBeNull();
    await get(`${path}?cursor=${encodeURIComponent(first.nextCursor!)}`);
    const audits = await readAudits(transcriptId);
    expect(audits).toHaveLength(2);
    expect(audits.every((audit) => audit.actor_user_id !== null)).toBe(true);
    const metadata = audits
      .map((audit) => JSON.parse(audit.metadata) as Record<string, number | string>)
      .toSorted((left, right) => Number(left["afterOrdinal"]) - Number(right["afterOrdinal"]));
    expect(metadata[0]).toEqual({
      meetingId: meeting.meetingId,
      recordingId,
      fileId,
      fileVersionId,
      afterOrdinal: -1,
      lineCount: 200,
    });
    expect(metadata[1]).toMatchObject({ afterOrdinal: 199, lineCount: 3 });
    // No line's words are anywhere in the log.
    for (const audit of audits) expect(audit.metadata).not.toContain("line ");
    // A pending transcript's header is not a read of its words, and writes nothing.
    const pending = await readyTranscriptOf(meeting, 1);
    await database()
      .prepare(`UPDATE meeting_transcript SET state = 'pending', file_id = NULL WHERE id = ?1`)
      .bind(pending.transcriptId)
      .run();
    await get(`/api/v1/meetings/${meeting.meetingId}/recordings/${pending.recordingId}/transcript`);
    expect(await readAudits(pending.transcriptId)).toEqual([]);
  });

  it("does not reach another firm's transcript", async () => {
    const otherFirm = (await seedFirm({ name: "Another Transcript Firm" })).firmId;
    const elsewhere = await seedRecordedMeeting(otherFirm);
    const { recordingId } = await readyTranscriptOf(elsewhere, 2);
    expect(
      (await get(`/api/v1/meetings/${elsewhere.meetingId}/recordings/${recordingId}/transcript`))
        .status,
    ).toBe(404);
  });
});
