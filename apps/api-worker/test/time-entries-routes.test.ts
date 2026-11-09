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
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
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
  const role = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .first<{ id: string }>();
  if (role === null) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
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
  await insertMemberStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  const now = new Date().toISOString();
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, permission, now)
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
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
  await mirrorMemberWithOwnerRole(owner.userId, "Time Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("time-owner@example.com");

  const readOnly = await seedCredentialedUser("time-readonly@example.com", {
    userName: "Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("time-readonly@example.com");

  // A user with time:track only (direct grant, no role) — used for self-scope and lifecycle tests.
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
    firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
    { name: "Standard" },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), card.effect, {
    now: clock.now,
  });
  rateCardId = card.rateCardId;
  const rate = await appendRate(
    firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
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
  await commitEffectBatch(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), rate.effect, {
    now: clock.now,
  });
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

    const row = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
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
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
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
    const row = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
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

  it("answers with EVERY status when the listing names none, not the drafts alone", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-06-24",
      rawDurationMinutes: 30,
      narrative: "Already invoiced",
      billable: true,
      source: "manual",
    });
    const billedId = ((await created.json()) as { timeEntryId: string }).timeEntryId;
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE time_entry SET status = 'billed' WHERE id = ?1")
      .bind(billedId)
      .run();

    const narrowed = await get(`/api/v1/time-entries?matterId=${matterId}&status=draft`);
    const narrowedBody = (await narrowed.json()) as { data: { id: string }[] };
    expect(narrowedBody.data.some((entry) => entry.id === billedId)).toBe(false);

    // The matter's time record is all of the time on it. Omitting the status used to answer with
    // the drafts alone, so an invoiced entry vanished from the matter it was worked on.
    const whole = await get(`/api/v1/time-entries?matterId=${matterId}`);
    expect(whole.status).toBe(200);
    const wholeBody = (await whole.json()) as {
      data: { id: string; status: string; timekeeperName?: string | null }[];
    };
    expect(wholeBody.data.some((entry) => entry.id === billedId)).toBe(true);
    expect(wholeBody.data.length).toBeGreaterThan(narrowedBody.data.length);

    // The timekeeper is a column on this screen, so the listing resolves the name beside the id.
    const billed = wholeBody.data.find((entry) => entry.id === billedId);
    expect(billed?.status).toBe("billed");
    expect(billed?.timekeeperName).not.toBeNull();
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
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE time_entry SET status = 'billed' WHERE id = ?1")
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
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE time_entry SET status = 'submitted' WHERE id = ?1")
      .bind(id)
      .run();
    const response = await patch(`/api/v1/time-entries/${id}`, { narrative: "edited" });
    expect(response.status).toBe(409);
  });

  it("refuses submit when the firm's approval gate is off (illegal-transition -> 409)", async () => {
    // The firm has not set billing.approval_required, so the default (false) applies.
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
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind("billing.approval_required", "true", new Date().toISOString())
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
    const row = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT status FROM time_entry WHERE id = ?1")
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe("approved");

    // Restore the gate to off so other tests that rely on the gate-off default are not surprised.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind("billing.approval_required", "false", new Date().toISOString())
      .run();
  });

  it("returns 404 (not 200) for a non-existent entry and writes no audit row", async () => {
    const phantomId = "timeEntry_000000000000000000000"; // valid shape; no such row
    const auditBefore = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS c FROM audit_log")
      .first<{ c: number }>();
    const response = await post(`/api/v1/time-entries/${phantomId}/submit`, {});
    expect(response.status).toBe(404);
    const auditAfter = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS c FROM audit_log")
      .first<{ c: number }>();
    // No phantom audit row must have been written for a non-existent entry.
    expect(auditAfter?.c).toBe(auditBefore?.c);
  });
});

