import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterEventId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The meeting's HTTP surface, exercised for the things that would be real product failures if they
// stopped holding:
//
//   - A DEPLOYMENT WITH NO MEDIA ROUTING CREDENTIALS refuses to start or join a meeting, and says so
//     as a deployment fact rather than as a permission problem or a server error. That is the state
//     every environment is in today, so it is the one most likely to be met by a person.
//   - A WALLED MATTER'S EVENT IS AS ABSENT AS AN EVENT THAT DOES NOT EXIST. The platform-owned
//     holding matter is the instrument: it is real in every firm's database and the visible-matter
//     predicate already excludes it, so a meeting on its event must be unreachable by wording as
//     well as by outcome.
//   - CONVENING AND ATTENDING ARE DIFFERENT CAPABILITIES. The migration seeds meetings:join to
//     Billing and meetings:host deliberately not, so a Billing member can be in a meeting and cannot
//     open or close one. Asserted against that seat rather than against a direct grant, because the
//     seeds are what decides the seat.
//   - THE SIGNALING SOCKET NEEDS AN OPEN STAY. The room's roster and the twelve-person cap are both
//     counted over attendance, so a socket that did not need one would be a way past both.
//
// The routing credentials are supplied as an ENVIRONMENT OVERRIDE rather than put in a shared
// settings file: the unconfigured deployment is a case this file has to be able to produce, and a
// placeholder sitting in the pool's environment would make every other suite configured too.

const app = createApp();

const ROUTED_ENVIRONMENT = {
  ...env,
  REALTIME_SFU_APP_ID: "test-realtime-application",
  REALTIME_SFU_APP_SECRET: "test-realtime-secret",
};

const UNROUTED_ENVIRONMENT = {
  ...env,
  REALTIME_SFU_APP_ID: undefined,
  REALTIME_SFU_APP_SECRET: undefined,
};

let firmId: FirmId;
let ownerCookie: string;
let billingCookie: string;
let responsibleUserId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const MATTER = newIdentifier("matter") as MatterId;
const HOLDING_MATTER = newIdentifier("matter") as MatterId;
const WALLED_EVENT = newIdentifier("matterEvent") as MatterEventId;

const base = "https://example.com";

async function post(
  path: string,
  cookie: string,
  body?: unknown,
  environment: Record<string, unknown> = ROUTED_ENVIRONMENT,
): Promise<Response> {
  return await app.request(
    `${base}${path}`,
    {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify(body ?? {}),
    },
    environment,
  );
}

async function get(
  path: string,
  cookie: string,
  headers: Record<string, string> = {},
  environment: Record<string, unknown> = ROUTED_ENVIRONMENT,
): Promise<Response> {
  return await app.request(`${base}${path}`, { headers: { cookie, ...headers } }, environment);
}

interface StartedMeeting {
  id: string;
  created: boolean;
}
interface JoinedMeeting {
  participantId: string;
  displayName: string;
  iceServers: unknown[];
}
interface MeetingSummary {
  id: string;
  status: string;
  liveCount: number;
  configured: boolean;
  title: string;
}

const EVENT_COLUMNS =
  "id, matter_id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, " +
  "recorded_at, recorded_by, created_at, updated_at";

/**
 * A calendar event of this test's own, because ONE MEETING PER EVENT is held by the database. A
 * shared event would make every test after the first find the previous test's room, which is
 * correct behaviour and useless as a fixture.
 */
async function freshEvent(title = "Settlement conference"): Promise<MatterEventId> {
  const id = newIdentifier("matterEvent") as MatterEventId;
  await firmDatabase
    .prepare(
      `INSERT INTO matter_event (${EVENT_COLUMNS}) VALUES ` +
        `(?1, ?2, ?3, 'scheduled', '2026-09-21', '09:30', '10:30', 'America/Los_Angeles', ?4, ?5, ?4, ?4)`,
    )
    .bind(id, MATTER, title, new Date().toISOString(), responsibleUserId)
    .run();
  return id;
}

/** Starts a meeting on an event and hands back its handle, failing loudly rather than returning one. */
async function startMeetingOn(eventId: string): Promise<string> {
  const response = await post("/api/v1/meetings", ownerCookie, {
    eventKind: "matter",
    eventId,
  });
  expect(response.status).toBe(201);
  return (await readJson<StartedMeeting>(response)).id;
}

