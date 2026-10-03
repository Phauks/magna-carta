import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { CANCEL_CLOSING_GUARD } from "@magna-carta/meetings/meeting-service";
import { STOP_RECORDING_GUARD } from "@magna-carta/meetings/recording-service";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A CANCELLATION WHOSE ROOM MOVES UNDER THE LAST OF ITS ATTEMPTS, driven through the real routes.
//
// The cancel composes the meeting's closing a round trip before it commits, and retries a bounded
// number of times when the room moves in between: a recording in the room stopping refuses the
// closing's stop, and somebody walking in (or the room ending) refuses the closing itself. Here two
// recordings stop under the first two attempts and the room moves under the third. A refusal of the
// last attempt that SETTLES the race — somebody is in the room, or there is nothing left to close —
// must be answered as it settled: the 409, or the cancellation standing on its own. It used to answer
// a server error, because the bound was checked before the guard was.
//
// This block seeds its OWN firm: the chokepoint's rate-limit key is `firm:<firmId>`, and the calendar
// route suite already spends most of its own firm's window.

let firmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let matterId: string;

const app = createApp();
// Joining mints relay credentials, so the act that moves a meeting under a cancel is driven through an
// environment that carries them; the mint degrades to the public resolution server when the service
// does not answer, which is what it does here.
const routed = {
  ...env,
  REALTIME_SFU_APP_ID: "test-realtime-application",
  REALTIME_SFU_APP_SECRET: "test-realtime-secret",
};

function authHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie: ownerCookie,
    "Idempotency-Key": crypto.randomUUID(),
  };
}

async function request(
  path: string,
  environment: Record<string, unknown> = routed,
  body: unknown = {},
): Promise<Response> {
  return await app.request(
    `https://example.com${path}`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify(body) },
    environment,
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Calendar Cancel Race Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const owner = await seedCredentialedUser("calendar-cancel-owner@example.com", {
    userName: "Cancel Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Cancel Owner", firmId);
  ownerUserId = owner.userId;
  ownerCookie = await signInForSessionCookie("calendar-cancel-owner@example.com");
  const matter = await request("/api/v1/matters", routed, {
    title: "Cancel race matter",
    status: "consultation",
    responsibleMemberId: ownerUserId,
  });
  expect(matter.status).toBe(201);
  const created: { matterId: string } = await matter.json();
  matterId = created.matterId;
});

async function scheduledMeetingEvent(title: string): Promise<{ id: string; meetingId: string }> {
  const recorded = await request(`/api/v1/matters/${matterId}/events`, routed, {
    title,
    startsOn: "2026-10-20",
    startsAtTime: "13:00",
    timeZone: "America/Los_Angeles",
    meeting: { medium: "video" },
  });
  expect(recorded.status).toBe(201);
  const body = (await recorded.json()) as { id: string; meetingId: string | null };
  return { id: body.id, meetingId: body.meetingId ?? "" };
}

async function meetingStatus(meetingId: string): Promise<string | undefined> {
  const { results } = await firmDatabase
    .prepare("SELECT status FROM meeting WHERE id = ?1")
    .bind(meetingId)
    .all<{ status: string }>();
  return results[0]?.status;
}

async function eventStatus(eventId: string): Promise<string | undefined> {
  const { results } = await firmDatabase
    .prepare("SELECT status FROM matter_event WHERE id = ?1")
    .bind(eventId)
    .all<{ status: string }>();
  return results[0]?.status;
}

/** A recording running in the meeting's room, as the cancel's closing would stop it. */
async function startRecording(meetingId: string): Promise<string> {
  const recordingId = newIdentifier("meetingRecording");
  const startedAt = new Date().toISOString();
  await firmDatabase
    .prepare(
      `INSERT INTO meeting_recording (id, meeting_id, matter_id, breakout_id, state, ` +
        `started_by_user_id, started_at, track_count, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, NULL, 'recording', ?4, ?5, 0, ?5, ?5)`,
    )
    .bind(recordingId, meetingId, matterId, ownerUserId, startedAt)
    .run();
  return recordingId;
}

