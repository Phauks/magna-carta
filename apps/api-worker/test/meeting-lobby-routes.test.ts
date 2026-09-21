import { env } from "cloudflare:test";
import { meetingSocketRequestUrl } from "../src/meetings/meeting-room.ts";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterEventId, MatterId } from "@magna-carta/identifiers/types";
import { ADMIT_PARTICIPANT_GUARD } from "@magna-carta/meetings/lobby-service";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { racingFirmDatabase } from "./support/racing-firm-database.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// THE DOOR OF ONE MEETING, exercised for the things that would be real product failures if they
// stopped holding:
//
//   - AN ARRIVAL AT THE DOOR IS NOT SOMEBODY IN THE ROOM. The join answers `waiting: true` and the
//     summary's live count does not move, because the two presence predicates have one home.
//   - WHOEVER MAY RUN THIS ROOM DOES NOT WAIT, and holding `meetings:host` is deliberately not
//     enough: a key-holder with no grant on this meeting queues like anybody else.
//   - A HOST'S DECISION IS ABOUT A NAMED PERSON. Turning the lobby off admits nobody, a batch
//     reports one outcome per identifier, and a denial bars re-entry for as long as the meeting runs.
//   - EVERY LOBBY PATH IS A HOST ACT, THE READ INCLUDED — the one read in this family that the
//     people in the room may not make.
//   - THE DATABASE SETTLES THE RACE THE READS CANNOT: an admission against a denial of the same
//     stay lands as an answer a host can act on rather than as an Error ID.
//
// The routing credentials are an environment override rather than a shared setting, exactly as the
// other meetings suites do it: starting and joining need them, and a placeholder in the pool's
// environment would make every other suite look configured.

// TWO APP INSTANCES, for the reason the hosting suite has two: the rate limiter is an in-memory
// sliding window built per app, and its default bucket is a hundred requests a minute — which a
// file that stands a lobby up per test spends. The split is only ever between describes.
const apps = [createApp(), createApp()] as const;
let servingApp: ReturnType<typeof createApp> = apps[0];

function servedBy(index: 0 | 1): void {
  servingApp = apps[index];
}

const ROUTED_ENVIRONMENT = {
  ...env,
  REALTIME_SFU_APP_ID: "test-realtime-application",
  REALTIME_SFU_APP_SECRET: "test-realtime-secret",
};

let firmId: FirmId;
let ownerCookie: string;
let ownerUserId: string;
let attorneyCookie: string;
let attorneyUserId: string;
let paralegalCookie: string;
let billingCookie: string;
let billingUserId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const MATTER = newIdentifier("matter") as MatterId;
const HOLDING_MATTER = newIdentifier("matter") as MatterId;
const WALLED_EVENT = newIdentifier("matterEvent") as MatterEventId;

const base = "https://example.com";

async function post(
  path: string,
  cookie: string,
  body?: unknown,
  options: { environment?: Record<string, unknown> } = {},
): Promise<Response> {
  return await servingApp.request(
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
    options.environment ?? ROUTED_ENVIRONMENT,
  );
}

async function get(path: string, cookie: string): Promise<Response> {
  return await servingApp.request(`${base}${path}`, { headers: { cookie } }, ROUTED_ENVIRONMENT);
}

interface StartedMeeting {
  id: string;
}
interface JoinedMeeting {
  participantId: string;
  waiting: boolean;
}
interface MeetingSummary {
  id: string;
  status: string;
  liveCount: number;
  lobby: string;
}
interface LobbyEntry {
  participantId: string;
  userId: string;
  displayName: string;
  waitingFrom: string;
}
interface LobbyList {
  data: LobbyEntry[];
}
interface LobbyDecision {
  participantId: string;
  outcome: string;
}
interface LobbyDecisions {
  data: LobbyDecision[];
}
interface ProblemBody {
  type: string;
  detail: string;
}

const EVENT_COLUMNS =
  "id, matter_id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, " +
  "recorded_at, recorded_by, created_at, updated_at";

