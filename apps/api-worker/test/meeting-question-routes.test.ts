import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterEventId, MatterId } from "@magna-carta/identifiers/types";
import { MAX_MEETING_QUESTION_LENGTH } from "@magna-carta/meetings/question-types";
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

// A meeting's question queue over HTTP, for the things that would be real product failures if they
// stopped holding:
//
//   - A WALLED MATTER'S MEETING IS AS ABSENT AS ONE THAT DOES NOT EXIST, through every route.
//   - MARKING ANSWERED IS THE GRANT'S, NOT THE KEY'S: an Attorney holding `meetings:host` and no
//     grant is 403 `meeting-not-host`.
//   - THE QUEUE WALKS ON ITS OWN STABLE KEY, and `since` agrees with the cursor about where it is.
//   - AN UPVOTE IS ONE PER MEMBER AND CAN BE TAKEN BACK; A TAKING-BACK KEEPS THE ROW.
//   - THE ROOM IS TOLD AFTER THE RECORD, with the question whole, and a redacted copy is empty.

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

interface Question {
  id: string;
  participantKind: string;
  participantId: string;
  userId: string | null;
  body: string;
  askedAt: string;
  answeredAt: string | null;
  answeredByUserId: string | null;
  redactedAt: string | null;
  redactedByUserId: string | null;
  upvotes: number;
  upvotedByCaller: boolean;
}
interface QuestionPage {
  data: Question[];
  nextCursor: string | null;
}
interface Problem {
  type: string;
}

/** The queue's own order, `(asked_at, id)`, compared as the database compares text. */
function byKey(first: Question, second: Question): number {
  const firstKey = `${first.askedAt} ${first.id}`;
  const secondKey = `${second.askedAt} ${second.id}`;
  return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
}

const EVENT_COLUMNS =
  "id, matter_id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, " +
  "recorded_at, recorded_by, created_at, updated_at";

async function freshEvent(): Promise<MatterEventId> {
  const id = newIdentifier("matterEvent") as MatterEventId;
  await firmDatabase
    .prepare(
      `INSERT INTO matter_event (${EVENT_COLUMNS}) VALUES ` +
        `(?1, ?2, 'Hearing', 'scheduled', '2026-09-21', '09:30', '10:30', 'America/Los_Angeles', ?3, ?4, ?3, ?3)`,
    )
    .bind(id, MATTER, new Date().toISOString(), ownerUserId)
    .run();
  return id;
}

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

