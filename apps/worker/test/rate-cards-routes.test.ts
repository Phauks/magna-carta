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
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Rate card routes: the HTTP surface for creating rate cards, appending effective-dated rate lines,
// re-rating unbilled drafts, and listing active cards. Overlap validation (overlapping-valid-from)
// maps to 422; an idempotent replay of a card create returns the original rateCardId; a Read-only
// member cannot POST (403). Rate amounts are stored as rateE4 (integer × 10^-4 of the currency
// unit) for exact arithmetic.

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;
let ownerUserId: UserId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (
    await seedFirm({ name: "Rate Card Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("rc-owner@example.com", {
    userName: "RC Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "RC Owner");
  ownerCookie = await signInForSessionCookie("rc-owner@example.com");

  const readOnly = await seedCredentialedUser("rc-readonly@example.com", {
    userName: "RC Read Only",
    firmId: poolFirmId,
  });
  const role = await env.DB_FIRM_POOL_1.prepare("SELECT id FROM role WHERE name = ?1")
    .bind("Read-only")
    .first<{ id: string }>();
  await insertMemberStatement(env.DB_FIRM_POOL_1, {
    userId: readOnly.userId,
    displayName: "RC Read Only",
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(env.DB_FIRM_POOL_1, {
    id: newIdentifier("memberRole"),
    memberUserId: readOnly.userId,
    roleId: assertIdentifier(role!.id, "role"),
  }).run();
  readOnlyCookie = await signInForSessionCookie("rc-readonly@example.com");
});

function writeHeaders(cookie: string): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    "Idempotency-Key": crypto.randomUUID(),
  };
}
function readHeaders(cookie: string): HeadersInit {
  return { origin: "https://example.com", cookie };
}

async function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: writeHeaders(cookie),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: readHeaders(cookie) });
}

describe("rate card lifecycle", () => {
  it("creates a rate card, appends a rate, lists it, and re-rates drafts", async () => {
    // Create the card
    const cardResponse = await post("/api/v1/rate-cards", { name: "Standard 2026" });
    expect(cardResponse.status).toBe(201);
    const { rateCardId } = (await cardResponse.json()) as { rateCardId: string };
    expect(rateCardId).toMatch(/^rateCard_/);

    // List it
    const listResponse = await get("/api/v1/rate-cards");
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { data: { id: string; name: string }[] };
    expect(list.data.some((card) => card.id === rateCardId)).toBe(true);

    // Append a rate
    const rateResponse = await post(`/api/v1/rate-cards/${rateCardId}/rates`, {
      tier: "timekeeper",
      scopedId: ownerUserId,
      rateE4: 2_500_000, // $250/hr
      currency: "USD",
      validFrom: "2026-01-01",
    });
    expect(rateResponse.status).toBe(201);
    const { rateId } = (await rateResponse.json()) as { rateId: string };
    expect(rateId).toMatch(/^rate_/);

    // Re-rate drafts (no entries exist in this date range yet, but the operation must succeed)
    const reRate = await post(`/api/v1/rate-cards/${rateCardId}/re-rate-drafts`, {
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
    });
    expect(reRate.status).toBe(200);
    expect(((await reRate.json()) as { count: number }).count).toBeGreaterThanOrEqual(0);
  });

  it("rejects a rate with an overlapping valid_from (422)", async () => {
    const cardResponse = await post("/api/v1/rate-cards", { name: "Overlap Card" });
    const { rateCardId } = (await cardResponse.json()) as { rateCardId: string };

    await post(`/api/v1/rate-cards/${rateCardId}/rates`, {
      tier: "timekeeper",
      scopedId: ownerUserId,
      rateE4: 1_000_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });
    // A new rate that starts on or before an existing one overlaps.
    const overlap = await post(`/api/v1/rate-cards/${rateCardId}/rates`, {
      tier: "timekeeper",
      scopedId: ownerUserId,
      rateE4: 2_000_000,
      currency: "USD",
      validFrom: "2026-01-01", // same validFrom — overlap
    });
    expect(overlap.status).toBe(422);
  });

  it("returns 404 when appending a rate to a nonexistent rate card, and writes no rate row", async () => {
    const unknownCardId = "rateCard_000000000000000000000"; // valid shape; no such row
    const before = await env.DB_FIRM_POOL_1.prepare("SELECT COUNT(*) AS count FROM rate").first<{
      count: number;
    }>();
    const response = await post(`/api/v1/rate-cards/${unknownCardId}/rates`, {
      tier: "timekeeper",
      scopedId: ownerUserId,
      rateE4: 1_000_000,
      currency: "USD",
      validFrom: "2026-01-01",
    });
    expect(response.status).toBe(404);
    // Confirm no rate row was written for the dangling card id.
    const after = await env.DB_FIRM_POOL_1.prepare("SELECT COUNT(*) AS count FROM rate").first<{
      count: number;
    }>();
    expect(after?.count).toBe(before?.count);
    // Confirm no audit_log row was written for the phantom card id.
    const auditCount = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE subject_id = ?1",
    )
      .bind(unknownCardId)
      .first<{ count: number }>();
    expect(auditCount?.count).toBe(0);
  });
});

describe("permission gate", () => {
  it("refuses a Read-only member the time:manageRates capability (403)", async () => {
    const response = await post("/api/v1/rate-cards", { name: "Denied" }, readOnlyCookie);
    expect(response.status).toBe(403);
  });
});