/** An event of this test's own, because one meeting per event is held by the database. */
async function freshEvent(title = "Settlement conference"): Promise<MatterEventId> {
  const id = newIdentifier("matterEvent") as MatterEventId;
  await firmDatabase
    .prepare(
      `INSERT INTO matter_event (${EVENT_COLUMNS}) VALUES ` +
        `(?1, ?2, ?3, 'scheduled', '2026-09-21', '09:30', '10:30', 'America/Los_Angeles', ?4, ?5, ?4, ?4)`,
    )
    .bind(id, MATTER, title, new Date().toISOString(), ownerUserId)
    .run();
  return id;
}

async function joinAs(meetingId: string, cookie: string): Promise<JoinedMeeting> {
  const response = await post(`/api/v1/meetings/${meetingId}/join`, cookie);
  expect(response.status).toBe(200);
  return await readJson<JoinedMeeting>(response);
}

/** A lobby-on room the owner started and is in, which is where most of these tests begin. */
async function meetingWithALobby(title?: string): Promise<string> {
  const started = await post("/api/v1/meetings", ownerCookie, {
    eventKind: "matter",
    eventId: await freshEvent(title),
    lobby: "on",
  });
  expect(started.status).toBe(201);
  const meetingId = (await readJson<StartedMeeting>(started)).id;
  // The starter holds a grant from the instant the room exists, so they never meet their own door.
  expect((await joinAs(meetingId, ownerCookie)).waiting).toBe(false);
  return meetingId;
}

async function lobbyOf(meetingId: string, cookie = ownerCookie): Promise<LobbyEntry[]> {
  const response = await get(`/api/v1/meetings/${meetingId}/lobby`, cookie);
  expect(response.status).toBe(200);
  return (await readJson<LobbyList>(response)).data;
}

async function summaryOf(meetingId: string): Promise<MeetingSummary> {
  return await readJson<MeetingSummary>(await get(`/api/v1/meetings/${meetingId}`, ownerCookie));
}

