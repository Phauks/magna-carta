import { env } from "cloudflare:test";
import { addCalendarDays, todayInUtc } from "@magna-carta/civil-time/civil-date";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  MatterEventId,
  MatterId,
  MeetingGuestInvitationId,
  MeetingId,
} from "@magna-carta/identifiers/types";
import { GUEST_ARRIVAL_GUARD, GUEST_DOOR_GUARD } from "@magna-carta/meetings/guest-service";
import { createMemoryLogger, type MemoryLogger } from "@magna-carta/telemetry/logger";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildOpenAPIDocument, createApp } from "../src/http/app.ts";
import type { SendEmail } from "../src/email-port.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { GUEST_SOCKET_PROTOCOL, mintGuestInvitationToken } from "../src/meetings/guest-token.ts";
import { racingFirmDatabase } from "./support/racing-firm-database.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A MEETING'S GUESTS, THROUGH THE WHOLE APPLICATION: the host mints a link and it is mailed; the guest
// opens it, arrives at the door, is admitted, speaks, opens the socket and leaves; the host rotates and
// withdraws it. What this file holds, beyond each route answering:
//
//   - OPENING THE LINK SPENDS NOTHING. The summary is a read, so a mail client that prefetches the
//     link, or a scanner that follows it, costs the guest none of their arrivals.
//   - THE CREDENTIAL IS WRITTEN IN EXACTLY TWO PLACES — the mail, and the arrival's answer to the
//     browser that earned the grant. Never a log line, an audit row, the idempotency store or a
//     response a host reads; the fitness assertions below search all of them for it.
//   - A GUEST IS NEVER HANDED THE MATTER. No guest response carries a matter or an event identifier,
//     and the summary a guest reads is a schema of its own rather than the member's with fields nulled.
//   - THE ROW IS THE AUTHORITY, so a rotation or a withdrawal refuses a perfectly-signed link at once.

const ROUTED_ENVIRONMENT = {
  ...env,
  REALTIME_SFU_APP_ID: "test-realtime-application",
  REALTIME_SFU_APP_SECRET: "test-realtime-secret",
};

const base = "https://example.com";

let firmId: FirmId;
let ownerCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const MATTER = newIdentifier("matter") as MatterId;
const CLIENT = newIdentifier("directoryPerson");
const STRANGER = newIdentifier("directoryPerson");
const CLIENT_ADDRESS = "jane.hollis@example.test";

// A fresh app per test: the rate limiter is an in-memory window built per app, and this file spends
// a guest's arrival budget on purpose. The logger is per app too, so a test reads its own events.
let app: ReturnType<typeof createApp>;
let logger: MemoryLogger;
let mail: { to: string; subject: string; text: string; messageClass?: string }[];
// How many of the next sends the mail adapter refuses — the deployment whose mail is down.
let mailFailuresToCome = 0;

beforeEach(() => {
  logger = createMemoryLogger();
  mail = [];
  mailFailuresToCome = 0;
  const capture: SendEmail = async (message) => {
    if (mailFailuresToCome > 0) {
      mailFailuresToCome -= 1;
      throw new Error("the mail adapter is not answering");
    }
    mail.push(message);
  };
  app = createApp({ loggerForEnv: () => logger, meetingGuestMail: () => capture });
});

// An event two days out, so a link minted for it is alive for the whole run whatever the hour.
const EVENT_DAY = addCalendarDays(todayInUtc(), 2);

const EVENT_COLUMNS =
  "id, matter_id, title, status, starts_on, starts_at_time, ends_at_time, time_zone, " +
  "recorded_at, recorded_by, created_at, updated_at";

let ownerUserId: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Hollis Guest Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  const owner = await seedCredentialedUser("guest-owner@example.com", {
    userName: "Guest Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Guest Owner", firmId);
  ownerCookie = await signInForSessionCookie("guest-owner@example.com");
  ownerUserId = owner.userId;

  const now = new Date().toISOString();
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, system_key, created_at, updated_at) " +
        "VALUES (?1, 'Hollis v Park', 'open', ?2, NULL, ?3, ?3)",
    )
    .bind(MATTER, owner.userId, now)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO directory_person (id, display_name, created_at, updated_at) VALUES " +
        "(?1, 'Jane Hollis', ?3, ?3), (?2, 'Somebody Else', ?3, ?3)",
    )
    .bind(CLIENT, STRANGER, now)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO directory_email (id, entity_id, address, is_primary, created_at, updated_at) VALUES " +
        "(?1, ?2, ?3, 1, ?4, ?4)",
    )
    .bind(newIdentifier("directoryEmail"), CLIENT, CLIENT_ADDRESS, now)
    .run();
});

/** An event of this test's own — one meeting per event is held by the database — with the client on it. */
async function freshEvent(): Promise<MatterEventId> {
  const id = newIdentifier("matterEvent") as MatterEventId;
  const now = new Date().toISOString();
  await firmDatabase
    .prepare(
      `INSERT INTO matter_event (${EVENT_COLUMNS}) VALUES ` +
        `(?1, ?2, 'Settlement conference', 'scheduled', ?3, '09:30', '10:30', 'America/Los_Angeles', ?4, ?5, ?4, ?4)`,
    )
    .bind(id, MATTER, EVENT_DAY, now, ownerUserId)
    .run();
  await firmDatabase
    .prepare(
      "INSERT INTO matter_event_participant (id, event_id, participant_kind, entity_id, participant_name, created_at, updated_at) " +
        "VALUES (?1, ?2, 'entity', ?3, NULL, ?4, ?4)",
    )
    .bind(newIdentifier("matterEventParticipant"), id, CLIENT, now)
    .run();
  return id;
}

