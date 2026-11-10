import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterEventId, MatterId } from "@magna-carta/identifiers/types";
import { STOP_RECORDING_GUARD } from "@magna-carta/meetings/recording-service";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";
import { setMeetingSinkSigningKeyForTests } from "../src/meetings/sink-token.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { fakeAdapterService, waitUntil } from "./support/meeting-recording-fixture.ts";
import { racingFirmDatabase } from "./support/racing-firm-database.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// THE RECORDING'S HTTP SURFACE, for the things that would be real product failures if they stopped
// holding:
//
//   - RECORDING IS OFF UNTIL A FIRM TURNS IT ON, and a deployment that cannot record says so as a
//     configuration fact (503) rather than as a permission problem.
//   - STARTING IS `meetings:record`; STOPPING IS THAT KEY OR RUNNING THE ROOM. A member who may host
//     but not record cannot start one and can stop one in a meeting they are running, labelled
//     `host`; a member holding neither is refused.
//   - THE CONSENT RECORD IS A HOST'S READ, and a member who may only attend cannot read it.
//   - A FIRM MEETING CANNOT BE RECORDED, because there is no matter to file the recording into.
//   - ONE FIRM CANNOT REACH ANOTHER'S RECORDINGS, by any read.
//   - ENDING THE MEETING STOPS THE RECORDING, in the end's own batch.

const app = createApp();
const SIGNING_KEY = "meetings-recording-routes-test-signing-key";

const ROUTED_ENVIRONMENT = {
  ...env,
  REALTIME_SFU_APP_ID: "test-realtime-application",
  REALTIME_SFU_APP_SECRET: "test-realtime-secret",
};

const base = "https://example.com";

let firmId: FirmId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerCookie: string;
let ownerUserId: string;
let attorneyCookie: string;
let billingCookie: string;
let otherFirmCookie: string;
const MATTER = newIdentifier("matter") as MatterId;

async function request(
  method: string,
  path: string,
  cookie: string,
  body?: unknown,
  through: {
    readonly environment?: typeof ROUTED_ENVIRONMENT;
    readonly idempotencyKey?: string;
    readonly executionContext?: ExecutionContext;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (method !== "GET") {
    headers["idempotency-key"] = through.idempotencyKey ?? crypto.randomUUID();
    headers["content-type"] = "application/json";
  }
  return await app.request(
    `${base}${path}`,
    { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) },
    through.environment ?? ROUTED_ENVIRONMENT,
    through.executionContext,
  );
}

