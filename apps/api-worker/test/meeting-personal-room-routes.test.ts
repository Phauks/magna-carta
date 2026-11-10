import { env } from "cloudflare:test";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A member's personal room through the chokepoint over real Miniflare bindings. What the suite turns
// on:
//
//   - THE ROOM IS MADE ONCE, and its link is what a colleague follows.
//   - A COLLEAGUE ON THE LINK sees the room closed until its owner opens it, and is then put on the
//     session's event and handed the meeting to join.
//   - A SESSION MOVES ONTO A MATTER, keeping the meeting's handle.
//   - HAVING A ROOM IS A HOST'S CAPABILITY: a Billing seat holds meetings:join and not meetings:host,
//     so it can follow a link and cannot have a room.

const app = createApp();
const base = "https://example.com";
const MATTER = "matter_personalRoomRoutes00";

let firmId: FirmId;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let ownerCookie: string;
let billingCookie: string;
let billingUserId: string;

async function call(
  method: "GET" | "POST" | "PATCH",
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { cookie };
  if (method !== "GET") {
    headers["idempotency-key"] = crypto.randomUUID();
    headers["content-type"] = "application/json";
    headers.origin = base;
  }
  return await app.request(
    `${base}${path}`,
    { method, headers, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) },
    env,
  );
}

interface RoomBody {
  room: { id: string; linkCode: string; lobby: string; openMeetingId: string | null } | null;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Personal Room Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("personal-room-owner@example.com", {
    userName: "Room Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Room Owner", firmId);
  ownerCookie = await signInForSessionCookie("personal-room-owner@example.com");

  const billing = await seedCredentialedUser("personal-room-billing@example.com", {
    userName: "Room Visitor",
    firmId,
  });
  billingUserId = billing.userId;
  await mirrorMemberWithRole(billing.userId as UserId, "Room Visitor", firmId, "Billing");
  billingCookie = await signInForSessionCookie("personal-room-billing@example.com");

  const now = new Date().toISOString();
  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, system_key, created_at, updated_at) VALUES (?, ?, 'open', ?, NULL, ?, ?)",
    )
    .bind(MATTER, "Herrera v Alvarez", owner.userId, now, now)
    .run();
});

describe("a member's personal room", () => {
  it("is null until made, then made once", async () => {
    const before = await call("GET", "/api/v1/meetings/personal-room", ownerCookie);
    expect(before.status).toBe(200);
    expect((await before.json<RoomBody>()).room).toBeNull();

    const made = await call("POST", "/api/v1/meetings/personal-room", ownerCookie);
    expect(made.status).toBe(200);
    const room = (await made.json<RoomBody>()).room;
    expect(room?.linkCode).toMatch(/^[a-z0-9]{10}$/);
    expect(room?.lobby).toBe("on");

    const again = await call("POST", "/api/v1/meetings/personal-room", ownerCookie);
    expect((await again.json<RoomBody>()).room?.id).toBe(room?.id);
  });

  it("is a host's to have, not a member who may only join", async () => {
    const refused = await call("POST", "/api/v1/meetings/personal-room", billingCookie);
    expect(refused.status).toBe(403);
  });

  it("is closed to a colleague until opened, then puts them on the session's event", async () => {
    const room = (await (await call("GET", "/api/v1/meetings/personal-room", ownerCookie)).json<RoomBody>())
      .room;
    const linkPath = `/api/v1/meetings/rooms/${room?.linkCode ?? ""}`;

    const closed = await call("GET", linkPath, billingCookie);
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ state: "closed", ownerDisplayName: "Room Owner" });

    const opened = await call("POST", "/api/v1/meetings/personal-room/open", ownerCookie, {
      timeZone: "America/New_York",
    });
    expect(opened.status).toBe(200);
    const { meetingId, created } = await opened.json<{ meetingId: string; created: boolean }>();
    expect(created).toBe(true);

    const arrived = await call("POST", `${linkPath}/arrive`, billingCookie);
    expect(arrived.status).toBe(200);
    expect(await arrived.json()).toMatchObject({ state: "open", meetingId });

    const participant = await firmDatabase
      .prepare(
        "SELECT 1 AS present FROM firm_event_participant JOIN meeting ON meeting.firm_event_id = firm_event_participant.firm_event_id WHERE meeting.id = ? AND member_user_id = ?",
      )
      .bind(meetingId, billingUserId)
      .first<{ present: number }>();
    expect(participant?.present).toBe(1);

    // And the session moves onto a matter, keeping its handle.
    const moved = await call("POST", `/api/v1/meetings/${meetingId}/move-to-matter`, ownerCookie, {
      matterId: MATTER,
    });
    expect(moved.status).toBe(200);
    const meeting = await firmDatabase
      .prepare("SELECT event_kind, matter_event_id FROM meeting WHERE id = ?")
      .bind(meetingId)
      .first<{ event_kind: string; matter_event_id: string }>();
    expect(meeting?.event_kind).toBe("matter");
    expect(meeting?.matter_event_id).toBe((await moved.json<{ matterEventId: string }>()).matterEventId);

    const twice = await call("POST", `/api/v1/meetings/${meetingId}/move-to-matter`, ownerCookie, {
      matterId: MATTER,
    });
    expect(twice.status).toBe(409);
  });

  it("answers a link that names nothing as absent", async () => {
    const response = await call("GET", "/api/v1/meetings/rooms/abcdefghjk", billingCookie);
    expect(response.status).toBe(404);
  });
});
