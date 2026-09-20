import { env } from "cloudflare:test";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, MatterEventId, MatterId } from "@magna-carta/identifiers/types";
import { MAX_MEETING_MESSAGE_LENGTH } from "@magna-carta/meetings/chat-types";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { REDACT_MESSAGE_GUARD } from "@magna-carta/meetings/chat-service";
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

// The in-meeting chat's HTTP surface, exercised for the things that would be real product failures
// if they stopped holding:
//
//   - BEING IN THE ROOM IS WHAT MAKES A MESSAGE SAYABLE. Posting without an open stay is answered
//     as not being in the meeting, which is the same answer the signaling socket gives.
//   - A WALLED MATTER'S MEETING IS AS ABSENT AS ONE THAT DOES NOT EXIST, through every one of the
//     three routes. The platform-owned holding matter is the instrument, exactly as it is for the
//     meetings routes themselves.
//   - TAKING A MESSAGE BACK KEEPS THE ROW. The transcript says a message was there and that
//     somebody removed it; a member may do it to their own words and a host to anybody's, and a
//     third member may not.
//   - THE TRANSCRIPT READS FORWARDS AND IS PAGED. A conversation is read from its beginning.
//
// The routing credentials are supplied as an environment override because JOINING needs them — the
// chat itself deliberately does not, since whether this deployment can route audio has nothing to
// do with whether what was said is on the file.

const app = createApp();

const ROUTED_ENVIRONMENT = {
  ...env,
  REALTIME_SFU_APP_ID: "test-realtime-application",
  REALTIME_SFU_APP_SECRET: "test-realtime-secret",
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
  options: { key?: string; environment?: Record<string, unknown> } = {},
): Promise<Response> {
  return await app.request(
    `${base}${path}`,
    {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "idempotency-key": options.key ?? crypto.randomUUID(),
      },
      body: JSON.stringify(body ?? {}),
    },
    options.environment ?? ROUTED_ENVIRONMENT,
  );
}

/** Every idempotency record this firm holds for one key, as the row actually stores it. */
async function storedResponseBody(key: string): Promise<string | null> {
  const row = await firmDatabase
    .prepare("SELECT response_body AS responseBody FROM idempotency_key WHERE key = ?1")
    .bind(key)
    .first<{ responseBody: string | null }>();
  return row?.responseBody ?? null;
}

async function get(path: string, cookie: string): Promise<Response> {
  return await app.request(`${base}${path}`, { headers: { cookie } }, ROUTED_ENVIRONMENT);
}

interface StartedMeeting {
  id: string;
}
interface Message {
  id: string;
  meetingId: string;
  participantKind: string;
  participantId: string;
  userId: string | null;
  sentAt: string;
  body: string;
  redactedAt: string | null;
  redactedByUserId: string | null;
}
interface MessagePage {
  data: Message[];
  nextCursor: string | null;
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
    .bind(id, MATTER, title, new Date().toISOString(), responsibleUserId)
    .run();
  return id;
}

/** A room the owner is already in, which is the state every chat test starts from. */
async function joinedMeeting(): Promise<string> {
  const started = await post("/api/v1/meetings", ownerCookie, {
    eventKind: "matter",
    eventId: await freshEvent(),
  });
  expect(started.status).toBe(201);
  const meetingId = (await readJson<StartedMeeting>(started)).id;
  expect((await post(`/api/v1/meetings/${meetingId}/join`, ownerCookie)).status).toBe(200);
  return meetingId;
}

async function say(meetingId: string, body: string, cookie = ownerCookie): Promise<Message> {
  const response = await post(`/api/v1/meetings/${meetingId}/messages`, cookie, { body });
  expect(response.status).toBe(201);
  return await readJson<Message>(response);
}

/**
 * A room on the walled matter's event, seeded directly — the create route refuses that event, which
 * is the point: this is what a meeting behind a matter the reader may not see looks like from
 * outside. The stay is the owner's, so nothing but the visibility gate can be what refuses them.
 */