/** The real room a meeting's routes reach, addressed exactly as they address it. */
function roomOf(meetingId: string) {
  return env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meetingId}`));
}

/** What a stand-in recorder was asked to do, in order. */
interface RecorderCalls {
  readonly starts: unknown[];
  readonly stops: string[];
}

/**
 * The deployment with a STAND-IN recorder: the routes reach it exactly as they reach the real one
 * (by name, through the binding), and it answers as the test says — so a recorder that fails, or
 * that never answers, is a thing a test can arrange.
 */
function withRecorder(behaviour: {
  readonly start?: (input: unknown) => Promise<unknown>;
  readonly stop?: (reason: string, attempt: number) => Promise<unknown>;
}): { environment: typeof ROUTED_ENVIRONMENT; calls: RecorderCalls } {
  const calls: RecorderCalls = { starts: [], stops: [] };
  const recorder = {
    start: async (input: unknown) => {
      calls.starts.push(input);
      return await (behaviour.start?.(input) ?? Promise.resolve({ opened: 0, lost: 0 }));
    },
    stop: async (reason: string) => {
      calls.stops.push(reason);
      return await (behaviour.stop?.(reason, calls.stops.length) ?? Promise.resolve(null));
    },
  };
  const namespace = { idFromName: (name: string) => ({ name }), get: () => recorder };
  return {
    environment: {
      ...ROUTED_ENVIRONMENT,
      MEETING_RECORDER: namespace as unknown as typeof env.MEETING_RECORDER,
    },
    calls,
  };
}

/** The deployment with the real room behind a stand-in whose `recordingStarted` answers as given. */
function withRoom(
  recordingStarted: (
    real: ReturnType<typeof roomOf>,
    transition: Parameters<ReturnType<typeof roomOf>["recordingStarted"]>[0],
  ) => Promise<{ recipientCount: number; noticeCount: number; stopped?: true }>,
  around: typeof ROUTED_ENVIRONMENT = ROUTED_ENVIRONMENT,
): typeof ROUTED_ENVIRONMENT {
  const namespace = {
    idFromName: (name: string) => env.MEETING_ROOM.idFromName(name),
    get: (id: DurableObjectId) => {
      const real = env.MEETING_ROOM.get(id);
      return {
        recordingStarted: async (
          transition: Parameters<ReturnType<typeof roomOf>["recordingStarted"]>[0],
        ) => await recordingStarted(real, transition),
        recordingStopped: async (
          transition: Parameters<ReturnType<typeof roomOf>["recordingStopped"]>[0],
        ) => await real.recordingStopped(transition),
        recordingCandidates: async () => await real.recordingCandidates(),
        runningRecording: async () => await real.runningRecording(),
        end: async (at: string) => await real.end(at),
      };
    },
  };
  return { ...around, MEETING_ROOM: namespace as unknown as typeof env.MEETING_ROOM };
}

async function recordingRow(recordingId: string) {
  return await firmDatabase
    .prepare(`SELECT state, stop_reason, failure_error_id FROM meeting_recording WHERE id = ?1`)
    .bind(recordingId)
    .first<{ state: string; stop_reason: string | null; failure_error_id: string | null }>();
}

async function failedAuditCount(recordingId: string): Promise<number> {
  const row = await firmDatabase
    .prepare(
      `SELECT COUNT(*) AS count FROM audit_log WHERE event = 'meetings.recording.failed' AND subject_id = ?1`,
    )
    .bind(recordingId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/** Hands this meeting's room to one more member, as naming a co-host does. */
async function grantCoHost(meetingId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await firmDatabase
    .prepare(
      `INSERT INTO meeting_host (id, meeting_id, user_id, role, granted_by_user_id, granted_at, ` +
        `revoked_at, revoked_by_user_id, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, 'co-host', ?3, ?4, NULL, NULL, ?4, ?4)`,
    )
    .bind(newIdentifier("meetingHost"), meetingId, userId, now)
    .run();
}

async function freshEvent(): Promise<MatterEventId> {
  const id = newIdentifier("matterEvent") as MatterEventId;
  await firmDatabase
    .prepare(
      `INSERT INTO matter_event (id, matter_id, title, status, starts_on, starts_at_time, ` +
        `ends_at_time, time_zone, recorded_at, recorded_by, created_at, updated_at) VALUES ` +
        `(?1, ?2, 'Settlement conference', 'scheduled', '2026-10-02', '09:30', '10:30', ` +
        `'America/Los_Angeles', ?3, ?4, ?3, ?3)`,
    )
    .bind(id, MATTER, new Date().toISOString(), ownerUserId)
    .run();
  return id;
}

async function startMeeting(cookie: string, eventKind = "matter", eventId?: string) {
  const response = await request("POST", "/api/v1/meetings", cookie, {
    eventKind,
    eventId: eventId ?? (await freshEvent()),
    medium: "audio",
  });
  expect(response.status).toBe(201);
  return (await readJson<{ id: string }>(response)).id;
}

async function setRecordingEnabled(enabled: boolean): Promise<void> {
  await firmDatabase
    .prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES ('meetings.recordingEnabled', ?1, ?2) ` +
        `ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(enabled ? "true" : "false", new Date().toISOString())
    .run();
}

interface RecordingSummary {
  id: string;
  state: string;
  startedBy: { userId: string; displayName: string };
  stoppedBy: { userId: string; displayName: string } | null;
  stopReason: string | null;
  trackCount: number;
  failureErrorId: string | null;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  setSfuFetchForTests(fakeAdapterService([]));
  setMeetingSinkSigningKeyForTests(SIGNING_KEY);
  firmId = (await seedFirm({ name: "Recording Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("recording-owner@example.com", {
    userName: "Recording Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Recording Owner", firmId);
  ownerCookie = await signInForSessionCookie("recording-owner@example.com");
  ownerUserId = owner.userId;

  const attorney = await seedCredentialedUser("recording-attorney@example.com", {
    userName: "Hosting Attorney",
    firmId,
  });
  await mirrorMemberWithRole(attorney.userId, "Hosting Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("recording-attorney@example.com");
  // THIS FIRM NARROWED RECORDING: its attorneys may convene meetings and may not record them — the
  // narrowing a third key exists to make possible.
  await firmDatabase
    .prepare(
      `DELETE FROM role_permission WHERE permission = 'meetings:record' ` +
        `AND role_id = (SELECT id FROM role WHERE name = 'Attorney')`,
    )
    .run();

  const billing = await seedCredentialedUser("recording-billing@example.com", {
    userName: "Recording Bookkeeper",
    firmId,
  });
  await mirrorMemberWithRole(billing.userId, "Recording Bookkeeper", firmId, "Billing");
  billingCookie = await signInForSessionCookie("recording-billing@example.com");

  await firmDatabase
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) ` +
        `VALUES (?1, 'Herrera v Alvarez', 'open', ?2, ?3, ?3)`,
    )
    .bind(MATTER, owner.userId, new Date().toISOString())
    .run();

  const otherFirmId = (await seedFirm({ name: "Another Recording Firm" })).firmId;
  const outsider = await seedCredentialedUser("recording-outsider@example.com", {
    userName: "Other Firm Owner",
    firmId: otherFirmId,
  });
  await mirrorMemberWithOwnerRole(outsider.userId, "Other Firm Owner", otherFirmId);
  otherFirmCookie = await signInForSessionCookie("recording-outsider@example.com");
});