async function hostPost(
  path: string,
  body?: unknown,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<Response> {
  return await app.request(
    `${base}${path}`,
    {
      method: "POST",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body ?? {}),
    },
    ROUTED_ENVIRONMENT,
  );
}

async function hostRequest(path: string, method = "GET"): Promise<Response> {
  return await app.request(
    `${base}${path}`,
    {
      method,
      headers: {
        cookie: ownerCookie,
        ...(method === "GET" ? {} : { "idempotency-key": crypto.randomUUID() }),
      },
    },
    ROUTED_ENVIRONMENT,
  );
}

async function guestRequest(
  path: string,
  credential: string | null,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    environment?: Record<string, unknown>;
  } = {},
): Promise<Response> {
  return await app.request(
    `${base}${path}`,
    {
      method: init.method ?? "GET",
      headers: {
        ...(credential === null ? {} : { "x-meeting-guest": credential }),
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
    init.environment ?? ROUTED_ENVIRONMENT,
  );
}

interface Invitation {
  id: string;
  entityKind: string;
  entityId: string;
  invitedName: string;
  expiresAt: string;
  revokedAt: string | null;
  arrivalCount: number;
  lastArrivalAt: string | null;
}
interface Arrival {
  waiting: boolean;
  participantId: string;
  displayName: string;
  medium: string;
  guestGrant: string;
}

/** The typed-fallback code in the most recent mail, which is the whole token. */
function tokenFromLastMail(): string {
  const text = mail.at(-1)?.text ?? "";
  const match = /followed by this code:\n\n(\S+)\n/.exec(text);
  if (match?.[1] === undefined) throw new Error("no token in the mail");
  return match[1];
}

/** A lobby-on meeting the owner started and is in, with the client invited and their link in hand. */
async function meetingWithAGuest(): Promise<{
  meetingId: string;
  invitation: Invitation;
  token: string;
}> {
  const started = await hostPost("/api/v1/meetings", {
    eventKind: "matter",
    eventId: await freshEvent(),
    lobby: "on",
  });
  expect(started.status).toBe(201);
  const meetingId = (await readJson<{ id: string }>(started)).id;
  expect((await hostPost(`/api/v1/meetings/${meetingId}/join`)).status).toBe(200);
  const invited = await hostPost(`/api/v1/meetings/${meetingId}/guests`, { entityId: CLIENT });
  expect(invited.status).toBe(201);
  return { meetingId, invitation: await readJson<Invitation>(invited), token: tokenFromLastMail() };
}

async function arrive(
  token: string,
  confirmedName = "Jane H.",
  environment?: Record<string, unknown>,
): Promise<Response> {
  return await guestRequest("/api/v1/guest/arrivals", token, {
    method: "POST",
    body: { confirmedName },
    ...(environment === undefined ? {} : { environment }),
  });
}

async function stayRow(stayId: string) {
  return await firmDatabase
    .prepare(
      "SELECT confirmed_name, admitted_at, left_at, ended_reason FROM meeting_guest_stay WHERE id = ?1",
    )
    .bind(stayId)
    .first<{
      confirmed_name: string;
      admitted_at: string | null;
      left_at: string | null;
      ended_reason: string | null;
    }>();
}

/** The link's own payload, read back out of a token — what a test needs to forge a sibling of it. */
function payloadOf(token: string): {
  firmId: FirmId;
  meetingId: MeetingId;
  invitationId: MeetingGuestInvitationId;
  secretVersion: number;
  secret: string;
} {
  const segment = (token.split(".")[0] ?? "").replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(segment)) as ReturnType<typeof payloadOf>;
}

async function invitationRow(invitationId: string) {
  return await firmDatabase
    .prepare(
      "SELECT arrival_count, secret_version, revoked_at FROM meeting_guest_invitation WHERE id = ?1",
    )
    .bind(invitationId)
    .first<{ arrival_count: number; secret_version: number; revoked_at: string | null }>();
}

async function problemType(response: Response): Promise<string> {
  return (await readJson<{ type: string }>(response)).type;
}

/** Every string a guest route answered must be free of these — the matter is never theirs to hold. */
function expectNoMatterOrEvent(body: string): void {
  expect(body).not.toMatch(/matterId|eventId|matterEventId|firmEventId/);
  expect(body).not.toContain(MATTER);
  expect(body).not.toMatch(/matterEvent_/);
}

describe("minting a link", () => {
  it("mails the link to the Directory address and answers with the invitation, never the token", async () => {
    const { invitation, token } = await meetingWithAGuest();
    expect(mail).toHaveLength(1);
    expect(mail[0]?.to).toBe(CLIENT_ADDRESS);
    expect(mail[0]?.messageClass).toBe("meeting-guest-invitation");
    expect(mail[0]?.subject).toBe(
      "Hollis Guest Firm has invited you to a meeting: Settlement conference",
    );
    expect(mail[0]?.text).toContain(`${base}/join/${encodeURIComponent(token)}`);

    expect(Object.keys(invitation).toSorted()).toEqual([
      "arrivalCount",
      "entityId",
      "entityKind",
      "expiresAt",
      "id",
      "invitedName",
      "lastArrivalAt",
      "revokedAt",
    ]);
    expect(invitation).toMatchObject({
      entityKind: "person",
      entityId: CLIENT,
      invitedName: "Jane Hollis",
      revokedAt: null,
      arrivalCount: 0,
    });
    expect(JSON.stringify(invitation)).not.toContain(token);
  });

  it("refuses an entity that is not on the event", async () => {
    const { meetingId } = await meetingWithAGuest();
    const response = await hostPost(`/api/v1/meetings/${meetingId}/guests`, { entityId: STRANGER });
    expect(response.status).toBe(422);
    expect(await problemType(response)).toMatch(/\/guest-not-invitable$/);
  });

  it("lists the invitations a host has sent, without a credential in sight", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    const response = await hostRequest(`/api/v1/meetings/${meetingId}/guests`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(token);
    const page = JSON.parse(text) as { data: Invitation[]; nextCursor: string | null };
    expect(page.data.map((one) => one.id)).toEqual([invitation.id]);
    expect(page.nextCursor).toBeNull();
  });

  it("writes the credential to no audit row and no idempotency record", async () => {
    const { meetingId, token } = await meetingWithAGuest();
    const payload = (token.split(".")[0] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const secret = (JSON.parse(atob(payload)) as { secret: string }).secret;
    expect(secret.length).toBeGreaterThan(20);
    const { results: audits } = await firmDatabase
      .prepare("SELECT * FROM audit_log WHERE subject_id = ?1")
      .bind(meetingId)
      .all();
    const { results: stored } = await firmDatabase.prepare("SELECT * FROM idempotency_key").all();
    for (const written of [JSON.stringify(audits), JSON.stringify(stored)]) {
      expect(written).not.toContain(token);
      expect(written).not.toContain(secret);
      expect(written).not.toContain(CLIENT_ADDRESS);
    }
    expect(JSON.stringify(audits)).toContain("meetings.guest.invited");
  });
});

describe("opening the link", () => {
  it("reads a summary of its own schema and spends nothing", async () => {
    const { invitation, token } = await meetingWithAGuest();
    for (let opened = 0; opened < 3; opened += 1) {
      const response = await guestRequest("/api/v1/guest/meeting", token);
      expect(response.status).toBe(200);
      const text = await response.text();
      expectNoMatterOrEvent(text);
      const summary = JSON.parse(text) as Record<string, unknown>;
      expect(Object.keys(summary).toSorted()).toEqual([
        "endsAtTime",
        "firmName",
        "invitedName",
        "medium",
        "startsAtTime",
        "startsOn",
        "status",
        "timeZone",
        "title",
      ]);
      expect(summary).toMatchObject({
        firmName: "Hollis Guest Firm",
        title: "Settlement conference",
        startsOn: EVENT_DAY,
        startsAtTime: "09:30",
        timeZone: "America/Los_Angeles",
        invitedName: "Jane Hollis",
      });
    }
    // A prefetching mail client opened it three times, and the guest still holds every arrival.
    expect((await invitationRow(invitation.id))?.arrival_count).toBe(0);
  });

  it("answers the flat 404 to no credential and to a mangled one", async () => {
    await meetingWithAGuest();
    expect((await guestRequest("/api/v1/guest/meeting", null)).status).toBe(404);
    expect((await guestRequest("/api/v1/guest/meeting", "not.a-real-link")).status).toBe(404);
  });

  it("refuses the link on a member route with the reserved 404, whatever cookie rides beside it", async () => {
    const { meetingId, token } = await meetingWithAGuest();
    const response = await app.request(
      `${base}/api/v1/meetings/${meetingId}`,
      { headers: { cookie: ownerCookie, "x-meeting-guest": token } },
      ROUTED_ENVIRONMENT,
    );
    expect(response.status).toBe(404);
  });
});

describe("arriving at the door", () => {
  it("opens a waiting stay, counts the spend, and hands the browser a grant", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    const response = await arrive(token);
    expect(response.status).toBe(201);
    const text = await response.text();
    expectNoMatterOrEvent(text);
    const arrived = JSON.parse(text) as Arrival;
    expect(arrived).toMatchObject({ waiting: true, displayName: "Jane H.", medium: "video" });
    expect(arrived.participantId).toMatch(/^meetingGuestStay_/);
    expect(arrived.guestGrant).not.toBe(token);

    expect((await invitationRow(invitation.id))?.arrival_count).toBe(1);
    const stay = await firmDatabase
      .prepare("SELECT admitted_at, left_at, confirmed_name FROM meeting_guest_stay WHERE id = ?1")
      .bind(arrived.participantId)
      .first<{ admitted_at: string | null; left_at: string | null; confirmed_name: string }>();
    expect(stay).toEqual({ admitted_at: null, left_at: null, confirmed_name: "Jane H." });

    // THE HOST SEES THEM AT THE DOOR, marked a guest, with both names and no user behind them.
    const lobby = await hostRequest(`/api/v1/meetings/${meetingId}/lobby`);
    expect(lobby.status).toBe(200);
    expect((await readJson<{ data: unknown[] }>(lobby)).data).toEqual([
      expect.objectContaining({
        participantId: arrived.participantId,
        kind: "guest",
        userId: null,
        displayName: "Jane H.",
        invitedName: "Jane Hollis",
      }),
    ]);
  });

  it("answers a second arrival with the same open stay, and spends again", async () => {
    const { invitation, token } = await meetingWithAGuest();
    const first = await readJson<Arrival>(await arrive(token));
    const second = await arrive(token);
    expect(second.status).toBe(200);
    const again = await readJson<Arrival>(second);
    expect(again.participantId).toBe(first.participantId);
    expect(again.guestGrant.length).toBeGreaterThan(0);
    expect((await invitationRow(invitation.id))?.arrival_count).toBe(2);
  });

  it("a second person on an ADMITTED stay lands at the door under the name they typed", async () => {
    const { meetingId, token } = await meetingWithAGuest();
    const first = await readJson<Arrival>(await arrive(token, "Jane H."));
    const admitted = await hostPost(`/api/v1/meetings/${meetingId}/lobby/admissions`, {
      participantIds: [first.participantId],
    });
    expect(admitted.status).toBe(200);
    expect((await stayRow(first.participantId))?.admitted_at).not.toBeNull();

    // Somebody the link was forwarded to presses Join.
    const second = await arrive(token, "A Stranger");
    expect(second.status).toBe(200);
    const again = await readJson<Arrival>(second);
    expect(again).toMatchObject({
      participantId: first.participantId,
      waiting: true,
      displayName: "A Stranger",
    });
    expect(await stayRow(first.participantId)).toMatchObject({
      confirmed_name: "A Stranger",
      admitted_at: null,
      left_at: null,
    });
    // The host reads the new name beside the invited one before deciding again.
    const lobby = await hostRequest(`/api/v1/meetings/${meetingId}/lobby`);
    expect((await readJson<{ data: unknown[] }>(lobby)).data).toEqual([
      expect.objectContaining({
        participantId: first.participantId,
        displayName: "A Stranger",
        invitedName: "Jane Hollis",
      }),
    ]);
    // And their socket opens at the door, not in the room.
    const socket = await app.request(
      `${base}/api/v1/guest/meeting/socket`,
      {
        headers: {
          upgrade: "websocket",
          origin: base,
          "sec-websocket-protocol": `${GUEST_SOCKET_PROTOCOL}, ${again.guestGrant}`,
        },
      },
      ROUTED_ENVIRONMENT,
    );
    expect(socket.status).toBe(101);
    const frames: { type: string }[] = [];
    socket.webSocket?.accept();
    socket.webSocket?.addEventListener("message", (event) => {
      frames.push(JSON.parse(String(event.data)) as { type: string });
    });
    const deadline = Date.now() + 5_000;
    while (frames.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(frames[0]?.type).toBe("lobby");
    socket.webSocket?.close(1000, "done");
  });

  it("two browsers spending one link at once share the one stay, under the later name", async () => {
    const { invitation, token } = await meetingWithAGuest();
    let winner: Arrival | undefined;
    const racing = racingFirmDatabase(ROUTED_ENVIRONMENT, GUEST_DOOR_GUARD, async () => {
      const response = await arrive(token, "The First Browser");
      expect(response.status).toBe(201);
      winner = await readJson<Arrival>(response);
    });

    const loser = await arrive(token, "The Second Browser", racing.environment);
    expect(racing.interleaved).toBe(true);
    expect(loser.status).toBe(200);
    const arrived = await readJson<Arrival>(loser);
    // The index held one open stay; the loser was answered with it — under ITS name, never the
    // winner's — and the stay stays at the door.
    expect(arrived.participantId).toBe(winner?.participantId);
    expect(arrived.displayName).toBe("The Second Browser");
    expect(await stayRow(arrived.participantId)).toMatchObject({
      confirmed_name: "The Second Browser",
      admitted_at: null,
    });
    const { results } = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS open FROM meeting_guest_stay WHERE invitation_id = ?1 AND left_at IS NULL",
      )
      .bind(invitation.id)
      .all<{ open: number }>();
    expect(results[0]?.open).toBe(1);
  });

  it("an arrival whose spend the link refused under it is told the true reason", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    const racing = racingFirmDatabase(ROUTED_ENVIRONMENT, GUEST_ARRIVAL_GUARD, async () => {
      const withdrawn = await hostRequest(
        `/api/v1/meetings/${meetingId}/guests/${invitation.id}`,
        "DELETE",
      );
      expect(withdrawn.status).toBe(200);
    });
    const response = await arrive(token, "Jane H.", racing.environment);
    expect(racing.interleaved).toBe(true);
    expect(response.status).toBe(410);
    // Withdrawn, and said so — not "replaced by a newer one", which is not what happened.
    expect(await problemType(response)).toMatch(/\/guest-link-revoked$/);
  });

  it("refuses the arrival past the link's ceiling", async () => {
    const { invitation, token } = await meetingWithAGuest();
    // Set rather than spent: twenty arrivals inside a minute is also the lane's rate limit, which
    // would answer first and hide the ceiling this test is about.
    await firmDatabase
      .prepare("UPDATE meeting_guest_invitation SET arrival_count = 20 WHERE id = ?1")
      .bind(invitation.id)
      .run();
    const response = await arrive(token);
    expect(response.status).toBe(409);
    expect(await problemType(response)).toMatch(/\/guest-link-exhausted$/);
  });

  it("refuses the arrival at a locked door, and spends nothing", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    expect((await hostPost(`/api/v1/meetings/${meetingId}/lock`, { locked: true })).status).toBe(
      200,
    );
    const response = await arrive(token);
    expect(response.status).toBe(409);
    expect(await problemType(response)).toMatch(/\/meeting-locked$/);
    expect((await invitationRow(invitation.id))?.arrival_count).toBe(0);
  });

  it("refuses the link once its meeting has ended", async () => {
    const { meetingId, token } = await meetingWithAGuest();
    expect((await hostPost(`/api/v1/meetings/${meetingId}/end`)).status).toBe(200);
    const summary = await guestRequest("/api/v1/guest/meeting", token);
    expect(summary.status).toBe(409);
    expect(await problemType(summary)).toMatch(/\/meeting-ended$/);
    expect((await arrive(token)).status).toBe(409);
  });

  it("refuses an empty name at the door", async () => {
    const { token } = await meetingWithAGuest();
    const response = await arrive(token, "   ");
    expect(response.status).toBe(422);
  });
});

