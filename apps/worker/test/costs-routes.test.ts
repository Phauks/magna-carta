import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
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
// A user with costs:track but NOT costs:approve — used to test approve/kickBack 403 gate.
let trackOnlyCookie: string;
let matterId: string;
// An e-billing matter used for the batch atomicity test.
let eBillingMatterId: string;
// The firm's per-firm database: its FirmDatabase Durable Object addressed by firmId (the production
// data-plane target), resolved once the firm is seeded. The DO self-migrates the per-firm lineage on
// first access, so there is no per-firm migration step — seeds and assertions read through the SAME
// store the worker resolves at request time.
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString() };

// Seeds a member with no role and a single direct-grant permission for controlled access testing.
async function mirrorMemberWithDirectGrant(
  userId: UserId,
  displayName: string,
  permission: string,
): Promise<void> {
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: clock.now(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, permission, clock.now())
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Cost Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("cost-owner@example.com", {
    userName: "Cost Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Cost Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("cost-owner@example.com");

  // A user with no costs:track — seeded with no role and no direct grant, so the chokepoint
  // refuses every costs:* route with 403.
  const readOnly = await seedCredentialedUser("cost-readonly@example.com", {
    userName: "Cost Read-Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrant(readOnly.userId, "Cost Read-Only", "firm:reportIncident");
  readOnlyCookie = await signInForSessionCookie("cost-readonly@example.com");

  // A user with costs:track only (no costs:approve) — used to prove kickBack/approve require
  // the costs:approve capability.
  const trackOnly = await seedCredentialedUser("cost-trackonly@example.com", {
    userName: "Cost Track Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrant(trackOnly.userId, "Cost Track Only", "costs:track");
  trackOnlyCookie = await signInForSessionCookie("cost-trackonly@example.com");

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

  // An e-billing matter: required for the batch atomicity test (billable entry without a UTBMS
  // expense code is rejected on an e-billing matter).
  const eBillingCreated = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      title: "Cost E-Billing Matter",
      status: "open",
      responsibleMemberId: ownerUserId,
    }),
  });
  eBillingMatterId = ((await eBillingCreated.json()) as { matterId: string }).matterId;
  // Flip the e_billing flag on the matter so captureCost enforces UTBMS codes.
  await firmDatabase
    .prepare("UPDATE matter SET e_billing = 1 WHERE id = ?1")
    .bind(eBillingMatterId)
    .run();
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

async function del(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "DELETE",
    headers: authHeaders(cookie, true),
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

    const row = await firmDatabase
      .prepare(
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
    const row = await firmDatabase
      .prepare("SELECT disbursement_class, billable FROM cost_entry WHERE id = ?1")
      .bind(body.costEntryId)
      .first<{ disbursement_class: string; billable: number }>();
    expect(row?.disbursement_class).toBe("soft");
    expect(row?.billable).toBe(0);
  });
});

describe("cost entry currency guard", () => {
  it("refuses a non-USD currency with 422 (the WIP store is USD-only)", async () => {
    const response = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 5000,
      currency: "EUR",
      disbursementClass: "hard",
      billable: true,
      description: "Foreign currency cost",
    });
    expect(response.status).toBe(422);
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

    const row = await firmDatabase
      .prepare("SELECT description, amount_minor FROM cost_entry WHERE id = ?1")
      .bind(costEntryId)
      .first<{ description: string; amount_minor: number }>();
    expect(row?.description).toBe("Corrected description");
    expect(row?.amount_minor).toBe(2500);
  });

  it("PATCH /api/v1/costs/{unknown-id} returns 404 and writes no audit row", async () => {
    const phantomId = "costEntry_000000000000000000000";
    const auditBefore = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM audit_log")
      .first<{ c: number }>();

    const response = await patch(`/api/v1/costs/${phantomId}`, { description: "ghost edit" });
    expect(response.status).toBe(404);

    const auditAfter = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM audit_log")
      .first<{ c: number }>();
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
    await firmDatabase
      .prepare("UPDATE cost_entry SET status = 'billed' WHERE id = ?1")
      .bind(costEntryId)
      .run();

    const response = await patch(`/api/v1/costs/${costEntryId}`, { description: "frozen edit" });
    expect(response.status).toBe(409);
  });
});