async function auditEvents(meetingId: string): Promise<string[]> {
  const { results } = await firmDatabase
    .prepare("SELECT event FROM audit_log WHERE subject_id = ?1 ORDER BY created_at ASC, id ASC")
    .bind(meetingId)
    .all<{ event: string }>();
  return results.map((row) => row.event);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Meeting Lobby Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("lobby-owner@example.com", {
    userName: "Lobby Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Lobby Owner", firmId);
  ownerCookie = await signInForSessionCookie("lobby-owner@example.com");
  ownerUserId = owner.userId;

  // A SECOND KEY-HOLDER. The seed migration puts `meetings:host` on Attorney, and the point of the
  // lobby is that holding it is not enough: a paralegal with the key walking past the door of a
  // confidential matter discussion is what a host turns the lobby on to prevent.
  const attorney = await seedCredentialedUser("lobby-attorney@example.com", {
    userName: "Lobby Attorney",
    firmId,
  });
  await mirrorMemberWithRole(attorney.userId, "Lobby Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("lobby-attorney@example.com");
  attorneyUserId = attorney.userId;

  const paralegal = await seedCredentialedUser("lobby-paralegal@example.com", {
    userName: "Lobby Paralegal",
    firmId,
  });
  await mirrorMemberWithRole(paralegal.userId, "Lobby Paralegal", firmId, "Paralegal");
  paralegalCookie = await signInForSessionCookie("lobby-paralegal@example.com");

  // And a member who may attend and not convene, which is the other side of the same line.
  const billing = await seedCredentialedUser("lobby-billing@example.com", {
    userName: "Lobby Bookkeeper",
    firmId,
  });
  await mirrorMemberWithRole(billing.userId, "Lobby Bookkeeper", firmId, "Billing");
  billingCookie = await signInForSessionCookie("lobby-billing@example.com");
  billingUserId = billing.userId;

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

  await firmDatabase
    .prepare(
      `INSERT INTO matter_event (${EVENT_COLUMNS}) VALUES ` +
        `(?1, ?2, 'Holding review', 'scheduled', '2026-09-21', '09:30', '10:30', 'America/Los_Angeles', ?3, ?4, ?3, ?3)`,
    )
    .bind(WALLED_EVENT, HOLDING_MATTER, new Date().toISOString(), owner.userId)
    .run();
});

/**
 * A socket in the meeting's own signaling room, which is how a BROADCAST is observed.
 *
 * The room is a real Durable Object in this pool and the route addresses it by the session firm and
 * the meeting, so the object a test opens a socket on is the object the handler reaches — and, for
 * the no-op case, the place where the absence of a frame can be asserted at all.
 */
async function openRoomSocket(
  meetingId: string,
  attendanceId: string,
): Promise<{ frames: Record<string, unknown>[] }> {
  const stub = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meetingId}`));
  const response = await stub.fetch(
    new Request(
      meetingSocketRequestUrl({
        firmId,
        meetingId,
        userId: `user_${attendanceId}`,
        attendanceId,
        displayName: "A Member",
        medium: "video",
        hostRole: null,
        locked: false,
        lobby: "off",
        waiting: false,
        waitingFrom: "",
      }),
      { headers: { Upgrade: "websocket" } },
    ),
  );
  const socket = response.webSocket;
  if (socket === null || socket === undefined) throw new Error("no WebSocket on the 101");
  const frames: Record<string, unknown>[] = [];
  socket.accept();
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(String(event.data)) as Record<string, unknown>);
  });
  await waitFor(() => frames.length > 0);
  frames.length = 0;
  return { frames };
}

/** Waits on elapsed time, because a push has to cross a socket pair before it can be seen. */
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A short pause, used ONLY to assert that nothing arrived. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

describe("arriving at a door", () => {
  it("answers waiting, keeps the live count where it was, and shows on the lobby list", async () => {
    const meetingId = await meetingWithALobby();

    const arrival = await joinAs(meetingId, billingCookie);
    expect(arrival.waiting).toBe(true);
    // The relay credentials come back either way: they last an hour, which covers any wait anybody
    // will sit through, and minting at admission would need a second round trip at the exact moment
    // somebody is being let into a meeting that has started without them.
    expect((await summaryOf(meetingId)).liveCount).toBe(1);

    expect(await lobbyOf(meetingId)).toEqual([
      {
        participantId: arrival.participantId,
        userId: billingUserId,
        displayName: "Lobby Bookkeeper",
        waitingFrom: expect.any(String) as string,
      },
    ]);
    expect(await auditEvents(meetingId)).toContain("meetings.meeting.waiting");
  });

  it("queues a key-holder who is not hosting this meeting, and never the host", async () => {
    const meetingId = await meetingWithALobby("Key-holder at the door");

    // HOLDING `meetings:host` IS NOT ENOUGH. The question is the grant on THIS meeting.
    expect((await joinAs(meetingId, attorneyCookie)).waiting).toBe(true);
    // And the starter, who holds one, walks in.
    expect((await joinAs(meetingId, ownerCookie)).waiting).toBe(false);
  });

  it("is a lobby only where the Start asked for one", async () => {
    const started = await post("/api/v1/meetings", ownerCookie, {
      eventKind: "matter",
      eventId: await freshEvent("No lobby"),
    });
    const meetingId = (await readJson<StartedMeeting>(started)).id;
    expect((await summaryOf(meetingId)).lobby).toBe("off");
    expect((await joinAs(meetingId, billingCookie)).waiting).toBe(false);
  });

  it("hands a reconnecting waiter the same stay rather than a place at the back", async () => {
    const meetingId = await meetingWithALobby("Reconnecting at the door");
    const first = await joinAs(meetingId, billingCookie);
    const again = await joinAs(meetingId, billingCookie);

    expect(again.participantId).toBe(first.participantId);
    expect(again.waiting).toBe(true);
    expect(await lobbyOf(meetingId)).toHaveLength(1);
  });
});

describe("who may see and move the door", () => {
  it("answers 403 meeting-not-host to a key-holder with no grant, on the read and every write", async () => {
    const meetingId = await meetingWithALobby("No grant at the door");
    const waiter = await joinAs(meetingId, billingCookie);

    const answers = [
      await get(`/api/v1/meetings/${meetingId}/lobby`, attorneyCookie),
      await post(`/api/v1/meetings/${meetingId}/lobby`, attorneyCookie, { lobby: "off" }),
      await post(`/api/v1/meetings/${meetingId}/lobby/admissions`, attorneyCookie, {
        participantIds: [waiter.participantId],
      }),
      await post(`/api/v1/meetings/${meetingId}/lobby/denials`, attorneyCookie, {
        participantIds: [waiter.participantId],
      }),
    ];
    for (const answer of answers) {
      // THE READ TOO, and that is the one place this family withholds something from a member who
      // may join: the lobby list is people a host has not decided about yet.
      expect(answer.status).toBe(403);
      expect((await readJson<ProblemBody>(answer)).type).toContain("meeting-not-host");
    }
  });

  it("refuses a member who may attend and not convene at the chokepoint instead", async () => {
    const meetingId = await meetingWithALobby("Attendee only at the door");
    const answer = await get(`/api/v1/meetings/${meetingId}/lobby`, billingCookie);
    expect(answer.status).toBe(403);
    expect((await readJson<ProblemBody>(answer)).type).not.toContain("meeting-not-host");
  });

  it("reports a walled matter's meeting as absent on every one of the four routes", async () => {
    const walledMeeting = newIdentifier("meeting");
    const now = new Date().toISOString();
    await firmDatabase
      .prepare(
        `INSERT INTO meeting (id, event_kind, matter_event_id, firm_event_id, status, ` +
          `created_by_user_id, started_at, lobby, created_at, updated_at) ` +
          `VALUES (?1, 'matter', ?2, NULL, 'live', ?3, ?4, 'on', ?4, ?4)`,
      )
      .bind(walledMeeting, WALLED_EVENT, ownerUserId, now)
      .run();

    const stranger = newIdentifier("meetingAttendance");
    const answers = [
      await get(`/api/v1/meetings/${walledMeeting}/lobby`, ownerCookie),
      await post(`/api/v1/meetings/${walledMeeting}/lobby`, ownerCookie, { lobby: "off" }),
      await post(`/api/v1/meetings/${walledMeeting}/lobby/admissions`, ownerCookie, {
        participantIds: [stranger],
      }),
      await post(`/api/v1/meetings/${walledMeeting}/lobby/denials`, ownerCookie, {
        participantIds: [stranger],
      }),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect((await readJson<ProblemBody>(answer)).type).toContain("meeting-not-found");
    }
  });

  it("opens and closes the door, and closing it admits nobody", async () => {
    const meetingId = await meetingWithALobby("Closing the door");
    const waiter = await joinAs(meetingId, billingCookie);

    const closed = await post(`/api/v1/meetings/${meetingId}/lobby`, ownerCookie, {
      lobby: "off",
    });
    expect(closed.status).toBe(200);
    expect((await summaryOf(meetingId)).lobby).toBe("off");

    // A SETTING IS NOT A DECISION ABOUT A NAMED PERSON. Somebody may be waiting precisely because
    // the host intends to deny them.
    expect((await lobbyOf(meetingId)).map((entry) => entry.participantId)).toEqual([
      waiter.participantId,
    ]);
    // And the next arrival walks straight in, which is what the setting actually changed.
    expect((await joinAs(meetingId, paralegalCookie)).waiting).toBe(false);

    // Already true: writing it again would move an instant a record already carries.
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lobby`, ownerCookie, { lobby: "off" })).status,
    ).toBe(200);
    expect(
      (await auditEvents(meetingId)).filter((event) => event === "meetings.meeting.lobbyChanged"),
    ).toHaveLength(1);
  });

  it("does not disturb the room for a setting that moved nothing", async () => {
    const meetingId = await meetingWithALobby("Lobby set twice, watched");
    const watching = await openRoomSocket(meetingId, newIdentifier("meetingAttendance"));

    // The value the meeting already holds: the write produces no statements, so nobody in the room
    // has anything to be told. Broadcasting anyway would restate what every socket already draws
    // and would report an event that did not happen.
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lobby`, ownerCookie, { lobby: "on" })).status,
    ).toBe(200);
    await settle();
    expect(watching.frames.filter((frame) => frame["type"] === "room-state")).toHaveLength(0);

    // And a write that DOES move it still reaches the room, so this is a skip rather than a break.
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lobby`, ownerCookie, { lobby: "off" })).status,
    ).toBe(200);
    await waitFor(
      () => watching.frames.filter((frame) => frame["type"] === "room-state").length > 0,
    );
    expect(watching.frames.filter((frame) => frame["type"] === "room-state").at(-1)).toMatchObject({
      lobby: "off",
    });
  });
});

