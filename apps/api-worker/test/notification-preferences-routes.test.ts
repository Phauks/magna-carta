import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { MATTER_CLOSED_TOPIC } from "@magna-carta/matters/topics";
import { writeFirmNotificationPreferencesStatement } from "@magna-carta/notifications/preferences";
import { translateOutboxMessage } from "@magna-carta/notifications/translate";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The preference surface through the chokepoint over real Miniflare bindings: what a member may
// choose, what the firm may insist on, and what the platform refuses to let either of them switch
// off. The fan-out is driven the way production drives it — a real translator pass over an outbox
// message — so what these tests observe is what the subscriber actually writes.

let firmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let plainCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

async function patchPreferences(
  cookie: string,
  categories: Record<string, { inApp?: string | null; email?: string | null }>,
): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/notifications/preferences", {
    method: "PATCH",
    headers: {
      cookie,
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ categories }),
  });
}

async function readPreferences(cookie: string): Promise<{
  categories: {
    category: string;
    inApp: string;
    email: string;
    inAppLockedBy: string | null;
    memberChoice: { inApp?: string; email?: string } | null;
  }[];
  suppressedInApp: { category: string; reason: string; count: number }[];
  suppressedSinceCivilDate: string;
}> {
  const response = await SELF.fetch("https://example.com/api/v1/notifications/preferences", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as never;
}

function categoryIn(
  body: Awaited<ReturnType<typeof readPreferences>>,
  category: string,
): { inApp: string; email: string; inAppLockedBy: string | null } {
  const entry = body.categories.find((row) => row.category === category);
  if (entry === undefined) throw new Error(`no resolved preference for ${category}`);
  return entry;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Preference Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("preference-owner@example.com", {
    userName: "Preference Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Preference Owner", firmId);
  ownerCookie = await signInForSessionCookie("preference-owner@example.com");

  // A member holding notifications:read and nothing else. Two things that proves at once: their own
  // preference read never shows them a colleague's choices, and the designation write — which is a
  // firm-level trust control rather than a personal setting — refuses them.
  const plain = await seedCredentialedUser("preference-plain@example.com", {
    userName: "Plain Member",
    firmId,
  });
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
  plainCookie = await signInForSessionCookie("preference-plain@example.com");

  await firmDatabase
    .prepare(
      "INSERT INTO matter (id, title, status, responsible_member_id, matter_number, e_billing, created_at, updated_at) VALUES (?1, ?2, 'open', ?3, ?4, 0, ?5, ?5)",
    )
    .bind("matter_pref000000001", "Ellison v. Braddock", ownerUserId, "8181-3", clock.now())
    .run();
});

describe("GET /api/v1/notifications/preferences", () => {
  it("returns the recommended defaults for a member who has chosen nothing", async () => {
    const body = await readPreferences(ownerCookie);
    expect(body.categories).toHaveLength(12);
    expect(categoryIn(body, "deadlines")).toMatchObject({ inApp: "on", email: "daily" });
    // The two categories that are about the platform working rather than the firm's work.
    expect(categoryIn(body, "jobs").email).toBe("off");
    expect(categoryIn(body, "system").email).toBe("off");
  });

  it("marks the two non-silenceable categories as locked by the platform", async () => {
    const body = await readPreferences(ownerCookie);
    expect(categoryIn(body, "trust").inAppLockedBy).toBe("mandatory");
    expect(categoryIn(body, "security").inAppLockedBy).toBe("mandatory");
    expect(categoryIn(body, "billing").inAppLockedBy).toBeNull();
  });

  it("refuses a session-less request", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/notifications/preferences");
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/v1/notifications/preferences", () => {
  it("stores a member's choice and reports what now applies", async () => {
    const response = await patchPreferences(ownerCookie, { billing: { inApp: "off" } });
    expect(response.status).toBe(200);
    expect(categoryIn(await readPreferences(ownerCookie), "billing").inApp).toBe("off");
  });

  it("clears a choice when the field is explicitly null", async () => {
    // Clearing has to be expressible, or a member who once chose the current recommendation could
    // never go back to simply following it.
    await patchPreferences(ownerCookie, { calendar: { email: "weekly" } });
    expect(categoryIn(await readPreferences(ownerCookie), "calendar").email).toBe("weekly");
    await patchPreferences(ownerCookie, { calendar: { email: null } });
    expect(categoryIn(await readPreferences(ownerCookie), "calendar").email).toBe("daily");
  });

  it("accepts an off on a mandatory category and reports honestly that it does not apply", async () => {
    // Stored rather than refused — the member's stated wish is real and survives the day the
    // category stops being mandatory — but the response says what actually happens, so nobody is
    // left believing they switched off a trust notification.
    const response = await patchPreferences(ownerCookie, { trust: { inApp: "off" } });
    expect(response.status).toBe(200);
    const body = await readPreferences(ownerCookie);
    expect(categoryIn(body, "trust").inApp).toBe("on");
    expect(categoryIn(body, "trust").inAppLockedBy).toBe("mandatory");
  });

  it("keeps a member's email cadence when a firm sets a louder one", async () => {
    // A firm may not force a member's mail upward: that would be forcing privileged-adjacent
    // metadata into a mailbox the firm may not administer.
    await patchPreferences(ownerCookie, { documents: { email: "off" } });
    await writeFirmNotificationPreferencesStatement(
      firmDatabase,
      { documents: { email: "daily" } },
      clock.now(),
    ).run();
    expect(categoryIn(await readPreferences(ownerCookie), "documents").email).toBe("off");
  });

  it("refuses a category the registry does not declare", async () => {
    const response = await patchPreferences(ownerCookie, { everything: { inApp: "off" } });
    expect(response.status).toBe(422);
  });

  it("refuses a write with no Idempotency-Key", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/notifications/preferences", {
      method: "PATCH",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ categories: { billing: { inApp: "on" } } }),
    });
    expect(response.status).toBe(400);
  });

  it("writes ONE audit row carrying the categories and never a subject or a matter", async () => {
    const before = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event = ?1")
      .bind("notifications.preferences_updated")
      .all<{ total: number }>();
    await patchPreferences(ownerCookie, { conflicts: { email: "weekly" } });
    const after = await firmDatabase
      .prepare(
        "SELECT metadata, subject_id, actor_user_id FROM audit_log WHERE event = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .bind("notifications.preferences_updated")
      .all<{ metadata: string; subject_id: string | null; actor_user_id: string }>();
    const total = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event = ?1")
      .bind("notifications.preferences_updated")
      .all<{ total: number }>();
    expect(total.results[0]?.total).toBe((before.results[0]?.total ?? 0) + 1);

    const row = after.results[0];
    expect(row?.subject_id).toBeNull();
    expect(row?.actor_user_id).toBe(ownerUserId);
    // The category, and what it now RESOLVES to — computed rather than echoed, so an audit row
    // never records a mandatory category as silenced when the floor keeps it on.
    expect(JSON.parse(row?.metadata ?? "{}")).toEqual({
      categories: [{ category: "conflicts", inApp: "on", email: "weekly" }],
    });
    // Nothing about a matter, a recipient, or a notification is in the record of a preference change.
    expect(row?.metadata).not.toContain("matter");
  });

  it("adds no audit row for an empty patch", async () => {
    const before = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event = ?1")
      .bind("notifications.preferences_updated")
      .all<{ total: number }>();
    const response = await patchPreferences(ownerCookie, {});
    expect(response.status).toBe(200);
    const after = await firmDatabase
      .prepare("SELECT COUNT(*) AS total FROM audit_log WHERE event = ?1")
      .bind("notifications.preferences_updated")
      .all<{ total: number }>();
    expect(after.results[0]?.total).toBe(before.results[0]?.total);
  });

  it("reports back what the member's own settings have stopped", async () => {
    // The whole point of the tally: a member can see that their choice, and not a fault, is why
    // nothing arrived.
    await patchPreferences(ownerCookie, { system: { inApp: "off" } });
    await translateOutboxMessage({
      database: firmDatabase,
      outboxRowId: "outbox_pref_suppressed",
      topic: MATTER_CLOSED_TOPIC,
      payload: JSON.stringify({ matterId: "matter_pref000000001" }),
      now: clock.now,
    });

    const body = await readPreferences(ownerCookie);
    const tally = body.suppressedInApp.find((row) => row.category === "system");
    expect(tally?.reason).toBe("member-preference");
    expect(tally?.count).toBeGreaterThanOrEqual(1);
    // And no feed row was written for it.
    const feed = await SELF.fetch("https://example.com/api/v1/notifications?category=system", {
      headers: { cookie: ownerCookie },
    });
    expect((await readJson<{ data: unknown[] }>(feed)).data).toEqual([]);

    // Put the category back so the ordering of the remaining cases does not depend on this one.
    await patchPreferences(ownerCookie, { system: { inApp: null } });
  });

  it("shows one member nothing of another member's choices", async () => {
    const body = await readPreferences(plainCookie);
    // The owner switched billing off above; this member never did.
    expect(categoryIn(body, "billing").inApp).toBe("on");
    expect(body.suppressedInApp).toEqual([]);
  });
});

