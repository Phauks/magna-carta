import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterEventId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_MEETING_PARTICIPANTS } from "@magna-carta/meetings/types";
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
//   - THE SIGNALING SOCKET NEEDS AN OPEN STAY. The room's roster and the participant cap are both
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
interface MeetingPage {
  data: MeetingSummary[];
  nextCursor: string | null;
}
interface AttendanceStay {
  id: string;
  userId: string;
  joinedAt: string;
  leftAt: string | null;
}
interface AttendancePage {
  data: AttendanceStay[];
  nextCursor: string | null;
}
interface MeetingSummary {
  id: string;
  medium: string;
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

/**
 * Fills a room with fabricated members' open stays, so the cap can be met without standing up a
 * session per seat. The rows are what the cap is counted over, so this is the same room state that
 * many real joins produce.
 */
async function fillRoomTo(meetingId: string, occupants: number): Promise<void> {
  const now = new Date().toISOString();
  for (let seat = 0; seat < occupants; seat += 1) {
    const userId = newIdentifier("user");
    await firmDatabase
      .prepare(
        `INSERT INTO member (user_id, display_name, status, created_at) ` +
          `VALUES (?1, ?2, 'active', ?3)`,
      )
      .bind(userId, `Seat ${String(seat)}`, now)
      .run();
    await firmDatabase
      .prepare(
        `INSERT INTO meeting_attendance (id, meeting_id, user_id, joined_at, left_at, created_at, ` +
          `updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?4, ?4)`,
      )
      .bind(newIdentifier("meetingAttendance"), meetingId, userId, now)
      .run();
  }
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

  it("starts a CALL when one is asked for, and keeps it a call when somebody asks for video", async () => {
    const eventId = await freshEvent("Settlement call");
    const started = await post("/api/v1/meetings", ownerCookie, {
      eventKind: "matter",
      eventId,
      medium: "audio",
    });
    expect(started.status).toBe(201);
    const meetingId = (await readJson<StartedMeeting>(started)).id;
    expect(
      (await readJson<MeetingSummary>(await get(`/api/v1/meetings/${meetingId}`, ownerCookie)))
        .medium,
    ).toBe("audio");

    // ONE MEETING PER EVENT, so the first Start decides. A second one asking for the other medium
    // gets the room that exists rather than switching a camera on for everybody already in it.
    const again = await post("/api/v1/meetings", ownerCookie, {
      eventKind: "matter",
      eventId,
      medium: "video",
    });
    expect(again.status).toBe(200);
    expect(await readJson<StartedMeeting>(again)).toEqual({ id: meetingId, created: false });
    expect(
      (await readJson<MeetingSummary>(await get(`/api/v1/meetings/${meetingId}`, ownerCookie)))
        .medium,
    ).toBe("audio");

    // And a Start that says nothing is a video meeting, which is what every one of them was before
    // calls existed.
    const silent = await post("/api/v1/meetings", ownerCookie, {
      eventKind: "matter",
      eventId: await freshEvent("Ordinary meeting"),
    });
    const quiet = (await readJson<StartedMeeting>(silent)).id;
    expect(
      (await readJson<MeetingSummary>(await get(`/api/v1/meetings/${quiet}`, ownerCookie))).medium,
    ).toBe("video");
  });

  it("is refused for a member who may attend but not convene", async () => {
    const response = await post("/api/v1/meetings", billingCookie, {
      eventKind: "matter",
      eventId: await freshEvent(),
    });
    expect(response.status).toBe(403);
  });

  it("hands the loser of a simultaneous Start the winner's room, not a server error", async () => {
    const eventId = await freshEvent("Simultaneous start");
    // ONE MEETING PER EVENT is held by a partial unique index, and the read-then-insert above it is
    // a round trip early. Two members pressing Start together both read no meeting and both insert;
    // the loser's batch aborts on the constraint. That reached the member as a 500 for pressing a
    // button at the same moment as a colleague — what they asked for was to be in the same room.
    const [first, second] = await Promise.all([
      post("/api/v1/meetings", ownerCookie, { eventKind: "matter", eventId }),
      post("/api/v1/meetings", ownerCookie, { eventKind: "matter", eventId }),
    ]);

    expect([first.status, second.status].toSorted()).toEqual([200, 201]);
    const opened = await readJson<StartedMeeting>(first);
    const found = await readJson<StartedMeeting>(second);
    // One room, and the pair of answers says which request opened it.
    expect(opened.id).toBe(found.id);
    expect([opened.created, found.created].toSorted()).toEqual([false, true]);
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
    // This deployment mints no relay credentials, so the browser is handed the public resolution
    // server alone: a list with nothing in it would leave it gathering only its local addresses.
    expect(joined.iceServers).toEqual([{ urls: "stun:stun.cloudflare.com:3478" }]);

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

  it("answers the arrival past the cap with a full room rather than a server error", async () => {
    const meetingId = await freshMeeting();
    await fillRoomTo(meetingId, MAX_MEETING_PARTICIPANTS - 1);

    // ONE SEAT, TWO ARRIVALS. Whichever way the two land — both counting the free seat and the
    // insert's guard refusing the loser, or the second counting a full room and refusing itself —
    // the answer the member gets is the same one, and it is never an Error ID for a batch they
    // cannot see.
    const [first, second] = await Promise.all([
      post(`/api/v1/meetings/${meetingId}/join`, ownerCookie),
      post(`/api/v1/meetings/${meetingId}/join`, billingCookie),
    ]);
    expect([first.status, second.status].toSorted()).toEqual([200, 409]);
    const refused = first.status === 409 ? first : second;
    expect((await readJson<{ type: string }>(refused)).type).toContain("meeting-room-full");

    // And the room holds exactly its ceiling, never one past it.
    const summary = await readJson<MeetingSummary>(
      await get(`/api/v1/meetings/${meetingId}`, ownerCookie),
    );
    expect(summary.liveCount).toBe(MAX_MEETING_PARTICIPANTS);
  });

  it("records who was in the room and when", async () => {
    const meetingId = await freshMeeting();
    await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie);
    await post(`/api/v1/meetings/${meetingId}/join`, billingCookie);

    const attendance = await readJson<AttendancePage>(
      await get(`/api/v1/meetings/${meetingId}/attendance`, ownerCookie),
    );
    expect(attendance.data).toHaveLength(2);
    expect(attendance.data.every((stay) => stay.leftAt === null)).toBe(true);
    // The record is paged like every other list: a handful of stays fits one page, and the cursor
    // is explicitly null rather than absent so a caller never has to guess whether there is more.
    expect(attendance.nextCursor).toBeNull();
  });

  it("pages the record, and the walk neither repeats a stay nor skips one", async () => {
    const meetingId = await freshMeeting();
    // Four stays out of two members: each joins, leaves, and comes back, which is exactly what
    // attendance is a row per stay FOR.
    for (const cookie of [ownerCookie, billingCookie]) {
      await post(`/api/v1/meetings/${meetingId}/join`, cookie);
      await post(`/api/v1/meetings/${meetingId}/leave`, cookie);
      await post(`/api/v1/meetings/${meetingId}/join`, cookie);
    }

    const whole = await readJson<AttendancePage>(
      await get(`/api/v1/meetings/${meetingId}/attendance`, ownerCookie),
    );
    expect(whole.data).toHaveLength(4);

    const walked: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page += 1) {
      const query: string = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      const answer: AttendancePage = await readJson<AttendancePage>(
        await get(`/api/v1/meetings/${meetingId}/attendance${query}`, ownerCookie),
      );
      for (const stay of answer.data) walked.push(stay.id);
      cursor = answer.nextCursor;
      if (cursor === null) break;
    }
    expect(walked).toEqual(whole.data.map((stay) => stay.id));
    expect(new Set(walked).size).toBe(4);
  });

  it("hands a double-clicked join the stay the first click opened, rather than a conflict", async () => {
    const meetingId = await freshMeeting();
    // TWO REQUESTS, TWO IDEMPOTENCY KEYS — which is what a double-clicked button actually produces,
    // and is why the idempotency gate does not settle it. Both read no open stay; the partial
    // unique index refuses the second insert, and the member is handed the stay that landed.
    const [first, second] = await Promise.all([
      post(`/api/v1/meetings/${meetingId}/join`, ownerCookie),
      post(`/api/v1/meetings/${meetingId}/join`, ownerCookie),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const stays = [
      (await readJson<JoinedMeeting>(first)).participantId,
      (await readJson<JoinedMeeting>(second)).participantId,
    ];
    expect(stays[0]).toBe(stays[1]);

    // One seat, one tile, one row to close.
    const attendance = await readJson<AttendancePage>(
      await get(`/api/v1/meetings/${meetingId}/attendance`, ownerCookie),
    );
    expect(attendance.data).toHaveLength(1);
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

describe("the meetings screen's three lists", () => {
  it("shows what is live, what is ahead and what has just ended, each in its own list", async () => {
    // Three rooms in three states, on events of this test's own so no other test's room appears.
    const liveId = await startMeetingOn(await freshEvent("Live conference"));
    await post(`/api/v1/meetings/${liveId}/join`, ownerCookie);
    const endedId = await startMeetingOn(await freshEvent("Finished conference"));
    await post(`/api/v1/meetings/${endedId}/join`, ownerCookie);
    await post(`/api/v1/meetings/${endedId}/end`, ownerCookie);
    const aheadId = await startMeetingOn(await freshEvent("Scheduled conference"));

    const live = await readJson<MeetingPage>(await get("/api/v1/meetings?scope=live", ownerCookie));
    expect(live.data.map((meeting) => meeting.id)).toContain(liveId);
    expect(live.data.map((meeting) => meeting.id)).not.toContain(endedId);
    // The deployment fact rides beside each summary, exactly as it does on a single read.
    expect(live.data.every((meeting) => meeting.configured)).toBe(true);

    // THE DAY COMES FROM THE CALLER. The fixture's events are on 2026-09-21, so a caller whose own
    // day is that day or earlier has them ahead of them.
    const ahead = await readJson<MeetingPage>(
      await get("/api/v1/meetings?scope=upcoming&today=2026-09-01", ownerCookie),
    );
    expect(ahead.data.map((meeting) => meeting.id)).toContain(aheadId);
    expect(ahead.data.map((meeting) => meeting.id)).not.toContain(liveId);

    // And a caller whose day is already past them sees none of them.
    const nothingAhead = await readJson<MeetingPage>(
      await get("/api/v1/meetings?scope=upcoming&today=2026-12-01", ownerCookie),
    );
    expect(nothingAhead.data.map((meeting) => meeting.id)).not.toContain(aheadId);

    const recent = await readJson<MeetingPage>(
      await get("/api/v1/meetings?scope=recent", ownerCookie),
    );
    expect(recent.data.map((meeting) => meeting.id)).toContain(endedId);
    expect(recent.data.map((meeting) => meeting.id)).not.toContain(liveId);
    expect(recent.nextCursor === null || typeof recent.nextCursor === "string").toBe(true);
  });

  it("refuses the upcoming scope with no day rather than guessing at one", async () => {
    // Falling back to the server's day would answer a different question, and would answer it
    // wrongly for exactly the member whose evening has not turned over yet.
    const response = await get("/api/v1/meetings?scope=upcoming", ownerCookie);
    expect(response.status).toBe(422);
  });

  it("leaves a walled matter's meeting out of every list", async () => {
    // Started while the matter was reachable — the holding matter is walled from every read, so the
    // room behind it must be as absent from a list as it is by id.
    const walledMeeting = newIdentifier("meeting");
    await firmDatabase
      .prepare(
        `INSERT INTO meeting (id, event_kind, matter_event_id, firm_event_id, status, ` +
          `created_by_user_id, started_at, created_at, updated_at) ` +
          `VALUES (?1, 'matter', ?2, NULL, 'live', ?3, ?4, ?4, ?4)`,
      )
      .bind(walledMeeting, WALLED_EVENT, responsibleUserId, new Date().toISOString())
      .run();

    const live = await readJson<MeetingPage>(await get("/api/v1/meetings?scope=live", ownerCookie));
    expect(live.data.map((meeting) => meeting.id)).not.toContain(walledMeeting);
    // The same answer by the other door, so the pair cannot be used to tell the two apart.
    expect((await get(`/api/v1/meetings/${walledMeeting}`, ownerCookie)).status).toBe(404);
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

  it("refuses an upgrade carrying another site's Origin", async () => {
    const meetingId = await freshMeeting();
    await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie);

    // A BROWSER WILL OPEN A SOCKET CROSS-ORIGIN WITH THE MEMBER'S COOKIE, where it would refuse to
    // let that page read any other call here. What it would buy is the roster of a meeting the
    // member is in and the ability to signal inside it.
    const response = await get(`/api/v1/meetings/${meetingId}/socket`, ownerCookie, {
      upgrade: "websocket",
      origin: "https://not-this-application.example",
    });
    expect(response.status).toBe(403);

    // The application's own origin is the one the request was addressed to, and it is served.
    const sameOrigin = await get(`/api/v1/meetings/${meetingId}/socket`, ownerCookie, {
      upgrade: "websocket",
      origin: base,
    });
    expect(sameOrigin.status).toBe(101);
    // Closed rather than left hanging: the harness's teardown barrier counts open sockets.
    sameOrigin.webSocket?.accept();
    sameOrigin.webSocket?.close(1000, "done");
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
