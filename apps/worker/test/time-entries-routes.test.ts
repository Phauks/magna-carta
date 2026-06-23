import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, RateCardId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The time-entry HTTP surface over real Miniflare bindings: capture resolves the rate + rounds the
// duration in the handler then commits the WIP row through the chokepoint; the My-Day / per-matter
// list shapes expose the real raw_duration_minutes; the draft-only and frozen-entry conflicts both
// map to 409; submit requires only time:track; the submit->approve review path requires the
// approval_required gate to be on; the read-shaped quick-add preview writes nothing; idempotent
// replay of a create; self-scope authorization; void; kickBack; gridBatch; zero-duration guard;
// and workDate re-resolution.

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;
let matterId: string;
// A user with time:track (direct grant) only — no time:viewFirm, no time:approve.
let trackOnlyCookie: string;
let trackOnlyUserId: UserId;
let rateCardId: RateCardId;

const clock = { now: () => new Date().toISOString() };

async function mirrorMemberWithRole(userId: UserId, displayName: string, roleName: string) {
  const role = await env.DB_FIRM_POOL_1.prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .first<{ id: string }>();
  if (role === null) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(env.DB_FIRM_POOL_1, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(env.DB_FIRM_POOL_1, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

// Seeds a member with no role but a single direct-grant permission. Used to construct a user
// who has time:track but not time:viewFirm or time:approve.
async function mirrorMemberWithDirectGrant(
  userId: UserId,
  displayName: string,
  permission: string,
): Promise<void> {
  await insertMemberStatement(env.DB_FIRM_POOL_1, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  const now = new Date().toISOString();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
  )
    .bind(newIdentifier("grant"), userId, permission, now)
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Time Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("time-owner@example.com", {
    userName: "Time Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Time Owner");
  ownerCookie = await signInForSessionCookie("time-owner@example.com");

  const readOnly = await seedCredentialedUser("time-readonly@example.com", {
    userName: "Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("time-readonly@example.com");

  // A user with time:track only (direct grant, no role) — used for Fix 1, Fix 2, and Fix 6 tests.
  const trackOnly = await seedCredentialedUser("time-trackonly@example.com", {
    userName: "Track Only",
    firmId: poolFirmId,
  });
  trackOnlyUserId = trackOnly.userId;
  await mirrorMemberWithDirectGrant(trackOnly.userId, "Track Only", "time:track");
  trackOnlyCookie = await signInForSessionCookie("time-trackonly@example.com");

  // A simple counter-only numbering scheme is needed to create an open (numbered) matter.
  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "TK-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  // A matter to bill time to, created straight through the matter surface.
  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      title: "Smith v. Jones",
      status: "open",
      responsibleMemberId: ownerUserId,
    }),
  });
  matterId = ((await created.json()) as { matterId: string }).matterId;

  // One rate card with an open timekeeper-tier rate, laid down through the real rate write path.
  const card = await createRateCard(
    env.DB_FIRM_POOL_1,
    { name: "Standard" },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(env.DB_FIRM_POOL_1, card.effect, { now: clock.now });
  rateCardId = card.rateCardId;
  const rate = await appendRate(
    env.DB_FIRM_POOL_1,
    {
      rateCardId: card.rateCardId,
      tier: "timekeeper",
      scopedId: ownerUserId,
      rateE4: 3_000_000, // $300.00/hour
      currency: "USD",
      validFrom: "2026-01-01",
    },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(env.DB_FIRM_POOL_1, rate.effect, { now: clock.now });
});

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}
async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function patch(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(cookie, true),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

describe("time-entry capture", () => {
  it("resolves the rate, rounds the duration, and commits a billable WIP entry", async () => {
    const response = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 38, // rounds up to 42 at the 6-minute default increment, nearest
      narrative: "Drafted demand letter",
      billable: true,
      source: "manual",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { timeEntryId: string };
    expect(body.timeEntryId).toMatch(/^timeEntry_/);

    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT duration_minutes, raw_duration_minutes, rate_e4, rate_source, amount_minor, currency, status FROM time_entry WHERE id = ?1",
    )
      .bind(body.timeEntryId)
      .first<{
        duration_minutes: number;
        raw_duration_minutes: number;
        rate_e4: number;
        rate_source: string;
        amount_minor: number;
        currency: string;
        status: string;
      }>();
    expect(row).not.toBeNull();
    expect(row?.raw_duration_minutes).toBe(38);
    expect(row?.duration_minutes).toBe(36); // 38 -> nearest 6-minute increment
    expect(row?.rate_e4).toBe(3_000_000);
    expect(row?.rate_source).toBe("timekeeper");
    expect(row?.amount_minor).toBe(18_000); // round(300.00 * 36/60) = $180.00
    expect(row?.currency).toBe("USD");
    expect(row?.status).toBe("draft");
  });

  it("captures a non-billable entry with no rate and a category", async () => {
    const categoryId = newIdentifier("nonBillableCategory");
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO non_billable_category (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
    )
      .bind(categoryId, "Administrative", new Date().toISOString())
      .run();
    const response = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 30,
      narrative: "Internal file admin",
      billable: false,
      nonBillableCategoryId: categoryId,
      source: "manual",
    });
    expect(response.status).toBe(201);
    const id = ((await response.json()) as { timeEntryId: string }).timeEntryId;
    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT rate_e4, amount_minor, rate_source, non_billable_category_id FROM time_entry WHERE id = ?1",
    )
      .bind(id)
      .first<{
        rate_e4: number | null;
        amount_minor: number | null;
        rate_source: string | null;
        non_billable_category_id: string | null;
      }>();
    expect(row?.rate_e4).toBeNull();
    expect(row?.amount_minor).toBeNull();
    expect(row?.rate_source).toBeNull();
    expect(row?.non_billable_category_id).toBe(categoryId);
  });
});