afterAll(() => {
  setSfuFetchForTests(null);
  setMeetingSinkSigningKeyForTests(null);
});

describe("a firm or a deployment that cannot record", () => {
  it("answers 503 while the firm has not switched recording on, and the summary says so", async () => {
    await setRecordingEnabled(false);
    const meetingId = await startMeeting(ownerCookie);
    const response = await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    expect(response.status).toBe(503);
    expect((await readJson<{ type: string }>(response)).type).toContain(
      "meeting-recording-not-configured",
    );
    const summary = await readJson<{ recordingConfigured: boolean; recordingState: string }>(
      await request("GET", `/api/v1/meetings/${meetingId}`, ownerCookie),
    );
    expect(summary).toMatchObject({ recordingConfigured: false, recordingState: "none" });
  });

  it("answers 503 where the deployment holds no sink signing key, whatever the firm says", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    setMeetingSinkSigningKeyForTests(null);
    try {
      const response = await request(
        "POST",
        `/api/v1/meetings/${meetingId}/recording`,
        ownerCookie,
      );
      expect(response.status).toBe(503);
    } finally {
      setMeetingSinkSigningKeyForTests(SIGNING_KEY);
    }
  });
});

describe("starting and stopping", () => {
  it("starts with the key, refuses a second start, and stops — attributed to the member", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const started = await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    expect(started.status).toBe(201);
    const recording = await readJson<RecordingSummary>(started);
    expect(recording).toMatchObject({
      state: "recording",
      startedBy: { userId: ownerUserId, displayName: "Recording Owner" },
      stoppedBy: null,
      trackCount: 0,
      // Nothing has gone wrong with a recording that is running.
      failureErrorId: null,
    });
    const summary = await readJson<{ recordingConfigured: boolean; recordingState: string }>(
      await request("GET", `/api/v1/meetings/${meetingId}`, ownerCookie),
    );
    expect(summary).toMatchObject({ recordingConfigured: true, recordingState: "recording" });

    const again = await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    expect(again.status).toBe(409);
    expect((await readJson<{ type: string }>(again)).type).toContain(
      "meeting-recording-already-running",
    );

    const stopped = await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    expect(stopped.status).toBe(200);
    const after = await readJson<RecordingSummary>(stopped);
    expect(after.stopReason).toBe("member");
    expect(after.stoppedBy?.userId).toBe(ownerUserId);
    // Nobody was publishing audio, so nothing was captured: the record says failed rather than
    // claiming a recording that holds nothing — with the Error ID a member can quote to support, on
    // the stop's own answer and on every later read of it.
    expect(after.state).toBe("failed");
    expect(after.failureErrorId).toMatch(/\S/);
    const listed = await readJson<{ data: RecordingSummary[] }>(
      await request("GET", `/api/v1/meetings/${meetingId}/recordings`, ownerCookie),
    );
    expect(listed.data[0]?.failureErrorId).toBe(after.failureErrorId);

    const none = await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    expect(none.status).toBe(409);
    expect((await readJson<{ type: string }>(none)).type).toContain(
      "meeting-recording-not-running",
    );
  });

  it("refuses a member who may host but not record — and lets them stop a recording in a room they run, as `host`", async () => {
    await setRecordingEnabled(true);
    // The attorney convenes the meeting, so the attorney holds the grant on it.
    const meetingId = await startMeeting(attorneyCookie);
    const refused = await request(
      "POST",
      `/api/v1/meetings/${meetingId}/recording`,
      attorneyCookie,
    );
    expect(refused.status).toBe(403);

    // The owner holds the key and is named to run the room too, which is what starting needs.
    await grantCoHost(meetingId, ownerUserId);
    expect(
      (await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie)).status,
    ).toBe(201);
    const stopped = await request(
      "DELETE",
      `/api/v1/meetings/${meetingId}/recording`,
      attorneyCookie,
    );
    expect(stopped.status).toBe(200);
    expect((await readJson<RecordingSummary>(stopped)).stopReason).toBe("host");
  });

  it("refuses a member holding the key who is not running this meeting — and starts once they are", async () => {
    await setRecordingEnabled(true);
    // The attorney convenes it; the owner holds meetings:record and no grant on this room.
    const meetingId = await startMeeting(attorneyCookie);
    const refused = await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    expect(refused.status).toBe(403);
    expect((await readJson<{ type: string }>(refused)).type).toContain("meeting-not-host");
    const page = await readJson<{ data: RecordingSummary[] }>(
      await request("GET", `/api/v1/meetings/${meetingId}/recordings`, ownerCookie),
    );
    expect(page.data).toEqual([]);

    await grantCoHost(meetingId, ownerUserId);
    expect(
      (await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie)).status,
    ).toBe(201);
    await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
  });

  it("refuses a stop by a member holding neither the key nor a grant on the meeting", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    expect(
      (await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie)).status,
    ).toBe(201);
    const refused = await request(
      "DELETE",
      `/api/v1/meetings/${meetingId}/recording`,
      billingCookie,
    );
    expect(refused.status).toBe(403);
    await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
  });

  it("refuses a meeting on a firm event, which has no matter to file a recording into", async () => {
    await setRecordingEnabled(true);
    const firmEventId = newIdentifier("firmEvent");
    await firmDatabase
      .prepare(
        `INSERT INTO firm_event (id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, ` +
          `audience, recorded_at, recorded_by, created_at, updated_at) VALUES (?1, 'Staff meeting', ` +
          `'scheduled', '2026-10-02', '08:00', '08:30', 'America/Los_Angeles', 'all_members', ?2, ?3, ?2, ?2)`,
      )
      .bind(firmEventId, new Date().toISOString(), ownerUserId)
      .run();
    const meetingId = await startMeeting(ownerCookie, "firm", firmEventId);
    const response = await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    expect(response.status).toBe(422);
    expect((await readJson<{ type: string }>(response)).type).toContain(
      "meeting-recording-needs-matter",
    );
  });

  it("stops the recording when the meeting ends, attributed to whoever ended it", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    expect(
      (await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie)).status,
    ).toBe(201);
    expect((await request("POST", `/api/v1/meetings/${meetingId}/end`, ownerCookie)).status).toBe(
      200,
    );
    const page = await readJson<{ data: RecordingSummary[] }>(
      await request("GET", `/api/v1/meetings/${meetingId}/recordings`, ownerCookie),
    );
    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({ stopReason: "meeting-ended" });
    expect(page.data[0]?.stoppedBy?.userId).toBe(ownerUserId);
  });
});

