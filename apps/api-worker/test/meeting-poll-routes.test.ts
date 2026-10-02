import { env } from "cloudflare:test";
import { fingerprintRequest } from "@magna-carta/data-access/canonical";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterEventId, MatterId } from "@magna-carta/identifiers/types";
import { MAX_MEETING_POLL_QUESTION_LENGTH } from "@magna-carta/meetings/poll-types";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { meetingSocketRequestUrl } from "../src/meetings/meeting-room.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A meeting's polls over HTTP, for the things that would be real product failures if they stopped
// holding:
//
//   - A WALLED MATTER'S MEETING IS AS ABSENT AS ONE THAT DOES NOT EXIST, through every one of the
//     six routes — the family's rule, and the platform-owned holding matter is the instrument.
//   - A HOST ACT IS THE GRANT, NOT THE KEY. An Attorney holds `meetings:host` and no grant on a
//     room somebody else opened, and every host route answers them 403 `meeting-not-host`.
//   - WHO ANSWERED WHAT IS REFUSED ON A POLL THAT SHOWS NO NAMES, rather than answered with an empty
//     page that would read as nobody having answered — and paged on one that does.
//   - A BODY PAST ITS CEILINGS IS ONE PROBLEM TYPE, naming the field.
//   - THE ROUTE IS THE RECORD AND THE ROOM IS TOLD AFTER IT, with the poll whole.

const app = createApp();

const ROUTED_ENVIRONMENT = {
  ...env,
  REALTIME_SFU_APP_ID: "test-realtime-application",
  REALTIME_SFU_APP_SECRET: "test-realtime-secret",
};

let firmId: FirmId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerCookie: string;
let ownerUserId: string;
let attorneyCookie: string;
let attorneyUserId: string;
let billingCookie: string;

const MATTER = newIdentifier("matter") as MatterId;
const HOLDING_MATTER = newIdentifier("matter") as MatterId;
const WALLED_EVENT = newIdentifier("matterEvent") as MatterEventId;

const base = "https://example.com";

async function post(
  path: string,
  cookie: string,
  body?: unknown,
  key: string = crypto.randomUUID(),
): Promise<Response> {
  return await app.request(
    `${base}${path}`,
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body ?? {}),
    },
    ROUTED_ENVIRONMENT,
  );
}

async function get(path: string, cookie: string): Promise<Response> {
  return await app.request(`${base}${path}`, { headers: { cookie } }, ROUTED_ENVIRONMENT);
}

interface PollOption {
  optionId: string;
  position: number;
  label: string;
  count: number;
}
interface Poll {
  id: string;
  question: string;
  anonymous: boolean;
  maxChoices: number;
  closedAt: string | null;
  closedByUserId: string | null;
  options: PollOption[];
  respondents: number;
  answeredByCaller: boolean;
}
interface Problem {
  type: string;
  detail?: string;
  errors?: { path: string }[];
}

const EVENT_COLUMNS =
  "id, matter_id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, " +
  "recorded_at, recorded_by, created_at, updated_at";

async function freshEvent(): Promise<MatterEventId> {
  const id = newIdentifier("matterEvent") as MatterEventId;
  await firmDatabase
    .prepare(
      `INSERT INTO matter_event (${EVENT_COLUMNS}) VALUES ` +
        `(?1, ?2, 'Mediation', 'scheduled', '2026-09-21', '09:30', '10:30', 'America/Los_Angeles', ?3, ?4, ?3, ?3)`,
    )
    .bind(id, MATTER, new Date().toISOString(), ownerUserId)
    .run();
  return id;
}

/** A room the owner started — and so hosts — and is in. */
async function hostedMeeting(): Promise<string> {
  const started = await post("/api/v1/meetings", ownerCookie, {
    eventKind: "matter",
    eventId: await freshEvent(),
  });
  expect(started.status).toBe(201);
  const meetingId = (await readJson<{ id: string }>(started)).id;
  expect((await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie)).status).toBe(200);
  return meetingId;
}

async function openPoll(
  meetingId: string,
  body: Partial<{
    question: string;
    options: string[];
    anonymous: boolean;
    maxChoices: number;
  }> = {},
): Promise<Poll> {
  const response = await post(`/api/v1/meetings/${meetingId}/polls`, ownerCookie, {
    question: "Which date suits?",
    options: ["Monday", "Tuesday", "Wednesday"],
    anonymous: false,
    maxChoices: 1,
    ...body,
  });
  expect(response.status).toBe(201);
  return await readJson<Poll>(response);
}