describe("the firm's trust-compliance designation", () => {
  it("defaults to nobody", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/v1/firm/notifications/trust-compliance-recipients",
      { headers: { cookie: ownerCookie } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      recipientUserIds: [],
    });
  });

  it("is written under the trust-management capability and refuses a member without it", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/v1/firm/notifications/trust-compliance-recipients",
      {
        method: "PUT",
        headers: {
          cookie: plainCookie,
          "content-type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ recipientUserIds: [ownerUserId] }),
      },
    );
    expect(response.status).toBe(403);
  });

  it("stores the designation and audits HOW MANY, never who", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/v1/firm/notifications/trust-compliance-recipients",
      {
        method: "PUT",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ recipientUserIds: [ownerUserId] }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      recipientUserIds: [ownerUserId],
    });

    const { results } = await firmDatabase
      .prepare(
        "SELECT metadata FROM audit_log WHERE event = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .bind("notifications.trust_compliance_recipients_updated")
      .all<{ metadata: string }>();
    expect(JSON.parse(results[0]?.metadata ?? "{}")).toEqual({ recipientCount: 1 });
    // A recipient list in the audit log would be a durable record of who a firm watches its trust
    // account through, kept in the one table its staff can read.
    expect(results[0]?.metadata).not.toContain(ownerUserId);
  });
});