describe("cost entry batch capture", () => {
  it("POST /costs/batch captures two rows atomically with source=grid", async () => {
    const response = await post("/api/v1/costs/batch", {
      rows: [
        {
          matterId,
          incurredDate: "2026-06-25",
          amountMinor: 1000,
          currency: "USD",
          disbursementClass: "hard",
          billable: true,
          description: "Batch row A",
        },
        {
          matterId,
          incurredDate: "2026-06-25",
          amountMinor: 2000,
          currency: "USD",
          disbursementClass: "soft",
          billable: false,
          description: "Batch row B",
        },
      ],
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { costEntryIds: string[] };
    expect(Array.isArray(body.costEntryIds)).toBe(true);
    expect(body.costEntryIds).toHaveLength(2);

    // Both rows must be in the DB with source=grid.
    for (const id of body.costEntryIds) {
      const row = await firmDatabase
        .prepare("SELECT status, source FROM cost_entry WHERE id = ?1")
        .bind(id)
        .first<{ status: string; source: string }>();
      expect(row).not.toBeNull();
      expect(row?.status).toBe("draft");
      expect(row?.source).toBe("grid");
    }
  });

  it("batch with an e-billing row missing a UTBMS code returns 422 and neither row is written (atomic)", async () => {
    const countBefore = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM cost_entry")
      .first<{ c: number }>();

    const response = await post("/api/v1/costs/batch", {
      rows: [
        {
          // Valid row on the regular matter.
          matterId,
          incurredDate: "2026-06-25",
          amountMinor: 500,
          currency: "USD",
          disbursementClass: "hard",
          billable: false,
          description: "Non-billable valid row",
        },
        {
          // Billable row on the e-billing matter without a UTBMS expense code — must fail.
          matterId: eBillingMatterId,
          incurredDate: "2026-06-25",
          amountMinor: 1500,
          currency: "USD",
          disbursementClass: "hard",
          billable: true,
          description: "Missing UTBMS code",
        },
      ],
    });
    expect(response.status).toBe(422);

    // Neither row must have been written (the batch is all-or-nothing).
    const countAfter = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM cost_entry")
      .first<{ c: number }>();
    expect(countAfter?.c).toBe(countBefore?.c);
  });
});

describe("cost entry lifecycle transitions", () => {
  it("submit then approve (gate on) moves draft->submitted->approved", async () => {
    // Enable the review gate for this firm so the submit->approve path is legal.
    await firmDatabase
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind("billing.approval_required", "true", new Date().toISOString())
      .run();

    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 3000,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: "For review",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };

    // A costs:track member can submit their matter's cost.
    expect((await post(`/api/v1/costs/${costEntryId}/submit`, {})).status).toBe(200);

    const afterSubmit = await firmDatabase
      .prepare("SELECT status FROM cost_entry WHERE id = ?1")
      .bind(costEntryId)
      .first<{ status: string }>();
    expect(afterSubmit?.status).toBe("submitted");

    // An owner (who has costs:approve) completes the review.
    expect((await post(`/api/v1/costs/${costEntryId}/approve`, {})).status).toBe(200);

    const row = await firmDatabase
      .prepare("SELECT status FROM cost_entry WHERE id = ?1")
      .bind(costEntryId)
      .first<{ status: string }>();
    expect(row?.status).toBe("approved");

    // Restore gate off so other tests are not affected.
    await firmDatabase
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .bind("billing.approval_required", "false", new Date().toISOString())
      .run();
  });

  it("void a draft cost entry sets status=void", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 800,
      currency: "USD",
      disbursementClass: "soft",
      billable: false,
      description: "To be voided",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };

    const response = await post(`/api/v1/costs/${costEntryId}/void`, {});
    expect(response.status).toBe(200);

    const row = await firmDatabase
      .prepare("SELECT status FROM cost_entry WHERE id = ?1")
      .bind(costEntryId)
      .first<{ status: string }>();
    expect(row?.status).toBe("void");
  });

  it("kickBack requires costs:approve — a costs:track-only member gets 403", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 600,
      currency: "USD",
      disbursementClass: "hard",
      billable: false,
      description: "Kick-back permission test",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };
    // Move directly to submitted in the DB to prime the kick-back target.
    await firmDatabase
      .prepare("UPDATE cost_entry SET status = 'submitted' WHERE id = ?1")
      .bind(costEntryId)
      .run();

    // trackOnlyCookie holds costs:track but NOT costs:approve — the chokepoint returns 403.
    const response = await post(
      `/api/v1/costs/${costEntryId}/kick-back`,
      { reason: "not allowed" },
      trackOnlyCookie,
    );
    expect(response.status).toBe(403);
  });

  it("any transition on a billed (frozen) entry returns 409", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 4000,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: "Already billed",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };
    await firmDatabase
      .prepare("UPDATE cost_entry SET status = 'billed' WHERE id = ?1")
      .bind(costEntryId)
      .run();

    const response = await post(`/api/v1/costs/${costEntryId}/void`, {});
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

