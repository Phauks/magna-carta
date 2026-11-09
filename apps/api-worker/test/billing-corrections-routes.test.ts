import { todayInUtc } from "@magna-carta/civil-time/civil-date";
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
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import type { ProblemBody } from "../src/http/contracts/problem.ts";

// Corrections after a bill has gone out, over HTTP: the credit note, the client credit it opens, the
// write-off, and the reversal. What this proves beyond the domain suite is the wiring — the
// chokepoint gating each on the right capability, the split between what a bill can absorb and what
// it cannot arriving through the contract, and each refusal surfacing as a status a client can act
// on. Its own file, because the suites share a tenant-scoped rate-limit window inside one isolate.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let readOnlyCookie: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };
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

interface Bill {
  readonly invoiceId: string;
  readonly matterId: string;
  readonly lineId: string;
}

async function finalizedBill(title: string, amountMinor: number): Promise<Bill> {
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
  const detail = (await (await get(`/api/v1/billing/invoices/${invoiceId}`)).json()) as {
    lines: { id: string }[];
  };
  return { invoiceId, matterId, lineId: detail.lines[0]?.id ?? "" };
}

async function unpaidMinor(invoiceId: string): Promise<number> {
  const detail = (await (await get(`/api/v1/billing/invoices/${invoiceId}`)).json()) as {
    unpaidMinor: number;
  };
  return detail.unpaidMinor;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Corrections Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("corrections-owner@example.com", {
    userName: "Corrections Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Corrections Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("corrections-owner@example.com");

  // A member who may look at bills and nothing else: correcting one changes what a client owes on a
  // document the firm already handed over, and that is a capability of its own.
  const viewer = await seedCredentialedUser("corrections-viewer@example.com", {
    userName: "Corrections Viewer",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrants(viewer.userId, "Corrections Viewer", ["billing:read"]);
  readOnlyCookie = await signInForSessionCookie("corrections-viewer@example.com");

  await put("/api/v1/numbering-scheme", {
    segments: [
      { kind: "literal", text: "COR-" },
      { kind: "counter", padWidth: 4 },
    ],
  });

  const roles = [
    ["accounts_receivable", "Accounts Receivable", "asset"],
    ["fee_income", "Fee Income", "income"],
    ["fee_adjustments", "Fee Adjustments", "income"],
    ["fee_write_off", "Fee Write-off", "expense"],
    ["client_credit_liability", "Client Credits Payable", "liability"],
  ] as const;
  const assignments = [];
  for (const [role, name, type] of roles) {
    const account = await createAccount(firmDatabase, { name, type, currency: "USD" }, { clock });
    await commitEffectBatch(firmDatabase, account.effect, { now: () => clock.now() });
    assignments.push({ role, ledgerAccountId: account.accountId });
  }
  await put("/api/v1/billing/account-roles", { assignments });
});

describe("correcting a bill over HTTP", () => {
  it("credits an unpaid bill, refuses the reader, and lists the note afterwards", async () => {
    const bill = await finalizedBill("Credit an unpaid bill", 500_000);

    const denied = await post(
      `/api/v1/billing/invoices/${bill.invoiceId}/credit-notes`,
      {
        reason: "Not mine to issue",
        effectiveDate: todayInUtc(),
        lines: [
          {
            matterId: bill.matterId,
            kind: "adjustment",
            description: "Nope",
            amountMinor: 100,
          },
        ],
      },
      readOnlyCookie,
    );
    expect(denied.status).toBe(403);

    const issued = await post(`/api/v1/billing/invoices/${bill.invoiceId}/credit-notes`, {
      reason: "The research hours were covered by the flat quote given in June",
      effectiveDate: todayInUtc(),
      lines: [
        {
          matterId: bill.matterId,
          kind: "adjustment",
          description: "Research hours already covered by the June quote",
          amountMinor: 120_000,
          creditsInvoiceLineId: bill.lineId,
        },
      ],
    });
    expect(issued.status).toBe(201);
    const body = (await issued.json()) as {
      creditNoteId: string;
      totalMinor: number;
      appliedMinor: number;
      clientCreditMinor: number;
    };
    expect(body).toMatchObject({
      totalMinor: 120_000,
      appliedMinor: 120_000,
      clientCreditMinor: 0,
    });
    expect(await unpaidMinor(bill.invoiceId)).toBe(380_000);

    const listed = await get(
      `/api/v1/billing/invoices/${bill.invoiceId}/credit-notes`,
      readOnlyCookie,
    );
    expect(listed.status).toBe(200);
    const notes = (await listed.json()) as {
      data: { id: string; totalMinor: number; lines: { creditsInvoiceLineId: string | null }[] }[];
    };
    expect(notes.data).toHaveLength(1);
    expect(notes.data[0]?.totalMinor).toBe(120_000);
    expect(notes.data[0]?.lines[0]?.creditsInvoiceLineId).toBe(bill.lineId);
  });

  it("writes off a balance, refuses more than is owed, and then a credit opens a client credit the reader can see", async () => {
    const bill = await finalizedBill("Write off then credit", 500_000);

    const tooMuch = await post(`/api/v1/billing/invoices/${bill.invoiceId}/write-offs`, {
      matterId: bill.matterId,
      amountMinor: 500_001,
      reason: "Uncollectable",
      effectiveDate: todayInUtc(),
    });
    expect(tooMuch.status).toBe(409);

    const written = await post(`/api/v1/billing/invoices/${bill.invoiceId}/write-offs`, {
      matterId: bill.matterId,
      amountMinor: 400_000,
      reason: "Abandoned after the client's insurer settled directly",
      effectiveDate: todayInUtc(),
    });
    expect(written.status).toBe(201);
    expect(await unpaidMinor(bill.invoiceId)).toBe(100_000);

    // More than the bill can still absorb: the remainder is money already the firm's, so it becomes
    // a recorded obligation rather than a negative receivable.
    const issued = await post(`/api/v1/billing/invoices/${bill.invoiceId}/credit-notes`, {
      reason: "Two of the three deposition hours were not earned",
      effectiveDate: todayInUtc(),
      lines: [
        {
          matterId: bill.matterId,
          kind: "adjustment",
          description: "Deposition hours not earned",
          amountMinor: 300_000,
        },
      ],
    });
    expect(issued.status).toBe(201);
    const body = (await issued.json()) as {
      appliedMinor: number;
      clientCreditMinor: number;
      matters: { clientCreditId: string | null }[];
    };
    expect(body.appliedMinor).toBe(100_000);
    expect(body.clientCreditMinor).toBe(200_000);
    expect(await unpaidMinor(bill.invoiceId)).toBe(0);

    const credits = await get(`/api/v1/billing/clients/${ACME}/credits`, readOnlyCookie);
    expect(credits.status).toBe(200);
    const listed = (await credits.json()) as {
      data: { id: string; remainingMinor: number }[];
    };
    expect(listed.data.some((credit) => credit.remainingMinor === 200_000)).toBe(true);

    // And it is set against a later bill for the same client, which moves no money in either
    // direction — the debt and the credit cancel.
    const creditId = body.matters[0]?.clientCreditId ?? "";
    const later = await finalizedBill("The later bill", 400_000);
    const applied = await post(`/api/v1/billing/client-credits/${creditId}/applications`, {
      invoiceId: later.invoiceId,
      matterId: later.matterId,
      amountMinor: 150_000,
      effectiveDate: todayInUtc(),
    });
    expect(applied.status).toBe(201);
    expect((await readJson<{ remainingMinor: number }>(applied)).remainingMinor).toBe(50_000);
    expect(await unpaidMinor(later.invoiceId)).toBe(250_000);

    const tooMuchAgain = await post(`/api/v1/billing/client-credits/${creditId}/applications`, {
      invoiceId: later.invoiceId,
      matterId: later.matterId,
      amountMinor: 50_001,
      effectiveDate: todayInUtc(),
    });
    expect(tooMuchAgain.status).toBe(409);
  });

  it("refuses a correction against a draft with a status a client can act on", async () => {
    const matterId = await openMatterWithClient("Still a draft");
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };
    const refused = await post(`/api/v1/billing/invoices/${invoiceId}/credit-notes`, {
      reason: "It is still a working document",
      effectiveDate: todayInUtc(),
      lines: [{ matterId, kind: "adjustment", description: "Nope", amountMinor: 100 }],
    });
    expect(refused.status).toBe(409);
    expect((await readJson<ProblemBody>(refused)).type).toContain("billing-invoice-not-editable");
  });

  it("reverses a write-off and refuses to unwind a credit note", async () => {
    const bill = await finalizedBill("Reverse a write-off", 300_000);
    const written = await post(`/api/v1/billing/invoices/${bill.invoiceId}/write-offs`, {
      matterId: bill.matterId,
      amountMinor: 300_000,
      reason: "Given up on",
      effectiveDate: todayInUtc(),
    });
    const { applicationId } = (await written.json()) as { applicationId: string };
    expect(await unpaidMinor(bill.invoiceId)).toBe(0);

    const reversed = await post(`/api/v1/billing/applications/${applicationId}/reversal`, {
      reason: "The client paid after all and the write-off was premature",
      effectiveDate: todayInUtc(),
    });
    expect(reversed.status).toBe(201);
    expect(await unpaidMinor(bill.invoiceId)).toBe(300_000);

    // A reversal happens once: the UNIQUE link settles the second attempt.
    const again = await post(`/api/v1/billing/applications/${applicationId}/reversal`, {
      reason: "Again",
      effectiveDate: todayInUtc(),
    });
    expect(again.status).toBe(422);

    const issued = await post(`/api/v1/billing/invoices/${bill.invoiceId}/credit-notes`, {
      reason: "Overstated by an hour",
      effectiveDate: todayInUtc(),
      lines: [
        {
          matterId: bill.matterId,
          kind: "adjustment",
          description: "One hour",
          amountMinor: 100_000,
        },
      ],
    });
    expect(issued.status).toBe(201);
    const noteApplication = await firmDatabase
      .prepare("SELECT id FROM invoice_application WHERE kind = 'credit_note' AND invoice_id = ?1")
      .bind(bill.invoiceId)
      .all<{ id: string }>();
    const refused = await post(
      `/api/v1/billing/applications/${noteApplication.results[0]?.id}/reversal`,
      { reason: "Change of mind", effectiveDate: todayInUtc() },
    );
    expect(refused.status).toBe(422);
  });

  it("reports a matter's contingency position, and refuses a matter that is not billed that way", async () => {
    const bill = await finalizedBill("Not a contingency matter", 100_000);
    const refused = await get(`/api/v1/billing/matters/${bill.matterId}/contingency-residual`);
    expect(refused.status).toBe(422);

    const matterId = await openMatterWithClient("A contingency matter");
    await put(`/api/v1/billing/matters/${matterId}/arrangement`, {
      kind: "contingency",
      contingencyShareE4: 3_333,
      contingencyBasis: "gross_recovery",
      currency: "USD",
      validFrom: todayInUtc(),
    });
    await post(`/api/v1/billing/matters/${matterId}/recoveries`, {
      amountMinor: 10_000_000,
      currency: "USD",
      recoveredDate: todayInUtc(),
      description: "Settlement of all claims",
    });

    const position = await get(
      `/api/v1/billing/matters/${matterId}/contingency-residual`,
      readOnlyCookie,
    );
    expect(position.status).toBe(200);
    const body = (await position.json()) as {
      entitlementMinor: number;
      billedMinor: number;
      residualMinor: number;
      feeLines: unknown[];
    };
    // Nothing billed yet, so the entitlement is the whole share and there is no residual.
    expect(body).toMatchObject({
      entitlementMinor: 3_333_000,
      billedMinor: 0,
      residualMinor: 0,
      feeLines: [],
    });
  });
});