describe("reading recordings and who was told", () => {
  it("lists a meeting's recordings to anybody who may attend it, newest first", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
    const page = await readJson<{ data: RecordingSummary[]; nextCursor: string | null }>(
      await request("GET", `/api/v1/meetings/${meetingId}/recordings`, billingCookie),
    );
    expect(page.data.map((one) => one.state)).toEqual(["recording", "failed"]);
    expect(page.nextCursor).toBeNull();
    await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
  });

  it("names the version a filed recording added and where it stands, read from the file pipeline", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const started = await readJson<RecordingSummary>(
      await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie),
    );
    await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);

    // The compose step's filing, written as it leaves the row: a file on the matter holding one
    // version the scan has not answered yet.
    const fileId = newIdentifier("file");
    const versionId = newIdentifier("fileVersion");
    const now = new Date().toISOString();
    await firmDatabase
      .prepare(
        `INSERT INTO file (id, matter_id, name, edit_state, created_at, updated_at) ` +
          `VALUES (?1, ?2, 'Meeting recording.wav', 'idle', ?3, ?3)`,
      )
      .bind(fileId, MATTER, now)
      .run();
    await firmDatabase
      .prepare(
        `INSERT INTO file_version (id, file_id, version_number, r2_key, status, created_at) ` +
          `VALUES (?1, ?2, 1, ?3, 'pending', ?4)`,
      )
      .bind(versionId, fileId, `files/${versionId}`, now)
      .run();
    await firmDatabase
      .prepare(
        `UPDATE meeting_recording SET state = 'filed', file_id = ?2, file_version_id = ?3 WHERE id = ?1`,
      )
      .bind(started.id, fileId, versionId)
      .run();

    const documentNow = async () => {
      const page = await readJson<{
        data: (RecordingSummary & { document: { versionId: string; state: string } | null })[];
      }>(await request("GET", `/api/v1/meetings/${meetingId}/recordings`, billingCookie));
      return page.data.find((one) => one.id === started.id)?.document;
    };

    expect(await documentNow()).toEqual({ versionId, state: "pending" });

    await firmDatabase
      .prepare(`UPDATE file_version SET status = 'clean', scan_verdict = 'clean' WHERE id = ?1`)
      .bind(versionId)
      .run();
    await firmDatabase
      .prepare(`UPDATE file SET current_version_id = ?2 WHERE id = ?1`)
      .bind(fileId, versionId)
      .run();
    expect(await documentNow()).toEqual({ versionId, state: "available" });

    await firmDatabase
      .prepare(
        `UPDATE file_version SET status = 'quarantined', scan_verdict = 'flagged' WHERE id = ?1`,
      )
      .bind(versionId)
      .run();
    expect(await documentNow()).toEqual({ versionId, state: "held" });

    // A recording that added nothing names no document.
    const second = await readJson<RecordingSummary>(
      await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie),
    );
    const page = await readJson<{
      data: (RecordingSummary & { document: unknown })[];
    }>(await request("GET", `/api/v1/meetings/${meetingId}/recordings`, ownerCookie));
    expect(page.data.find((one) => one.id === second.id)?.document).toBeNull();
    await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
  });

  it("reads the consent record for a host — a guest's notice by its stay — and refuses a member who may only attend", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const recording = await readJson<RecordingSummary>(
      await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie),
    );
    const guestStay = newIdentifier("meetingGuestStay");
    await firmDatabase
      .prepare(
        `INSERT INTO meeting_recording_notice (id, recording_id, participant_kind, participant_id, ` +
          `user_id, reason, delivered_at, created_at) VALUES (?1, ?2, 'guest', ?3, NULL, 'arrival', ?4, ?4)`,
      )
      .bind(
        newIdentifier("meetingRecordingNotice"),
        recording.id,
        guestStay,
        new Date().toISOString(),
      )
      .run();

    const path = `/api/v1/meetings/${meetingId}/recordings/${recording.id}/notices`;
    const read = await request("GET", path, ownerCookie);
    expect(read.status).toBe(200);
    const page = await readJson<{ data: Record<string, unknown>[] }>(read);
    expect(page.data).toEqual([
      expect.objectContaining({
        participantKind: "guest",
        participantId: guestStay,
        userId: null,
        reason: "arrival",
      }),
    ]);
    expect((await request("GET", path, billingCookie)).status).toBe(403);
    await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
  });

  it("answers another firm's member with the same absence as a meeting that does not exist", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const recording = await readJson<RecordingSummary>(
      await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie),
    );
    expect(
      (await request("GET", `/api/v1/meetings/${meetingId}/recordings`, otherFirmCookie)).status,
    ).toBe(404);
    expect(
      (
        await request(
          "GET",
          `/api/v1/meetings/${meetingId}/recordings/${recording.id}/notices`,
          otherFirmCookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, otherFirmCookie)).status,
    ).toBe(404);
    await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie);
  });

  it("answers a recording that belongs to another meeting as absent", async () => {
    await setRecordingEnabled(true);
    const first = await startMeeting(ownerCookie);
    const second = await startMeeting(ownerCookie);
    const recording = await readJson<RecordingSummary>(
      await request("POST", `/api/v1/meetings/${first}/recording`, ownerCookie),
    );
    expect(
      (
        await request(
          "GET",
          `/api/v1/meetings/${second}/recordings/${recording.id}/notices`,
          ownerCookie,
        )
      ).status,
    ).toBe(404);
    await request("DELETE", `/api/v1/meetings/${first}/recording`, ownerCookie);
  });
});