async function ask(meetingId: string, body: string, cookie = ownerCookie): Promise<Question> {
  const response = await post(`/api/v1/meetings/${meetingId}/questions`, cookie, { body });
  expect(response.status).toBe(201);
  return await readJson<Question>(response);
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
  return meetingId;
}

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
  firmId = (await seedFirm({ name: "Meeting Questions Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("questions-owner@example.com", {
    userName: "Questions Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Questions Owner", firmId);
  ownerCookie = await signInForSessionCookie("questions-owner@example.com");
  ownerUserId = owner.userId;

  const attorney = await seedCredentialedUser("questions-attorney@example.com", {
    userName: "Questions Attorney",
    firmId,
  });
  await mirrorMemberWithRole(attorney.userId, "Questions Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("questions-attorney@example.com");

  const billing = await seedCredentialedUser("questions-billing@example.com", {
    userName: "Questions Bookkeeper",
    firmId,
  });
  await mirrorMemberWithRole(billing.userId, "Questions Bookkeeper", firmId, "Billing");
  billingCookie = await signInForSessionCookie("questions-billing@example.com");

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

describe("asking a question", () => {
  it("keeps it on the record against the stay, and tells the room the question whole", async () => {
    const meetingId = await hostedMeeting();
    const socket = await openRoomSocket(meetingId);
    const question = await ask(meetingId, "When is the next hearing?");
    expect(question.id).toMatch(/^meetingQuestion_/);
    expect(question.participantKind).toBe("member");
    expect(question.participantId).toMatch(/^meetingAttendance_/);
    expect(question.userId).toBe(ownerUserId);
    expect(question.upvotes).toBe(0);

    await waitFor(() => socket.frames.some((frame) => frame["type"] === "question-asked"));
    const relayed = socket.frames.find((frame) => frame["type"] === "question-asked") as {
      question: Question;
    };
    expect(relayed.question.id).toBe(question.id);
    expect(relayed.question.body).toBe("When is the next hearing?");
    expect(relayed.question).not.toHaveProperty("upvotedByCaller");
  });

  it("is refused from outside the room, and past the ceiling", async () => {
    const meetingId = await hostedMeeting();
    const outside = await post(`/api/v1/meetings/${meetingId}/questions`, billingCookie, {
      body: "Let me ask",
    });
    expect(outside.status).toBe(409);
    expect((await readJson<Problem>(outside)).type).toContain("meeting-not-joined");

    const tooLong = await post(`/api/v1/meetings/${meetingId}/questions`, ownerCookie, {
      body: "x".repeat(MAX_MEETING_QUESTION_LENGTH + 10),
    });
    expect(tooLong.status).toBe(422);
    expect((await readJson<Problem>(tooLong)).type).toContain("meeting-question-too-long");
  });

  it("answers a retry with the question's record and not its words", async () => {
    const meetingId = await hostedMeeting();
    const key = crypto.randomUUID();
    const first = await post(
      `/api/v1/meetings/${meetingId}/questions`,
      ownerCookie,
      { body: "Is the authority really ninety thousand?" },
      key,
    );
    expect(first.status).toBe(201);
    const stored = await firmDatabase
      .prepare("SELECT response_body AS responseBody FROM idempotency_key WHERE key = ?1")
      .bind(key)
      .first<{ responseBody: string | null }>();
    expect(stored?.responseBody).not.toContain("ninety thousand");
  });
});

describe("the queue", () => {
  it("walks on (asked_at, id), and `since` agrees with the cursor", async () => {
    const meetingId = await hostedMeeting();
    const asked: Question[] = [];
    for (let index = 0; index < 4; index += 1) {
      asked.push(await ask(meetingId, `Question ${String(index)}`));
    }
    // Two questions can share a millisecond, and the handle breaks the tie — so the expected order
    // is the key's, not the order the requests were sent in.
    asked.sort(byKey);
    const page = await readJson<QuestionPage>(
      await get(`/api/v1/meetings/${meetingId}/questions`, billingCookie),
    );
    expect(page.data.map((question) => question.id)).toEqual(asked.map((question) => question.id));
    expect(page.nextCursor).toBeNull();

    const second = asked[1];
    const following = await readJson<QuestionPage>(
      await get(
        `/api/v1/meetings/${meetingId}/questions?since=${encodeURIComponent(second?.askedAt ?? "")}` +
          `&sinceId=${second?.id ?? ""}`,
        ownerCookie,
      ),
    );
    expect(following.data.map((question) => question.id)).toEqual(
      asked.slice(2).map((question) => question.id),
    );
  });
});

describe("upvoting", () => {
  it("is one per member, and withdrawal takes exactly that one back", async () => {
    const meetingId = await hostedMeeting();
    expect((await post(`/api/v1/meetings/${meetingId}/join`, attorneyCookie)).status).toBe(200);
    const question = await ask(meetingId, "Can we adjourn?");
    const path = `/api/v1/meetings/${meetingId}/questions/${question.id}/upvotes`;

    const first = await readJson<Question>(await post(path, attorneyCookie));
    expect(first.upvotes).toBe(1);
    expect(first.upvotedByCaller).toBe(true);
    const again = await readJson<Question>(await post(path, attorneyCookie));
    expect(again.upvotes).toBe(1);
    const owners = await readJson<Question>(await post(path, ownerCookie));
    expect(owners.upvotes).toBe(2);

    const withdrawn = await post(`${path}/withdrawal`, attorneyCookie);
    expect(withdrawn.status).toBe(200);
    const after = await readJson<Question>(withdrawn);
    expect(after.upvotes).toBe(1);
    expect(after.upvotedByCaller).toBe(false);
  });
});

describe("marking answered and taking a question back", () => {
  it("marks and unmarks as a host, and is 403 meeting-not-host to a key-holder with no grant", async () => {
    const meetingId = await hostedMeeting();
    const question = await ask(meetingId, "Is the bundle filed?");
    const path = `/api/v1/meetings/${meetingId}/questions/${question.id}/answered`;

    const refused = await post(path, attorneyCookie, { answered: true });
    expect(refused.status).toBe(403);
    expect((await readJson<Problem>(refused)).type).toContain("meeting-not-host");

    const marked = await readJson<Question>(await post(path, ownerCookie, { answered: true }));
    expect(marked.answeredAt).not.toBeNull();
    expect(marked.answeredByUserId).toBe(ownerUserId);
    const unmarked = await readJson<Question>(await post(path, ownerCookie, { answered: false }));
    expect(unmarked.answeredAt).toBeNull();
    expect(unmarked.answeredByUserId).toBeNull();
  });

  it("keeps the row and blanks the body, and the room's copy is empty too", async () => {
    const meetingId = await hostedMeeting();
    expect((await post(`/api/v1/meetings/${meetingId}/join`, attorneyCookie)).status).toBe(200);
    const question = await ask(meetingId, "Wrong window, ignore that.", attorneyCookie);
    const socket = await openRoomSocket(meetingId);
    const path = `/api/v1/meetings/${meetingId}/questions/${question.id}/redact`;

    // A member who is neither the author nor hosting takes nothing back.
    expect((await post(`/api/v1/meetings/${meetingId}/join`, billingCookie)).status).toBe(200);
    const third = await post(path, billingCookie);
    expect(third.status).toBe(403);

    const taken = await post(path, attorneyCookie);
    expect(taken.status).toBe(200);
    const body = await readJson<Question>(taken);
    expect(body.body).toBe("");
    expect(body.redactedAt).not.toBeNull();

    await waitFor(() => socket.frames.some((frame) => frame["type"] === "question-updated"));
    const relayed = socket.frames.find((frame) => frame["type"] === "question-updated") as {
      question: Question;
    };
    expect(relayed.question.body).toBe("");
    expect(relayed.question.redactedAt).toBe(body.redactedAt);
  });
});

describe("a meeting behind a matter the member may not see", () => {
  it("is absent through every route", async () => {
    const meetingId = await walledMeeting();
    const questionId = newIdentifier("meetingQuestion");
    const responses = [
      await post(`/api/v1/meetings/${meetingId}/questions`, ownerCookie, { body: "Q?" }),
      await get(`/api/v1/meetings/${meetingId}/questions`, ownerCookie),
      await post(`/api/v1/meetings/${meetingId}/questions/${questionId}/upvotes`, ownerCookie),
      await post(
        `/api/v1/meetings/${meetingId}/questions/${questionId}/upvotes/withdrawal`,
        ownerCookie,
      ),
      await post(`/api/v1/meetings/${meetingId}/questions/${questionId}/answered`, ownerCookie, {
        answered: true,
      }),
      await post(`/api/v1/meetings/${meetingId}/questions/${questionId}/redact`, ownerCookie),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect((await readJson<Problem>(response)).type).toContain("meeting-not-found");
    }
  });
});
