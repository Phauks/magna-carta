import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
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

// The cost-entry HTTP surface over real Miniflare bindings: create sets source='manual', stores
// status='draft', and persists an integer amount_minor; a member lacking costs:track gets 403;
// the list route returns entries for a matter; the update route patches a draft; a non-existent
// entry returns 404 without writing an audit row.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let readOnlyCookie: string;
let matterId: string;

const clock = { now: () => new Date().toISOString() };

// Seeds a member with no role and a single direct-grant permission for controlled access testing.
async function mirrorMemberWithDirectGrant(
  userId: UserId,
  displayName: string,
  permission: string,
): Promise<void> {
  await insertMemberStatement(env.DB_FIRM_POOL_1, {
    userId,
    displayName,
    now: clock.now(),
  }).run();
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
  )
    .bind(newIdentifier("grant"), userId, permission, clock.now())
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Cost Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("cost-owner@example.com", {
    userName: "Cost Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Cost Owner");
  ownerCookie = await signInForSessionCookie("cost-owner@example.com");

  // A user with no costs:track — seeded with no role and no direct grant, so the chokepoint
  // refuses every costs:* route with 403.
  const readOnly = await seedCredentialedUser("cost-readonly@example.com", {
    userName: "Cost Read-Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrant(readOnly.userId, "Cost Read-Only", "firm:reportIncident");
  readOnlyCookie = await signInForSessionCookie("cost-readonly@example.com");

  // Set a simple numbering scheme so we can open a numbered matter.
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
        { kind: "literal", text: "CST-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      title: "Cost Test Matter",
      status: "open",
      responsibleMemberId: ownerUserId,
    }),
  });
  matterId = ((await created.json()) as { matterId: string }).matterId;
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

describe("cost entry capture", () => {
  it("captures a manual cost entry and persists status=draft, source=manual, integer amount_minor", async () => {
    const response = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 5000,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: "Filing fee",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { costEntryId: string };
    expect(body.costEntryId).toMatch(/^costEntry_/);

    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status, source, amount_minor, disbursement_class, billable FROM cost_entry WHERE id = ?1",
    )
      .bind(body.costEntryId)
      .first<{
        status: string;
        source: string;
        amount_minor: number;
        disbursement_class: string;
        billable: number;
      }>();
    expect(row).not.toBeNull();
    expect(row?.status).toBe("draft");
    expect(row?.source).toBe("manual");
    expect(row?.amount_minor).toBe(5000);
    expect(Number.isInteger(row?.amount_minor)).toBe(true);
    expect(row?.disbursement_class).toBe("hard");
    expect(row?.billable).toBe(1);
  });

  it("captures a soft non-billable cost entry", async () => {
    const response = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 1200,
      currency: "USD",
      disbursementClass: "soft",
      billable: false,
      description: "Photocopies",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { costEntryId: string };
    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT disbursement_class, billable FROM cost_entry WHERE id = ?1",
    )
      .bind(body.costEntryId)
      .first<{ disbursement_class: string; billable: number }>();
    expect(row?.disbursement_class).toBe("soft");
    expect(row?.billable).toBe(0);
  });
});

describe("cost entry permission gate", () => {
  it("refuses a member lacking costs:track (403)", async () => {
    const response = await post(
      "/api/v1/costs",
      {
        matterId,
        incurredDate: "2026-06-25",
        amountMinor: 100,
        currency: "USD",
        disbursementClass: "hard",
        billable: false,
        description: "Denied",
      },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });
});

describe("cost entry list", () => {
  it("GET /api/v1/costs?matterId returns the matter's costs", async () => {
    const response = await get(`/api/v1/costs?matterId=${matterId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { id: string; matterId: string }[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    expect(body.data.every((entry) => entry.matterId === matterId)).toBe(true);
  });

  it("GET /api/v1/costs without matterId returns an empty list", async () => {
    const response = await get("/api/v1/costs");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

describe("cost entry get", () => {
  it("GET /api/v1/costs/{id} returns one cost entry", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 750,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: "Service of process",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };

    const response = await get(`/api/v1/costs/${costEntryId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      matterId: string;
      amountMinor: number;
      disbursementClass: string;
      status: string;
      source: string;
    };
    expect(body.id).toBe(costEntryId);
    expect(body.matterId).toBe(matterId);
    expect(body.amountMinor).toBe(750);
    expect(body.disbursementClass).toBe("hard");
    expect(body.status).toBe("draft");
    expect(body.source).toBe("manual");
  });

  it("GET /api/v1/costs/{unknown-id} returns 404", async () => {
    const response = await get("/api/v1/costs/costEntry_000000000000000000000");
    expect(response.status).toBe(404);
  });
});

describe("cost entry update", () => {
  it("PATCH /api/v1/costs/{id} updates a draft and persists the change", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 2000,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: "Original description",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };

    const response = await patch(`/api/v1/costs/${costEntryId}`, {
      description: "Corrected description",
      amountMinor: 2500,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { costEntryId: string };
    expect(body.costEntryId).toBe(costEntryId);

    const row = await env.DB_FIRM_POOL_1.prepare(
      "SELECT description, amount_minor FROM cost_entry WHERE id = ?1",
    )
      .bind(costEntryId)
      .first<{ description: string; amount_minor: number }>();
    expect(row?.description).toBe("Corrected description");
    expect(row?.amount_minor).toBe(2500);
  });

  it("PATCH /api/v1/costs/{unknown-id} returns 404 and writes no audit row", async () => {
    const phantomId = "costEntry_000000000000000000000";
    const auditBefore = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM audit_log",
    ).first<{ c: number }>();

    const response = await patch(`/api/v1/costs/${phantomId}`, { description: "ghost edit" });
    expect(response.status).toBe(404);

    const auditAfter = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM audit_log",
    ).first<{ c: number }>();
    expect(auditAfter?.c).toBe(auditBefore?.c);
  });

  it("PATCH a frozen (billed) entry returns 409", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 3000,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: "To be billed",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };
    await env.DB_FIRM_POOL_1.prepare("UPDATE cost_entry SET status = 'billed' WHERE id = ?1")
      .bind(costEntryId)
      .run();

    const response = await patch(`/api/v1/costs/${costEntryId}`, { description: "frozen edit" });
    expect(response.status).toBe(409);
  });
});

describe("idempotency", () => {
  it("replays a create under the same Idempotency-Key (no second row)", async () => {
    const key = crypto.randomUUID();
    const body = {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 4000,
      currency: "USD",
      disbursementClass: "soft",
      billable: false,
      description: "Idempotent cost",
    };
    const headers = {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": key,
    };
    const first = await SELF.fetch("https://example.com/api/v1/costs", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { costEntryId: string }).costEntryId;

    const replay = await SELF.fetch("https://example.com/api/v1/costs", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(((await replay.json()) as { costEntryId: string }).costEntryId).toBe(firstId);
  });
});