describe("after the commit — the recorder and the room", () => {
  it("asks the recorder again when the first stop fails, and announces the stop only after it acknowledged", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const heldWhenAsked: (string | null)[] = [];
    const { environment, calls } = withRecorder({
      stop: async (_reason, attempt) => {
        heldWhenAsked.push((await roomOf(meetingId).runningRecording())?.recordingId ?? null);
        if (attempt === 1) throw new Error("the recorder was being moved");
        return null;
      },
    });
    const started = await readJson<RecordingSummary>(
      await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie, undefined, {
        environment,
      }),
    );
    expect(calls.starts).toHaveLength(1);

    const stopped = await request(
      "DELETE",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment },
    );
    expect(stopped.status).toBe(200);
    expect(calls.stops).toEqual(["member", "member"]);
    // The room still held the recording at BOTH asks: nobody was told it stopped before the recorder
    // had let go of it.
    expect(heldWhenAsked).toEqual([started.id, started.id]);
    expect(await roomOf(meetingId).runningRecording()).toBeNull();
    expect(await recordingRow(started.id)).toMatchObject({
      state: "composing",
      failure_error_id: null,
    });
  });

  it("still announces the stop when the recorder cannot be reached, and the record carries the failure", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const { environment, calls } = withRecorder({
      stop: () => Promise.reject(new Error("the recorder is unreachable")),
    });
    const started = await readJson<RecordingSummary>(
      await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie, undefined, {
        environment,
      }),
    );
    const stopped = await request(
      "DELETE",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment },
    );
    expect(stopped.status).toBe(200);
    expect(calls.stops).toHaveLength(2);
    // The mark clears for everybody: the record says it stopped, and a lit mark would be a lie.
    expect(await roomOf(meetingId).runningRecording()).toBeNull();
    // Still composing — whether anything was captured is the recorder's to say on its own next
    // pass — with the Error ID of the stop it missed.
    const row = await recordingRow(started.id);
    expect(row?.state).toBe("composing");
    expect(row?.failure_error_id).toMatch(/\S/);
  });

  it("hands the work after the commit to the request's waitUntil, so a cancelled request still finishes it", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const keptAlive: Promise<unknown>[] = [];
    const executionContext = {
      waitUntil: (work: Promise<unknown>) => {
        keptAlive.push(work);
      },
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    let keptAliveWhenStarted = -1;
    let keptAliveWhenStopped = -1;
    // Each stand-in yields once before it looks: a request can only be cancelled at an await, so
    // what matters is that the work was handed over before the first one — which is the turn the
    // call into the recorder begins in.
    const { environment } = withRecorder({
      start: async () => {
        await Promise.resolve();
        keptAliveWhenStarted = keptAlive.length;
        return { opened: 0, lost: 0 };
      },
      stop: async () => {
        await Promise.resolve();
        keptAliveWhenStopped = keptAlive.length;
        return null;
      },
    });
    const started = await request(
      "POST",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment, executionContext },
    );
    expect(started.status).toBe(201);
    expect(keptAliveWhenStarted).toBeGreaterThan(0);
    const before = keptAlive.length;
    const stopped = await request(
      "DELETE",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment, executionContext },
    );
    expect(stopped.status).toBe(200);
    expect(keptAliveWhenStopped).toBeGreaterThan(before);
    await Promise.allSettled(keptAlive);
  });

  it("fails the start before anything is captured when the room could not record everybody it told", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const { environment: withStandIn, calls } = withRecorder({});
    const environment = withRoom(async (real, transition) => {
      const told = await real.recordingStarted(transition);
      // One stay more was handed the frame than the room managed to write down.
      return { recipientCount: told.recipientCount + 1, noticeCount: told.noticeCount };
    }, withStandIn);
    const response = await request(
      "POST",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment },
    );
    expect(response.status).toBe(201);
    const recording = await readJson<RecordingSummary>(response);
    expect(recording).toMatchObject({
      state: "failed",
      stopReason: "start-failed",
      stoppedBy: null,
    });
    // Nothing was handed to the recorder to capture.
    expect(calls.starts).toEqual([]);
    expect(await roomOf(meetingId).runningRecording()).toBeNull();
    expect(await failedAuditCount(recording.id)).toBe(1);
  });

  it("starts no recorder when the room says the recording was already over by the time its start arrived", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const { environment: withStandIn, calls } = withRecorder({});
    // The stop, the end or the calendar cancel reached the room first: it lit nothing and says so.
    const environment = withRoom(
      async () =>
        await Promise.resolve({ recipientCount: 0, noticeCount: 0, stopped: true as const }),
      withStandIn,
    );
    const response = await request(
      "POST",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment },
    );
    expect(response.status).toBe(201);
    const recording = await readJson<RecordingSummary>(response);
    // Not failed: whatever stopped it settled the record, and the start route has nothing to add.
    expect(recording.state).not.toBe("failed");
    expect(calls.starts).toEqual([]);
    expect(await failedAuditCount(recording.id)).toBe(0);
  });

  it("writes ONE failed audit row when the start fails after the recorder had already taken the recording", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    // The real recorder takes the recording, and the answer is lost on the way back: the route gives
    // up on the start, and the recorder then settles a recording that captured nothing.
    const recorders = env.MEETING_RECORDER;
    if (recorders === undefined) throw new Error("the test pool binds a recorder");
    const namespace = {
      idFromName: (name: string) => recorders.idFromName(name),
      get: (id: DurableObjectId) => {
        const real = recorders.get(id);
        return {
          start: async (input: Parameters<typeof real.start>[0]) => {
            await real.start(input);
            throw new Error("the recorder's answer was lost");
          },
          stop: async (reason: Parameters<typeof real.stop>[0]) => await real.stop(reason),
        };
      },
    };
    const environment = {
      ...ROUTED_ENVIRONMENT,
      MEETING_RECORDER: namespace as unknown as typeof env.MEETING_RECORDER,
    };
    const response = await request(
      "POST",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment },
    );
    const recording = await readJson<RecordingSummary>(response);
    expect(recording).toMatchObject({ state: "failed", stopReason: "start-failed" });
    expect(await failedAuditCount(recording.id)).toBe(1);
  });

  it("finishes a start whose first request was cut off after the commit, when the start is replayed", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const idempotencyKey = crypto.randomUUID();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The first request commits and then never gets to the room — the shape a request cancelled
    // between the commit and the announcement leaves behind.
    const stalled = withRoom(async () => {
      await held;
      throw new Error("the first request never reached the room");
    });
    const first = request(
      "POST",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      {
        environment: stalled,
        idempotencyKey,
      },
    );
    let recordingId: string | undefined;
    await waitUntil(async () => {
      const row = await firmDatabase
        .prepare(`SELECT id FROM meeting_recording WHERE meeting_id = ?1 AND state = 'recording'`)
        .bind(meetingId)
        .first<{ id: string }>();
      recordingId = row?.id;
      return recordingId !== undefined;
    });
    expect(recordingId).toBeDefined();
    expect(await roomOf(meetingId).runningRecording()).toBeNull();

    const { environment, calls } = withRecorder({});
    const replay = await request(
      "POST",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment, idempotencyKey },
    );
    expect(replay.status).toBe(201);
    expect((await readJson<RecordingSummary>(replay)).id).toBe(recordingId);
    // Told now, and only then handed to the recorder.
    expect((await roomOf(meetingId).runningRecording())?.recordingId).toBe(recordingId);
    expect(calls.starts).toHaveLength(1);
    expect(await recordingRow(recordingId ?? "")).toMatchObject({ state: "recording" });

    release?.();
    await first;
  });

  it("announces once when a replay carries the start out while the first request is still on its way", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const idempotencyKey = crypto.randomUUID();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { environment: standIn, calls } = withRecorder({});
    // The first request commits and is SLOW to reach the room — it gets there after the replay.
    const slow = withRoom(async (real, transition) => {
      await held;
      return await real.recordingStarted(transition);
    }, standIn);
    const first = request(
      "POST",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment: slow, idempotencyKey },
    );
    let recordingId = "";
    await waitUntil(async () => {
      const row = await firmDatabase
        .prepare(`SELECT id FROM meeting_recording WHERE meeting_id = ?1 AND state = 'recording'`)
        .bind(meetingId)
        .first<{ id: string }>();
      recordingId = row?.id ?? "";
      return recordingId !== "";
    });
    const replay = await request(
      "POST",
      `/api/v1/meetings/${meetingId}/recording`,
      ownerCookie,
      undefined,
      { environment: standIn, idempotencyKey },
    );
    expect(replay.status).toBe(201);
    release?.();
    expect((await first).status).toBe(201);

    // ONE announcement — one fan-out on the record — however many requests carried the start out,
    // and the recording still running: neither request mistook the other's work for a failure.
    const noticed = await firmDatabase
      .prepare(
        `SELECT COUNT(*) AS count FROM audit_log WHERE event = 'meetings.recording.noticed' AND subject_id = ?1`,
      )
      .bind(recordingId)
      .first<{ count: number }>();
    expect(noticed?.count).toBe(1);
    expect(await recordingRow(recordingId)).toMatchObject({ state: "recording" });
    expect(calls.starts.length).toBeGreaterThan(0);
    await request("DELETE", `/api/v1/meetings/${meetingId}/recording`, ownerCookie, undefined, {
      environment: standIn,
    });
  });
});