async function walledMeeting(): Promise<string> {
  const meetingId = newIdentifier("meeting");
  const now = new Date().toISOString();
  await firmDatabase
    .prepare(
      `INSERT INTO meeting (id, event_kind, medium, matter_event_id, firm_event_id, status, ` +
        `created_by_user_id, started_at, ended_at, ended_by_user_id, created_at, updated_at) ` +
        `VALUES (?1, 'matter', 'video', ?2, NULL, 'live', ?3, ?4, NULL, NULL, ?4, ?4)`,
    )
    .bind(meetingId, WALLED_EVENT, ownerUserId, now)
    .run();
  await firmDatabase
    .prepare(
      `INSERT INTO meeting_attendance (id, meeting_id, user_id, joined_at, left_at, created_at, ` +
        `updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?4, ?4)`,
    )
    .bind(newIdentifier("meetingAttendance"), meetingId, ownerUserId, now)
    .run();
  await firmDatabase
    .prepare(
      `INSERT INTO meeting_host (id, meeting_id, user_id, role, granted_at, granted_by_user_id, ` +
        `revoked_at, revoked_by_user_id, created_at, updated_at) ` +
        `VALUES (?1, ?2, ?3, 'host', ?4, ?3, NULL, NULL, ?4, ?4)`,
    )
    .bind(newIdentifier("meetingHost"), meetingId, ownerUserId, now)
    .run();
  return meetingId;
}

