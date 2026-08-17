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

// Recording that a bill went out, over HTTP. What this proves beyond the domain suite is the wiring:
// the chokepoint gating the write on a capability a read-only member does not hold, the closed channel
// and outcome vocabularies arriving as contract validation rather than as a database refusal, and —
// the one that matters most — the delivery state reaching a caller ON THE INVOICE ITSELF, because a
// record that has to be asked for separately is a record the surface deciding to take fees out of
// trust will forget to show.
//
// Its own file, because the billing suites share a tenant-scoped rate-limit window inside one isolate.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let readOnlyCookie: string;
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

function post(path: string, body: unknown, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": crypto.randomUUID(),
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
  await firmDatabase
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
    )
    .bind(newIdentifier("matterParty"), matterId, ACME, clock.now())
    .run();
  return matterId;
}

async function seedBillableTime(matterId: string, amountMinor: number): Promise<string> {
  const timeEntryId = newIdentifier("timeEntry");
  await firmDatabase
    .prepare(
      `INSERT INTO time_entry (id, matter_id, timekeeper_user_id, work_date, duration_minutes, raw_duration_minutes, narrative, billable, currency, rate_e4, amount_minor, status, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 60, 60, 'Attended to the matter', 1, 'USD', 4000000, ?5, 'draft', 'manual', ?6, ?6)`,
    )
    .bind(timeEntryId, matterId, ownerUserId, todayInUtc(), amountMinor, clock.now())
    .run();
  return timeEntryId;
}

async function finalizedInvoiceId(title: string, amountMinor: number): Promise<string> {
  const matterId = await openMatterWithClient(title);
  const timeEntryId = await seedBillableTime(matterId, amountMinor);
  const created = await post("/api/v1/billing/invoices", {
    clientEntityId: ACME,
    currency: "USD",
  });
  const { invoiceId } = (await created.json()) as { invoiceId: string };
  const claimed = await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
    claims: [{ sourceKind: "time_entry", sourceId: timeEntryId }],
  });
  expect(claimed.status).toBe(201);
  const finalized = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
    issueDate: todayInUtc(),
    dueDate: todayInUtc(),
  });
  expect(finalized.status).toBe(201);
  return invoiceId;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Delivery Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("delivery-owner@example.com", {
    userName: "Delivery Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Delivery Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("delivery-owner@example.com");

  // A member who may look at bills and nothing else. Recording that a bill was given to a client
  // writes a permanent record the firm relies on later, so it is a write capability rather than a
  // consequence of being able to read the bill.
  const viewer = await seedCredentialedUser("delivery-viewer@example.com", {
    userName: "Delivery Viewer",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrants(viewer.userId, "Delivery Viewer", ["billing:read"]);
  readOnlyCookie = await signInForSessionCookie("delivery-viewer@example.com");

  await put("/api/v1/numbering-scheme", {
    segments: [
      { kind: "literal", text: "DEL-" },
      { kind: "counter", padWidth: 4 },
    ],
  });

  const roles = [
    ["accounts_receivable", "Accounts Receivable", "asset"],
    ["fee_income", "Fee Income", "income"],
  ] as const;
  const assignments = [];
  for (const [role, name, type] of roles) {
    const account = await createAccount(firmDatabase, { name, type, currency: "USD" }, { clock });
    await commitEffectBatch(firmDatabase, account.effect, { now: () => clock.now() });
    assignments.push({ role, ledgerAccountId: account.accountId });
  }
  await put("/api/v1/billing/account-roles", { assignments });
});

describe("recording that a bill went out, over HTTP", () => {
  it("records two attempts, refuses the reader, and reports the state on the bill itself", async () => {
    const invoiceId = await finalizedInvoiceId("Deliver a bill", 500_000);

    // Nothing recorded yet, and the bill says so rather than staying silent about it.
    const before = (await (await get(`/api/v1/billing/invoices/${invoiceId}`)).json()) as {
      delivery: { delivered: boolean; attemptCount: number; deliveredOn: string | null };
    };
    expect(before.delivery).toMatchObject({
      delivered: false,
      attemptCount: 0,
      deliveredOn: null,
    });

    // Being allowed to read a bill is not being allowed to assert that a client received it.
    const denied = await post(
      `/api/v1/billing/invoices/${invoiceId}/deliveries`,
      {
        channel: "post",
        recipientReference: "12 Court Street",
        deliveryDate: todayInUtc(),
        outcome: "delivered",
      },
      readOnlyCookie,
    );
    expect(denied.status).toBe(403);

    // A vocabulary the design did not name is refused by the contract, before it can reach the table.
    const unknownChannel = await post(`/api/v1/billing/invoices/${invoiceId}/deliveries`, {
      channel: "carrier_pigeon",
      recipientReference: "12 Court Street",
      deliveryDate: todayInUtc(),
      outcome: "delivered",
    });
    expect(unknownChannel.status).toBe(400);

    const failed = await post(`/api/v1/billing/invoices/${invoiceId}/deliveries`, {
      channel: "post",
      recipientReference: "12 Court Street, Reno NV",
      deliveryDate: todayInUtc(),
      externalReference: "RR123456789US",
      outcome: "failed",
    });
    expect(failed.status).toBe(201);

    const delivered = await post(`/api/v1/billing/invoices/${invoiceId}/deliveries`, {
      channel: "hand",
      recipientReference: "handed to the client at the closing meeting",
      deliveryDate: todayInUtc(),
      outcome: "delivered",
    });
    expect(delivered.status).toBe(201);

    // Two attempts, not one row edited twice — and a reader may see the history even though they
    // could not write it.
    const listed = await get(`/api/v1/billing/invoices/${invoiceId}/deliveries`, readOnlyCookie);
    expect(listed.status).toBe(200);
    const history = (await listed.json()) as {
      state: { delivered: boolean; attemptCount: number; failedAttemptCount: number };
      data: { channel: string; outcome: string; externalReference: string | null }[];
    };
    expect(history.data).toHaveLength(2);
    expect(history.state).toMatchObject({
      delivered: true,
      attemptCount: 2,
      failedAttemptCount: 1,
    });
    expect(history.data.map((attempt) => attempt.outcome).sort()).toEqual(["delivered", "failed"]);

    // The whole point of the state riding the detail read: the surface that decides to move client
    // money out of trust gets this without knowing to ask a second endpoint.
    const after = (await (await get(`/api/v1/billing/invoices/${invoiceId}`)).json()) as {
      delivery: { delivered: boolean; deliveredOn: string | null; failedAttemptCount: number };
    };
    expect(after.delivery).toMatchObject({
      delivered: true,
      deliveredOn: todayInUtc(),
      failedAttemptCount: 1,
    });
  });

  // A draft is still being written, so a delivery recorded against one would assert the client was
  // given a bill that does not yet exist in the form the row describes.
  it("refuses a delivery of a bill that was never issued", async () => {
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };

    const refused = await post(`/api/v1/billing/invoices/${invoiceId}/deliveries`, {
      channel: "post",
      recipientReference: "12 Court Street, Reno NV",
      deliveryDate: todayInUtc(),
      outcome: "delivered",
    });
    expect(refused.status).toBe(409);
  });
});