/** Somebody pressed Stop. */
async function stopRecording(recordingId: string): Promise<void> {
  const now = new Date().toISOString();
  await firmDatabase
    .prepare(
      `UPDATE meeting_recording SET state = 'composing', stopped_at = ?1, stop_reason = 'member', ` +
        `stopped_by_user_id = ?2, updated_at = ?1 WHERE id = ?3`,
    )
    .bind(now, ownerUserId, recordingId)
    .run();
}

/**
 * The firm-database binding, wrapped so each batch commit carrying either of the cancel's guards first
 * runs the next competing act — one race per attempt, at the real point between its read and its
 * commit. The shared racing harness fires once; this needs one act per attempt.
 */
function racingEveryAttempt(acts: readonly (() => Promise<unknown>)[]) {
  const namespace = env.FIRM_DATABASE;
  let fired = 0;
  const wrapped = {
    idFromName: (name: string) => namespace.idFromName(name),
    get: (id: DurableObjectId) => {
      const stub = namespace.get(id);
      return {
        runRead: (sql: string, bindings: unknown[]) => stub.runRead(sql, bindings),
        runWrite: (sql: string, bindings: unknown[]) => stub.runWrite(sql, bindings),
        migrationState: () => stub.migrationState(),
        commitBatch: async (statements: { sql: string; bindings: unknown[]; guard?: string }[]) => {
          const guarded = statements.some(
            (statement) =>
              statement.guard === CANCEL_CLOSING_GUARD || statement.guard === STOP_RECORDING_GUARD,
          );
          const act = acts[fired];
          if (guarded && act !== undefined) {
            fired += 1;
            await act();
          }
          return await stub.commitBatch(statements);
        },
      };
    },
  };
  return {
    environment: { ...routed, FIRM_DATABASE: wrapped },
    get fired() {
      return fired;
    },
  };
}

/** Two attempts, each refused by the recording its closing would stop being stopped first. */
async function twoRecordingRaces(meetingId: string): Promise<(() => Promise<void>)[]> {
  const first = await startRecording(meetingId);
  let second = "";
  return [
    async () => {
      await stopRecording(first);
      second = await startRecording(meetingId);
    },
    async () => {
      await stopRecording(second);
      await startRecording(meetingId);
    },
  ];
}

describe("cancelling an event when its room moves under the last attempt", () => {
  it("answers the 409 when somebody walks in", async () => {
    const event = await scheduledMeetingEvent("Conference joined on the last attempt");
    const racing = racingEveryAttempt([
      ...(await twoRecordingRaces(event.meetingId)),
      async () => {
        const joined = await request(`/api/v1/meetings/${event.meetingId}/join`);
        expect(joined.status).toBe(200);
      },
    ]);

    const response = await request(`/api/v1/events/${event.id}/cancel`, racing.environment);

    expect(racing.fired).toBe(3);
    expect(response.status).toBe(409);
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toContain("meeting-in-progress");
    // The whole batch rolled back: the meeting is live and the sitting is still on the calendar.
    expect(await meetingStatus(event.meetingId)).toBe("live");
    expect(await eventStatus(event.id)).toBe("scheduled");
  });

  it("cancels with nothing to close when the room ended", async () => {
    const event = await scheduledMeetingEvent("Conference ended on the last attempt");
    const racing = racingEveryAttempt([
      ...(await twoRecordingRaces(event.meetingId)),
      async () => {
        // The meeting closed in the window with the third recording left alone, so the only
        // statement the last attempt's batch can refuse is the closing itself.
        const now = new Date().toISOString();
        await firmDatabase
          .prepare(
            "UPDATE meeting SET status = 'ended', ended_at = ?1, ended_by_user_id = ?2, updated_at = ?1 WHERE id = ?3",
          )
          .bind(now, ownerUserId, event.meetingId)
          .run();
      },
    ]);

    const response = await request(`/api/v1/events/${event.id}/cancel`, racing.environment);

    expect(racing.fired).toBe(3);
    expect(response.status).toBe(200);
    expect(await meetingStatus(event.meetingId)).toBe("ended");
    expect(await eventStatus(event.id)).toBe("cancelled");
  });
});