/** A room nobody has been in yet, on an event nothing else in this file touches. */
async function freshMeeting(): Promise<string> {
  return await startMeetingOn(await freshEvent());
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Meetings Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("meetings-owner@example.com", {
    userName: "Meetings Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Meetings Owner", firmId);
  ownerCookie = await signInForSessionCookie("meetings-owner@example.com");
  responsibleUserId = owner.userId;

  const billing = await seedCredentialedUser("meetings-billing@example.com", {
    userName: "Meetings Bookkeeper",
    firmId,
  });
  await mirrorMemberWithRole(billing.userId as UserId, "Meetings Bookkeeper", firmId, "Billing");
  billingCookie = await signInForSessionCookie("meetings-billing@example.com");

  // The ordinary matter and the platform-owned holding matter, whose system_key is exactly what the
  // visible-matter predicate excludes.
  const matterColumns =
    "id, title, status, responsible_member_id, system_key, created_at, updated_at";
  for (const [id, title, systemKey] of [
    [MATTER, "Herrera v Alvarez", null],
    [HOLDING_MATTER, "Custody holdings", "custody-holding"],
  ] as const) {
    await firmDatabase
      .prepare(`INSERT INTO matter (${matterColumns}) VALUES (?1, ?2, 'open', ?3, ?4, ?5, ?5)`)
      .bind(id, title, owner.userId, systemKey, new Date().toISOString())
      .run();
  }

  // The one event this file keeps a handle on: the walled matter's, which every other test asks
  // about by name.
  await firmDatabase
    .prepare(
      `INSERT INTO matter_event (${EVENT_COLUMNS}) VALUES ` +
        `(?1, ?2, 'Holding review', 'scheduled', '2026-09-21', '09:30', '10:30', 'America/Los_Angeles', ?3, ?4, ?3, ?3)`,
    )
    .bind(WALLED_EVENT, HOLDING_MATTER, new Date().toISOString(), owner.userId)
    .run();
});

describe("a deployment that cannot route a meeting's media", () => {
  it("refuses to start one, as a fact about the deployment rather than about the member", async () => {
    const response = await post(
      "/api/v1/meetings",
      ownerCookie,
      { eventKind: "matter", eventId: await freshEvent() },
      UNROUTED_ENVIRONMENT,
    );

    expect(response.status).toBe(503);
    const problem = await readJson<{ type: string; detail: string }>(response);
    expect(problem.type).toContain("meetings-not-configured");
    // Never names the credentials, and never reads as something the member did wrong.
    expect(problem.detail).not.toContain("SECRET");
  });

  it("refuses to join one", async () => {
    const meetingId = await freshMeeting();
    const response = await post(
      `/api/v1/meetings/${meetingId}/join`,
      ownerCookie,
      {},
      UNROUTED_ENVIRONMENT,
    );
    expect(response.status).toBe(503);
  });
});

describe("starting a meeting on an event", () => {
  it("answers 201 the first time and 200 to the second member who presses Start", async () => {
    const eventId = await freshEvent();
    const first = await post("/api/v1/meetings", ownerCookie, { eventKind: "matter", eventId });
    expect(first.status).toBe(201);
    const opened = await readJson<StartedMeeting>(first);
    expect(opened.created).toBe(true);

    // A DIFFERENT idempotency key, so this is a genuinely separate request rather than a replay:
    // two members opening the same hearing want to be in the same room, which is what `created:
    // false` beside the first member's handle says.
    const second = await post("/api/v1/meetings", ownerCookie, { eventKind: "matter", eventId });
    expect(second.status).toBe(200);
    const found = await readJson<StartedMeeting>(second);
    expect(found).toEqual({ id: opened.id, created: false });
  });

  it("is refused for a member who may attend but not convene", async () => {
    const response = await post("/api/v1/meetings", billingCookie, {
      eventKind: "matter",
      eventId: await freshEvent(),
    });
    expect(response.status).toBe(403);
  });

  it("reports a walled matter's event as absent rather than as forbidden", async () => {
    const response = await post("/api/v1/meetings", ownerCookie, {
      eventKind: "matter",
      eventId: WALLED_EVENT,
    });

    // 404 and not 403: which matters a firm has is itself a fact about its work, and a
    // distinguishable refusal would let anybody holding the key probe for either.
    expect(response.status).toBe(404);
    const problem = await readJson<{ type: string }>(response);
    expect(problem.type).toContain("meeting-not-found");

    // The same answer by the other door, so the pair cannot be used to tell the two apart.
    expect((await get(`/api/v1/events/${WALLED_EVENT}/meeting`, ownerCookie)).status).toBe(404);
  });
});