describe("quick-add preview is read-shaped", () => {
  it("returns parsed candidates and writes nothing", async () => {
    const before = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS c FROM time_entry")
      .first<{
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
    const after = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS c FROM time_entry")
      .first<{
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

// My-Day list view self-scope — a timekeeper may only list their own daily entries
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

  it("allows an Admin (time:viewFirm holder) to list another timekeeper's daily entries (200)", async () => {
    // ownerCookie belongs to the Admin who holds time:viewFirm via their role.
    const response = await get(
      `/api/v1/time-entries?timekeeperUserId=${trackOnlyUserId}&workDate=2026-06-22`,
      ownerCookie,
    );
    expect(response.status).toBe(200);
  });
});

// Mutations self-scoped — create and gridBatch refuse a foreign timekeeperUserId;
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

// Zero-duration guard — a raw duration shorter than the rounding increment with direction
// 'down' produces 0 minutes after rounding, which must be refused before writing.
describe("zero-duration guard", () => {
  it("returns 422 and writes no row when the rounded duration is 0 (sub-increment with direction down)", async () => {
    // Write the scoped settings at firm tier (scoped_id NULL). The value column stores JSON, so a
    // string enum is stored with its surrounding quotes; a number is stored without.
    const now = new Date().toISOString();
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "DELETE FROM scoped_setting WHERE key IN ('time.increment_minutes','time.rounding_direction')",
      )
      .run();
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO scoped_setting (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, 'firm', NULL, ?2, ?3)",
      )
      .bind("time.increment_minutes", "6", now)
      .run();
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO scoped_setting (key, scope_tier, scoped_id, value, updated_at) VALUES (?1, 'firm', NULL, ?2, ?3)",
      )
      .bind("time.rounding_direction", '"down"', now)
      .run();

    const before = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT COUNT(*) AS c FROM time_entry WHERE raw_duration_minutes = 5 AND narrative = 'Sub-increment test'",
      )
      .first<{ c: number }>();

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

    const after = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT COUNT(*) AS c FROM time_entry WHERE raw_duration_minutes = 5 AND narrative = 'Sub-increment test'",
      )
      .first<{ c: number }>();
    expect(after?.c).toBe(before?.c ?? 0);

    // Restore defaults so other tests are not affected by the per-firm rounding override.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "DELETE FROM scoped_setting WHERE key IN ('time.increment_minutes','time.rounding_direction')",
      )
      .run();
  });
});

// Patching workDate re-resolves the rate for the new date.
describe("workDate patch with rate re-resolution", () => {
  it("patching workDate re-resolves the rate snapshot for the new date", async () => {
    // Append a second rate version effective from 2026-07-01 at a different rateE4.
    const laterRate = await appendRate(
      firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
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
    await commitEffectBatch(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), laterRate.effect, {
      now: clock.now,
    });

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

    const before = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT work_date, rate_e4, amount_minor FROM time_entry WHERE id = ?1")
      .bind(id)
      .first<{ work_date: string; rate_e4: number; amount_minor: number }>();
    expect(before?.work_date).toBe("2026-06-22");
    expect(before?.rate_e4).toBe(3_000_000);

    // Patch the workDate to 2026-07-01 — the handler must re-resolve to $400/hr.
    const patchResponse = await patch(`/api/v1/time-entries/${id}`, { workDate: "2026-07-01" });
    expect(patchResponse.status).toBe(200);

    const after = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT work_date, rate_e4, amount_minor FROM time_entry WHERE id = ?1")
      .bind(id)
      .first<{ work_date: string; rate_e4: number; amount_minor: number }>();
    expect(after?.work_date).toBe("2026-07-01");
    expect(after?.rate_e4).toBe(4_000_000);
    // 60 minutes at $400/hr = $400.00 = 40_000 minor units.
    expect(after?.amount_minor).toBe(40_000);
  });
});

// void, kickBack, and gridBatch route coverage.
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
    const row = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT status FROM time_entry WHERE id = ?1")
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
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE time_entry SET status = 'billed' WHERE id = ?1")
      .bind(id)
      .run();
    const response = await post(`/api/v1/time-entries/${id}/void`, {});
    expect(response.status).toBe(409);
  });
});