describe("in the room", () => {
  it("speaks and reads the chat once admitted, with no firm user identifier in either answer", async () => {
    const { meetingId, token } = await meetingWithAGuest();
    const arrived = await readJson<Arrival>(await arrive(token));
    const grant = arrived.guestGrant;

    // AT THE DOOR, NOT IN THE ROOM: the chat is not theirs yet.
    expect((await guestRequest("/api/v1/guest/meeting/messages", grant)).status).toBe(409);

    const admitted = await hostPost(`/api/v1/meetings/${meetingId}/lobby/admissions`, {
      participantIds: [arrived.participantId],
    });
    expect(admitted.status).toBe(200);

    expect(
      (await hostPost(`/api/v1/meetings/${meetingId}/messages`, { body: "Welcome, Jane." })).status,
    ).toBe(201);
    const said = await guestRequest("/api/v1/guest/meeting/messages", grant, {
      method: "POST",
      body: { body: "Thank you for having me." },
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    expect(said.status).toBe(201);
    expect(await readJson<Record<string, unknown>>(said)).toMatchObject({
      participantKind: "guest",
      participantId: arrived.participantId,
      userId: null,
    });

    const read = await guestRequest("/api/v1/guest/meeting/messages", grant);
    expect(read.status).toBe(200);
    const text = await read.text();
    expect(text).not.toContain(ownerUserId);
    expectNoMatterOrEvent(text);
    expect((JSON.parse(text) as { data: { body: string }[] }).data.map((one) => one.body)).toEqual([
      "Welcome, Jane.",
      "Thank you for having me.",
    ]);
  });

  it("opens the socket on the guest parameter, and no log line carries the credential", async () => {
    const { token } = await meetingWithAGuest();
    const grant = (await readJson<Arrival>(await arrive(token))).guestGrant;
    const response = await app.request(
      `${base}/api/v1/guest/meeting/socket?guest=${encodeURIComponent(grant)}`,
      { headers: { upgrade: "websocket", origin: base } },
      ROUTED_ENVIRONMENT,
    );
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close(1000, "done");

    // THE REQUEST LOG RECORDS THE ROUTE'S TEMPLATE, never the concrete address the grant rode in.
    const logged = JSON.stringify(logger.events);
    expect(logged).not.toContain(grant);
    expect(logged).not.toContain(encodeURIComponent(grant));
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(CLIENT_ADDRESS);
    expect(
      logger.events.some(
        (event) =>
          event.name === "request.completed" &&
          event.fields["route"] === "/api/v1/guest/meeting/socket",
      ),
    ).toBe(true);
  });

  it("opens the socket on the grant offered as a subprotocol, and answers with the bare protocol name", async () => {
    const { token } = await meetingWithAGuest();
    const grant = (await readJson<Arrival>(await arrive(token))).guestGrant;
    const response = await app.request(
      `${base}/api/v1/guest/meeting/socket`,
      {
        headers: {
          upgrade: "websocket",
          origin: base,
          "sec-websocket-protocol": `${GUEST_SOCKET_PROTOCOL}, ${grant}`,
        },
      },
      ROUTED_ENVIRONMENT,
    );
    expect(response.status).toBe(101);
    // The standard requires the answer to name one of the offered protocols; naming the bare one
    // keeps the credential out of every response header.
    expect(response.headers.get("sec-websocket-protocol")).toBe(GUEST_SOCKET_PROTOCOL);
    response.webSocket?.accept();
    response.webSocket?.close(1000, "done");
    expect(JSON.stringify(logger.events)).not.toContain(grant);
  });

  it("refuses the grant in the address of any other route's upgrade", async () => {
    const { meetingId, token } = await meetingWithAGuest();
    const arrived = await readJson<Arrival>(await arrive(token));
    await hostPost(`/api/v1/meetings/${meetingId}/lobby/admissions`, {
      participantIds: [arrived.participantId],
    });
    const response = await app.request(
      `${base}/api/v1/guest/meeting/messages?guest=${encodeURIComponent(arrived.guestGrant)}`,
      { headers: { upgrade: "websocket", origin: base } },
      ROUTED_ENVIRONMENT,
    );
    expect(response.status).toBe(404);
  });

  it("records no request's query string in any log line — the route template is all a line carries", async () => {
    const { token } = await meetingWithAGuest();
    const grant = (await readJson<Arrival>(await arrive(token))).guestGrant;
    const upgraded = await app.request(
      `${base}/api/v1/guest/meeting/socket?guest=${encodeURIComponent(grant)}&marker=query-string-canary`,
      { headers: { upgrade: "websocket", origin: base } },
      ROUTED_ENVIRONMENT,
    );
    upgraded.webSocket?.accept();
    upgraded.webSocket?.close(1000, "done");
    await guestRequest("/api/v1/guest/meeting?marker=query-string-canary", token);
    // THE FITNESS ASSERTION the guest parameter relies on: every field of every event, and no
    // field that looks like an address with a query on it.
    for (const event of logger.events) {
      for (const value of Object.values(event.fields)) {
        if (typeof value !== "string") continue;
        expect(value).not.toContain("query-string-canary");
        expect(value).not.toMatch(/[?&]guest=/);
      }
    }
    expect(JSON.stringify(logger.events)).not.toContain(grant);
  });

  it("leaves, closing the stay, and a second leave answers the same", async () => {
    const { token } = await meetingWithAGuest();
    const arrived = await readJson<Arrival>(await arrive(token));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const left = await guestRequest("/api/v1/guest/departures", arrived.guestGrant, {
        method: "POST",
      });
      expect(left.status).toBe(200);
    }
    const stay = await firmDatabase
      .prepare("SELECT left_at, ended_reason FROM meeting_guest_stay WHERE id = ?1")
      .bind(arrived.participantId)
      .first<{ left_at: string | null; ended_reason: string | null }>();
    expect(stay?.left_at).not.toBeNull();
    expect(stay?.ended_reason).toBe("left");
  });
});

describe("rotating and withdrawing", () => {
  it("rotates: a fresh link is mailed, and the old one stops working at once", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    const rotated = await hostRequest(
      `/api/v1/meetings/${meetingId}/guests/${invitation.id}/rotation`,
      "POST",
    );
    expect(rotated.status).toBe(200);
    expect(mail).toHaveLength(2);
    const fresh = tokenFromLastMail();
    expect(fresh).not.toBe(token);
    expect((await invitationRow(invitation.id))?.secret_version).toBe(2);

    const old = await guestRequest("/api/v1/guest/meeting", token);
    expect(old.status).toBe(410);
    expect(await problemType(old)).toMatch(/\/guest-link-not-valid$/);
    expect((await guestRequest("/api/v1/guest/meeting", fresh)).status).toBe(200);
  });

  it("withdraws: the row is kept, the link is refused, and a second withdrawal is a no-op", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    const withdrawn = await hostRequest(
      `/api/v1/meetings/${meetingId}/guests/${invitation.id}`,
      "DELETE",
    );
    expect(withdrawn.status).toBe(200);
    const body = await readJson<Invitation>(withdrawn);
    expect(body.revokedAt).not.toBeNull();

    const refused = await guestRequest("/api/v1/guest/meeting", token);
    expect(refused.status).toBe(410);
    expect(await problemType(refused)).toMatch(/\/guest-link-revoked$/);

    const again = await hostRequest(
      `/api/v1/meetings/${meetingId}/guests/${invitation.id}`,
      "DELETE",
    );
    expect(again.status).toBe(200);
    expect((await readJson<Invitation>(again)).revokedAt).toBe(body.revokedAt);

    // A withdrawn link is not rotated; inviting again reinstates the one row with a fresh secret.
    expect(
      (await hostRequest(`/api/v1/meetings/${meetingId}/guests/${invitation.id}/rotation`, "POST"))
        .status,
    ).toBe(410);
    const reinstated = await hostPost(`/api/v1/meetings/${meetingId}/guests`, { entityId: CLIENT });
    expect(reinstated.status).toBe(200);
    expect((await readJson<Invitation>(reinstated)).id).toBe(invitation.id);
    expect((await guestRequest("/api/v1/guest/meeting", tokenFromLastMail())).status).toBe(200);
  });

  it("withdrawing puts a guest in the room out, without barring them from the meeting", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    const arrived = await readJson<Arrival>(await arrive(token));
    await hostPost(`/api/v1/meetings/${meetingId}/lobby/admissions`, {
      participantIds: [arrived.participantId],
    });
    await hostRequest(`/api/v1/meetings/${meetingId}/guests/${invitation.id}`, "DELETE");

    // Closed `left`: withdrawing a link is a decision about the link, not a removal of the person.
    expect((await stayRow(arrived.participantId))?.ended_reason).toBe("left");
    // The grant dies with the link it was minted under.
    const refused = await guestRequest("/api/v1/guest/meeting/messages", arrived.guestGrant);
    expect(refused.status).toBe(410);
    expect(await problemType(refused)).toMatch(/\/guest-link-revoked$/);
  });

  it("withdrawing a waiting guest's link and inviting them again lets them arrive", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    const waiting = await readJson<Arrival>(await arrive(token));
    await hostRequest(`/api/v1/meetings/${meetingId}/guests/${invitation.id}`, "DELETE");
    expect((await stayRow(waiting.participantId))?.ended_reason).toBe("left");

    const reinstated = await hostPost(`/api/v1/meetings/${meetingId}/guests`, { entityId: CLIENT });
    expect(reinstated.status).toBe(200);
    const again = await arrive(tokenFromLastMail());
    // Arrived — not told they were removed from a meeting nobody removed them from.
    expect(again.status).toBe(201);
    const arrived = await readJson<Arrival>(again);
    expect(arrived.participantId).not.toBe(waiting.participantId);
  });

  it("rotating closes the stay the old link held, and the fresh link arrives at the door", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    const first = await readJson<Arrival>(await arrive(token));
    await hostPost(`/api/v1/meetings/${meetingId}/lobby/admissions`, {
      participantIds: [first.participantId],
    });
    expect(
      (await hostRequest(`/api/v1/meetings/${meetingId}/guests/${invitation.id}/rotation`, "POST"))
        .status,
    ).toBe(200);
    expect(await stayRow(first.participantId)).toMatchObject({ ended_reason: "left" });
    const renewed = await arrive(tokenFromLastMail(), "Jane H.");
    expect(renewed.status).toBe(201);
    const arrived = await readJson<Arrival>(renewed);
    expect(arrived.participantId).not.toBe(first.participantId);
    expect((await stayRow(arrived.participantId))?.admitted_at).toBeNull();
  });

  it("a link used up comes back to life when the host sends a fresh one", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    await firmDatabase
      .prepare("UPDATE meeting_guest_invitation SET arrival_count = 20 WHERE id = ?1")
      .bind(invitation.id)
      .run();
    expect((await arrive(token)).status).toBe(409);
    const rotated = await hostRequest(
      `/api/v1/meetings/${meetingId}/guests/${invitation.id}/rotation`,
      "POST",
    );
    expect((await readJson<Invitation>(rotated)).arrivalCount).toBe(0);
    expect((await arrive(tokenFromLastMail())).status).toBe(201);
  });

  it("a guest put out by the removal route is out, and barred on the same link", async () => {
    const { meetingId, token } = await meetingWithAGuest();
    const arrived = await readJson<Arrival>(await arrive(token));
    await hostPost(`/api/v1/meetings/${meetingId}/lobby/admissions`, {
      participantIds: [arrived.participantId],
    });
    const removed = await hostPost(
      `/api/v1/meetings/${meetingId}/participants/${arrived.participantId}/remove`,
    );
    expect(removed.status).toBe(200);
    expect(await stayRow(arrived.participantId)).toMatchObject({ ended_reason: "removed" });
    const barred = await arrive(token);
    expect(barred.status).toBe(409);
    expect(await problemType(barred)).toMatch(/\/meeting-removed$/);
  });
});

