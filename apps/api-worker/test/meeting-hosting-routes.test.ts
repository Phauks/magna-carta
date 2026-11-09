import { env } from "cloudflare:test";
import { meetingSocketRequestUrl } from "../src/meetings/meeting-room.ts";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterEventId, MatterId } from "@magna-carta/identifiers/types";
import { HANDOVER_GUARD, REMOVE_PARTICIPANT_GUARD } from "@magna-carta/meetings/hosting-service";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
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

// THE HOSTING SURFACE, exercised for the things that would be real product failures if they stopped
// holding:
//
//   - AUTHORITY OVER A MEETING IS A GRANT ON THE MEETING, NOT A CAPABILITY OF A SEAT. Every write
//     here answers 403 `meeting-not-host` to a member who holds `meetings:host` and no grant on this
//     room, and 200 to the member who started it. The permission key is the floor; the record is
//     the authority.
//   - ENDING IS NOW A HOST ACT. The behaviour change is asserted deliberately: before this, any
//     key-holder could close any meeting they could see the event for, from anywhere, without being
//     in it.
//   - THE GRANTS READ IS REACHABLE ON `meetings:join`. Everybody in the room needs to know who is
//     running it; hiding that from the people it governs would be a strange kind of privacy.
//   - A WALLED MATTER'S MEETING IS AS ABSENT AS ONE THAT DOES NOT EXIST, through every one of the
//     five routes — the family's own rule, held here rather than assumed.
//   - THE DATABASE SETTLES THE RACES THE READS CANNOT. A removal against a member leaving, and two
//     claims for one hostless room, both land as answers a member can act on rather than as an
//     Error ID.
//
// The routing credentials are an environment override rather than a shared setting, exactly as the
// meetings routes' own suite does it: STARTING and JOINING need them, and a placeholder in the
// pool's environment would make every other suite look configured.

// TWO APP INSTANCES, AND THE REASON IS THE HARNESS RATHER THAN THE PRODUCT. The rate limiter is an
// in-memory sliding window keyed by firm and built per app, and its default bucket is a hundred
// requests a minute — which this file, running in about three seconds, spends. The alternative was
// to thin the assertions until they fitted a bucket that exists to bound abuse, which would have
// been the test trimmed to suit a limit nobody is testing. Everything that must be asked of ONE
// running app — a race, a retry, a member's answer after somebody else's act — is asked of one of
// them; the split is only ever between describes.
const apps = [createApp(), createApp()] as const;
let servingApp: ReturnType<typeof createApp> = apps[0];

