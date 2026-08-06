import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The billing HTTP surface over real Miniflare bindings. What is proved here is the wiring the domain
// suites cannot reach: that the chokepoint gates each route on the right billing capability, that
// finalization commits its number, its balance rows, its lock on the claimed work, and its
// accounts-receivable posting in ONE idempotent batch, that a replayed Idempotency-Key does not draw a
// second number, and that each refusal surfaces as the status a client can act on.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let noBillingCookie: string;
let draftOnlyCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };
const todayInUtc = () => new Date().toISOString().slice(0, 10);
const ACME = "directoryOrganization_acme";

async function mirrorMemberWithDirectGrants(
  userId: UserId,
  displayName: string,
  permissions: readonly string[],
): Promise<void> {
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: clock.now(),
  }).run();
  for (const permission of permissions) {
    await firmDatabase
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
      )
      .bind(newIdentifier("grant"), userId, permission, clock.now())
      .run();
  }
}

function post(path: string, body: unknown, cookie = ownerCookie, key?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": key ?? crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function put(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function patch(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, { headers: { cookie } });
}

async function openMatterWithClient(title: string): Promise<string> {
  const created = await post("/api/v1/matters", {
    title,
    status: "open",
    responsibleMemberId: ownerUserId,
  });
  const { matterId } = (await created.json()) as { matterId: string };
  // The invoice's client resolves through matter_party where role = 'client'; the Directory link
  // surface is not what this suite is proving, so the party row is seeded directly.
  await firmDatabase
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
    )
    .bind(newIdentifier("matterParty"), matterId, ACME, clock.now())
    .run();
  return matterId;
}

