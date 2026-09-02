import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { readCalendarWeekStartsOn } from "@magna-carta/calendar/settings";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm's calendar settings through the chokepoint over real Miniflare bindings. One setting
// today, the day the week begins on, and the two things the surface must hold: a member who may only
// READ the calendar cannot move the firm's week, and a write lands once, on the firm, with one audit
// row and none for a no-op.

let firmId: FirmId;
let ownerCookie: string;
let readerCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };
const SETTINGS_URL = "https://example.com/api/v1/calendar/settings";

async function readSettings(cookie: string): Promise<{ weekStartsOn: number }> {
  const response = await SELF.fetch(SETTINGS_URL, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as { weekStartsOn: number };
}

async function patchSettings(cookie: string, body: unknown, key = crypto.randomUUID()) {
  return SELF.fetch(SETTINGS_URL, {
    method: "PATCH",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: "https://example.com",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}

async function countSettingsAudits(): Promise<number> {
  return (
    (
      await firmDatabase
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'calendar.settings.updated'")
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Calendar Settings Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("calendar-settings-owner@example.com", {
    userName: "Calendar Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Calendar Owner", firmId);
  ownerCookie = await signInForSessionCookie("calendar-settings-owner@example.com");

  // A member holding calendar:read and nothing else: everyone can see what is coming, and that
  // must not be the key that moves the firm's week.
  const reader = await seedCredentialedUser("calendar-settings-reader@example.com", {
    userName: "Calendar Reader",
    firmId,
  });
  await insertMemberStatement(firmDatabase, {
    userId: reader.userId as UserId,
    displayName: "Calendar Reader",
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, 'calendar:read', ?2, NULL, ?3)",
    )
    .bind(newIdentifier("grant"), reader.userId, clock.now())
    .run();
  readerCookie = await signInForSessionCookie("calendar-settings-reader@example.com");
});

describe("the firm's calendar settings", () => {
  it("reads Sunday where the firm has never set anything, for a reader as well as an owner", async () => {
    expect(await readSettings(ownerCookie)).toEqual({ weekStartsOn: 0 });
    expect(await readSettings(readerCookie)).toEqual({ weekStartsOn: 0 });
  });

  it("refuses a member who may only read the calendar", async () => {
    const response = await patchSettings(readerCookie, { weekStartsOn: 1 });
    expect(response.status).toBe(403);
    expect(await readCalendarWeekStartsOn(firmDatabase)).toBe(0);
  });

  it("moves the firm's week for everybody, with one audit row", async () => {
    const before = await countSettingsAudits();
    const response = await patchSettings(ownerCookie, { weekStartsOn: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ weekStartsOn: 1 });
    expect(await readSettings(readerCookie)).toEqual({ weekStartsOn: 1 });
    expect(await readCalendarWeekStartsOn(firmDatabase)).toBe(1);
    expect(await countSettingsAudits()).toBe(before + 1);
  });

  it("replays a retried write rather than recording it twice", async () => {
    const before = await countSettingsAudits();
    const key = crypto.randomUUID();
    const first = await patchSettings(ownerCookie, { weekStartsOn: 0 }, key);
    const second = await patchSettings(ownerCookie, { weekStartsOn: 0 }, key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await countSettingsAudits()).toBe(before + 1);
  });

  it("writes nothing and audits nothing for an empty patch", async () => {
    const before = await countSettingsAudits();
    const response = await patchSettings(ownerCookie, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ weekStartsOn: 0 });
    expect(await countSettingsAudits()).toBe(before);
  });

  it("refuses a day the vocabulary does not carry", async () => {
    const response = await patchSettings(ownerCookie, { weekStartsOn: 3 });
    expect(response.status).toBe(422);
  });
});
