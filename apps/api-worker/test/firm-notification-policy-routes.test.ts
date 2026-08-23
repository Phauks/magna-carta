import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { readFirmNotificationPreferences } from "@magna-carta/notifications/preferences";
import {
  readNotificationDigestLocalHour,
  readNotificationRetentionDays,
} from "@magna-carta/notifications/settings";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm's own tier of the notification policy, through the chokepoint over real Miniflare
// bindings. Three settings that were written by nothing in the product until this route existed: the
// in-app floor, the retention window the nightly sweep reads, and the local hour the digest pass
// asks each firm about.
//
// Two things these tests are careful about, because getting either wrong is the failure the surface
// exists to prevent. The write must land on the FIRM tier and not on the acting member's own row —
// an administrator changing firm policy must not be silently changing their personal preferences.
// And the floor must actually bind: a member who chose `off` has to come back `on` and locked, which
// is only observable through the member's own read.

let firmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let plainUserId: UserId;
let plainCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

const POLICY_URL = "https://example.com/api/v1/firm/notifications/policy";
const MEMBER_PREFERENCES_URL = "https://example.com/api/v1/notifications/preferences";

interface PolicyBody {
  categories: { category: string; inApp: string | null; email: string | null }[];
  retentionDays: number;
  digestLocalHour: number;
}

async function patchPolicy(cookie: string, patch: unknown): Promise<Response> {
  return SELF.fetch(POLICY_URL, {
    method: "PATCH",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: "https://example.com",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(patch),
  });
}

