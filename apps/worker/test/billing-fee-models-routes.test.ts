import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type {
  FirmId,
  LocationId,
  MatterId,
  TrustAccountId,
  UserId,
} from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
import { composeTrustDeposit } from "@magna-carta/trust/movements";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The fee models over HTTP: the versioned agreement, the flat fee, the contingency derivation, the
// retainer floor, and the multi-matter render shape. What these prove beyond the domain suites is
// the wiring — the chokepoint gating configuration on `billing:configure`, the derivation arriving
// through the contract, and each refusal surfacing as a status a client can act on. A separate file
// from billing-routes.test.ts on purpose: the suites share a tenant-scoped rate-limit window inside
// one isolate, and each file gets its own.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let draftOnlyCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;
let trustAccountId: TrustAccountId;

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

// Billable time with its rate already snapshot, seeded directly — billing consumes the snapshot and
// never re-resolves a rate, so the snapshot is exactly what it needs.
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

async function depositClientFunds(matterId: string, amountMinor: number): Promise<void> {
  const deposit = await composeTrustDeposit(
    firmDatabase,
    {
      trustAccountId,
      to: { matterId: matterId as MatterId, clientNodeName: "Acme", matterLeafName: "Matter" },
      amount: money(amountMinor, currencyFromCode("USD")),
      effectiveDate: todayInUtc(),
      description: "Retainer received",
      method: "check",
      reference: "2042",
      source: "The client",
      purpose: "Advance against fees",
      recordedBy: ownerUserId,
    },
    { clock },
  );
  await commitEffectBatch(firmDatabase, deposit.effect, { now: () => clock.now() });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Fee Models Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("fee-models-owner@example.com", {
    userName: "Fee Models Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Fee Models Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("fee-models-owner@example.com");

  // A billing clerk: reads and drafts, and deliberately cannot configure the firm's agreements.
  const clerk = await seedCredentialedUser("fee-models-clerk@example.com", {
    userName: "Fee Models Clerk",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrants(clerk.userId, "Fee Models Clerk", [
    "billing:read",
    "billing:draft",
    "matters:create",
  ]);
  draftOnlyCookie = await signInForSessionCookie("fee-models-clerk@example.com");

  // A matter draws its number when it opens, so the firm needs a scheme before any matter exists.
  await put("/api/v1/numbering-scheme", {
    segments: [
      { kind: "literal", text: "FEE-" },
      { kind: "counter", padWidth: 4 },
    ],
  });

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
  await put("/api/v1/billing/account-roles", {
    assignments: [
      { role: "accounts_receivable", ledgerAccountId: accountsReceivable.accountId },
      { role: "fee_income", ledgerAccountId: feeIncome.accountId },
    ],
  });

  const locationId = newIdentifier("location");
  await firmDatabase
    .prepare(
      "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, 'Main', 'active', ?2, ?2)",
    )
    .bind(locationId, clock.now())
    .run();
  const opened = await openTrustAccount(
    firmDatabase,
    {
      name: "IOLTA — Main",
      locationId: locationId as LocationId,
      jurisdiction: "NV",
      currency: "USD",
      openedOn: todayInUtc(),
    },
    { clock },
  );
  await commitEffectBatch(firmDatabase, opened.effect, { now: () => clock.now() });
  trustAccountId = opened.trustAccountId;
});

describe("the fee models", () => {
  it("records the agreement on billing:configure, amends it as a new version, and refuses the clerk", async () => {
    const matterId = await openMatterWithClient("Fee agreement");
    const denied = await put(
      `/api/v1/billing/matters/${matterId}/arrangement`,
      { kind: "hourly", currency: "USD", validFrom: todayInUtc() },
      draftOnlyCookie,
    );
    expect(denied.status).toBe(403);

    const first = await put(`/api/v1/billing/matters/${matterId}/arrangement`, {
      kind: "flat_fee",
      flatFeeAmountMinor: 500_000,
      currency: "USD",
      validFrom: todayInUtc(),
    });
    expect(first.status).toBe(200);
    const amended = await put(`/api/v1/billing/matters/${matterId}/arrangement`, {
      kind: "retainer",
      retainerTargetMinor: 1_000_000,
      retainerThresholdMinor: 250_000,
      advanceDepositDestination: "trust",
      currency: "USD",
      validFrom: todayInUtc(),
    });
    expect(amended.status).toBe(200);
    const body = (await amended.json()) as {
      inForce: { kind: string; version: number } | null;
      history: { version: number; validTo: string | null }[];
    };
    expect(body.inForce).toMatchObject({ kind: "retainer", version: 2 });
    expect(body.history).toHaveLength(2);

    const read = await get(`/api/v1/billing/matters/${matterId}/arrangement`, draftOnlyCookie);
    expect(read.status).toBe(200);
    expect((await read.json()).inForce?.kind).toBe("retainer");
  });

  it("a malformed agreement is refused on its own terms", async () => {
    const matterId = await openMatterWithClient("Malformed agreement");
    const refused = await put(`/api/v1/billing/matters/${matterId}/arrangement`, {
      kind: "flat_fee",
      currency: "USD",
      validFrom: todayInUtc(),
    });
    expect(refused.status).toBe(422);
  });

  it("bills a flat-fee matter: one line, contributing work claimed at zero and locked at finalize, hourly claims refused", async () => {
    const matterId = await openMatterWithClient("Flat fee matter");
    await put(`/api/v1/billing/matters/${matterId}/arrangement`, {
      kind: "flat_fee",
      flatFeeAmountMinor: 750_000,
      currency: "USD",
      validFrom: todayInUtc(),
    });
    const entryId = await seedBillableTime(matterId, 120);
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };

    // The hourly path refuses this matter by name; the flat-fee path is the door.
    const hourly = await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
      claims: [{ sourceKind: "time_entry", sourceId: entryId }],
    });
    expect(hourly.status).toBe(422);

    const flat = await post(`/api/v1/billing/invoices/${invoiceId}/flat-fee`, {
      matterId,
      contributingTimeEntryIds: [entryId],
    });
    expect(flat.status).toBe(201);
    const flatBody = (await flat.json()) as { lineId: string; claimIds: string[] };
    expect(flatBody.claimIds).toHaveLength(1);

    const finalized = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
      issueDate: todayInUtc(),
      dueDate: todayInUtc(),
    });
    expect(finalized.status).toBe(201);
    expect((await finalized.json()).totalMinor).toBe(750_000);
    const locked = await firmDatabase
      .prepare("SELECT status FROM time_entry WHERE id = ?1")
      .bind(entryId)
      .all<{ status: string }>();
    expect(locked.results[0]?.status).toBe("billed");
  });

  it("computes the contingency fee from recorded recoveries and refuses without one", async () => {
    const matterId = await openMatterWithClient("Contingency matter");
    await put(`/api/v1/billing/matters/${matterId}/arrangement`, {
      kind: "contingency",
      contingencyShareE4: 3_333,
      contingencyBasis: "gross_recovery",
      currency: "USD",
      validFrom: todayInUtc(),
    });
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };

    // No recovery on the record yet: nothing to take a share of.
    const early = await post(`/api/v1/billing/invoices/${invoiceId}/contingency-fee`, { matterId });
    expect(early.status).toBe(422);

    const recorded = await post(`/api/v1/billing/matters/${matterId}/recoveries`, {
      amountMinor: 10_000_000,
      currency: "USD",
      recoveredDate: todayInUtc(),
      description: "Settlement of all claims",
    });
    expect(recorded.status).toBe(201);
    const { recoveryId } = (await recorded.json()) as { recoveryId: string };

    const composed = await post(`/api/v1/billing/invoices/${invoiceId}/contingency-fee`, {
      matterId,
    });
    expect(composed.status).toBe(201);
    const derivation = (await composed.json()) as { feeMinor: number; baseMinor: number };
    expect(derivation).toMatchObject({ feeMinor: 3_333_000, baseMinor: 10_000_000 });

    // A recovery is reachable only through its own matter: voiding it through another matter's path
    // answers not-found rather than acting on a record that is not that path's to reach.
    const otherMatterId = await openMatterWithClient("Contingency other");
    const mismatched = await post(
      `/api/v1/billing/matters/${otherMatterId}/recoveries/${recoveryId}/void`,
      { reason: "Entered twice" },
    );
    expect(mismatched.status).toBe(404);

    // The recoveries read shows the record; a void keeps it readable with its reason.
    const voided = await post(`/api/v1/billing/matters/${matterId}/recoveries/${recoveryId}/void`, {
      reason: "Entered twice",
    });
    expect(voided.status).toBe(201);
    const listed = await get(`/api/v1/billing/matters/${matterId}/recoveries`);
    const listBody = (await listed.json()) as { data: { voidReason: string | null }[] };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.voidReason).toBe("Entered twice");
  });

  it("reads the retainer floor, raises ONE ask below it, and resolves it", async () => {
    const matterId = await openMatterWithClient("Retainer matter");
    await put(`/api/v1/billing/matters/${matterId}/arrangement`, {
      kind: "retainer",
      retainerTargetMinor: 1_000_000,
      retainerThresholdMinor: 250_000,
      advanceDepositDestination: "trust",
      currency: "USD",
      validFrom: todayInUtc(),
    });
    await depositClientFunds(matterId, 100_000);

    const status = await get(
      `/api/v1/billing/matters/${matterId}/retainer?trustAccountId=${trustAccountId}`,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      availableMinor: 100_000,
      belowFloor: true,
      shortfallMinor: 900_000,
      openRequestId: null,
    });

    const asked = await post(
      `/api/v1/billing/matters/${matterId}/retainer/replenishment-requests`,
      {
        trustAccountId,
      },
    );
    expect(asked.status).toBe(201);
    const askBody = (await asked.json()) as { requestId: string; requestedAmountMinor: number };
    expect(askBody.requestedAmountMinor).toBe(900_000);

    // A second ask while one is open is a conflict, not a refusal on the merits.
    const again = await post(
      `/api/v1/billing/matters/${matterId}/retainer/replenishment-requests`,
      {
        trustAccountId,
      },
    );
    expect(again.status).toBe(409);

    const resolved = await post(
      `/api/v1/billing/replenishment-requests/${askBody.requestId}/resolution`,
      {},
    );
    expect(resolved.status).toBe(201);
  });

  it("the render shape: firm default on billing:configure, snapshot at finalize, derived per matter with a summary", async () => {
    // The firm's default is readable and settable only with billing:configure.
    expect((await get("/api/v1/billing/render-shape", draftOnlyCookie)).status).toBe(403);
    const defaulted = await get("/api/v1/billing/render-shape");
    expect((await defaulted.json()).renderShape).toBe("per_matter_pages");

    const firstMatter = await openMatterWithClient("Render first");
    const secondMatter = await openMatterWithClient("Render second");
    const firstEntry = await seedBillableTime(firstMatter, 60);
    const secondEntry = await seedBillableTime(secondMatter, 90);
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };
    await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
      claims: [
        { sourceKind: "time_entry", sourceId: firstEntry },
        { sourceKind: "time_entry", sourceId: secondEntry },
      ],
    });
    const finalized = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
      issueDate: todayInUtc(),
      dueDate: todayInUtc(),
    });
    expect(finalized.status).toBe(201);

    const model = await get(`/api/v1/billing/invoices/${invoiceId}/render-model`);
    expect(model.status).toBe(200);
    const modelBody = (await model.json()) as {
      renderShape: string;
      pages: { matterId: string | null; subtotalMinor: number }[];
      summary: { totalMinor: number } | null;
      totalMinor: number;
    };
    expect(modelBody.renderShape).toBe("per_matter_pages");
    expect(modelBody.pages).toHaveLength(2);
    expect(modelBody.summary?.totalMinor).toBe(modelBody.totalMinor);

    // The firm switches its default; the finalized bill keeps the shape it went out with.
    const set = await put("/api/v1/billing/render-shape", { renderShape: "combined" });
    expect(set.status).toBe(200);
    const after = await get(`/api/v1/billing/invoices/${invoiceId}/render-model`);
    expect((await after.json()).renderShape).toBe("per_matter_pages");
  });
});
