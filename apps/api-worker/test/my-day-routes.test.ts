import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// My Day route: the daily headline for a timekeeper. The handler resolves the firm's daily-hours
// target from the flat setting store, converts hours to minutes (multiply by 60), and delegates to
// readMyDay. A day with no entries produces unloggedDay: true. A missing firm target yields a null
// shortfall. A Read-only member cannot access the endpoint (requires time:track). A time:track-only
// user cannot read another timekeeper's My Day; time:viewFirm is required for cross-user reads.

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;
// A user with time:track only (direct grant), used to test self-scope enforcement.
let trackOnlyCookie: string;
let trackOnlyUserId: UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "My Day Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("myday-owner@example.com", {
    userName: "My Day Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "My Day Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("myday-owner@example.com");

  const readOnly = await seedCredentialedUser("myday-readonly@example.com", {
    userName: "My Day Read Only",
    firmId: poolFirmId,
  });
  const role = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind("Read-only")
    .first<{ id: string }>();
  await insertMemberStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    userId: readOnly.userId,
    displayName: "My Day Read Only",
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    id: newIdentifier("memberRole"),
    memberUserId: readOnly.userId,
    roleId: assertIdentifier(role!.id, "role"),
  }).run();
  readOnlyCookie = await signInForSessionCookie("myday-readonly@example.com");

  // Seed a user with only a direct time:track grant — no role, no time:viewFirm.
  const trackOnly = await seedCredentialedUser("myday-trackonly@example.com", {
    userName: "My Day Track Only",
    firmId: poolFirmId,
  });
  trackOnlyUserId = trackOnly.userId;
  await insertMemberStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    userId: trackOnly.userId,
    displayName: "My Day Track Only",
    now: new Date().toISOString(),
  }).run();
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), trackOnly.userId, "time:track", new Date().toISOString())
    .run();
  trackOnlyCookie = await signInForSessionCookie("myday-trackonly@example.com");
});

function readHeaders(cookie: string): HeadersInit {
  return { origin: "https://example.com", cookie };
}

async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: readHeaders(cookie) });
}

describe("My Day view", () => {
  it("returns zero totals and unloggedDay: true for a day with no entries", async () => {
    const response = await get(
      `/api/v1/my-day?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      billableMinutes: number;
      nonBillableMinutes: number;
      targetDailyMinutes: number | null;
      shortfallMinutes: number | null;
      unloggedDay: boolean;
    };
    expect(body.billableMinutes).toBe(0);
    expect(body.nonBillableMinutes).toBe(0);
    // No target set for this firm, so targetDailyMinutes and shortfallMinutes are null.
    expect(body.targetDailyMinutes).toBeNull();
    expect(body.shortfallMinutes).toBeNull();
    expect(body.unloggedDay).toBe(true);
  });

  it("reflects the firm target when time.target_daily_hours is set", async () => {
    // Set the daily target to 8 hours (480 minutes).
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind("time.target_daily_hours", "8", new Date().toISOString())
      .run();

    const response = await get(
      `/api/v1/my-day?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      targetDailyMinutes: number | null;
      shortfallMinutes: number | null;
    };
    expect(body.targetDailyMinutes).toBe(480);
    // No entries, so shortfall = target.
    expect(body.shortfallMinutes).toBe(480);

    // Restore to no target for subsequent tests.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("DELETE FROM setting WHERE key = ?1")
      .bind("time.target_daily_hours")
      .run();
  });
});

describe("permission gate", () => {
  it("refuses a Read-only member the time:track capability (403)", async () => {
    const response = await get(
      `/api/v1/my-day?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});

// My Day self-scope — a timekeeper may always read their own headline; reading another
// timekeeper's headline requires time:viewFirm.
describe("My Day self-scope authorization", () => {
  it("allows a timekeeper to read their own My Day (self read -> 200)", async () => {
    const response = await get(
      `/api/v1/my-day?timekeeperUserId=${trackOnlyUserId}&workDate=2026-06-22`,
      trackOnlyCookie,
    );
    expect(response.status).toBe(200);
  });

  it("refuses a time:track-only user reading another timekeeper's My Day (403)", async () => {
    // trackOnlyCookie does not hold time:viewFirm — reading ownerUserId's headline must be refused.
    const response = await get(
      `/api/v1/my-day?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
      trackOnlyCookie,
    );
    expect(response.status).toBe(403);
  });

  it("allows an Admin (time:viewFirm holder) to read another timekeeper's My Day (200)", async () => {
    // ownerCookie is Admin who holds time:viewFirm via their role.
    const response = await get(
      `/api/v1/my-day?timekeeperUserId=${trackOnlyUserId}&workDate=2026-06-22`,
      ownerCookie,
    );
    expect(response.status).toBe(200);
  });
});