async function readPolicy(cookie: string): Promise<PolicyBody> {
  const response = await SELF.fetch(POLICY_URL, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as PolicyBody;
}

function policyFor(body: PolicyBody, category: string): PolicyBody["categories"][number] {
  const entry = body.categories.find((row) => row.category === category);
  if (entry === undefined) throw new Error(`no firm policy row for ${category}`);
  return entry;
}

async function countPolicyAudits(): Promise<number> {
  return (
    (
      await firmDatabase
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.notification_policy_updated'",
        )
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Notification Policy Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("policy-owner@example.com", {
    userName: "Policy Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Policy Owner", firmId);
  ownerCookie = await signInForSessionCookie("policy-owner@example.com");

  // A member holding notifications:read and NOTHING else — the seat every default role including
  // Read-only occupies. If the firm policy rode that key, this member could raise the floor and
  // shorten retention for the whole firm.
  const plain = await seedCredentialedUser("policy-plain@example.com", {
    userName: "Plain Member",
    firmId,
  });
  plainUserId = plain.userId;
  await insertMemberStatement(firmDatabase, {
    userId: plain.userId,
    displayName: "Plain Member",
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, 'notifications:read', ?2, NULL, ?3)",
    )
    .bind(newIdentifier("grant"), plain.userId, clock.now())
    .run();
  plainCookie = await signInForSessionCookie("policy-plain@example.com");
});

describe("GET /api/v1/firm/notifications/policy", () => {
  it("reports every category as unset, with the platform's retention window and digest hour", async () => {
    const body = await readPolicy(ownerCookie);
    expect(body.categories).toHaveLength(11);
    // Null, not "off" — the firm having expressed nothing is a different fact from the firm having
    // chosen today's recommendation, and only null can say so.
    expect(policyFor(body, "billing")).toEqual({ category: "billing", inApp: null, email: null });
    expect(body.retentionDays).toBe(90);
    expect(body.digestLocalHour).toBe(7);
  });

  it("refuses a member who holds notifications:read but not firm:manageNotificationPolicy", async () => {
    const response = await SELF.fetch(POLICY_URL, { headers: { cookie: plainCookie } });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("refuses a session-less request", async () => {
    const response = await SELF.fetch(POLICY_URL);
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/v1/firm/notifications/policy", () => {
  it("refuses a member who holds notifications:read but not firm:manageNotificationPolicy", async () => {
    const response = await patchPolicy(plainCookie, { retentionDays: 365 });
    expect(response.status).toBe(403);
    expect(await readNotificationRetentionDays(firmDatabase)).toBe(90);
  });

  it("writes the FIRM tier, and leaves the acting member's own preferences untouched", async () => {
    const response = await patchPolicy(ownerCookie, { categories: { billing: { inApp: "on" } } });
    expect(response.status).toBe(200);

    // The stored row is the firm's, addressed as the scope chain addresses a firm tier.
    const firmRow = await firmDatabase
      .prepare(
        "SELECT value FROM scoped_setting WHERE key = 'notifications.preferences' AND scope_tier = 'firm' AND scoped_id IS NULL",
      )
      .first<{ value: string }>();
    expect(JSON.parse(firmRow?.value ?? "null")).toEqual({ billing: { inApp: "on" } });

    // And there is no user-tier row for the administrator who made the change. An admin setting firm
    // policy is not thereby setting their own preferences.
    const actorRows = await firmDatabase
      .prepare(
        "SELECT COUNT(*) AS n FROM scoped_setting WHERE key = 'notifications.preferences' AND scope_tier = 'user' AND scoped_id = ?1",
      )
      .bind(ownerUserId)
      .first<{ n: number }>();
    expect(actorRows?.n).toBe(0);
  });

  it("the floor BINDS: a member who switched a category off is answered on, and locked by the firm", async () => {
    // The member silences a category for themselves first, so the assertion afterwards cannot pass
    // by the member simply never having chosen anything.
    const silence = await SELF.fetch(MEMBER_PREFERENCES_URL, {
      method: "PATCH",
      headers: {
        cookie: plainCookie,
        "content-type": "application/json",
        origin: "https://example.com",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ categories: { documents: { inApp: "off" } } }),
    });
    expect(silence.status).toBe(200);
    const silenced = (await silence.json()) as {
      categories: { category: string; inApp: string; inAppLockedBy: string | null }[];
    };
    expect(silenced.categories.find((row) => row.category === "documents")).toMatchObject({
      inApp: "off",
      inAppLockedBy: null,
    });

    // The firm raises the floor through the route under test.
    expect(
      (await patchPolicy(ownerCookie, { categories: { documents: { inApp: "on" } } })).status,
    ).toBe(200);

    const after = await SELF.fetch(MEMBER_PREFERENCES_URL, { headers: { cookie: plainCookie } });
    expect(after.status).toBe(200);
    const resolved = (await after.json()) as {
      categories: {
        category: string;
        inApp: string;
        inAppLockedBy: string | null;
        memberChoice: { inApp?: string } | null;
      }[];
    };
    const documents = resolved.categories.find((row) => row.category === "documents");
    expect(documents).toMatchObject({ inApp: "on", inAppLockedBy: "firm-policy" });
    // The member's own choice is still on the row — a floor overrides it, it does not erase it, so
    // lowering the floor returns them to `off` rather than to the default.
    expect(documents?.memberChoice).toEqual({ inApp: "off" });
  });

  it("never raises a member's EMAIL cadence — the firm's tier is only a default there", async () => {
    const silence = await SELF.fetch(MEMBER_PREFERENCES_URL, {
      method: "PATCH",
      headers: {
        cookie: plainCookie,
        "content-type": "application/json",
        origin: "https://example.com",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ categories: { calendar: { email: "off" } } }),
    });
    expect(silence.status).toBe(200);

    expect(
      (await patchPolicy(ownerCookie, { categories: { calendar: { email: "daily" } } })).status,
    ).toBe(200);

    const after = await SELF.fetch(MEMBER_PREFERENCES_URL, { headers: { cookie: plainCookie } });
    const resolved = (await after.json()) as { categories: { category: string; email: string }[] };
    expect(resolved.categories.find((row) => row.category === "calendar")?.email).toBe("off");
  });

  it("is sparse: a second category patch leaves the first alone, and null clears one", async () => {
    expect(
      (await patchPolicy(ownerCookie, { categories: { custody: { inApp: "on" } } })).status,
    ).toBe(200);
    let body = await readPolicy(ownerCookie);
    expect(policyFor(body, "billing").inApp).toBe("on");
    expect(policyFor(body, "custody").inApp).toBe("on");

    expect(
      (await patchPolicy(ownerCookie, { categories: { custody: { inApp: null } } })).status,
    ).toBe(200);
    body = await readPolicy(ownerCookie);
    expect(policyFor(body, "custody").inApp).toBeNull();
    expect(policyFor(body, "billing").inApp).toBe("on");
  });

  it("writes a retention window and a digest hour the scheduled passes then read", async () => {
    const response = await patchPolicy(ownerCookie, { retentionDays: 180, digestLocalHour: 6 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as PolicyBody;
    expect(body.retentionDays).toBe(180);
    expect(body.digestLocalHour).toBe(6);

    // The readers the nightly retention sweep and the hourly digest pass actually call.
    expect(await readNotificationRetentionDays(firmDatabase)).toBe(180);
    expect(await readNotificationDigestLocalHour(firmDatabase)).toBe(6);
  });

  it("REFUSES an out-of-bounds retention window rather than clamping it", async () => {
    const before = await readNotificationRetentionDays(firmDatabase);
    for (const retentionDays of [29, 366]) {
      const response = await patchPolicy(ownerCookie, { retentionDays });
      expect(response.status).toBe(422);
      expect(response.headers.get("content-type")).toContain("application/problem+json");
    }
    // A firm that asked for five years and silently got one would believe it had the first.
    expect(await readNotificationRetentionDays(firmDatabase)).toBe(before);
  });

  it("REFUSES an out-of-range digest hour rather than clamping it", async () => {
    const before = await readNotificationDigestLocalHour(firmDatabase);
    for (const digestLocalHour of [-1, 24]) {
      expect((await patchPolicy(ownerCookie, { digestLocalHour })).status).toBe(422);
    }
    expect(await readNotificationDigestLocalHour(firmDatabase)).toBe(before);
  });

  it("refuses a category the registry does not declare", async () => {
    const response = await patchPolicy(ownerCookie, {
      categories: { everything: { inApp: "on" } },
    });
    expect(response.status).toBe(422);
  });

  it("an empty patch writes no audit row and returns the current policy", async () => {
    const before = await countPolicyAudits();
    const response = await patchPolicy(ownerCookie, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ retentionDays: 180 });
    expect(await countPolicyAudits()).toBe(before);
  });

  it("is idempotent: replaying one Idempotency-Key writes exactly one audit row", async () => {
    const key = crypto.randomUUID();
    const send = () =>
      SELF.fetch(POLICY_URL, {
        method: "PATCH",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "https://example.com",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ retentionDays: 120 }),
      });

    const before = await countPolicyAudits();
    expect((await send()).status).toBe(200);
    const replay = await send();
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await countPolicyAudits()) - before).toBe(1);
  });

  it("audits the policy and nobody's identity beyond the actor", async () => {
    expect((await patchPolicy(ownerCookie, { digestLocalHour: 9 })).status).toBe(200);
    const row = await firmDatabase
      .prepare(
        "SELECT actor_user_id, subject_id, metadata FROM audit_log WHERE event = 'firm.notification_policy_updated' ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .first<{ actor_user_id: string; subject_id: string | null; metadata: string }>();
    expect(row?.actor_user_id).toBe(ownerUserId);
    expect(row?.subject_id).toBeNull();
    expect(JSON.parse(row?.metadata ?? "null")).toEqual({ digestLocalHour: 9 });
    expect(row?.metadata).not.toContain(plainUserId);
  });

  it("the firm tier the package reads back is the one the route wrote", async () => {
    // Closing the loop the probe opened: the value every fan-out composes against is now reachable
    // from the product, not only from a test that inserted the row by hand.
    const stored = await readFirmNotificationPreferences(firmDatabase);
    expect(stored["billing"]).toEqual({ inApp: "on" });
    expect(stored["documents"]).toEqual({ inApp: "on" });
    expect(stored["custody"]).toBeUndefined();
  });
});
