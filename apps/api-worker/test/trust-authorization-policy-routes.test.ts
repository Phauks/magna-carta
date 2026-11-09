import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, LocationId, MatterId, UserId } from "@magna-carta/identifiers/types";
import { createAccount } from "@magna-carta/ledger/create-account";
import { currencyFromCode, money } from "@magna-carta/money/money";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
import { composeTrustDeposit } from "@magna-carta/trust/movements";
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
import type { ProblemBody } from "../src/contracts/problem.ts";

// The per-firm authorization policy over the HTTP surface. What is proved here is the wiring the
// domain suites cannot reach: the policy read and the versioned change as routes, the chokepoint
// gating the change on trust:authorize (a capability, not a role name), the in-flight rule holding
// across a posture change made over HTTP, and billing's application queue — submit by one member,
// authority-refused approval, then a second person's approval paying the bill — end to end.
//
// Tests in this file run IN ORDER and share one firm: a policy is firm-global state, so the sequence
// of posture changes below is load-bearing.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let managerCookie: string;
let managerUserId: UserId;
let trustAccountId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };
const ACME = "directoryOrganization_acme";

function post(path: string, body: unknown, cookie = ownerCookie, key?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
      "Idempotency-Key": key ?? crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
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

async function depositToMatter(matterId: string, amountMinor: number): Promise<void> {
  const deposit = await composeTrustDeposit(
    firmDatabase,
    {
      trustAccountId: trustAccountId as never,
      to: { matterId: matterId as MatterId, clientNodeName: "Acme", matterLeafName: "Matter" },
      amount: money(amountMinor, currencyFromCode("USD")),
      effectiveDate: todayInUtc(),
      description: "Retainer received",
      method: "check",
      reference: "1041",
      source: "The client",
      purpose: "Advance against fees",
      recordedBy: ownerUserId,
    },
    { clock },
  );
  await commitEffectBatch(firmDatabase, deposit.effect, { now: () => clock.now() });
}

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

const disbursementBody = (matterId: string, amountMinor: number) => ({
  trustAccountId,
  matterId,
  amountMinor,
  currency: "USD" as const,
  effectiveDate: todayInUtc(),
  description: "Filing fee paid on the client's behalf",
  method: "check" as const,
  payee: "Second Judicial District Court",
  purpose: "Complaint filing fee",
});

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Authorization Policy Firm", databaseIdentifier: "DB_FIRM_POOL_3" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  // The owner: holds trust:authorize through the Admin role — the seat with the authority to
  // act on client money and to change the posture.
  const owner = await seedCredentialedUser("policy-owner@example.com", {
    userName: "Policy Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Policy Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("policy-owner@example.com");

  // The manager: moves money and applies fees, and deliberately does NOT hold trust:authorize. Their
  // existence is also what makes the firm multi-manager, so the default two-person posture binds.
  const manager = await seedCredentialedUser("policy-manager@example.com", {
    userName: "Billing Manager",
    firmId: poolFirmId,
  });
  managerUserId = manager.userId;
  await insertMemberStatement(firmDatabase, {
    userId: manager.userId,
    displayName: "Billing Manager",
    now: clock.now(),
  }).run();
  for (const permission of ["trust:manage", "trust:read", "billing:apply", "billing:read"]) {
    await firmDatabase
      .prepare(
        "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
      )
      .bind(newIdentifier("grant"), manager.userId, permission, clock.now())
      .run();
  }
  managerCookie = await signInForSessionCookie("policy-manager@example.com");

  await put("/api/v1/numbering-scheme", {
    segments: [
      { kind: "literal", text: "POL-" },
      { kind: "counter", padWidth: 4 },
    ],
  });

  // The chart of accounts and its billing roles, so a bill can finalize and a transfer can land.
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
  const operatingBank = await createAccount(
    firmDatabase,
    { name: "Operating Bank Account", type: "asset", currency: "USD" },
    { clock },
  );
  await commitEffectBatch(
    firmDatabase,
    {
      statements: [
        ...accountsReceivable.effect.statements,
        ...feeIncome.effect.statements,
        ...operatingBank.effect.statements,
      ],
      outboxMessages: [],
    },
    { now: () => clock.now() },
  );
  await put("/api/v1/billing/account-roles", {
    assignments: [
      { role: "accounts_receivable", ledgerAccountId: accountsReceivable.accountId },
      { role: "fee_income", ledgerAccountId: feeIncome.accountId },
      { role: "operating_bank", ledgerAccountId: operatingBank.accountId },
    ],
  });

  const locationId = newIdentifier("location") as LocationId;
  await firmDatabase
    .prepare(
      "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, 'Reno', 'active', ?2, ?2)",
    )
    .bind(locationId, clock.now())
    .run();
  const opened = await openTrustAccount(
    firmDatabase,
    {
      name: "IOLTA — Reno",
      locationId,
      jurisdiction: "US-NV",
      currency: "USD",
      openedOn: todayInUtc(),
    },
    { clock },
  );
  await commitEffectBatch(firmDatabase, opened.effect, { now: () => clock.now() });
  trustAccountId = opened.trustAccountId;
});

describe("the firm's authorization policy over HTTP", () => {
  it("ships authority-based: a holder acts alone, and the posture is version 1 of the firm's own history", async () => {
    const response = await get("/api/v1/trust/authorization-policy", managerCookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      current: {
        id: string | null;
        version: number;
        policy: string;
        thresholdAmountMinor: number | null;
        requireAuthorizedApprover: boolean;
      };
      history: { version: number }[];
    };
    expect(body.current).toMatchObject({
      version: 1,
      policy: "off",
      thresholdAmountMinor: null,
      requireAuthorizedApprover: true,
    });
    // A real row rather than a reading of an absent one: the firm can see what it started with.
    expect(body.current.id).not.toBeNull();
    expect(body.history.map((version) => version.version)).toEqual([1]);
  });

  it("refuses a posture change from a member without the authority capability", async () => {
    const response = await put(
      "/api/v1/trust/authorization-policy",
      { policy: "off", requireAuthorizedApprover: false },
      managerCookie,
    );
    // trust:manage moves money; changing how the firm's money moves takes trust:authorize.
    expect(response.status).toBe(403);
  });

  it("a pending request keeps the always posture it was submitted under when the firm relaxes", async () => {
    // The firm tightens first: the seeded posture would let this owner release the payment alone,
    // and the point of this case is a request that has to wait.
    const strict = await put("/api/v1/trust/authorization-policy", {
      policy: "always",
      requireAuthorizedApprover: false,
    });
    expect(strict.status).toBe(201);
    expect(await strict.json()).toMatchObject({ version: 2, policy: "always" });

    const matterId = await openMatterWithClient("In-flight Matter");
    await depositToMatter(matterId, 500000);
    const submitted = await post(
      "/api/v1/trust/disbursement-requests",
      disbursementBody(matterId, 120000),
    );
    expect(submitted.status).toBe(201);
    const { trustDisbursementRequestId, status } = (await submitted.json()) as {
      trustDisbursementRequestId: string;
      status: string;
    };
    expect(status).toBe("pending");

    // The owner relaxes the posture entirely — for NEW authorizations.
    const relaxed = await put("/api/v1/trust/authorization-policy", {
      policy: "off",
      requireAuthorizedApprover: false,
    });
    expect(relaxed.status).toBe(201);
    expect(await relaxed.json()).toMatchObject({ version: 3, policy: "off", setBy: ownerUserId });

    // The in-flight request still refuses the submitter's own approval.
    const selfApproval = await post(
      `/api/v1/trust/disbursement-requests/${trustDisbursementRequestId}/approval`,
      undefined,
    );
    expect(selfApproval.status).toBe(422);
    expect((await readJson<ProblemBody>(selfApproval)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-disbursement-authorization-refused",
    );

    // A payment raised under the relaxed posture is released in the same call, and the record says
    // on what footing.
    const relaxedRequest = await post(
      "/api/v1/trust/disbursement-requests",
      disbursementBody(matterId, 60000),
    );
    expect(relaxedRequest.status).toBe(201);
    expect(await relaxedRequest.json()).toMatchObject({
      status: "approved",
      authorizationBasis: "policy_exempt",
    });
  });

  it("routes the earned-fee application to somebody with the authority to act when the option is on", async () => {
    // A new version: no second person required, but whoever lets money go must hold trust:authorize.
    const changed = await put("/api/v1/trust/authorization-policy", {
      policy: "off",
      requireAuthorizedApprover: true,
    });
    expect(changed.status).toBe(201);

    // A finalized bill and the client's money in trust against its matter.
    const matterId = await openMatterWithClient("Application Matter");
    await depositToMatter(matterId, 800_00);
    const entryId = await seedBillableTime(matterId, 120);
    const created = await post("/api/v1/billing/invoices", {
      clientEntityId: ACME,
      currency: "USD",
    });
    const { invoiceId } = (await created.json()) as { invoiceId: string };
    await post(`/api/v1/billing/invoices/${invoiceId}/claims`, {
      claims: [{ sourceKind: "time_entry", sourceId: entryId }],
    });
    const finalized = await post(`/api/v1/billing/invoices/${invoiceId}/finalization`, {
      issueDate: todayInUtc(),
      dueDate: todayInUtc(),
    });
    expect(finalized.status).toBe(201);
    const { totalMinor } = (await finalized.json()) as { totalMinor: number };

    // The manager proposes taking the fee. Nothing moves.
    const submitted = await post(
      "/api/v1/billing/trust-application-requests",
      {
        trustAccountId,
        matterId,
        currency: "USD",
        effectiveDate: todayInUtc(),
        applications: [{ invoiceId, amountMinor: totalMinor }],
        trustDescription: "Earned fees transferred to operating",
        operatingDescription: "Earned fees received from trust",
        method: "electronic_transfer",
        payee: "The Firm — operating account",
        purpose: "Earned fees on finalized invoice",
      },
      managerCookie,
    );
    expect(submitted.status).toBe(201);
    const submission = (await submitted.json()) as {
      trustDisbursementRequestId: string;
      status: string;
      eligibleApprovers: { userId: string }[];
    };
    const requestId = submission.trustDisbursementRequestId;
    // The manager may act alone under the off posture, but does not hold the authority the firm
    // requires of whoever lets money go — so this queued rather than applied, and it says who can.
    expect(submission.status).toBe("pending");
    expect(submission.eligibleApprovers.map((approver) => approver.userId)).toContain(ownerUserId);

    // The shared queue shows it, labelled as what its approval will post.
    const queued = await get(
      `/api/v1/trust/disbursement-requests?trustAccountId=${trustAccountId}`,
      managerCookie,
    );
    const queue = (await queued.json()) as { requests: { id: string; kind: string }[] };
    expect(queue.requests).toContainEqual(
      expect.objectContaining({ id: requestId, kind: "earned_fee_application" }),
    );

    // And the guard behind the routing says the same thing: attempting the decision anyway is
    // refused, so the disposition is a face on the rule rather than the rule itself.
    const withoutAuthority = await post(
      `/api/v1/billing/trust-application-requests/${requestId}/approval`,
      undefined,
      managerCookie,
    );
    expect(withoutAuthority.status).toBe(422);
    expect((await readJson<ProblemBody>(withoutAuthority)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-disbursement-authorization-refused",
    );

    // The owner — holding trust:authorize — approves, and the bill is paid in one batch.
    const approved = await post(
      `/api/v1/billing/trust-application-requests/${requestId}/approval`,
      undefined,
    );
    expect(approved.status).toBe(201);
    const approval = (await approved.json()) as {
      trustDisbursementRequestId: string;
      authorizationBasis: string;
      transferId: string;
      totalMinor: number;
    };
    expect(approval).toMatchObject({
      trustDisbursementRequestId: requestId,
      authorizationBasis: "second_person",
      totalMinor,
    });

    const detail = await get(`/api/v1/billing/invoices/${invoiceId}`);
    const bill = (await detail.json()) as { appliedMinor: number; unpaidMinor: number };
    expect(bill.appliedMinor).toBe(totalMinor);
    expect(bill.unpaidMinor).toBe(0);

    // The transfer names the submitter, the approver, and the request it was approved from.
    const { results } = await firmDatabase
      .prepare(
        "SELECT recorded_by, authorized_by, approved_request_id FROM trust_transfer WHERE id = ?1",
      )
      .bind(approval.transferId)
      .all<{ recorded_by: string; authorized_by: string; approved_request_id: string }>();
    expect(results[0]).toEqual({
      recorded_by: managerUserId,
      authorized_by: ownerUserId,
      approved_request_id: requestId,
    });
  });

  it("answers a re-statement of the standing posture with 409, and shows the audited history", async () => {
    const restated = await put("/api/v1/trust/authorization-policy", {
      policy: "off",
      requireAuthorizedApprover: true,
    });
    expect(restated.status).toBe(409);
    expect((await readJson<ProblemBody>(restated)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-authorization-policy-conflict",
    );

    const response = await get("/api/v1/trust/authorization-policy");
    const body = (await response.json()) as {
      current: { version: number };
      history: { version: number; policy: string; setBy: string }[];
    };
    expect(body.current.version).toBe(4);
    expect(body.history.map((version) => [version.version, version.policy])).toEqual([
      [4, "off"],
      [3, "off"],
      [2, "always"],
      [1, "off"],
    ]);
    expect(body.history[0]?.setBy).toBe(ownerUserId);
  });
});