describe("a host's decision", () => {
  beforeAll(() => {
    servedBy(1);
  });

  it("admits somebody, who then counts as being in the room", async () => {
    const meetingId = await meetingWithALobby("Admitting");
    const waiter = await joinAs(meetingId, billingCookie);

    const admitted = await post(`/api/v1/meetings/${meetingId}/lobby/admissions`, ownerCookie, {
      participantIds: [waiter.participantId],
    });
    expect(admitted.status).toBe(200);
    expect((await readJson<LobbyDecisions>(admitted)).data).toEqual([
      { participantId: waiter.participantId, outcome: "admitted" },
    ]);

    expect((await summaryOf(meetingId)).liveCount).toBe(2);
    expect(await lobbyOf(meetingId)).toEqual([]);
    expect(await auditEvents(meetingId)).toContain("meetings.meeting.admitted");
  });

  it("reports one outcome per identifier in a mixed batch", async () => {
    const meetingId = await meetingWithALobby("Mixed batch");
    const waiter = await joinAs(meetingId, billingCookie);
    const stranger = newIdentifier("meetingAttendance");

    const admitted = await post(`/api/v1/meetings/${meetingId}/lobby/admissions`, ownerCookie, {
      participantIds: [waiter.participantId, stranger],
    });
    expect((await readJson<LobbyDecisions>(admitted)).data).toEqual([
      { participantId: waiter.participantId, outcome: "admitted" },
      { participantId: stranger, outcome: "not-waiting" },
    ]);
  });

  it("denies somebody, bars them for the life of the meeting, and tells the room nothing", async () => {
    const meetingId = await meetingWithALobby("Denying");
    const waiter = await joinAs(meetingId, billingCookie);

    const denied = await post(`/api/v1/meetings/${meetingId}/lobby/denials`, ownerCookie, {
      participantIds: [waiter.participantId],
    });
    expect(denied.status).toBe(200);
    expect((await readJson<LobbyDecisions>(denied)).data).toEqual([
      { participantId: waiter.participantId, outcome: "denied" },
    ]);

    const stay = await firmDatabase
      .prepare(
        "SELECT left_at AS leftAt, ended_reason AS endedReason, admitted_at AS admittedAt " +
          "FROM meeting_attendance WHERE id = ?1",
      )
      .bind(waiter.participantId)
      .first<{ leftAt: string | null; endedReason: string | null; admittedAt: string | null }>();
    expect(stay?.endedReason).toBe("denied");
    expect(stay?.admittedAt).toBeNull();
    expect(stay?.leftAt).not.toBeNull();

    // A DENIAL THAT DID NOT BAR would be a button that does nothing: the member presses Join again
    // and is back at the front of the queue.
    const again = await post(`/api/v1/meetings/${meetingId}/join`, billingCookie);
    expect(again.status).toBe(409);
    expect((await readJson<ProblemBody>(again)).type).toContain("meeting-not-admitted");

    // The record carries both facts: the departure, labelled, and the host's act beside it.
    const events = await auditEvents(meetingId);
    expect(events).toContain("meetings.meeting.denied");
    expect(events).toContain("meetings.meeting.left");
    expect((await summaryOf(meetingId)).liveCount).toBe(1);
  });

  it("rolls the batch back when a denial lands inside an admission's window", async () => {
    const meetingId = await meetingWithALobby("Admit against deny");
    const waiter = await joinAs(meetingId, billingCookie);

    // THE WINDOW IS REAL: the admission reads the stay, decides, and commits a round trip later. A
    // co-host's denial lands in between, so the admission's guarded UPDATE meets a row that is no
    // longer waiting — and an instant on somebody's record is never moved by a second write.
    const racing = racingFirmDatabase(ROUTED_ENVIRONMENT, ADMIT_PARTICIPANT_GUARD, async () => {
      const denied = await post(`/api/v1/meetings/${meetingId}/lobby/denials`, ownerCookie, {
        participantIds: [waiter.participantId],
      });
      expect(denied.status).toBe(200);
    });

    const loser = await post(
      `/api/v1/meetings/${meetingId}/lobby/admissions`,
      ownerCookie,
      { participantIds: [waiter.participantId] },
      { environment: racing.environment },
    );
    expect(racing.interleaved).toBe(true);
    expect(loser.status).toBe(409);
    expect((await readJson<ProblemBody>(loser)).type).toContain("conflict");

    // ONE DECISION STANDS, and it is the one that landed. Nothing half-committed.
    const stay = await firmDatabase
      .prepare(
        "SELECT ended_reason AS endedReason, admitted_at AS admittedAt FROM meeting_attendance WHERE id = ?1",
      )
      .bind(waiter.participantId)
      .first<{ endedReason: string | null; admittedAt: string | null }>();
    expect(stay?.endedReason).toBe("denied");
    expect(stay?.admittedAt).toBeNull();
    expect(
      (await auditEvents(meetingId)).filter((event) => event === "meetings.meeting.admitted"),
    ).toHaveLength(0);
  });

  it("refuses a decision on a meeting that has ended", async () => {
    const meetingId = await meetingWithALobby("Ended under the door");
    const waiter = await joinAs(meetingId, billingCookie);
    expect((await post(`/api/v1/meetings/${meetingId}/end`, ownerCookie)).status).toBe(200);

    const answer = await post(`/api/v1/meetings/${meetingId}/lobby/admissions`, ownerCookie, {
      participantIds: [waiter.participantId],
    });
    expect(answer.status).toBe(409);
    expect((await readJson<ProblemBody>(answer)).type).toContain("meeting-ended");
  });
});