// Billable time with its rate already snapshot. Seeded directly rather than captured through the
// time-entry route: capture resolves a rate through the effective-dated rate engine, and standing
// that engine up would make this suite about time capture rather than about the billing wiring it
// exists to prove. Billing consumes the snapshot and never re-resolves a rate, so the snapshot is
// exactly what it needs.
async function seedBillableTime(matterId: string, minutes: number): Promise<string> {
  const timeEntryId = newIdentifier("timeEntry");
  await firmDatabase
    .prepare(
      `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'Attended to the matter', 1, 'USD', 4000000, ?6, 'draft', 'manual', ?7, ?7)`,
    )
    .bind(
      timeEntryId,
      matterId,
      ownerUserId,
      todayInUtc(),
      minutes,
      Math.round((4_000_000 * minutes) / 60 / 100),
      clock.now(),
    )
    .run();
  return timeEntryId;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Billing Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("billing-owner@example.com", {
    userName: "Billing Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Billing Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("billing-owner@example.com");

  // A member with no billing capability at all — the chokepoint must refuse every route below.
  const noBilling = await seedCredentialedUser("billing-none@example.com", {
    userName: "No Billing",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrants(noBilling.userId, "No Billing", ["firm:reportIncident"]);
  noBillingCookie = await signInForSessionCookie("billing-none@example.com");

  // A billing clerk: assembles drafts, and deliberately cannot turn one into evidence.
  const clerk = await seedCredentialedUser("billing-clerk@example.com", {
    userName: "Billing Clerk",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrants(clerk.userId, "Billing Clerk", [
    "billing:read",
    "billing:draft",
    "matters:create",
    "time:track",
  ]);
  draftOnlyCookie = await signInForSessionCookie("billing-clerk@example.com");

  // A matter draws its number when it opens, so the firm needs a scheme before any matter exists.
  await put("/api/v1/numbering-scheme", {
    segments: [
      { kind: "literal", text: "BIL-" },
      { kind: "counter", padWidth: 4 },
    ],
  });

  // The firm's chart of accounts, mapped to the roles a billing posting resolves. Finalization
  // refuses without it — proved per-role in the billing package's own account-role suite, which is
  // where the nine refusals belong; what this suite needs is a firm that CAN finalize.
  const accountsReceivable = await createAccount(
    firmDatabase,
    { name: "Accounts Receivable", type: "asset", currency: "USD" },
    { clock },
  );
  const feeIncome = await createAccount(
    firmDatabase,
    { name: "Fee Income", type: "income", currency: "USD" },
    { clock },
  );
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [...accountsReceivable.effect.statements, ...feeIncome.effect.statements],
      outboxMessages: [
        ...accountsReceivable.effect.outboxMessages,
        ...feeIncome.effect.outboxMessages,
      ],
    },
    { now: () => clock.now() },
  );

  // Deliberately AFTER the unmapped-role test's fixture would need it — the refusal test maps
  // nothing and runs first, so the order here is load-bearing for that one assertion.
  await put("/api/v1/billing/account-roles", {
    assignments: [
      { role: "accounts_receivable", ledgerAccountId: accountsReceivable.accountId },
      { role: "fee_income", ledgerAccountId: feeIncome.accountId },
    ],
  });
});

describe("the billing HTTP surface", () => {
  it("refuses every route to a member with no billing capability", async () => {
    expect(
      (
        await post(
          "/api/v1/billing/invoices",
          { clientEntityId: ACME, currency: "USD" },
          noBillingCookie,
        )
      ).status,
    ).toBe(403);
    expect((await get("/api/v1/billing/invoices", noBillingCookie)).status).toBe(403);
    expect((await get("/api/v1/billing/receivables/aging", noBillingCookie)).status).toBe(403);
  });

  it("drafts, claims, reviews, finalizes, and reads back — the whole spine", async () => {
    const matterId = await openMatterWithClient("Acme merger");
    const firstEntryId = await seedBillableTime(matterId, 90);
    const secondEntryId = await seedBillableTime(matterId, 30);

    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
      notes: "August work",
    });
    expect(created.status).toBe(201);
    const { invoiceId } = (await created.json()) as { invoiceId: string };

    // Before anything is claimed, the matter's unbilled work is visible.
    const unbilledBefore = await get(`/api/v1/billing/matters/${matterId}/unbilled`);
    expect(unbilledBefore.status).toBe(200);
    expect((await unbilledBefore.json()).timeEntryCount).toBe(2);

    const claimed = await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
      claims: [
        { sourceKind: "time_entry", sourceId: firstEntryId },
        { sourceKind: "time_entry", sourceId: secondEntryId },
      ],
    });
    expect(claimed.status).toBe(201);
    const { lineIds } = (await claimed.json()) as { lineIds: string[] };
    expect(lineIds).toHaveLength(2);

    // Claiming does not lock the work — bill review is exactly when a firm fixes a narrative.
    const duringReview = await firmDatabase
      .prepare("SELECT status FROM time_entry WHERE id = ?1")
      .bind(firstEntryId)
      .all();
    expect(duringReview.results[0].status).toBe("draft");

    // The reviewer trims the first line. The client is told less; the timekeeper's record stands.
    const reviewed = await patch(`/api/v1/billing/invoices/${invoiceId}/lines/${lineIds[0]}`, {
      quantityE4: 10_000,
      description: "Drafted the motion (reduced as a courtesy)",
    });
    expect(reviewed.status).toBe(200);

    const finalized = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
      issueDate: todayInUtc(),
      dueDate: todayInUtc(),
    });
    expect(finalized.status).toBe(201);
    const finalizedBody = (await finalized.json()) as {
      invoiceNumber: string;
      totalMinor: number;
      ledgerEntryId: string;
    };
    expect(finalizedBody.invoiceNumber).toMatch(/^\d{5}$/);
    expect(finalizedBody.totalMinor).toBeGreaterThan(0);

    // Every claimed entry is now locked, and the matter has nothing unbilled left.
    const afterFinalize = await firmDatabase
      .prepare("SELECT status FROM time_entry WHERE id = ?1")
      .bind(firstEntryId)
      .all();
    expect(afterFinalize.results[0].status).toBe("billed");
    const unbilledAfter = await get(`/api/v1/billing/matters/${matterId}/unbilled`);
    const unbilledAfterBody = (await unbilledAfter.json()) as {
      timeEntryCount: number;
      receivableUnpaidMinor: number;
    };
    expect(unbilledAfterBody.timeEntryCount).toBe(0);
    expect(unbilledAfterBody.receivableUnpaidMinor).toBe(finalizedBody.totalMinor);

    // The detail read returns the finalized invoice with its lines and its per-matter balance.
    const detail = await get(`/api/v1/billing/invoices/${invoiceId}`);
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      status: string;
      unpaidMinor: number;
      lines: unknown[];
      matterBalances: { matterId: string; unpaidMinor: number }[];
    };
    expect(detailBody.status).toBe("final");
    expect(detailBody.lines).toHaveLength(2);
    expect(detailBody.matterBalances[0]?.matterId).toBe(matterId);
    expect(detailBody.unpaidMinor).toBe(finalizedBody.totalMinor);

    // And it is immutable: a second finalization, and any edit, are refused.
    const refinalized = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
      issueDate: todayInUtc(),
      dueDate: todayInUtc(),
    });
    expect(refinalized.status).toBe(409);
    const edited = await patch(`/api/v1/billing/invoices/${invoiceId}/lines/${lineIds[0]}`, {
      description: "Rewritten after the fact",
    });
    expect(edited.status).toBe(409);
  });

  // The ledger's own refusals are ordinary bad input on a money route. They are a different error
  // class from this package's, so they used to escape to the app's error boundary as a 500 with an
  // Error ID — a member got a platform-bug page for typing next month's issue date.
  it("answers a future issue date with the ledger's 422 rather than a 500", async () => {
    const matterId = await openMatterWithClient("Acme future dating");
    const entryId = await seedBillableTime(matterId, 60);
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };
    await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
      claims: [{ sourceKind: "time_entry", sourceId: entryId }],
    });

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const refused = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
      issueDate: tomorrow,
      dueDate: tomorrow,
    });
    expect(refused.status).toBe(422);
    const body = (await refused.json()) as { type: string; detail: string };
    expect(body.type).toBe("https://api.magnacarta.esq/problems/ledger-entry-refused");
    expect(body.detail).toContain(tomorrow);

    // A date that is not a day never reaches the ledger at all — the request shape refuses it.
    const impossible = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
      issueDate: "2026-02-30",
      dueDate: todayInUtc(),
    });
    expect(impossible.status).toBe(422);
    expect((await impossible.json()).type).toBe("https://api.magnacarta.esq/problems/validation");
  });

  // A scope key is free text that selects which counter the number is drawn from, so a near-miss
  // silently starts a second sequence and the gap-detection query reports it as perfectly gapless.
  it("refuses a numbering scope the firm has never used unless the caller opens it deliberately", async () => {
    const matterId = await openMatterWithClient("Acme second letterhead");
    const entryId = await seedBillableTime(matterId, 60);
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };
    await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
      claims: [{ sourceKind: "time_entry", sourceId: entryId }],
    });

    const refused = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
      issueDate: todayInUtc(),
      dueDate: todayInUtc(),
      numberScopeKey: "RENO",
    });
    expect(refused.status).toBe(422);
    expect((await refused.json()).type).toBe("https://api.magnacarta.esq/problems/billing-refused");

    const opened = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
      issueDate: todayInUtc(),
      dueDate: todayInUtc(),
      numberScopeKey: "RENO",
      createNumberScope: true,
    });
    expect(opened.status).toBe(201);
    expect((await opened.json()).invoiceNumber).toBe("RENO-00001");
  });

  it("replays a finalization under the same Idempotency-Key without drawing a second number", async () => {
    const matterId = await openMatterWithClient("Acme lease");
    const entryId = await seedBillableTime(matterId, 60);
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };
    await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
      claims: [{ sourceKind: "time_entry", sourceId: entryId }],
    });

    const key = crypto.randomUUID();
    const body = { issueDate: todayInUtc(), dueDate: todayInUtc() };
    const first = await post(
      `/api/v1/billing/invoices/${invoiceId}/finalization`,
      body,
      ownerCookie,
      key,
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { invoiceNumber: string };

    const replayed = await post(
      `/api/v1/billing/invoices/${invoiceId}/finalization`,
      body,
      ownerCookie,
      key,
    );
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await replayed.json()).invoiceNumber).toBe(firstBody.invoiceNumber);

    const allocations = await firmDatabase
      .prepare("SELECT COUNT(*) AS count FROM invoice_number_allocation WHERE invoice_id = ?1")
      .bind(invoiceId)
      .all<{ count: number }>();
    expect(allocations.results[0]?.count).toBe(1);
  });

  it("lets a billing clerk assemble a draft and refuses to let them finalize it", async () => {
    const matterId = await openMatterWithClient("Acme dispute");
    const entryId = await seedBillableTime(matterId, 60);
    const created = await post(
      "/api/v1/billing/invoices",
      { clientEntityId: ACME, currency: "USD" },
      draftOnlyCookie,
    );
    expect(created.status).toBe(201);
    const { invoiceId } = (await created.json()) as { invoiceId: string };
    const claimed = await post(
      `/api/v1/billing/invoices/${invoiceId}/claims`,
      { claims: [{ sourceKind: "time_entry", sourceId: entryId }] },
      draftOnlyCookie,
    );
    expect(claimed.status).toBe(201);

    const finalized = await post(
      `/api/v1/billing/invoices/${invoiceId}/finalization`,
      { issueDate: todayInUtc(), dueDate: todayInUtc() },
      draftOnlyCookie,
    );
    expect(finalized.status).toBe(403);
  });

  it("releases a claim back to unbilled work, and voids a draft with everything on it", async () => {
    const matterId = await openMatterWithClient("Acme lien");
    const firstEntryId = await seedBillableTime(matterId, 60);
    const secondEntryId = await seedBillableTime(matterId, 60);
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };
    const claimed = await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
      claims: [
        { sourceKind: "time_entry", sourceId: firstEntryId },
        { sourceKind: "time_entry", sourceId: secondEntryId },
      ],
    });
    const { claimIds } = (await claimed.json()) as { claimIds: string[] };

    const released = await post(
      `/api/v1/billing/invoices/${invoiceId}/claims/${claimIds[0]}/release`,
      {},
    );
    expect(released.status).toBe(201);
    const afterRelease = await get(`/api/v1/billing/matters/${matterId}/unbilled`);
    expect((await afterRelease.json()).timeEntryCount).toBe(1);

    const voided = await post(`/api/v1/billing/invoices/${invoiceId}/void`, {
      reason: "billed to the wrong period",
    });
    expect(voided.status).toBe(201);
    const afterVoid = await get(`/api/v1/billing/matters/${matterId}/unbilled`);
    expect((await afterVoid.json()).timeEntryCount).toBe(2);
  });

  it("refuses a matter belonging to another client with a 422 naming the mismatch", async () => {
    const strayMatterId = await post("/api/v1/matters", {
      title: "Borealis retainer",
      status: "open",
      responsibleMemberId: ownerUserId,
    }).then(async (response) => (await response.json()).matterId);
    await firmDatabase
      .prepare(
        "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, 'directoryOrganization_borealis', 'client', ?3, ?3)",
      )
      .bind(newIdentifier("matterParty"), strayMatterId, clock.now())
      .run();
    const entryId = await seedBillableTime(strayMatterId, 60);

    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };
    const claimed = await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
      claims: [{ sourceKind: "time_entry", sourceId: entryId }],
    });
    expect(claimed.status).toBe(422);
    const problem = (await claimed.json()) as { type: string; detail: string };
    expect(problem.type).toContain("billing-refused");
    expect(problem.detail).toContain("one invoice bills one client");
  });

  it("serves the aging read, with overdue derived at read time", async () => {
    const aging = await get(`/api/v1/billing/receivables/aging?asOfDate=${todayInUtc()}`);
    expect(aging.status).toBe(200);
    const body = (await aging.json()) as {
      asOfDate: string;
      buckets: { label: string; unpaidMinor: number }[];
    };
    expect(body.asOfDate).toBe(todayInUtc());
    expect(body.buckets.map((bucket) => bucket.label)).toEqual([
      "current",
      "1-30",
      "31-60",
      "61-90",
      "90+",
    ]);
    // Bills issued and due today are current, not overdue.
    expect(body.buckets[0]?.unpaidMinor).toBeGreaterThan(0);
  });
});