describe("kickBack", () => {
  it("kicks back a submitted entry and sets the kick_back_reason", async () => {
    // Enable the approval gate so submit->kickBack is legal.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind("billing.approval_required", "true", new Date().toISOString())
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

    const row = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT status, kick_back_reason FROM time_entry WHERE id = ?1")
      .bind(id)
      .first<{ status: string; kick_back_reason: string | null }>();
    expect(row?.status).toBe("draft");
    expect(row?.kick_back_reason).toBe("wrong matter code");

    // Restore gate off.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind("billing.approval_required", "false", new Date().toISOString())
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
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE time_entry SET status = 'submitted' WHERE id = ?1")
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
      const row = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
        .prepare("SELECT rate_e4, amount_minor FROM time_entry WHERE id = ?1")
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
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE matter SET e_billing = 1 WHERE id = ?1")
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

describe("the matter time listing", () => {
  it("pages a matter whose time record does not fit one response, losing and repeating nothing", async () => {
    // The listing carried no LIMIT at all: a matter that had been billing for years answered with
    // every entry on it in one response. All entries here share a work date on purpose, so the
    // cursor is proved over the identifier tiebreak rather than over a date that happens to differ.
    //
    // Seeded through the database rather than the capture route: fifty-five writes through the API
    // exhaust this firm's request budget and starve whatever runs next. The read is what is under
    // test; the capture path is exercised by its own cases above.
    const created = await post("/api/v1/matters", {
      title: "Time Paging Matter",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    expect(created.status).toBe(201);
    const paged = ((await created.json()) as { matterId: string }).matterId;

    const database = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
    const expected: string[] = [];
    for (let index = 0; index < 55; index += 1) {
      const id = newIdentifier("timeEntry");
      expected.push(id);
      await database
        .prepare(
          `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes,
             raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status,
             source, created_at, updated_at)
           VALUES (?1, ?2, ?3, '2026-07-02', 60, 60, ?4, 1, 'USD', 0, 0, 'draft', 'manual', ?5, ?5)`,
        )
        .bind(
          id,
          paged,
          ownerUserId,
          `Drafting session ${String(index)}`,
          "2026-07-02T00:00:00.000Z",
        )
        .run();
    }

    const first = await get(`/api/v1/time-entries?matterId=${paged}`);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { data: { id: string }[]; nextCursor: string | null };
    expect(firstBody.data).toHaveLength(50);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await get(
      `/api/v1/time-entries?matterId=${paged}&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
    );
    const secondBody = (await second.json()) as {
      data: { id: string }[];
      nextCursor: string | null;
    };
    expect(secondBody.data).toHaveLength(5);
    expect(secondBody.nextCursor).toBeNull();

    const seen = [...firstBody.data, ...secondBody.data].map((entry) => entry.id);
    expect(new Set(seen).size).toBe(55);
    expect([...seen].sort()).toEqual([...expected].sort());
  });

  it("answers the daily view as a complete page rather than an open cursor", async () => {
    // One timekeeper on one date is a complete answer by construction. The envelope is uniform, so
    // the cursor is explicitly null rather than absent.
    const listed = await get(
      `/api/v1/time-entries?timekeeperUserId=${ownerUserId}&workDate=2026-07-02`,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body.nextCursor).toBeNull();
  });
});

// The record surfaces: the widened summary, the internal memo, the matter-scoped entry number,
// the event history, attachments, and convert-to-cost.

describe("the widened entry record", () => {
  it("serves rate, coding, enterer, entered date, memo and entry number on create + get + list", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      // A June date, before the second rate version other tests append — the assertion below pins
      // the ORIGINAL $300 rate snapshot.
      workDate: "2026-06-25",
      rawDurationMinutes: 30,
      narrative: "Reviewed discovery responses",
      billable: true,
      source: "manual",
      memo: "waiting on opposing counsel",
    });
    expect(created.status).toBe(201);
    const ack = (await created.json()) as { timeEntryId: string; entryNumber?: string };
    // The matter drew its number from the TK- scheme, so the entry number is prefixed by it.
    expect(ack.entryNumber).toMatch(/^TK-\d{4}\.\d{4}$/);

    const detail = await get(`/api/v1/time-entries/${ack.timeEntryId}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: ack.timeEntryId,
      entryNumber: ack.entryNumber,
      memo: "waiting on opposing counsel",
      rateE4: 3_000_000,
      rateSource: "timekeeper",
      rateCardId,
      invoiceId: null,
      source: "manual",
      createdByUserId: ownerUserId,
      createdByName: "Time Owner",
      timekeeperName: "Time Owner",
      attachmentCount: 0,
    });
    expect(typeof body["createdAt"]).toBe("string");

    const listed = await get(`/api/v1/time-entries?matterId=${matterId}`);
    const listBody = (await listed.json()) as {
      data: { id: string; entryNumber: string | null; createdByName: string | null }[];
    };
    const listedEntry = listBody.data.find((entry) => entry.id === ack.timeEntryId);
    expect(listedEntry).toMatchObject({
      entryNumber: ack.entryNumber,
      createdByName: "Time Owner",
    });
  });

  it("draws consecutive matter-scoped numbers, and a void keeps its number", async () => {
    const first = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-07-11",
      rawDurationMinutes: 12,
      narrative: "call",
      billable: true,
      source: "manual",
    });
    const second = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-07-11",
      rawDurationMinutes: 12,
      narrative: "call",
      billable: true,
      source: "manual",
    });
    const firstAck = (await first.json()) as { timeEntryId: string; entryNumber?: string };
    const secondAck = (await second.json()) as { timeEntryId: string; entryNumber?: string };
    const sequence = (number: string | undefined) => Number(number?.split(".")[1]);
    expect(sequence(secondAck.entryNumber)).toBe(sequence(firstAck.entryNumber) + 1);

    const voided = await post(`/api/v1/time-entries/${firstAck.timeEntryId}/void`, {});
    expect(voided.status).toBe(200);
    const detail = (await (await get(`/api/v1/time-entries/${firstAck.timeEntryId}`)).json()) as {
      entryNumber: string | null;
      status: string;
    };
    expect(detail.status).toBe("void");
    expect(detail.entryNumber).toBe(firstAck.entryNumber);
  });

  it("patches the memo (and clears it with null) without the text ever reaching the audit trail", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-07-12",
      rawDurationMinutes: 30,
      narrative: "Hearing prep",
      billable: true,
      source: "manual",
    });
    const { timeEntryId } = (await created.json()) as { timeEntryId: string };

    const patched = await patch(`/api/v1/time-entries/${timeEntryId}`, {
      memo: "the privileged internal note",
    });
    expect(patched.status).toBe(200);
    let detail = (await (await get(`/api/v1/time-entries/${timeEntryId}`)).json()) as {
      memo: string | null;
    };
    expect(detail.memo).toBe("the privileged internal note");

    // The audit trail records THAT the memo changed, never what it says.
    const { results: auditRows } = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT metadata FROM audit_log WHERE subject_id = ?1 AND event = 'time_entry.updated'",
      )
      .bind(timeEntryId)
      .all<{ metadata: string | null }>();
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    for (const auditRow of auditRows) {
      expect(auditRow.metadata ?? "").not.toContain("privileged internal note");
    }
    expect(auditRows[0]?.metadata).toContain("memo");

    const cleared = await patch(`/api/v1/time-entries/${timeEntryId}`, { memo: null });
    expect(cleared.status).toBe(200);
    detail = (await (await get(`/api/v1/time-entries/${timeEntryId}`)).json()) as {
      memo: string | null;
    };
    expect(detail.memo).toBeNull();
  });
});