describe("cost entry receipt attach/detach", () => {
  it("POST /receipt sets receipt_file_id on a draft cost entry (read back confirms)", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 1500,
      currency: "USD",
      disbursementClass: "hard",
      billable: false,
      description: "Receipt attach test",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };

    const fileId = newIdentifier("file");
    const response = await post(`/api/v1/costs/${costEntryId}/receipt`, { fileId });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { costEntryId: string };
    expect(body.costEntryId).toBe(costEntryId);

    const row = await firmDatabase
      .prepare("SELECT receipt_file_id FROM cost_entry WHERE id = ?1")
      .bind(costEntryId)
      .first<{ receipt_file_id: string | null }>();
    expect(row?.receipt_file_id).toBe(fileId);
  });

  it("POST /receipt on a non-existent cost returns 404 and writes no audit row", async () => {
    const phantomId = "costEntry_111111111111111111111";
    const auditBefore = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM audit_log")
      .first<{ c: number }>();

    const fileId = newIdentifier("file");
    const response = await post(`/api/v1/costs/${phantomId}/receipt`, { fileId });
    expect(response.status).toBe(404);

    const auditAfter = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM audit_log")
      .first<{ c: number }>();
    expect(auditAfter?.c).toBe(auditBefore?.c);
  });

  it("POST /receipt on a billed (frozen) cost entry returns 409", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 2000,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: "Frozen receipt attach test",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };
    await firmDatabase
      .prepare("UPDATE cost_entry SET status = 'billed' WHERE id = ?1")
      .bind(costEntryId)
      .run();

    const fileId = newIdentifier("file");
    const response = await post(`/api/v1/costs/${costEntryId}/receipt`, { fileId });
    expect(response.status).toBe(409);
  });

  it("DELETE /receipt clears receipt_file_id on a cost entry", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 900,
      currency: "USD",
      disbursementClass: "soft",
      billable: false,
      description: "Receipt detach test",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };

    // Attach a receipt first, then detach it.
    const fileId = newIdentifier("file");
    await post(`/api/v1/costs/${costEntryId}/receipt`, { fileId });

    const response = await del(`/api/v1/costs/${costEntryId}/receipt`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { costEntryId: string };
    expect(body.costEntryId).toBe(costEntryId);

    const row = await firmDatabase
      .prepare("SELECT receipt_file_id FROM cost_entry WHERE id = ?1")
      .bind(costEntryId)
      .first<{ receipt_file_id: string | null }>();
    expect(row?.receipt_file_id).toBeNull();
  });

  it("DELETE /receipt on a non-existent cost returns 404 and writes no audit row", async () => {
    const phantomId = "costEntry_222222222222222222222";
    const auditBefore = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM audit_log")
      .first<{ c: number }>();

    const response = await del(`/api/v1/costs/${phantomId}/receipt`);
    expect(response.status).toBe(404);

    const auditAfter = await firmDatabase
      .prepare("SELECT COUNT(*) AS c FROM audit_log")
      .first<{ c: number }>();
    expect(auditAfter?.c).toBe(auditBefore?.c);
  });

  it("DELETE /receipt on a billed (frozen) cost entry returns 409", async () => {
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-25",
      amountMinor: 2100,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: "Frozen receipt detach test",
    });
    const { costEntryId } = (await created.json()) as { costEntryId: string };
    await firmDatabase
      .prepare("UPDATE cost_entry SET status = 'billed' WHERE id = ?1")
      .bind(costEntryId)
      .run();

    const response = await del(`/api/v1/costs/${costEntryId}/receipt`);
    expect(response.status).toBe(409);
  });
});
