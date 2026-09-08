import { env, SELF } from "cloudflare:test";
import { resolveScopedSetting } from "@magna-carta/data-access/scoped-setting-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import {
  incrementMinutesDefinition,
  roundingDirectionDefinition,
} from "@magna-carta/timekeeping/settings";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm's time-capture policy through the chokepoint over real Miniflare bindings: the seeded
// Owner role reaches it, an attorney who tracks time cannot change how the firm measures it, a
// write lands once at the FIRM tier with one audit row and none for a no-op, and a matter's own
// override is left exactly where the firm put it.

let firmId: FirmId;
let ownerCookie: string;
let attorneyCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const POLICY_URL = "https://example.com/api/v1/firm/time-policy";

async function readPolicy(cookie: string): Promise<Response> {
  return SELF.fetch(POLICY_URL, { headers: { cookie } });
}

async function patchPolicy(
  cookie: string,
  body: unknown,
  key = crypto.randomUUID(),
): Promise<Response> {
  return SELF.fetch(POLICY_URL, {
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

async function countPolicyAudits(): Promise<number> {
  return (
    (
      await firmDatabase
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.time_policy_updated'")
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Time Policy Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("time-policy-owner@example.com", {
    userName: "Time Policy Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Time Policy Owner", firmId);
  ownerCookie = await signInForSessionCookie("time-policy-owner@example.com");

  // A member who CAPTURES time and nothing more: tracking time must not be the key that decides
  // how the firm measures it. The seed decides that, which is why this is a seat rather than a
  // direct grant.
  const attorney = await seedCredentialedUser("time-policy-attorney@example.com", {
    userName: "Time Policy Attorney",
    firmId,
  });
  await mirrorMemberWithRole(attorney.userId, "Time Policy Attorney", firmId, "Attorney");
  attorneyCookie = await signInForSessionCookie("time-policy-attorney@example.com");
});

describe("the firm's time-capture policy", () => {
  it("reads the in-code defaults where the firm has never set anything", async () => {
    const response = await readPolicy(ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ incrementMinutes: 6, roundingDirection: "nearest" });
  });

  it("refuses a member who may only capture time, on the read and the write alike", async () => {
    expect((await readPolicy(attorneyCookie)).status).toBe(403);
    const response = await patchPolicy(attorneyCookie, { incrementMinutes: 15 });
    expect(response.status).toBe(403);
    expect(await resolveScopedSetting(firmDatabase, incrementMinutesDefinition, {})).toBe(6);
  });

  it("changes one setting and leaves the other, with one audit row", async () => {
    const before = await countPolicyAudits();
    const response = await patchPolicy(ownerCookie, { incrementMinutes: 15 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ incrementMinutes: 15, roundingDirection: "nearest" });
    expect(await resolveScopedSetting(firmDatabase, roundingDirectionDefinition, {})).toBe(
      "nearest",
    );
    expect((await countPolicyAudits()) - before).toBe(1);
  });

  it("writes the FIRM tier and leaves a matter's own override standing", async () => {
    // A matter deliberately pinned to tenths. The firm moving to half hours must not reach it —
    // the resolver walks most-specific-first, and this route owns one row.
    await firmDatabase
      .prepare(
        "INSERT INTO scoped_setting (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, 'matter', 'matter_pinned', '6', ?2) ON CONFLICT(key, scope_tier, scoped_id) DO UPDATE SET value = excluded.value",
      )
      .bind(incrementMinutesDefinition.key, new Date().toISOString())
      .run();

    expect((await patchPolicy(ownerCookie, { incrementMinutes: 30 })).status).toBe(200);

    expect(await resolveScopedSetting(firmDatabase, incrementMinutesDefinition, {})).toBe(30);
    expect(
      await resolveScopedSetting(firmDatabase, incrementMinutesDefinition, {
        matterId: "matter_pinned",
      }),
    ).toBe(6);
  });

  it("an empty patch changes nothing and records nothing", async () => {
    const before = await countPolicyAudits();
    const response = await patchPolicy(ownerCookie, {});
    expect(response.status).toBe(200);
    expect((await countPolicyAudits()) - before).toBe(0);
  });

  it("refuses an increment past an hour, and a direction that is not one of the three", async () => {
    expect((await patchPolicy(ownerCookie, { incrementMinutes: 90 })).status).toBe(422);
    expect((await patchPolicy(ownerCookie, { incrementMinutes: 0 })).status).toBe(422);
    expect((await patchPolicy(ownerCookie, { incrementMinutes: 7.5 })).status).toBe(422);
    expect((await patchPolicy(ownerCookie, { roundingDirection: "sideways" })).status).toBe(422);
  });

  it("requires an Idempotency-Key on the write", async () => {
    const response = await SELF.fetch(POLICY_URL, {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: "https://example.com",
      },
      body: JSON.stringify({ roundingDirection: "up" }),
    });
    expect(response.status).toBe(400);
  });

  it("replaying one key answers 200 twice and writes exactly one audit row", async () => {
    const before = await countPolicyAudits();
    const key = crypto.randomUUID();
    expect((await patchPolicy(ownerCookie, { roundingDirection: "up" }, key)).status).toBe(200);
    const second = await patchPolicy(ownerCookie, { roundingDirection: "up" }, key);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await countPolicyAudits()) - before).toBe(1);
  });
});