/** Moves the rest of the file onto the second instance, and back for a describe that needs the first. */
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
let attorneyCookie: string;
let billingCookie: string;
let ownerUserId: string;
let attorneyUserId: string;
let paralegalCookie: string;
let paralegalUserId: string;
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
}
interface HostGrant {
  userId: string;
  role: string;
  grantedAt: string;
}
interface HostGrants {
  data: HostGrant[];
}
interface MeetingSummary {
  id: string;
  status: string;
  liveCount: number;
  locked: boolean;
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

async function joinAs(meetingId: string, cookie: string): Promise<string> {
  const response = await post(`/api/v1/meetings/${meetingId}/join`, cookie);
  expect(response.status).toBe(200);
  return (await readJson<JoinedMeeting>(response)).participantId;
}

/** A room the owner started and is in, which is where every test here begins. */
async function startedMeeting(title?: string): Promise<string> {
  const started = await post("/api/v1/meetings", ownerCookie, {
    eventKind: "matter",
    eventId: await freshEvent(title),
  });
  expect(started.status).toBe(201);
  const meetingId = (await readJson<StartedMeeting>(started)).id;
  await joinAs(meetingId, ownerCookie);
  return meetingId;
}

async function grantsOf(meetingId: string, cookie = ownerCookie): Promise<HostGrant[]> {
  const response = await get(`/api/v1/meetings/${meetingId}/hosts`, cookie);
  expect(response.status).toBe(200);
  return (await readJson<HostGrants>(response)).data;
}

async function summaryOf(meetingId: string): Promise<MeetingSummary> {
  return await readJson<MeetingSummary>(await get(`/api/v1/meetings/${meetingId}`, ownerCookie));
}

/**
 * A socket in the meeting's own signaling room, which is how a BROADCAST is observed.
 *
 * The room is a real Durable Object in this pool and the route addresses it by the session firm and
 * the meeting, so the object a test opens a socket on is the object the handler reaches. What a spy
 * would assert is that a method was called; what this asserts is that a frame arrived — and, for the
 * no-op case below, that none did.
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
  // The welcome crosses the pair before anything else does; the assertions are about what follows.
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

/** A short pause, used ONLY to assert that nothing arrived — a negative has no condition to wait on. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
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
  firmId = (await seedFirm({ name: "Meeting Hosting Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("hosting-owner@example.com", {
    userName: "Hosting Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Hosting Owner", firmId);
  ownerCookie = await signInForSessionCookie("hosting-owner@example.com");
  ownerUserId = owner.userId;

  // A SECOND KEY-HOLDER. The seed migration puts `meetings:host` on Attorney, which is exactly the
  // seat the old behaviour let close anybody's meeting — so the narrowing is asserted against the
  // seat rather than against a hand-made grant.
  const attorney = await seedCredentialedUser("hosting-attorney@example.com", {
    userName: "Hosting Attorney",
    firmId,
  });
  await mirrorMemberWithRole(attorney.userId, "Hosting Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("hosting-attorney@example.com");
  attorneyUserId = attorney.userId;

  // A SECOND SEAT THE SEEDS GIVE `meetings:host` TO, so two members can want the same hostless
  // room without either of them being the one who started it.
  const paralegal = await seedCredentialedUser("hosting-paralegal@example.com", {
    userName: "Hosting Paralegal",
    firmId,
  });
  await mirrorMemberWithRole(paralegal.userId, "Hosting Paralegal", firmId, "Paralegal");
  paralegalCookie = await signInForSessionCookie("hosting-paralegal@example.com");
  paralegalUserId = paralegal.userId;

  // And a member who may attend and not convene, which is the other side of the same line.
  const billing = await seedCredentialedUser("hosting-billing@example.com", {
    userName: "Hosting Bookkeeper",
    firmId,
  });
  await mirrorMemberWithRole(billing.userId, "Hosting Bookkeeper", firmId, "Billing");
  billingCookie = await signInForSessionCookie("hosting-billing@example.com");
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

describe("who is running the meeting", () => {
  it("names the starter, and is readable by anybody who may join", async () => {
    const meetingId = await startedMeeting();

    const grants = await grantsOf(meetingId);
    expect(grants).toEqual([
      { userId: ownerUserId, role: "host", grantedAt: expect.any(String) as string },
    ]);

    // `meetings:join`, not `meetings:host`: everybody in the room needs to know who is running it.
    await joinAs(meetingId, billingCookie);
    expect((await get(`/api/v1/meetings/${meetingId}/hosts`, billingCookie)).status).toBe(200);
  });

  it("reports a walled matter's meeting as absent on every one of the five routes", async () => {
    // Started while the matter was reachable; the holding matter is walled from every read, so the
    // room behind it must be unreachable by wording as well as by outcome.
    const walledMeeting = newIdentifier("meeting");
    const now = new Date().toISOString();
    await firmDatabase
      .prepare(
        `INSERT INTO meeting (id, event_kind, matter_event_id, firm_event_id, status, ` +
          `created_by_user_id, started_at, created_at, updated_at) ` +
          `VALUES (?1, 'matter', ?2, NULL, 'live', ?3, ?4, ?4, ?4)`,
      )
      .bind(walledMeeting, WALLED_EVENT, ownerUserId, now)
      .run();

    const answers = [
      await get(`/api/v1/meetings/${walledMeeting}/hosts`, ownerCookie),
      await post(`/api/v1/meetings/${walledMeeting}/hosts`, ownerCookie, {
        userId: ownerUserId,
        role: "host",
      }),
      await post(`/api/v1/meetings/${walledMeeting}/hosts/${ownerUserId}/revoke`, ownerCookie),
      await post(
        `/api/v1/meetings/${walledMeeting}/participants/${newIdentifier("meetingAttendance")}/remove`,
        ownerCookie,
      ),
      await post(`/api/v1/meetings/${walledMeeting}/lock`, ownerCookie, { locked: true }),
    ];
    for (const answer of answers) {
      expect(answer.status).toBe(404);
      expect((await readJson<ProblemBody>(answer)).type).toContain("meeting-not-found");
    }
  });

  it("answers 403 meeting-not-host to a key-holder with no grant, on every write", async () => {
    const meetingId = await startedMeeting("Key-holder with no grant");
    await joinAs(meetingId, attorneyCookie);
    const attorneyStay = await joinAs(meetingId, billingCookie);

    const answers = [
      await post(`/api/v1/meetings/${meetingId}/hosts`, attorneyCookie, {
        userId: billingUserId,
        role: "co-host",
      }),
      await post(`/api/v1/meetings/${meetingId}/hosts/${ownerUserId}/revoke`, attorneyCookie),
      await post(
        `/api/v1/meetings/${meetingId}/participants/${attorneyStay}/remove`,
        attorneyCookie,
      ),
      await post(`/api/v1/meetings/${meetingId}/lock`, attorneyCookie, { locked: true }),
    ];
    for (const answer of answers) {
      // 403 AND ITS OWN TYPE. The member holds `meetings:host`; what they do not hold is a grant on
      // this room, and the remedy is somebody handing it to them rather than an administrator
      // granting anything.
      expect(answer.status).toBe(403);
      expect((await readJson<ProblemBody>(answer)).type).toContain("meeting-not-host");
    }

    // The member who started it is answered 200 on the same call.
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, ownerCookie, { locked: true })).status,
    ).toBe(200);
  });

  it("refuses a member who may attend and not convene at the chokepoint instead", async () => {
    const meetingId = await startedMeeting("Attendee only");
    await joinAs(meetingId, billingCookie);

    // The key is still the floor: a seat without `meetings:host` never reaches the grant question.
    const answer = await post(`/api/v1/meetings/${meetingId}/lock`, billingCookie, {
      locked: true,
    });
    expect(answer.status).toBe(403);
    expect((await readJson<ProblemBody>(answer)).type).not.toContain("meeting-not-host");
  });
});

describe("handing the room over and naming a co-host", () => {
  it("moves hosting to somebody in the room and leaves the old grant closed", async () => {
    const meetingId = await startedMeeting("Handing over");
    await joinAs(meetingId, attorneyCookie);

    const handedOver = await post(`/api/v1/meetings/${meetingId}/hosts`, ownerCookie, {
      userId: attorneyUserId,
      role: "host",
    });
    expect(handedOver.status).toBe(200);
    // A HAND-OVER IS NOT A WALK-OUT: the room is the attorney's, and the outgoing host stays on as
    // a co-host. Dropping them to an ordinary member would take the mute, the spotlight and the
    // door away from somebody who was hosting a second earlier.
    expect(
      (await readJson<HostGrants>(handedOver)).data.map((grant) => [grant.userId, grant.role]),
    ).toEqual([
      [attorneyUserId, "host"],
      [ownerUserId, "co-host"],
    ]);

    // And the authority moved with it: the new host may hand the room on, and the old one may not.
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, attorneyCookie, { locked: true })).status,
    ).toBe(200);
    expect(
      (
        await post(`/api/v1/meetings/${meetingId}/hosts`, ownerCookie, {
          userId: billingUserId,
          role: "co-host",
        })
      ).status,
    ).toBe(403);
  });

  it("lets a co-host stand down from their own grant without asking the host", async () => {
    const meetingId = await startedMeeting("Standing down");
    await joinAs(meetingId, attorneyCookie);
    expect(
      (
        await post(`/api/v1/meetings/${meetingId}/hosts`, ownerCookie, {
          userId: attorneyUserId,
          role: "co-host",
        })
      ).status,
    ).toBe(200);

    // A grant only the host could close meant a co-host named for one agenda item carried the mute,
    // the spotlight and the door for the rest of the meeting, and the only exit was asking.
    const resigned = await post(
      `/api/v1/meetings/${meetingId}/hosts/${attorneyUserId}/revoke`,
      attorneyCookie,
    );
    expect(resigned.status).toBe(200);
    expect((await readJson<HostGrants>(resigned)).data.map((grant) => grant.userId)).toEqual([
      ownerUserId,
    ]);
    // And the authority went with it.
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, attorneyCookie, { locked: true })).status,
    ).toBe(403);
    expect(await auditEvents(meetingId)).toContain("meetings.meeting.hostingResigned");
  });

  it("refuses a host who is the only person holding anything", async () => {
    const meetingId = await startedMeeting("The last one out");

    // The room would be left with nobody running it and no act but a claim. What a host does
    // instead is hand it over, or end the meeting.
    const refused = await post(
      `/api/v1/meetings/${meetingId}/hosts/${ownerUserId}/revoke`,
      ownerCookie,
    );
    expect(refused.status).toBe(403);
    expect((await readJson<ProblemBody>(refused)).type).toContain("meeting-not-host");
  });

  it("names a co-host, who may run the room but not the host", async () => {
    const meetingId = await startedMeeting("Naming a co-host");
    await joinAs(meetingId, attorneyCookie);
    const billingStay = await joinAs(meetingId, billingCookie);

    expect(
      (
        await post(`/api/v1/meetings/${meetingId}/hosts`, ownerCookie, {
          userId: attorneyUserId,
          role: "co-host",
        })
      ).status,
    ).toBe(200);
    expect((await grantsOf(meetingId)).map((grant) => grant.role)).toEqual(["host", "co-host"]);

    // A co-host may lock the room and remove an ordinary member…
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, attorneyCookie, { locked: true })).status,
    ).toBe(200);
    expect(
      (
        await post(
          `/api/v1/meetings/${meetingId}/participants/${billingStay}/remove`,
          attorneyCookie,
        )
      ).status,
    ).toBe(200);
    // …and may not withdraw a grant or hand the room over: they are running the meeting with the
    // host, not running the host.
    expect(
      (await post(`/api/v1/meetings/${meetingId}/hosts/${ownerUserId}/revoke`, attorneyCookie))
        .status,
    ).toBe(403);
  });

  it("refuses a target who is not in the room", async () => {
    const meetingId = await startedMeeting("Absent target");

    const answer = await post(`/api/v1/meetings/${meetingId}/hosts`, ownerCookie, {
      userId: attorneyUserId,
      role: "co-host",
    });
    expect(answer.status).toBe(409);
    expect((await readJson<ProblemBody>(answer)).type).toContain("meeting-not-joined");
  });

  it("withdraws a co-host, and answers a member who holds nothing without writing anything", async () => {
    const meetingId = await startedMeeting("Withdrawing");
    await joinAs(meetingId, attorneyCookie);
    await post(`/api/v1/meetings/${meetingId}/hosts`, ownerCookie, {
      userId: attorneyUserId,
      role: "co-host",
    });

    const withdrawn = await post(
      `/api/v1/meetings/${meetingId}/hosts/${attorneyUserId}/revoke`,
      ownerCookie,
    );
    expect(withdrawn.status).toBe(200);
    expect((await readJson<HostGrants>(withdrawn)).data).toHaveLength(1);

    // Already true: what the caller asked for is the state, and a refusal would report a failure
    // that did not happen.
    const again = await post(
      `/api/v1/meetings/${meetingId}/hosts/${attorneyUserId}/revoke`,
      ownerCookie,
    );
    expect(again.status).toBe(200);
    expect(
      (await auditEvents(meetingId)).filter(
        (event) => event === "meetings.meeting.coHostWithdrawn",
      ),
    ).toHaveLength(1);
  });
});

describe("claiming a room nobody is running", () => {
  it("is refused while the host is in it, and accepted once they have gone", async () => {
    const meetingId = await startedMeeting("Claiming");
    await joinAs(meetingId, attorneyCookie);

    const early = await post(`/api/v1/meetings/${meetingId}/hosts`, attorneyCookie, {
      userId: attorneyUserId,
      role: "host",
    });
    expect(early.status).toBe(403);
    expect((await readJson<ProblemBody>(early)).type).toContain("meeting-not-host");

    // HOSTING DOES NOT PASS ON ITS OWN when a host leaves — the grant stands while they are away —
    // and what changes the answer is that nobody holding one is in the room.
    expect((await post(`/api/v1/meetings/${meetingId}/leave`, ownerCookie)).status).toBe(200);
    const claimed = await post(`/api/v1/meetings/${meetingId}/hosts`, attorneyCookie, {
      userId: attorneyUserId,
      role: "host",
    });
    expect(claimed.status).toBe(200);
    expect((await readJson<HostGrants>(claimed)).data).toEqual([
      { userId: attorneyUserId, role: "host", grantedAt: expect.any(String) as string },
    ]);
    // Audited as a claim rather than as a hand-over, because nobody gave it.
    expect(await auditEvents(meetingId)).toContain("meetings.meeting.hostingClaimed");
  });

  it("gives the room to one of two members claiming it in the same instant", async () => {
    const meetingId = await startedMeeting("Two claimants");
    await joinAs(meetingId, attorneyCookie);
    await joinAs(meetingId, paralegalCookie);
    expect((await post(`/api/v1/meetings/${meetingId}/leave`, ownerCookie)).status).toBe(200);

    // THE WINDOW IS REAL: a claim reads the grants and finds nobody running the room, then commits
    // a round trip later. Firing the second claim at the first one's own guard beats racing two
    // promises, which interleave however the runtime happened to schedule them that run — the
    // suite's first attempt at this passed with both answering 200 because they simply ran in turn.
    const racing = racingFirmDatabase(ROUTED_ENVIRONMENT, HANDOVER_GUARD, async () => {
      const winner = await post(`/api/v1/meetings/${meetingId}/hosts`, paralegalCookie, {
        userId: paralegalUserId,
        role: "host",
      });
      expect(winner.status).toBe(200);
    });

    const loser = await post(
      `/api/v1/meetings/${meetingId}/hosts`,
      attorneyCookie,
      { userId: attorneyUserId, role: "host" },
      { environment: racing.environment },
    );

    // The abandoned grant this claim meant to close was closed by the other claimant inside the
    // window, so its guarded revoke matched no row and the whole batch rolled back. One live host,
    // and the member who lost is told somebody else changed who is hosting rather than handed an
    // Error ID for a batch they cannot see.
    expect(racing.interleaved).toBe(true);
    expect(loser.status).toBe(409);
    expect((await readJson<ProblemBody>(loser)).type).toContain("conflict");
    const hosts = (await grantsOf(meetingId, attorneyCookie)).filter(
      (grant) => grant.role === "host",
    );
    expect(hosts).toEqual([
      { userId: paralegalUserId, role: "host", grantedAt: expect.any(String) as string },
    ]);
  });
});

describe("removing somebody", () => {
  // From here the file is served by the second instance, so one firm's abuse bucket is not what
  // decides whether these assertions run.
  beforeAll(() => {
    servedBy(1);
  });

  it("closes their stay as removed and refuses them the room while it runs", async () => {
    const meetingId = await startedMeeting("Removing");
    const billingStay = await joinAs(meetingId, billingCookie);

    const removed = await post(
      `/api/v1/meetings/${meetingId}/participants/${billingStay}/remove`,
      ownerCookie,
    );
    expect(removed.status).toBe(200);

    const stay = await firmDatabase
      .prepare(
        "SELECT left_at AS leftAt, ended_reason AS endedReason FROM meeting_attendance WHERE id = ?1",
      )
      .bind(billingStay)
      .first<{ leftAt: string | null; endedReason: string | null }>();
    expect(stay?.endedReason).toBe("removed");
    expect(stay?.leftAt).not.toBeNull();

    const rejoined = await post(`/api/v1/meetings/${meetingId}/join`, billingCookie);
    expect(rejoined.status).toBe(409);
    expect((await readJson<ProblemBody>(rejoined)).type).toContain("meeting-removed");

    // The record carries both facts: the departure, labelled, and the host's act beside it.
    const events = await auditEvents(meetingId);
    expect(events).toContain("meetings.meeting.removed");
    expect(events).toContain("meetings.meeting.left");
    expect((await summaryOf(meetingId)).liveCount).toBe(1);
  });

  it("refuses a host removing themselves, because leaving is how a person leaves", async () => {
    const meetingId = await startedMeeting("Removing oneself");
    const ownStay = (
      await readJson<JoinedMeeting>(await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie))
    ).participantId;

    const answer = await post(
      `/api/v1/meetings/${meetingId}/participants/${ownStay}/remove`,
      ownerCookie,
    );
    expect(answer.status).toBe(403);
    expect((await readJson<ProblemBody>(answer)).type).toContain("meeting-not-host");
  });

  it("tells the host their target left first, rather than writing a second departure", async () => {
    const meetingId = await startedMeeting("Removal against a leave");
    const billingStay = await joinAs(meetingId, billingCookie);

    // THE WINDOW IS REAL: the removal reads the open stay, decides, and commits a round trip later.
    // The member's own leave lands in between, so the removal's guarded UPDATE meets a row that has
    // already closed — and the instant on somebody's record is never moved by a second write.
    const racing = racingFirmDatabase(ROUTED_ENVIRONMENT, REMOVE_PARTICIPANT_GUARD, async () => {
      expect((await post(`/api/v1/meetings/${meetingId}/leave`, billingCookie)).status).toBe(200);
    });

    const loser = await post(
      `/api/v1/meetings/${meetingId}/participants/${billingStay}/remove`,
      ownerCookie,
      undefined,
      { environment: racing.environment },
    );
    expect(racing.interleaved).toBe(true);
    expect(loser.status).toBe(409);
    expect((await readJson<ProblemBody>(loser)).type).toContain("meeting-not-joined");

    // One departure, and it is the member's own.
    const stay = await firmDatabase
      .prepare("SELECT ended_reason AS endedReason FROM meeting_attendance WHERE id = ?1")
      .bind(billingStay)
      .first<{ endedReason: string | null }>();
    expect(stay?.endedReason).toBe("left");
    expect(
      (await auditEvents(meetingId)).filter((event) => event === "meetings.meeting.removed"),
    ).toHaveLength(0);
  });
});

describe("the door", () => {
  it("refuses a late arrival, says so on the summary, and opens again", async () => {
    const meetingId = await startedMeeting("Locking");
    await joinAs(meetingId, attorneyCookie);

    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, ownerCookie, { locked: true })).status,
    ).toBe(200);
    // A Join control reads this and says so BEFORE the click rather than after it.
    expect((await summaryOf(meetingId)).locked).toBe(true);

    const late = await post(`/api/v1/meetings/${meetingId}/join`, billingCookie);
    expect(late.status).toBe(409);
    expect((await readJson<ProblemBody>(late)).type).toContain("meeting-locked");
    // Nobody already in the room is touched by the door: a browser reconnecting gets its stay back.
    expect((await post(`/api/v1/meetings/${meetingId}/join`, attorneyCookie)).status).toBe(200);

    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, ownerCookie, { locked: false })).status,
    ).toBe(200);
    expect((await summaryOf(meetingId)).locked).toBe(false);
    expect((await post(`/api/v1/meetings/${meetingId}/join`, billingCookie)).status).toBe(200);
  });

  it("answers a room already in the state asked for without writing a second instant", async () => {
    const meetingId = await startedMeeting("Locking twice");
    await post(`/api/v1/meetings/${meetingId}/lock`, ownerCookie, { locked: true });

    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, ownerCookie, { locked: true })).status,
    ).toBe(200);
    expect(
      (await auditEvents(meetingId)).filter((event) => event === "meetings.meeting.lockChanged"),
    ).toHaveLength(1);
  });

  it("does not disturb the room for a lock that moved nothing", async () => {
    const meetingId = await startedMeeting("Locking twice, watched");
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, ownerCookie, { locked: true })).status,
    ).toBe(200);
    const watching = await openRoomSocket(meetingId, newIdentifier("meetingAttendance"));

    // The same value again: the write produces no statements, so there is nothing anybody needs
    // telling. A room-state broadcast here would spend a frame on every socket in the room to
    // restate what each of them already draws, and a screen redrawing its door would be reporting
    // an event that did not happen.
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, ownerCookie, { locked: true })).status,
    ).toBe(200);
    await settle();
    expect(watching.frames.filter((frame) => frame["type"] === "room-state")).toHaveLength(0);

    // And a write that DOES move it still reaches the room, so this is a skip rather than a break.
    expect(
      (await post(`/api/v1/meetings/${meetingId}/lock`, ownerCookie, { locked: false })).status,
    ).toBe(200);
    await waitFor(
      () => watching.frames.filter((frame) => frame["type"] === "room-state").length > 0,
    );
    expect(watching.frames.filter((frame) => frame["type"] === "room-state").at(-1)).toMatchObject({
      locked: false,
    });
  });
});

describe("ending a meeting", () => {
  it("is refused to a key-holder who is not hosting, and allowed once they claim the room", async () => {
    const meetingId = await startedMeeting("Ending");
    await joinAs(meetingId, attorneyCookie);

    // THE BEHAVIOUR CHANGE, asserted deliberately. On the key alone this answered 200: any Attorney
    // in the firm could close any meeting they could see the event for, without being in it.
    const refused = await post(`/api/v1/meetings/${meetingId}/end`, attorneyCookie);
    expect(refused.status).toBe(403);
    expect((await readJson<ProblemBody>(refused)).type).toContain("meeting-not-host");

    // The ordinary case is unchanged, because the starter holds a grant.
    expect((await post(`/api/v1/meetings/${meetingId}/end`, ownerCookie)).status).toBe(200);
    expect((await summaryOf(meetingId)).status).toBe("ended");
  });

  it("lets a key-holder close an abandoned room by claiming it first, which leaves a record of that", async () => {
    const meetingId = await startedMeeting("Abandoned");
    // The paralegal rather than the attorney, and for a reason that has nothing to do with the
    // product: the default rate-limit bucket is per member, and the attorney has spent this file's
    // share of it on the seat-level assertions above.
    await joinAs(meetingId, paralegalCookie);
    expect((await post(`/api/v1/meetings/${meetingId}/leave`, ownerCookie)).status).toBe(200);

    expect(
      (
        await post(`/api/v1/meetings/${meetingId}/hosts`, paralegalCookie, {
          userId: paralegalUserId,
          role: "host",
        })
      ).status,
    ).toBe(200);
    expect((await post(`/api/v1/meetings/${meetingId}/end`, paralegalCookie)).status).toBe(200);

    // WHICH IS THE POINT OF MAKING THEM CLAIM IT. A key-holder who needs to close an abandoned room
    // can, and the record says they took it before they closed it.
    const events = await auditEvents(meetingId);
    expect(events).toContain("meetings.meeting.hostingClaimed");
    expect(events).toContain("meetings.meeting.ended");
  });
});