describe("a link whose entity has left the event", () => {
  it("is refused as withdrawn at the summary and at the arrival, and the refused arrival is recorded", async () => {
    const { meetingId, invitation, token } = await meetingWithAGuest();
    const event = await firmDatabase
      .prepare("SELECT matter_event_id FROM meeting WHERE id = ?1")
      .bind(meetingId)
      .first<{ matter_event_id: string }>();
    await firmDatabase
      .prepare("DELETE FROM matter_event_participant WHERE event_id = ?1 AND entity_id = ?2")
      .bind(event?.matter_event_id, CLIENT)
      .run();

    const summary = await guestRequest("/api/v1/guest/meeting", token);
    expect(summary.status).toBe(410);
    expect(await problemType(summary)).toMatch(/\/guest-link-revoked$/);
    const arrival = await arrive(token);
    expect(arrival.status).toBe(410);
    expect(await problemType(arrival)).toMatch(/\/guest-link-revoked$/);
    expect((await invitationRow(invitation.id))?.arrival_count).toBe(0);
    const { results } = await firmDatabase
      .prepare("SELECT event FROM audit_log WHERE subject_id = ?1")
      .bind(meetingId)
      .all<{ event: string }>();
    expect(results.map((row) => row.event)).toContain("meetings.guest.arrivalRefused");
  });
});