describe("the event history", () => {
  it("serves the entry's recorded events oldest first with actors and redacted detail", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-07-13",
      rawDurationMinutes: 30,
      narrative: "Deposition outline",
      billable: true,
      source: "manual",
    });
    const { timeEntryId } = (await created.json()) as { timeEntryId: string };
    await patch(`/api/v1/time-entries/${timeEntryId}`, { narrative: "Deposition outline v2" });
    await post(`/api/v1/time-entries/${timeEntryId}/void`, {});

    const response = await get(`/api/v1/time-entries/${timeEntryId}/events`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        at: string;
        event: string;
        actorUserId: string | null;
        actorName: string | null;
        detail: unknown;
      }[];
    };
    expect(body.data.map((event) => event.event)).toEqual([
      "time_entry.captured",
      "time_entry.updated",
      "time_entry.voided",
    ]);
    expect(body.data[0]).toMatchObject({
      actorUserId: ownerUserId,
      actorName: "Time Owner",
      detail: { source: "manual" },
    });
    expect(body.data[1]?.detail).toEqual({ fields: ["narrative"] });
    // The voided event predates any richer metadata — an honest blank, not a fabricated one.
    expect(body.data[2]?.detail).toBeNull();
  });

  it("answers 404 for an unknown entry rather than an empty rail", async () => {
    const response = await get(`/api/v1/time-entries/${newIdentifier("timeEntry")}/events`);
    expect(response.status).toBe(404);
  });
});