describe("a recording stopped while the meeting is ending", () => {
  it("ends the meeting and keeps the stop that got there first, rather than answering a server error", async () => {
    await setRecordingEnabled(true);
    const meetingId = await startMeeting(ownerCookie);
    const { environment: standIn } = withRecorder({});
    const started = await readJson<RecordingSummary>(
      await request("POST", `/api/v1/meetings/${meetingId}/recording`, ownerCookie, undefined, {
        environment: standIn,
      }),
    );
    // Between the end reading the running recording and its batch committing, somebody stops it.
    const racing = racingFirmDatabase({ ...standIn }, STOP_RECORDING_GUARD, async () => {
      const now = new Date().toISOString();
      await firmDatabase
        .prepare(
          `UPDATE meeting_recording SET state = 'composing', stopped_at = ?1, stop_reason = 'member', ` +
            `stopped_by_user_id = ?2, updated_at = ?1 WHERE id = ?3`,
        )
        .bind(now, ownerUserId, started.id)
        .run();
    });
    const ended = await request(
      "POST",
      `/api/v1/meetings/${meetingId}/end`,
      ownerCookie,
      undefined,
      {
        environment: racing.environment as typeof ROUTED_ENVIRONMENT,
      },
    );
    expect(racing.interleaved).toBe(true);
    expect(ended.status).toBe(200);
    const meeting = await firmDatabase
      .prepare(`SELECT status FROM meeting WHERE id = ?1`)
      .bind(meetingId)
      .first<{ status: string }>();
    expect(meeting?.status).toBe("ended");
    // The stop that committed first is the one the record keeps.
    expect(await recordingRow(started.id)).toMatchObject({
      state: "composing",
      stop_reason: "member",
    });
  });
});