/** A socket in the meeting's own room, so the relay is observed end to end. */
async function openRoomSocket(meetingId: string): Promise<{ frames: Record<string, unknown>[] }> {
  const stub = env.MEETING_ROOM.get(env.MEETING_ROOM.idFromName(`${firmId}:${meetingId}`));
  const attendanceId = newIdentifier("meetingAttendance");
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
  return { frames };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Meeting Polls Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("polls-owner@example.com", {
    userName: "Polls Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Polls Owner", firmId);
  ownerCookie = await signInForSessionCookie("polls-owner@example.com");
  ownerUserId = owner.userId;

  // A KEY-HOLDER WITH NO GRANT: the seeds put `meetings:host` on Attorney, so this member passes the
  // chokepoint on every host route and is refused by the grant, which is the line being tested.
  const attorney = await seedCredentialedUser("polls-attorney@example.com", {
    userName: "Polls Attorney",
    firmId,
  });
  await mirrorMemberWithRole(attorney.userId, "Polls Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("polls-attorney@example.com");
  attorneyUserId = attorney.userId;

  const billing = await seedCredentialedUser("polls-billing@example.com", {
    userName: "Polls Bookkeeper",
    firmId,
  });
  await mirrorMemberWithRole(billing.userId, "Polls Bookkeeper", firmId, "Billing");
  billingCookie = await signInForSessionCookie("polls-billing@example.com");

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

describe("opening and reading a poll", () => {
  it("opens it on the record, reads it back and lists it, and tells the room the poll whole", async () => {
    const meetingId = await hostedMeeting();
    const socket = await openRoomSocket(meetingId);

    const poll = await openPoll(meetingId, { question: "Which date suits the mediation?" });
    expect(poll.id).toMatch(/^meetingPoll_/);
    expect(poll.options.map((option) => option.label)).toEqual(["Monday", "Tuesday", "Wednesday"]);
    expect(poll.options.map((option) => option.count)).toEqual([0, 0, 0]);

    const read = await get(`/api/v1/meetings/${meetingId}/polls/${poll.id}`, ownerCookie);
    expect(read.status).toBe(200);
    expect((await readJson<Poll>(read)).question).toBe("Which date suits the mediation?");

    const listed = await get(`/api/v1/meetings/${meetingId}/polls`, billingCookie);
    expect(listed.status).toBe(200);
    const page = await readJson<{ data: Poll[]; nextCursor: string | null }>(listed);
    expect(page.data.map((entry) => entry.id)).toEqual([poll.id]);
    expect(page.nextCursor).toBeNull();

    await waitFor(() => socket.frames.some((frame) => frame["type"] === "poll-opened"));
    const relayed = socket.frames.find((frame) => frame["type"] === "poll-opened") as {
      poll: Poll & { answeredByCaller?: boolean };
    };
    expect(relayed.poll.id).toBe(poll.id);
    expect(relayed.poll.question).toBe("Which date suits the mediation?");
    expect(relayed.poll.options).toHaveLength(3);
    // A fact about one reader cannot ride a frame every socket receives.
    expect(relayed.poll).not.toHaveProperty("answeredByCaller");
  });

  it("answers a retry with the poll's record and not its words", async () => {
    const meetingId = await hostedMeeting();
    const key = crypto.randomUUID();
    const body = {
      question: "Is the offer of ninety thousand acceptable?",
      options: ["Accept", "Counter"],
      anonymous: false,
      maxChoices: 1,
    };
    const first = await post(`/api/v1/meetings/${meetingId}/polls`, ownerCookie, body, key);
    expect(first.status).toBe(201);
    const stored = await firmDatabase
      .prepare("SELECT response_body AS responseBody FROM idempotency_key WHERE key = ?1")
      .bind(key)
      .first<{ responseBody: string | null }>();
    expect(stored?.responseBody).not.toContain("ninety thousand");
    expect(stored?.responseBody).not.toContain("Counter");
  });

  it("refuses a body past its ceilings as one problem type naming the field", async () => {
    const meetingId = await hostedMeeting();
    const response = await post(`/api/v1/meetings/${meetingId}/polls`, ownerCookie, {
      question: "q".repeat(MAX_MEETING_POLL_QUESTION_LENGTH + 1),
      options: ["Yes", "No"],
      anonymous: false,
      maxChoices: 1,
    });
    expect(response.status).toBe(422);
    const problem = await readJson<Problem>(response);
    expect(problem.type).toContain("meeting-poll-invalid");
    expect(problem.detail).toMatch(/^question: /);
    expect(problem.errors?.[0]?.path).toBe("question");

    const tooFew = await post(`/api/v1/meetings/${meetingId}/polls`, ownerCookie, {
      question: "One option?",
      options: ["Only"],
      anonymous: false,
      maxChoices: 1,
    });
    expect(tooFew.status).toBe(422);
    expect((await readJson<Problem>(tooFew)).detail).toMatch(/^options: /);
  });
});

describe("a host route", () => {
  it("answers 403 meeting-not-host to a member holding the key and no grant", async () => {
    const meetingId = await hostedMeeting();
    const poll = await openPoll(meetingId);

    const attempts = [
      await post(`/api/v1/meetings/${meetingId}/polls`, attorneyCookie, {
        question: "Mine?",
        options: ["Yes", "No"],
        anonymous: false,
        maxChoices: 1,
      }),
      await post(`/api/v1/meetings/${meetingId}/polls/${poll.id}/close`, attorneyCookie),
      await get(`/api/v1/meetings/${meetingId}/polls/${poll.id}/answers`, attorneyCookie),
    ];
    for (const response of attempts) {
      expect(response.status).toBe(403);
      expect((await readJson<Problem>(response)).type).toContain("meeting-not-host");
    }
  });
});

describe("a meeting behind a matter the member may not see", () => {
  it("is absent through every one of the six routes", async () => {
    const meetingId = await walledMeeting();
    const pollId = newIdentifier("meetingPoll");
    const responses = [
      await post(`/api/v1/meetings/${meetingId}/polls`, ownerCookie, {
        question: "Q?",
        options: ["A", "B"],
        anonymous: false,
        maxChoices: 1,
      }),
      await get(`/api/v1/meetings/${meetingId}/polls`, ownerCookie),
      await get(`/api/v1/meetings/${meetingId}/polls/${pollId}`, ownerCookie),
      await post(`/api/v1/meetings/${meetingId}/polls/${pollId}/close`, ownerCookie),
      await post(`/api/v1/meetings/${meetingId}/polls/${pollId}/answers`, ownerCookie, {
        optionIds: ["meetingPollOption_nothing000000"],
      }),
      await get(`/api/v1/meetings/${meetingId}/polls/${pollId}/answers`, ownerCookie),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect((await readJson<Problem>(response)).type).toContain("meeting-not-found");
    }
  });
});

describe("answering, closing and reading who answered", () => {
  it("takes one participation per member, and a closed poll refuses answers", async () => {
    const meetingId = await hostedMeeting();
    expect((await post(`/api/v1/meetings/${meetingId}/join`, attorneyCookie)).status).toBe(200);
    const poll = await openPoll(meetingId);
    const [monday, tuesday] = poll.options.map((option) => option.optionId);

    // Not in the room: the room's own answer.
    const outside = await post(
      `/api/v1/meetings/${meetingId}/polls/${poll.id}/answers`,
      billingCookie,
      {
        optionIds: [monday],
      },
    );
    expect(outside.status).toBe(409);
    expect((await readJson<Problem>(outside)).type).toContain("meeting-not-joined");

    const answered = await post(
      `/api/v1/meetings/${meetingId}/polls/${poll.id}/answers`,
      attorneyCookie,
      { optionIds: [monday] },
    );
    expect(answered.status).toBe(200);
    const after = await readJson<Poll>(answered);
    expect(after.answeredByCaller).toBe(true);
    expect(after.respondents).toBe(1);
    expect(after.options[0]?.count).toBe(1);

    const again = await post(
      `/api/v1/meetings/${meetingId}/polls/${poll.id}/answers`,
      attorneyCookie,
      { optionIds: [tuesday] },
    );
    expect(again.status).toBe(409);
    expect((await readJson<Problem>(again)).type).toContain("meeting-poll-already-answered");

    const closed = await post(`/api/v1/meetings/${meetingId}/polls/${poll.id}/close`, ownerCookie);
    expect(closed.status).toBe(200);
    const closedPoll = await readJson<Poll>(closed);
    expect(closedPoll.closedAt).not.toBeNull();
    expect(closedPoll.closedByUserId).toBe(ownerUserId);

    const late = await post(`/api/v1/meetings/${meetingId}/polls/${poll.id}/answers`, ownerCookie, {
      optionIds: [tuesday],
    });
    expect(late.status).toBe(409);
    expect((await readJson<Problem>(late)).type).toContain("meeting-poll-closed");
  });

  it("refuses the attributed read on a poll that shows no names, and pages it on one that does", async () => {
    const meetingId = await hostedMeeting();
    expect((await post(`/api/v1/meetings/${meetingId}/join`, attorneyCookie)).status).toBe(200);

    const hidden = await openPoll(meetingId, { anonymous: true });
    const refused = await get(
      `/api/v1/meetings/${meetingId}/polls/${hidden.id}/answers`,
      ownerCookie,
    );
    expect(refused.status).toBe(409);
    expect((await readJson<Problem>(refused)).type).toContain(
      "meeting-poll-answers-not-attributed",
    );

    const named = await openPoll(meetingId, { maxChoices: 2 });
    const [, tuesday, wednesday] = named.options.map((option) => option.optionId);
    expect(
      (
        await post(`/api/v1/meetings/${meetingId}/polls/${named.id}/answers`, attorneyCookie, {
          optionIds: [wednesday, tuesday],
        })
      ).status,
    ).toBe(200);
    const page = await get(`/api/v1/meetings/${meetingId}/polls/${named.id}/answers`, ownerCookie);
    expect(page.status).toBe(200);
    const body = await readJson<{
      data: { userId: string | null; optionIds: string[]; participantKind: string }[];
      nextCursor: string | null;
    }>(page);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.userId).toBe(attorneyUserId);
    expect(body.data[0]?.participantKind).toBe("member");
    expect(body.data[0]?.optionIds).toEqual([tuesday, wednesday]);
    expect(body.nextCursor).toBeNull();
  });

  it("tells the room the final tally when a poll closes", async () => {
    const meetingId = await hostedMeeting();
    const poll = await openPoll(meetingId);
    const socket = await openRoomSocket(meetingId);
    expect(
      (
        await post(`/api/v1/meetings/${meetingId}/polls/${poll.id}/answers`, ownerCookie, {
          optionIds: [poll.options[2]?.optionId],
        })
      ).status,
    ).toBe(200);
    expect(
      (await post(`/api/v1/meetings/${meetingId}/polls/${poll.id}/close`, ownerCookie)).status,
    ).toBe(200);

    await waitFor(() => socket.frames.some((frame) => frame["type"] === "poll-closed"));
    const closed = socket.frames.find((frame) => frame["type"] === "poll-closed") as {
      pollId: string;
      counts: { optionId: string; count: number }[];
      respondents: number;
    };
    expect(closed.pollId).toBe(poll.id);
    expect(closed.counts.map((entry) => entry.count)).toEqual([0, 0, 1]);
    expect(closed.respondents).toBe(1);
  });
});

describe("the idempotency record of an answer", () => {
  async function storedRecord(key: string) {
    return await firmDatabase
      .prepare(
        "SELECT fingerprint, response_body AS responseBody FROM idempotency_key WHERE key = ?1",
      )
      .bind(key)
      .first<{ fingerprint: string; responseBody: string | null }>();
  }

  it("keeps nothing on an anonymous poll that the choice could be read back out of", async () => {
    const meetingId = await hostedMeeting();
    expect((await post(`/api/v1/meetings/${meetingId}/join`, attorneyCookie)).status).toBe(200);
    const poll = await openPoll(meetingId, { anonymous: true });
    const [monday, tuesday, wednesday] = poll.options.map((option) => option.optionId);
    const path = `/api/v1/meetings/${meetingId}/polls/${poll.id}/answers`;

    const attorneyKey = crypto.randomUUID();
    const ownerKey = crypto.randomUUID();
    expect((await post(path, attorneyCookie, { optionIds: [monday] }, attorneyKey)).status).toBe(
      200,
    );
    expect((await post(path, ownerCookie, { optionIds: [tuesday] }, ownerKey)).status).toBe(200);
    const attorneys = await storedRecord(attorneyKey);
    const owners = await storedRecord(ownerKey);

    // THE FINGERPRINT CANNOT BE ENUMERATED BACK TO A CHOICE. Two members who chose differently hold
    // the same one, and hashing each candidate body the way a fingerprint over the body is made
    // matches neither.
    expect(attorneys?.fingerprint).toBe(owners?.fingerprint);
    for (const optionId of [monday, tuesday, wednesday]) {
      const candidate = await fingerprintRequest({
        method: "POST",
        path,
        body: { optionIds: [optionId] },
      });
      expect(attorneys?.fingerprint).not.toBe(candidate);
      expect(owners?.fingerprint).not.toBe(candidate);
    }

    // AND NO TALLY: two consecutive stored bodies would otherwise differ by exactly one choice.
    for (const record of [attorneys, owners]) {
      expect(JSON.parse(record?.responseBody ?? "null")).toEqual({ id: poll.id });
    }
  });

  it("answers a retry from the record as it stands now, and records nothing a second time", async () => {
    const meetingId = await hostedMeeting();
    expect((await post(`/api/v1/meetings/${meetingId}/join`, attorneyCookie)).status).toBe(200);
    const poll = await openPoll(meetingId, { anonymous: true });
    const [monday, tuesday, wednesday] = poll.options.map((option) => option.optionId);
    const path = `/api/v1/meetings/${meetingId}/polls/${poll.id}/answers`;
    const key = crypto.randomUUID();

    expect((await post(path, attorneyCookie, { optionIds: [monday] }, key)).status).toBe(200);
    expect((await post(path, ownerCookie, { optionIds: [tuesday] })).status).toBe(200);

    // The same key, the same body: the poll whole, as the record now holds it — both answers in it.
    const retried = await post(path, attorneyCookie, { optionIds: [monday] }, key);
    expect(retried.status).toBe(200);
    expect(retried.headers.get("idempotency-replayed")).toBe("true");
    const replayed = await readJson<Poll>(retried);
    expect(replayed.id).toBe(poll.id);
    expect(replayed.question).toBe("Which date suits?");
    expect(replayed.answeredByCaller).toBe(true);
    expect(replayed.respondents).toBe(2);
    expect(replayed.options.map((option) => option.count)).toEqual([1, 1, 0]);

    // THE TRADE, STATED: the record cannot tell a different body under the same key from the first,
    // so it is answered as the first was. It can never be a second answer — an answer cannot be
    // changed — and nothing is written.
    const changedMind = await post(path, attorneyCookie, { optionIds: [wednesday] }, key);
    expect(changedMind.status).toBe(200);
    expect(changedMind.headers.get("idempotency-replayed")).toBe("true");
    expect((await readJson<Poll>(changedMind)).options.map((option) => option.count)).toEqual([
      1, 1, 0,
    ]);
    const respondents = await firmDatabase
      .prepare("SELECT COUNT(*) AS count FROM meeting_poll_respondent WHERE poll_id = ?1")
      .bind(poll.id)
      .first<{ count: number }>();
    expect(respondents?.count).toBe(2);

    // A key reused on ANOTHER poll is still a different request, and still refused.
    const elsewhere = await openPoll(meetingId, { anonymous: true });
    const reused = await post(
      `/api/v1/meetings/${meetingId}/polls/${elsewhere.id}/answers`,
      attorneyCookie,
      { optionIds: [elsewhere.options[0]?.optionId] },
      key,
    );
    expect(reused.status).toBe(422);
  });
});