async function walledMeeting(): Promise<string> {
  const meetingId = newIdentifier("meeting");
  const now = new Date().toISOString();
  await firmDatabase
    .prepare(
      `INSERT INTO meeting (id, event_kind, medium, matter_event_id, firm_event_id, status, ` +
        `created_by_user_id, started_at, ended_at, ended_by_user_id, created_at, updated_at) ` +
        `VALUES (?1, 'matter', 'video', ?2, NULL, 'live', ?3, ?4, NULL, NULL, ?4, ?4)`,
    )
    .bind(meetingId, WALLED_EVENT, responsibleUserId, now)
    .run();
  await firmDatabase
    .prepare(
      `INSERT INTO meeting_attendance (id, meeting_id, user_id, joined_at, left_at, created_at, ` +
        `updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?4, ?4)`,
    )
    .bind(newIdentifier("meetingAttendance"), meetingId, responsibleUserId, now)
    .run();
  return meetingId;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Meeting Chat Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("chat-owner@example.com", {
    userName: "Chat Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Chat Owner", firmId);
  ownerCookie = await signInForSessionCookie("chat-owner@example.com");
  responsibleUserId = owner.userId;

  // A member who may be in a meeting and may not host one — the seat the seeds grant
  // meetings:join and deliberately not meetings:host.
  const billing = await seedCredentialedUser("chat-billing@example.com", {
    userName: "Chat Bookkeeper",
    firmId,
  });
  await mirrorMemberWithRole(billing.userId, "Chat Bookkeeper", firmId, "Billing");
  billingCookie = await signInForSessionCookie("chat-billing@example.com");

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

describe("saying something in a meeting", () => {
  it("keeps it on the record, against the stay it was said from", async () => {
    const meetingId = await joinedMeeting();
    const message = await say(meetingId, "The exhibits are in the shared folder.");

    expect(message.id).toMatch(/^meetingMessage_/);
    expect(message.body).toBe("The exhibits are in the shared folder.");
    // The STAY, and the kind that says which table its handle belongs to. Only members have stays
    // in meeting_attendance today; an external guest's will be its own row.
    expect(message.participantKind).toBe("member");
    expect(message.participantId).toMatch(/^meetingAttendance_/);
    expect(message.userId).toBe(responsibleUserId);
    expect(message.redactedAt).toBeNull();
  });

  it("is refused for a member who is not in the room", async () => {
    const meetingId = await joinedMeeting();
    const response = await post(`/api/v1/meetings/${meetingId}/messages`, billingCookie, {
      body: "Let me in",
    });

    // The same answer the signaling socket gives for the same missing stay, rather than a second
    // refusal meaning nearly the same thing.
    expect(response.status).toBe(409);
    expect((await readJson<{ type: string }>(response)).type).toContain("meeting-not-joined");
  });

  it("refuses a message longer than a message may be, naming that as the problem", async () => {
    const meetingId = await joinedMeeting();
    const response = await post(`/api/v1/meetings/${meetingId}/messages`, ownerCookie, {
      body: "x".repeat(MAX_MEETING_MESSAGE_LENGTH + 10),
    });

    expect(response.status).toBe(422);
    // Its own type rather than a generic validation failure: the remedy is to shorten it, and a
    // message silently truncated to fit would be a record of something nobody said.
    expect((await readJson<{ type: string }>(response)).type).toContain("meeting-message-too-long");
  });

  it("refuses an empty message", async () => {
    const meetingId = await joinedMeeting();
    const response = await post(`/api/v1/meetings/${meetingId}/messages`, ownerCookie, {
      body: "   ",
    });
    expect(response.status).toBe(422);
  });
});

describe("a meeting behind a matter the member may not see", () => {
  it("is absent through every one of the three routes", async () => {
    const meetingId = await walledMeeting();

    // 404 and not 403 in all three: which matters a firm has is itself a fact about its work, and a
    // distinguishable refusal would let anybody holding the key probe for either.
    const said = await post(`/api/v1/meetings/${meetingId}/messages`, ownerCookie, {
      body: "Anything at all",
    });
    expect(said.status).toBe(404);
    expect((await readJson<{ type: string }>(said)).type).toContain("meeting-not-found");

    expect((await get(`/api/v1/meetings/${meetingId}/messages`, ownerCookie)).status).toBe(404);

    const redacted = await post(
      `/api/v1/meetings/${meetingId}/messages/${newIdentifier("meetingMessage")}/redact`,
      ownerCookie,
    );
    expect(redacted.status).toBe(404);
  });
});

describe("reading a meeting's chat", () => {
  it("reads forwards, and hands a poller a position rather than a watermark", async () => {
    const meetingId = await joinedMeeting();
    const said = [
      await say(meetingId, "first"),
      await say(meetingId, "second"),
      await say(meetingId, "third"),
    ];

    const page = await readJson<MessagePage>(
      await get(`/api/v1/meetings/${meetingId}/messages`, ownerCookie),
    );
    // MEMBERSHIP, and then the ORDER BY the page actually pages on — never a fixed sequence of
    // handles. The clock here is the real one, so two of these can land on the same millisecond and
    // the tiebreak decides which reads first; asserting the sequence would be asserting which
    // identifier the generator happened to mint, which is a test that fails on a fast machine.
    expect(new Set(page.data.map((message) => message.id))).toEqual(
      new Set(said.map((message) => message.id)),
    );
    const keys = page.data.map((message) => `${message.sentAt}|${message.id}`);
    expect(keys).toEqual([...keys].toSorted());

    // A POSITION, NOT A HAS-MORE FLAG. A screen following a live meeting reaches the end and keeps
    // asking, so the last page carries the place it got to; a null here would leave it continuing
    // from an instant, which loses the second of two messages sharing one.
    expect(page.nextCursor).not.toBeNull();
    const caughtUp = await readJson<MessagePage>(
      await get(
        `/api/v1/meetings/${meetingId}/messages?cursor=${encodeURIComponent(page.nextCursor ?? "")}`,
        ownerCookie,
      ),
    );
    expect(caughtUp.data).toEqual([]);
    expect(caughtUp.nextCursor).toBeNull();

    const fourth = await say(meetingId, "fourth");
    const polled = await readJson<MessagePage>(
      await get(
        `/api/v1/meetings/${meetingId}/messages?cursor=${encodeURIComponent(page.nextCursor ?? "")}`,
        ownerCookie,
      ),
    );
    expect(polled.data.map((message) => message.id)).toEqual([fourth.id]);

    // And the same position spelled out as the pair a caller can hold without the cursor: the
    // instant AND the handle of the row read there.
    const last = page.data.at(-1);
    const byPair = await readJson<MessagePage>(
      await get(
        `/api/v1/meetings/${meetingId}/messages?since=${encodeURIComponent(last?.sentAt ?? "")}` +
          `&sinceId=${encodeURIComponent(last?.id ?? "")}`,
        ownerCookie,
      ),
    );
    expect(byPair.data.map((message) => message.id)).toEqual([fourth.id]);
  });

  it("is reachable by any member who may join, not only by the people who spoke", async () => {
    const meetingId = await joinedMeeting();
    await say(meetingId, "Said before the bookkeeper arrived");

    const response = await get(`/api/v1/meetings/${meetingId}/messages`, billingCookie);
    expect(response.status).toBe(200);
    expect((await readJson<MessagePage>(response)).data).toHaveLength(1);
  });
});

describe("taking a message back", () => {
  it("blanks the body, keeps the row, and says who removed it", async () => {
    const meetingId = await joinedMeeting();
    const message = await say(meetingId, "Wrong window — ignore that.");

    const response = await post(
      `/api/v1/meetings/${meetingId}/messages/${message.id}/redact`,
      ownerCookie,
    );
    expect(response.status).toBe(200);
    const taken = await readJson<Message>(response);
    expect(taken.body).toBe("");
    expect(taken.redactedByUserId).toBe(responsibleUserId);
    expect(taken.redactedAt).not.toBeNull();

    // STILL IN THE TRANSCRIPT. A conversation with a silent hole in it is one nobody can rely on.
    const page = await readJson<MessagePage>(
      await get(`/api/v1/meetings/${meetingId}/messages`, ownerCookie),
    );
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.body).toBe("");
    expect(page.data[0]?.sentAt).toBe(message.sentAt);
  });

  it("is refused for a member who neither wrote it nor hosts the room", async () => {
    const meetingId = await joinedMeeting();
    const message = await say(meetingId, "The owner said this");

    const response = await post(
      `/api/v1/meetings/${meetingId}/messages/${message.id}/redact`,
      billingCookie,
    );
    // A permission answer rather than an absence: the message is one they can see in the
    // transcript, so pretending it is not there would be the worse answer.
    expect(response.status).toBe(403);
  });

  it("is allowed to the author who does not host, and to the host who did not write it", async () => {
    const meetingId = await joinedMeeting();
    expect((await post(`/api/v1/meetings/${meetingId}/join`, billingCookie)).status).toBe(200);
    const theirs = await say(meetingId, "The bookkeeper said this", billingCookie);

    const byAuthor = await post(
      `/api/v1/meetings/${meetingId}/messages/${theirs.id}/redact`,
      billingCookie,
    );
    expect(byAuthor.status).toBe(200);
    expect((await readJson<Message>(byAuthor)).body).toBe("");

    const alsoTheirs = await say(meetingId, "And this too", billingCookie);
    const byHost = await post(
      `/api/v1/meetings/${meetingId}/messages/${alsoTheirs.id}/redact`,
      ownerCookie,
    );
    expect(byHost.status).toBe(200);
    expect((await readJson<Message>(byHost)).redactedByUserId).toBe(responsibleUserId);
  });

  it("answers a second removal with the row as it stands rather than moving the instant", async () => {
    const meetingId = await joinedMeeting();
    const message = await say(meetingId, "Said in error");
    const first = await readJson<Message>(
      await post(`/api/v1/meetings/${meetingId}/messages/${message.id}/redact`, ownerCookie),
    );

    // A DIFFERENT idempotency key, so this is a genuinely separate request rather than a replay.
    const again = await post(
      `/api/v1/meetings/${meetingId}/messages/${message.id}/redact`,
      ownerCookie,
    );
    expect(again.status).toBe(200);
    expect((await readJson<Message>(again)).redactedAt).toBe(first.redactedAt);
  });

  it("answers both members when two of them take the same message back together", async () => {
    const meetingId = await joinedMeeting();
    const message = await say(meetingId, "Sent to the wrong room");

    // THE WINDOW IS REAL: the redaction reads the message, decides it is not yet taken back, and
    // commits a round trip later. The competing removal lands in between, on its own idempotency
    // key, so the second batch meets a row that has already moved — and the guard on it is what
    // rolls that batch back rather than letting it write a second instant over the first.
    const racing = racingFirmDatabase(ROUTED_ENVIRONMENT, REDACT_MESSAGE_GUARD, async () => {
      const winner = await post(
        `/api/v1/meetings/${meetingId}/messages/${message.id}/redact`,
        ownerCookie,
      );
      expect(winner.status).toBe(200);
    });

    const loser = await post(
      `/api/v1/meetings/${meetingId}/messages/${message.id}/redact`,
      ownerCookie,
      undefined,
      { environment: racing.environment },
    );
    // Without it, the member who lost the race was handed a 500 and an Error ID for a message that
    // is gone — which is what they asked for.
    expect(racing.interleaved).toBe(true);
    expect(loser.status).toBe(200);
    expect((await readJson<Message>(loser)).body).toBe("");

    // ONE ROW, REDACTED ONCE, and the instant is the winner's.
    const page = await readJson<MessagePage>(
      await get(`/api/v1/meetings/${meetingId}/messages`, ownerCookie),
    );
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.redactedAt).not.toBeNull();
    const removals = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS removals FROM audit_log WHERE event = 'meetings.chat.messageRedacted' AND subject_id = ?1",
      )
      .bind(message.id)
      .first<{ removals: number }>();
    expect(removals?.removals).toBe(1);
  });

  it("replays a retried send as the row now stands, and never stores the words to replay", async () => {
    const meetingId = await joinedMeeting();
    const key = crypto.randomUUID();
    const secret = "The settlement figure is in the sealed exhibit.";
    const sent = await readJson<Message>(
      await post(`/api/v1/meetings/${meetingId}/messages`, ownerCookie, { body: secret }, { key }),
    );

    // THE STORED BODY IS THE HANDLE AND NOTHING ELSE. An idempotency record is replayed verbatim to
    // whoever retries the key and is not part of the record a redaction reaches, so a message kept
    // there would outlive the taking-back that was meant to remove it.
    const stored = await storedResponseBody(key);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(secret);
    expect(stored).toContain(sent.id);

    expect(
      (await post(`/api/v1/meetings/${meetingId}/messages/${sent.id}/redact`, ownerCookie)).status,
    ).toBe(200);

    // The retry is answered in the same shape — the message's record, so a client parses one thing
    // — with the words absent rather than replayed out of a row the redaction never reached.
    const replayed = await post(
      `/api/v1/meetings/${meetingId}/messages`,
      ownerCookie,
      { body: secret },
      { key },
    );
    expect(replayed.status).toBe(201);
    const body = await readJson<Message>(replayed);
    expect(body.id).toBe(sent.id);
    expect(body.participantId).toBe(sent.participantId);
    expect(body.body).toBe("");

    // And the transcript — the one copy the taking-back does reach — says what happened to it.
    const page = await readJson<MessagePage>(
      await get(`/api/v1/meetings/${meetingId}/messages`, ownerCookie),
    );
    expect(page.data[0]?.body).toBe("");
    expect(page.data[0]?.redactedAt).not.toBeNull();
  });

  it("reports a message from another meeting as one that is not there", async () => {
    const here = await joinedMeeting();
    const there = await joinedMeeting();
    const message = await say(here, "In the first room");

    const response = await post(
      `/api/v1/meetings/${there}/messages/${message.id}/redact`,
      ownerCookie,
    );
    expect(response.status).toBe(404);
    expect((await readJson<{ type: string }>(response)).type).toContain(
      "meeting-message-not-found",
    );
  });
});