describe("attachments", () => {
  async function seedMatterFile(fileMatterId: string, name: string): Promise<string> {
    const fileId = newIdentifier("file");
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO file (id, matter_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
      )
      .bind(fileId, fileMatterId, name, new Date().toISOString())
      .run();
    return fileId;
  }

  async function capture(): Promise<string> {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-07-14",
      rawDurationMinutes: 30,
      narrative: "Research memo drafting",
      billable: true,
      source: "manual",
    });
    return ((await created.json()) as { timeEntryId: string }).timeEntryId;
  }

  it("attaches one of the matter's files, serves it and the count, and detaches without deleting", async () => {
    const timeEntryId = await capture();
    const fileId = await seedMatterFile(matterId, "research-memo.pdf");

    const attached = await post(`/api/v1/time-entries/${timeEntryId}/attachments`, { fileId });
    expect(attached.status).toBe(200);

    const listed = await get(`/api/v1/time-entries/${timeEntryId}/attachments`);
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      data: { fileId: string; fileName: string | null; createdByName: string | null }[];
    };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]).toMatchObject({
      fileId,
      fileName: "research-memo.pdf",
      createdByName: "Time Owner",
    });
    const detail = (await (await get(`/api/v1/time-entries/${timeEntryId}`)).json()) as {
      attachmentCount: number;
    };
    expect(detail.attachmentCount).toBe(1);

    // A duplicate attach is a 409, not a second row.
    const duplicate = await post(`/api/v1/time-entries/${timeEntryId}/attachments`, { fileId });
    expect(duplicate.status).toBe(409);

    const detached = await post(`/api/v1/time-entries/${timeEntryId}/attachments/detach`, {
      fileId,
    });
    expect(detached.status).toBe(200);
    const relisted = (await (
      await get(`/api/v1/time-entries/${timeEntryId}/attachments`)
    ).json()) as {
      data: unknown[];
    };
    expect(relisted.data).toHaveLength(0);
    // Detach removed the LINK; the file stays in the matter.
    const fileRow = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT deleted_at FROM file WHERE id = ?1")
      .bind(fileId)
      .first<{ deleted_at: string | null }>();
    expect(fileRow).not.toBeNull();
    expect(fileRow?.deleted_at).toBeNull();

    // Both acts are on the entry's own history.
    const events = (await (await get(`/api/v1/time-entries/${timeEntryId}/events`)).json()) as {
      data: { event: string; detail: unknown }[];
    };
    expect(events.data.map((event) => event.event)).toContain("time_entry.file_attached");
    expect(events.data.map((event) => event.event)).toContain("time_entry.file_detached");
  });

  it("refuses a file that is not on the entry's matter (422)", async () => {
    const timeEntryId = await capture();
    // A second matter with its own file.
    const otherMatter = await post("/api/v1/matters", {
      title: "Other matter",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    const otherMatterId = ((await otherMatter.json()) as { matterId: string }).matterId;
    const foreignFileId = await seedMatterFile(otherMatterId, "foreign.pdf");

    const refused = await post(`/api/v1/time-entries/${timeEntryId}/attachments`, {
      fileId: foreignFileId,
    });
    expect(refused.status).toBe(422);
    // And detaching a link that does not exist is a 404.
    const missing = await post(`/api/v1/time-entries/${timeEntryId}/attachments/detach`, {
      fileId: foreignFileId,
    });
    expect(missing.status).toBe(404);
  });
});

