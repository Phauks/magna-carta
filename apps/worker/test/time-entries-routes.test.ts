import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
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
// list shapes; the draft-only freeze refusal; the submit -> approve review path under the gate; the
// read-shaped quick-add preview that writes nothing; and an idempotent replay of a create.

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;
let matterId: string;

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
  it("lists a timekeeper's entries for a work date (the My-Day shape)", async () => {
    const response = await get(
      `/api/v1/time-entries?timekeeperUserId=${ownerUserId}&workDate=2026-06-22`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; durationMinutes: number }[] };
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("lists unbilled WIP per matter (the per-matter shape)", async () => {
    const response = await get(`/api/v1/time-entries?matterId=${matterId}&status=draft`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; matterId: string }[] };
    expect(body.data.every((entry) => entry.matterId === matterId)).toBe(true);
  });
});

describe("draft-only freeze and the review path", () => {
  it("refuses an update to a billed row (409)", async () => {
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
    // Move it to billed directly (the 3·4 billing-lock seam this slice leaves to billing).
    await env.DB_FIRM_POOL_1.prepare("UPDATE time_entry SET status = 'billed' WHERE id = ?1")
      .bind(id)
      .run();
    const response = await patch(`/api/v1/time-entries/${id}`, { narrative: "edited" });
    expect(response.status).toBe(409);
  });

  it("walks the submit -> approve review path", async () => {
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
    expect((await post(`/api/v1/time-entries/${id}/submit`, {})).status).toBe(200);
    expect((await post(`/api/v1/time-entries/${id}/approve`, {})).status).toBe(200);
    const row = await env.DB_FIRM_POOL_1.prepare("SELECT status FROM time_entry WHERE id = ?1")
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe("approved");
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