describe("time-entry reads", () => {
  it("lists a timekeeper's entries for a work date (the My-Day shape) with real raw duration", async () => {
    const response = await get(
      `/api/v1/time-entries?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string; durationMinutes: number; rawDurationMinutes: number }[];
    };
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    // The first capture used rawDurationMinutes=38 which rounded to 36 at the 6-minute increment.
    // Verify at least one entry carries the stored raw value (38 ≠ 36) to confirm raw_duration_minutes
    // is selected at the query layer rather than falling back to the rounded value.
    const rounded = body.data.find((entry) => entry.rawDurationMinutes !== entry.durationMinutes);
    expect(rounded).toBeDefined();
    expect(rounded?.rawDurationMinutes).toBe(38);
    expect(rounded?.durationMinutes).toBe(36);
  });

  it("lists unbilled WIP per matter (the per-matter shape)", async () => {
    const response = await get(`/api/v1/time-entries?matterId=${matterId}&status=draft`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; matterId: string }[] };
    expect(body.data.every((entry) => entry.matterId === matterId)).toBe(true);
  });
});

describe("draft-only freeze and the review path", () => {
  it("refuses an update to a billed row (frozen-entry -> 409)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "To be billed",
      billable: true,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    // Move it to billed directly (the billing lock is wired in the billing slice).
    await env.DB_FIRM_POOL_1.prepare("UPDATE time_entry SET status = 'billed' WHERE id = ?1")
      .bind(id)
      .run();
    const response = await patch(`/api/v1/time-entries/${id}`, { narrative: "edited" });
    expect(response.status).toBe(409);
  });

  it("refuses an update to a submitted row (draft-only -> 409)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "Will be submitted",
      billable: true,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    // Move it to submitted directly without the gate on (simulates a DB state bypassing the gate).
    await env.DB_FIRM_POOL_1.prepare("UPDATE time_entry SET status = 'submitted' WHERE id = ?1")
      .bind(id)
      .run();
    const response = await patch(`/api/v1/time-entries/${id}`, { narrative: "edited" });
    expect(response.status).toBe(409);
  });

  it("refuses submit when the firm's approval gate is off (illegal-transition -> 409)", async () => {
    // The firm has not set time.approval_required, so the default (false) applies.
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 18,
      narrative: "Gate-off submit attempt",
      billable: true,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    const response = await post(`/api/v1/time-entries/${id}/submit`, {});
    expect(response.status).toBe(409);
  });

  it("walks the submit -> approve review path when the approval gate is on", async () => {
    // Enable the review gate for this firm so the submit->approve path is legal.
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind("time.approval_required", "true", new Date().toISOString())
      .run();

    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 18,
      narrative: "Reviewable",
      billable: true,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    // A timekeeper with time:track can submit their own draft.
    expect((await post(`/api/v1/time-entries/${id}/submit`, {})).status).toBe(200);
    // An approver with time:approve completes the review.
    expect((await post(`/api/v1/time-entries/${id}/approve`, {})).status).toBe(200);
    const row = await env.DB_FIRM_POOL_1.prepare("SELECT status FROM time_entry WHERE id = ?1")
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe("approved");

    // Restore the gate to off so other tests that rely on the gate-off default are not surprised.
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind("time.approval_required", "false", new Date().toISOString())
      .run();
  });

  it("returns 404 (not 200) for a non-existent entry and writes no audit row", async () => {
    const phantomId = "timeEntry_000000000000000000000"; // valid shape; no such row
    const auditBefore = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM audit_log",
    ).first<{ c: number }>();
    const response = await post(`/api/v1/time-entries/${phantomId}/submit`, {});
    expect(response.status).toBe(404);
    const auditAfter = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM audit_log",
    ).first<{ c: number }>();
    // No phantom audit row must have been written for a non-existent entry.
    expect(auditAfter?.c).toBe(auditBefore?.c);
  });
});

describe("quick-add preview is read-shaped", () => {
  it("returns parsed candidates and writes nothing", async () => {
    const before = await env.DB_FIRM_POOL_1.prepare("SELECT COUNT(*) AS c FROM time_entry").first<{
      c: number;
    }>();
    const response = await post("/api/v1/time-entries/quick-add-preview", {
      text: "0.5 Smith — drafted demand letter",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      durationMinutes: number;
      matterHint: string | null;
      narrative: string;
      candidates: { id: string; title: string }[];
    };
    expect(body.durationMinutes).toBe(30);
    expect(body.matterHint).toBe("Smith");
    expect(body.narrative).toBe("drafted demand letter");
    expect(body.candidates.some((c) => c.id === matterId)).toBe(true);
    const after = await env.DB_FIRM_POOL_1.prepare("SELECT COUNT(*) AS c FROM time_entry").first<{
      c: number;
    }>();
    expect(after?.c).toBe(before?.c);
  });
});

describe("idempotency and permission", () => {
  it("replays a create under the same Idempotency-Key (no second entry)", async () => {
    const key = crypto.randomUUID();
    const body = {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 6,
      narrative: "Idempotent",
      billable: true,
      source: "manual",
    };
    const headers = {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": key,
    };
    const first = await SELF.fetch("https://example.com/api/v1/time-entries", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { timeEntryId: string }).timeEntryId;
    const replay = await SELF.fetch("https://example.com/api/v1/time-entries", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(((await replay.json()) as { timeEntryId: string }).timeEntryId).toBe(firstId);
  });

  it("refuses a Read-only member the time:track capability (403)", async () => {
    const response = await post(
      "/api/v1/time-entries",
      {
        matterId,
        timekeeperUserId: ownerUserId,
        workDate: "2026-06-22",
        rawDurationMinutes: 6,
        narrative: "Denied",
        billable: true,
        source: "manual",
      },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});

// Fix 1: My-Day list view self-scope — a timekeeper may only list their own daily entries
// without time:viewFirm.
describe("list self-scope authorization (My-Day shape)", () => {
  it("allows a timekeeper to list their own daily entries (self read -> 200)", async () => {
    const response = await get(
      `/api/v1/time-entries?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
    );
    expect(response.status).toBe(200);
  });

  it("refuses a time:track-only user reading another timekeeper's daily entries (403)", async () => {
    // trackOnlyUserId has time:track but not time:viewFirm; they cannot see ownerUserId's entries.
    const response = await get(
      `/api/v1/time-entries?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
      trackOnlyCookie,
    );
    expect(response.status).toBe(403);
  });

  it("allows an Owner/Admin (time:viewFirm holder) to list another timekeeper's daily entries (200)", async () => {
    // ownerCookie belongs to the Owner/Admin who holds time:viewFirm via their role.
    const response = await get(
      `/api/v1/time-entries?timekeeperUserId=${trackOnlyUserId}&workDate=2026-06-22`,
      ownerCookie,
    );
    expect(response.status).toBe(200);
  });
});

// Fix 2: Mutations self-scoped — create and gridBatch refuse a foreign timekeeperUserId;
// update/submit/void refuse a non-owned entry.
describe("create self-scope authorization", () => {
  it("refuses capturing an entry for another timekeeper (403)", async () => {
    // trackOnlyCookie user tries to create an entry with ownerUserId as the timekeeper.
    const response = await post(
      "/api/v1/time-entries",
      {
        matterId,
        timekeeperUserId: ownerUserId,
        workDate: "2026-06-22",
        rawDurationMinutes: 12,
        narrative: "Illegal capture",
        billable: false,
        source: "manual",
      },
      trackOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});

describe("update/submit/void ownership guard", () => {
  it("refuses a second user from updating the owner's entry (404 — no existence leak)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "Owner entry",
      billable: false,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    // trackOnlyCookie user does not own this entry — must see 404, not 403.
    const response = await patch(
      `/api/v1/time-entries/${id}`,
      { narrative: "stolen edit" },
      trackOnlyCookie,
    );
    expect(response.status).toBe(404);
  });

  it("refuses a second user from submitting the owner's entry (404)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "Owner submit target",
      billable: false,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    const response = await post(`/api/v1/time-entries/${id}/submit`, {}, trackOnlyCookie);
    expect(response.status).toBe(404);
  });

  it("refuses a second user from voiding the owner's entry (404)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "Owner void target",
      billable: false,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    const response = await post(`/api/v1/time-entries/${id}/void`, {}, trackOnlyCookie);
    expect(response.status).toBe(404);
  });

  it("allows the owner to update their own entry (200)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "Original narrative",
      billable: false,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    const response = await patch(`/api/v1/time-entries/${id}`, { narrative: "Revised narrative" });
    expect(response.status).toBe(200);
  });
});

// Fix 3: Zero-duration guard — a raw duration shorter than the rounding increment with direction
// 'down' produces 0 minutes after rounding, which must be refused before writing.
describe("zero-duration guard", () => {
  it("returns 422 and writes no row when the rounded duration is 0 (sub-increment with direction down)", async () => {
    // Write the scoped settings at firm tier (scoped_id NULL). The value column stores JSON, so a
    // string enum is stored with its surrounding quotes; a number is stored without.
    const now = new Date().toISOString();
    await env.DB_FIRM_POOL_1.prepare(
      "DELETE FROM scoped_setting WHERE key IN ('time.increment_minutes','time.rounding_direction')",
    ).run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO scoped_setting (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, 'firm', NULL, ?2, ?3)",
    )
      .bind("time.increment_minutes", "6", now)
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO scoped_setting (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, 'firm', NULL, ?2, ?3)",
    )
      .bind("time.rounding_direction", '"down"', now)
      .run();

    const before = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM time_entry WHERE raw_duration_minutes = 5 AND narrative = 'Sub-increment test'",
    ).first<{ c: number }>();

    const response = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 5,
      narrative: "Sub-increment test",
      billable: true,
      source: "manual",
    });
    expect(response.status).toBe(422);

    const after = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM time_entry WHERE raw_duration_minutes = 5 AND narrative = 'Sub-increment test'",
    ).first<{ c: number }>();
    expect(after?.c).toBe(before?.c ?? 0);

    // Restore defaults so other tests are not affected by the per-firm rounding override.
    await env.DB_FIRM_POOL_1.prepare(
      "DELETE FROM scoped_setting WHERE key IN ('time.increment_minutes','time.rounding_direction')",
    ).run();
  });
});

// Fix 4: Patching workDate re-resolves the rate for the new date.
describe("workDate patch with rate re-resolution", () => {
  it("patching workDate re-resolves the rate snapshot for the new date", async () => {
    // Append a second rate version effective from 2026-07-01 at a different rateE4.
    const laterRate = await appendRate(
      env.DB_FIRM_POOL_1,
      {
        rateCardId,
        tier: "timekeeper",
        scopedId: ownerUserId,
        rateE4: 4_000_000, // $400.00/hour — higher than the $300/hr rate valid before 2026-07-01
        currency: "USD",
        validFrom: "2026-07-01",
      },
      { clock, actorUserId: ownerUserId },
    );
    await commitEffectBatch(env.DB_FIRM_POOL_1, laterRate.effect, { now: clock.now });

    // Create a draft on 2026-06-22, which resolves at $300/hr (3_000_000 rate_e4).
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 60,
      narrative: "Entry before date correction",
      billable: true,
      source: "manual",
      rateCardId,
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;

    const before = await env.DB_FIRM_POOL_1.prepare(
      "SELECT work_date, rate_e4, amount_minor FROM time_entry WHERE id = ?1",
    )
      .bind(id)
      .first<{ work_date: string; rate_e4: number; amount_minor: number }>();
    expect(before?.work_date).toBe("2026-06-22");
    expect(before?.rate_e4).toBe(3_000_000);

    // Patch the workDate to 2026-07-01 — the handler must re-resolve to $400/hr.
    const patchResponse = await patch(`/api/v1/time-entries/${id}`, { workDate: "2026-07-01" });
    expect(patchResponse.status).toBe(200);

    const after = await env.DB_FIRM_POOL_1.prepare(
      "SELECT work_date, rate_e4, amount_minor FROM time_entry WHERE id = ?1",
    )
      .bind(id)
      .first<{ work_date: string; rate_e4: number; amount_minor: number }>();
    expect(after?.work_date).toBe("2026-07-01");
    expect(after?.rate_e4).toBe(4_000_000);
    // 60 minutes at $400/hr = $400.00 = 40_000 minor units.
    expect(after?.amount_minor).toBe(40_000);
  });
});

// Fix 6: void, kickBack, and gridBatch route coverage.
describe("void", () => {
  it("voids a draft entry (draft -> void)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "To void",
      billable: false,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    const response = await post(`/api/v1/time-entries/${id}/void`, {});
    expect(response.status).toBe(200);
    const row = await env.DB_FIRM_POOL_1.prepare("SELECT status FROM time_entry WHERE id = ?1")
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe("void");
  });

  it("refuses to void a billed (frozen) entry (frozen-entry -> 409)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "Billed entry",
      billable: false,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    await env.DB_FIRM_POOL_1.prepare("UPDATE time_entry SET status = 'billed' WHERE id = ?1")
      .bind(id)
      .run();
    const response = await post(`/api/v1/time-entries/${id}/void`, {});
    expect(response.status).toBe(409);
  });
});

describe("kickBack", () => {
  it("kicks back a submitted entry and sets the kick_back_reason", async () => {
    // Enable the approval gate so submit->kickBack is legal.
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind("time.approval_required", "true", new Date().toISOString())
      .run();

    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "Kick me back",
      billable: false,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    expect((await post(`/api/v1/time-entries/${id}/submit`, {})).status).toBe(200);

    const kickResponse = await post(`/api/v1/time-entries/${id}/kick-back`, {
      reason: "wrong matter code",
    });
    expect(kickResponse.status).toBe(200);

    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status, kick_back_reason FROM time_entry WHERE id = ?1",
    )
      .bind(id)
      .first<{ status: string; kick_back_reason: string | null }>();
    expect(row?.status).toBe("draft");
    expect(row?.kick_back_reason).toBe("wrong matter code");

    // Restore gate off.
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind("time.approval_required", "false", new Date().toISOString())
      .run();
  });

  it("refuses kickBack for a user without time:approve (403)", async () => {
    // Set a submitted entry directly in the DB.
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-22",
      rawDurationMinutes: 12,
      narrative: "No approve test",
      billable: false,
      source: "manual",
    });
    const id = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    await env.DB_FIRM_POOL_1.prepare("UPDATE time_entry SET status = 'submitted' WHERE id = ?1")
      .bind(id)
      .run();
    // trackOnlyCookie only has time:track, not time:approve — the chokepoint blocks at 403.
    const response = await post(
      `/api/v1/time-entries/${id}/kick-back`,
      { reason: "not allowed" },
      trackOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});

describe("gridBatch", () => {
  it("captures a two-entry batch with correct rate snapshots", async () => {
    const response = await post("/api/v1/time-entries/grid-batch", {
      entries: [
        {
          matterId,
          timekeeperUserId: ownerUserId,
          workDate: "2026-06-22",
          rawDurationMinutes: 30,
          narrative: "Grid entry A",
          billable: true,
          source: "grid",
          rateCardId,
        },
        {
          matterId,
          timekeeperUserId: ownerUserId,
          workDate: "2026-06-22",
          rawDurationMinutes: 60,
          narrative: "Grid entry B",
          billable: true,
          source: "grid",
          rateCardId,
        },
      ],
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { timeEntryIds: string[] };
    expect(body.timeEntryIds).toHaveLength(2);
    for (const timeEntryId of body.timeEntryIds) {
      const row = await env.DB_FIRM_POOL_1.prepare(
        "SELECT rate_e4, amount_minor FROM time_entry WHERE id = ?1",
      )
        .bind(timeEntryId)
        .first<{ rate_e4: number; amount_minor: number }>();
      expect(row?.rate_e4).toBe(3_000_000); // $300/hr, valid from 2026-01-01
      expect(row?.amount_minor).toBeGreaterThan(0);
    }
  });

  it("rejects a batch entry missing a UTBMS code on an e-billing matter (422)", async () => {
    // Create a new e-billing matter.
    const eMatter = await SELF.fetch("https://example.com/api/v1/matters", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        title: "E-Billing Matter",
        status: "open",
        responsibleMemberId: ownerUserId,
      }),
    });
    const eMatterId = ((await eMatter.json()) as { matterId: string }).matterId;
    await env.DB_FIRM_POOL_1.prepare("UPDATE matter SET e_billing = 1 WHERE id = ?1")
      .bind(eMatterId)
      .run();

    const response = await post("/api/v1/time-entries/grid-batch", {
      entries: [
        {
          matterId: eMatterId,
          timekeeperUserId: ownerUserId,
          workDate: "2026-06-22",
          rawDurationMinutes: 30,
          narrative: "E-billing without UTBMS",
          billable: true,
          source: "grid",
        },
      ],
    });
    expect(response.status).toBe(422);
  });

  it("refuses gridBatch for a user without time:track (403)", async () => {
    const response = await post(
      "/api/v1/time-entries/grid-batch",
      {
        entries: [
          {
            matterId,
            timekeeperUserId: ownerUserId,
            workDate: "2026-06-22",
            rawDurationMinutes: 30,
            narrative: "Read-only attempt",
            billable: false,
            source: "grid",
          },
        ],
      },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});