describe("refiling a misfiled entry onto another matter", () => {
  /*
   * Time gets recorded against the wrong matter, and the remedy has to keep the record: its number,
   * its memo, its codes, its files and its history. The alternative — strike it and type it again —
   * loses all five and leaves a struck row on a matter the work was never really on.
   *
   * ONE destination matter for the whole block, made once. The suite shares a rate-limit budget, so
   * a describe that stands up a fresh matter per test spends the budget the later blocks need.
   */
  let destination: string;

  beforeAll(async () => {
    const created = await SELF.fetch("https://example.com/api/v1/matters", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        title: "Pemberton v. Hale",
        status: "open",
        responsibleMemberId: ownerUserId,
      }),
    });
    destination = ((await created.json()) as { matterId: string }).matterId;
  });

  async function captureDraft(memo?: string): Promise<{ id: string; entryNumber?: string }> {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-07-20",
      rawDurationMinutes: 30,
      narrative: "Filed on the wrong matter",
      billable: true,
      source: "manual",
      ...(memo === undefined ? {} : { memo }),
    });
    const ack = (await created.json()) as { timeEntryId: string; entryNumber?: string };
    return {
      id: ack.timeEntryId,
      ...(ack.entryNumber === undefined ? {} : { entryNumber: ack.entryNumber }),
    };
  }

  it("moves the entry, keeps what identifies it, and re-reads the rate on the new matter", async () => {
    const draft = await captureDraft("do not raise this on the call");
    const response = await post(`/api/v1/time-entries/${draft.id}/refile`, {
      matterId: destination,
    });
    expect(response.status).toBe(200);
    // The ack answers with what the entry NOW carries: the rate and the rounding are re-resolved
    // against the destination, so a caller that assumed only the matter moved would be showing the
    // wrong money. This firm has one card and a timekeeper-tier rate, so the destination resolves
    // the same figure — a firm with a matter- or client-tier rate on either end gets a different
    // one, which is the whole reason the move re-asks.
    const ack = (await response.json()) as { matterId: string; rateE4: number | null };
    expect(ack.matterId).toBe(destination);
    expect(ack.rateE4).not.toBeNull();

    const body = (await (await get(`/api/v1/time-entries/${draft.id}`)).json()) as Record<
      string,
      unknown
    >;
    expect(body["matterId"]).toBe(destination);
    // The ack tells the truth about the record: what it reported the entry now carries is what the
    // entry now carries. That the figure was RE-RESOLVED against the destination rather than
    // carried over is pinned in the service test, where two matters can be given different chains;
    // this firm has one card, so both ends of the move answer alike.
    expect(body["rateE4"]).toBe(ack.rateE4);
    // The entry number does NOT change: a reference that changes is a reference that lies, so its
    // prefix becomes provenance — it names the matter the entry was FIRST written on.
    expect(body["entryNumber"]).toBe(draft.entryNumber);
    expect(body["memo"]).toBe("do not raise this on the call");
    expect(body["narrative"]).toBe("Filed on the wrong matter");
    expect(body["status"]).toBe("draft");

    // And the move is legible afterwards, naming both ends.
    const events = await get(`/api/v1/time-entries/${draft.id}/events`);
    const history = (await events.json()) as { data: { event: string; detail: unknown }[] };
    const move = history.data.find((entry) => entry.event === "time_entry.refiled");
    expect(move?.detail).toMatchObject({ fromMatterId: matterId, toMatterId: destination });
  });

  it("refuses a matter this firm does not have, and the one it is already on", async () => {
    const draft = await captureDraft();
    const unknown = await post(`/api/v1/time-entries/${draft.id}/refile`, {
      matterId: newIdentifier("matter"),
    });
    expect(unknown.status).toBe(404);

    // Refusing rather than no-opping keeps the act's meaning: a move that moved nothing still
    // reported success.
    const sameMatter = await post(`/api/v1/time-entries/${draft.id}/refile`, { matterId });
    expect(sameMatter.status).toBe(422);
  });

  /*
   * Past draft the entry is evidence somebody is relying on, and the answer is a void and a fresh
   * record — never a move nobody can see.
   */
  it("refuses an entry that is no longer a draft", async () => {
    const draft = await captureDraft();
    await post(`/api/v1/time-entries/${draft.id}/void`, {});

    const response = await post(`/api/v1/time-entries/${draft.id}/refile`, {
      matterId: destination,
    });
    expect(response.status).toBe(409);
  });
});