describe("arriving, and leaving a record of it", () => {
  it("opens a stay and hands the browser what it needs to connect", async () => {
    const meetingId = await freshMeeting();
    const response = await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie);

    expect(response.status).toBe(200);
    const joined = await readJson<JoinedMeeting>(response);
    expect(joined.participantId).toMatch(/^meetingAttendance_/);
    expect(joined.displayName).toBe("Meetings Owner");
    // This deployment mints no relay credentials, which is a different statement from a relay that
    // refused: nothing was attempted, so the browser uses whatever it is configured with.
    expect(joined.iceServers).toEqual([]);

    const summary = await readJson<MeetingSummary>(
      await get(`/api/v1/meetings/${meetingId}`, ownerCookie),
    );
    // The FIRST arrival is what makes a room live — not the creation.
    expect(summary.status).toBe("live");
    expect(summary.liveCount).toBe(1);
    expect(summary.configured).toBe(true);
    // The event's own facts, resolved by the read rather than copied onto the meeting.
    expect(summary.title).toBe("Settlement conference");
  });

  it("lets a member who may attend but not convene into the room", async () => {
    const meetingId = await freshMeeting();
    const response = await post(`/api/v1/meetings/${meetingId}/join`, billingCookie);
    expect(response.status).toBe(200);
    expect((await readJson<JoinedMeeting>(response)).displayName).toBe("Meetings Bookkeeper");
  });

  it("records who was in the room and when", async () => {
    const meetingId = await freshMeeting();
    await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie);
    await post(`/api/v1/meetings/${meetingId}/join`, billingCookie);

    const attendance = await readJson<{
      data: { userId: string; joinedAt: string; leftAt: string | null }[];
    }>(await get(`/api/v1/meetings/${meetingId}/attendance`, ownerCookie));
    expect(attendance.data).toHaveLength(2);
    expect(attendance.data.every((stay) => stay.leftAt === null)).toBe(true);
  });
});

describe("ending it", () => {
  it("is the host's act, and closes every open stay at one instant", async () => {
    const meetingId = await freshMeeting();
    await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie);
    await post(`/api/v1/meetings/${meetingId}/join`, billingCookie);

    expect((await post(`/api/v1/meetings/${meetingId}/end`, billingCookie)).status).toBe(403);
    expect((await post(`/api/v1/meetings/${meetingId}/end`, ownerCookie)).status).toBe(200);

    const summary = await readJson<MeetingSummary>(
      await get(`/api/v1/meetings/${meetingId}`, ownerCookie),
    );
    expect(summary.status).toBe("ended");
    // Nobody's stay runs forever because they closed a laptop: ending closes every open one.
    expect(summary.liveCount).toBe(0);

    const attendance = await readJson<{ data: { leftAt: string | null }[] }>(
      await get(`/api/v1/meetings/${meetingId}/attendance`, ownerCookie),
    );
    const instants = new Set(attendance.data.map((stay) => stay.leftAt));
    // ONE instant across every stay: the meeting ended once, and rows milliseconds apart would say
    // people left at slightly different times, which is not what happened.
    expect(instants.size).toBe(1);
    expect([...instants][0]).not.toBeNull();
  });

  it("refuses a meeting that has already ended", async () => {
    const meetingId = await freshMeeting();
    expect((await post(`/api/v1/meetings/${meetingId}/end`, ownerCookie)).status).toBe(200);

    const again = await post(`/api/v1/meetings/${meetingId}/end`, ownerCookie);
    expect(again.status).toBe(409);
    expect((await readJson<{ type: string }>(again)).type).toContain("meeting-ended");
  });
});

describe("the signaling socket", () => {
  it("refuses a member who has not joined, rather than putting them in the room", async () => {
    const meetingId = await freshMeeting();
    await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie);

    const response = await get(`/api/v1/meetings/${meetingId}/socket`, billingCookie, {
      upgrade: "websocket",
    });
    expect(response.status).toBe(409);
    expect((await readJson<{ type: string }>(response)).type).toContain("meeting-not-joined");
  });

  it("refuses a request that did not ask to upgrade", async () => {
    const meetingId = await freshMeeting();
    await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie);

    const response = await get(`/api/v1/meetings/${meetingId}/socket`, ownerCookie);
    expect(response.status).toBe(426);
    expect((await readJson<{ type: string }>(response)).type).toContain(
      "websocket-upgrade-required",
    );
  });
});