describe("a link the row does not vouch for, or that has run out", () => {
  it("refuses a correctly signed, current-version link whose secret is not the row's", async () => {
    const { token } = await meetingWithAGuest();
    const genuine = payloadOf(token);
    const forged = await mintGuestInvitationToken(ROUTED_ENVIRONMENT.AUTH_SECRET, {
      firmId: genuine.firmId,
      meetingId: genuine.meetingId,
      invitationId: genuine.invitationId,
      secretVersion: genuine.secretVersion,
      secret: "a-secret-the-row-never-held",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const response = await guestRequest("/api/v1/guest/meeting", forged);
    expect(response.status).toBe(410);
    expect(await problemType(response)).toMatch(/\/guest-link-not-valid$/);
    expect((await guestRequest("/api/v1/guest/meeting", token)).status).toBe(200);
  });

  it("tells the holder of an expired link it expired, and never counts them as a stranger", async () => {
    const { token } = await meetingWithAGuest();
    const genuine = payloadOf(token);
    const expired = await mintGuestInvitationToken(ROUTED_ENVIRONMENT.AUTH_SECRET, {
      ...genuine,
      expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    });
    const responses = [await guestRequest("/api/v1/guest/meeting", expired), await arrive(expired)];
    expect(responses.map((response) => response.status)).toEqual([410, 410]);
    expect(await Promise.all(responses.map(problemType))).toEqual([
      expect.stringMatching(/\/guest-link-expired$/),
      expect.stringMatching(/\/guest-link-expired$/),
    ]);
    const refusals = logger.events.filter((event) => event.name === "meetings.guest.refused");
    expect(refusals.map((event) => event.fields["reason"])).toEqual([
      "guest-link-expired",
      "guest-link-expired",
    ]);
  });
});

describe("the host's mail, when it cannot be sent", () => {
  it("stores no answer for a mint whose mail failed, so the retry sends a fresh link", async () => {
    const { meetingId } = await meetingWithAGuest();
    const other = newIdentifier("directoryPerson");
    const now = new Date().toISOString();
    const event = await firmDatabase
      .prepare("SELECT matter_event_id FROM meeting WHERE id = ?1")
      .bind(meetingId)
      .first<{ matter_event_id: string }>();
    await firmDatabase
      .prepare(
        "INSERT INTO directory_person (id, display_name, created_at, updated_at) VALUES (?1, 'Pat Other', ?2, ?2)",
      )
      .bind(other, now)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO directory_email (id, entity_id, address, is_primary, created_at, updated_at) VALUES (?1, ?2, 'pat@example.test', 1, ?3, ?3)",
      )
      .bind(newIdentifier("directoryEmail"), other, now)
      .run();
    await firmDatabase
      .prepare(
        "INSERT INTO matter_event_participant (id, event_id, participant_kind, entity_id, participant_name, created_at, updated_at) VALUES (?1, ?2, 'entity', ?3, NULL, ?4, ?4)",
      )
      .bind(newIdentifier("matterEventParticipant"), event?.matter_event_id, other, now)
      .run();

    const key = crypto.randomUUID();
    const sentBefore = mail.length;
    mailFailuresToCome = 1;
    const failed = await hostPost(`/api/v1/meetings/${meetingId}/guests`, { entityId: other }, key);
    expect(failed.status).toBe(503);
    expect(mail.length).toBe(sentBefore);

    // The SAME key: not the stored success of a call whose mail never went, but the act again.
    const retried = await hostPost(
      `/api/v1/meetings/${meetingId}/guests`,
      { entityId: other },
      key,
    );
    expect(retried.status).toBe(200);
    expect(mail.length).toBe(sentBefore + 1);
    expect(mail.at(-1)?.to).toBe("pat@example.test");
    // The mailed link is the live one.
    expect((await guestRequest("/api/v1/guest/meeting", tokenFromLastMail())).status).toBe(200);

    // And a third call with the key replays the stored success without mailing again.
    const replayed = await hostPost(
      `/api/v1/meetings/${meetingId}/guests`,
      { entityId: other },
      key,
    );
    expect(replayed.status).toBe(200);
    expect(mail.length).toBe(sentBefore + 1);
  });

  it("stores no answer for a rotation whose mail failed, so the retry mails", async () => {
    const { meetingId, invitation } = await meetingWithAGuest();
    const key = crypto.randomUUID();
    const rotate = async () =>
      await app.request(
        `${base}/api/v1/meetings/${meetingId}/guests/${invitation.id}/rotation`,
        { method: "POST", headers: { cookie: ownerCookie, "idempotency-key": key } },
        ROUTED_ENVIRONMENT,
      );
    mailFailuresToCome = 1;
    expect((await rotate()).status).toBe(503);
    expect(mail).toHaveLength(1);
    expect((await rotate()).status).toBe(200);
    expect(mail).toHaveLength(2);
    expect((await guestRequest("/api/v1/guest/meeting", tokenFromLastMail())).status).toBe(200);
  });
});

describe("the contract", () => {
  const document = buildOpenAPIDocument() as unknown as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
    components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
  };

  it("gives the guest a summary schema of its own, sharing no field that names the matter", () => {
    const guest = document.components.schemas["GuestMeetingSummary"]?.properties ?? {};
    const member = document.components.schemas["MeetingSummary"]?.properties ?? {};
    expect(Object.keys(guest).length).toBeGreaterThan(0);
    expect(Object.keys(guest).toSorted()).not.toEqual(Object.keys(member).toSorted());
    for (const name of ["GuestMeetingSummary", "GuestArrival", "MeetingGuestInvitation"]) {
      const properties = Object.keys(document.components.schemas[name]?.properties ?? {});
      expect(properties.length).toBeGreaterThan(0);
      expect(properties.filter((field) => /matter|event/i.test(field))).toEqual([]);
    }
  });

  it("puts no meeting identifier in any guest route's path, and marks every one of them", () => {
    const guestPaths = Object.keys(document.paths).filter((path) =>
      path.startsWith("/api/v1/guest/"),
    );
    expect(guestPaths.toSorted()).toEqual([
      "/api/v1/guest/arrivals",
      "/api/v1/guest/departures",
      "/api/v1/guest/meeting",
      "/api/v1/guest/meeting/messages",
      "/api/v1/guest/meeting/socket",
    ]);
    for (const path of guestPaths) {
      expect(path).not.toContain("{");
      for (const operation of Object.values(document.paths[path] ?? {})) {
        expect(operation["x-mc-guestLane"]).toMatch(/^(invitation|grant)$/);
        expect(operation["x-mc-permission"]).toBeNull();
      }
    }
  });
});
