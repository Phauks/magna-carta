import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterEventId, MatterId } from "@magna-carta/identifiers/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { setSfuFetchForTests } from "../src/meetings/sfu/sfu-client.ts";
import { setMeetingSinkSigningKeyForTests } from "../src/meetings/sink-token.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { fakeAdapterService } from "./support/meeting-recording-fixture.ts";
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
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (method !== "GET") {
    headers["idempotency-key"] = crypto.randomUUID();
    headers["content-type"] = "application/json";
  }
  return await app.request(
    `${base}${path}`,
    { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) },
    ROUTED_ENVIRONMENT,
  );
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
    // claiming a recording that holds nothing.
    expect(after.state).toBe("failed");

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