describe("the lobby's one deadlock", () => {
  it("lets a key-holder claim a hostless room from inside it, and admits them by the same batch", async () => {
    const meetingId = await meetingWithALobby("Claiming from the door");
    const waiter = await joinAs(meetingId, attorneyCookie);
    expect(waiter.waiting).toBe(true);

    // The host opens the room and goes, leaving everybody queued for somebody who will never admit
    // them.
    expect((await post(`/api/v1/meetings/${meetingId}/leave`, ownerCookie)).status).toBe(200);

    const claimed = await post(`/api/v1/meetings/${meetingId}/hosts`, attorneyCookie, {
      userId: attorneyUserId,
      role: "host",
    });
    expect(claimed.status).toBe(200);

    // A HOST DOES NOT WAIT IN THEIR OWN LOBBY, so the claim admitted their stay in the same batch —
    // there is no instant in which somebody is hosting a room they are not in.
    const stay = await firmDatabase
      .prepare("SELECT admitted_at AS admittedAt FROM meeting_attendance WHERE id = ?1")
      .bind(waiter.participantId)
      .first<{ admittedAt: string | null }>();
    expect(stay?.admittedAt).not.toBeNull();
    expect(await lobbyOf(meetingId, attorneyCookie)).toEqual([]);
    expect(await auditEvents(meetingId)).toContain("meetings.meeting.hostingClaimed");
  });
});