describe("convert-to-cost", () => {
  async function captureBillable(): Promise<string> {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-07-15",
      rawDurationMinutes: 30,
      narrative: "Courier run billed as time by mistake",
      billable: true,
      source: "manual",
    });
    return ((await created.json()) as { timeEntryId: string }).timeEntryId;
  }

  it("creates the cost, voids the entry in the same act, and cross-references both audit trails", async () => {
    const timeEntryId = await captureBillable();
    const response = await post(`/api/v1/time-entries/${timeEntryId}/convert-to-cost`, {});
    expect(response.status).toBe(201);
    const ack = (await response.json()) as { costEntryId: string; timeEntryId: string };
    expect(ack.timeEntryId).toBe(timeEntryId);
    expect(ack.costEntryId).toMatch(/^costEntry_/);

    // The entry is void; its value lives on the cost now, never in both places.
    const entry = (await (await get(`/api/v1/time-entries/${timeEntryId}`)).json()) as {
      status: string;
      amountMinor: number | null;
    };
    expect(entry.status).toBe("void");

    const cost = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT matter_id, amount_minor, description, incurred_date, billable, status FROM cost_entry WHERE id = ?1",
      )
      .bind(ack.costEntryId)
      .first<{
        matter_id: string;
        amount_minor: number;
        description: string;
        incurred_date: string;
        billable: number;
        status: string;
      }>();
    expect(cost).toMatchObject({
      matter_id: matterId,
      amount_minor: entry.amountMinor ?? 15_000,
      description: "Courier run billed as time by mistake",
      incurred_date: "2026-07-15",
      billable: 1,
      status: "draft",
    });

    // Each record's audit trail names the other.
    const entryEvents = (await (
      await get(`/api/v1/time-entries/${timeEntryId}/events`)
    ).json()) as {
      data: { event: string; detail: unknown }[];
    };
    const conversion = entryEvents.data.find(
      (event) => event.event === "time_entry.converted_to_cost",
    );
    expect(conversion?.detail).toEqual({ costEntryId: ack.costEntryId });
    const costAudit = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "SELECT metadata FROM audit_log WHERE subject_id = ?1 AND event = 'cost_entry.converted_from_time_entry'",
      )
      .bind(ack.costEntryId)
      .first<{ metadata: string | null }>();
    expect(JSON.parse(costAudit?.metadata ?? "null")).toEqual({ timeEntryId });

    // Converting again refuses: the entry is void now.
    const again = await post(`/api/v1/time-entries/${timeEntryId}/convert-to-cost`, {});
    expect(again.status).toBe(409);
  });

  it("refuses an entry with no amount (422)", async () => {
    const created = await post("/api/v1/time-entries", {
      matterId,
      timekeeperUserId: ownerUserId,
      workDate: "2026-07-15",
      rawDurationMinutes: 30,
      narrative: "Internal admin",
      billable: false,
      source: "manual",
    });
    const { timeEntryId } = (await created.json()) as { timeEntryId: string };
    const response = await post(`/api/v1/time-entries/${timeEntryId}/convert-to-cost`, {});
    expect(response.status).toBe(422);
  });

  it("refuses an actor without costs:track (403) — time:track alone is not the cost gate", async () => {
    // trackOnly holds time:track by direct grant and nothing else, but may only convert an entry
    // they own; capture one as them first (self-scope), then convert without costs:track.
    const created = await post(
      "/api/v1/time-entries",
      {
        matterId,
        timekeeperUserId: trackOnlyUserId,
        workDate: "2026-07-15",
        rawDurationMinutes: 30,
        narrative: "Their own entry",
        billable: true,
        source: "manual",
      },
      trackOnlyCookie,
    );
    const { timeEntryId } = (await created.json()) as { timeEntryId: string };
    const response = await post(
      `/api/v1/time-entries/${timeEntryId}/convert-to-cost`,
      {},
      trackOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});
