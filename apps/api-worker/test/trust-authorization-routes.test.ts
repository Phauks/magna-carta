import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, LocationId, UserId } from "@magna-carta/identifiers/types";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
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

// What this suite reads off the matter-ledger reply — the fields of the route's
// TrustClientLedgerResponse that these assertions actually depend on.
interface LedgerBody {
  readonly trustLedgerNodeId: string;
  readonly balanceMinor: number;
  readonly movements: readonly {
    readonly kind: string;
    readonly recordedBy: string;
    readonly authorizedBy: string | null;
  }[];
}

// Two-person disbursement authorization over the HTTP surface, in a firm that has SEVERAL members
// holding trust:manage — which is the case the rule is really about. What is proved here is the
// wiring the domain suite cannot reach: that a request commits without moving money, that approval
// by a second member posts the movement in one idempotent batch, that the submitter's own approval
// is refused with a status a client can act on, that a request overtaken by other activity refuses
// rather than posting, and that a replayed key on either step never doubles anything.
//
// This suite seeds its own firm because the trust-movement suite deliberately runs a SINGLE-trust-
// manager firm, and the number of members holding the capability is exactly what decides which
// authorization basis is available.

let poolFirmId: FirmId;
let submitterCookie: string;
let submitterUserId: UserId;
let approverCookie: string;
let approverUserId: UserId;
let trustAccountId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };

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

function post(path: string, body: unknown, cookie: string, key?: string): Promise<Response> {
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

function get(path: string, cookie: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

// The matter's client party, recorded straight into the firm database because there is no HTTP
// surface for it yet. A trust ledger's client attribution is derived from this link, so a matter
// without one holds no client money at all.
async function openMatter(title: string, clientEntityId: string): Promise<string> {
  const created = await post(
    "/api/v1/matters",
    { title, status: "open", responsibleMemberId: submitterUserId },
    submitterCookie,
  );
  const matterId = (await readJson<{ matterId: string }>(created)).matterId;
  await firmDatabase
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
    )
    .bind(newIdentifier("matterParty"), matterId, clientEntityId, clock.now())
    .run();
  return matterId;
}

const depositBody = (matterId: string, amountMinor: number) => ({
  trustAccountId,
  matterId,
  amountMinor,
  currency: "USD" as const,
  effectiveDate: todayInUtc(),
  description: "Retainer received",
  method: "check" as const,
  reference: "1041",
  source: "Webb Holdings",
  purpose: "Advance on fees and costs",
});

const requestBody = (matterId: string, amountMinor: number) => ({
  trustAccountId,
  matterId,
  amountMinor,
  currency: "USD" as const,
  effectiveDate: todayInUtc(),
  description: "Filing fee paid on the client's behalf",
  method: "check" as const,
  reference: "2207",
  payee: "Second Judicial District Court",
  purpose: "Complaint filing fee",
});

// Funds a fresh matter and leaves one disbursement request pending on it.
async function pendingRequest(
  label: string,
  fundedMinor: number,
  requestedMinor: number,
): Promise<{ matterId: string; requestId: string }> {
  const matterId = await openMatter(label, `entity_${label.replace(/\W/g, "_").toLowerCase()}`);
  const deposited = await post(
    "/api/v1/trust/deposits",
    depositBody(matterId, fundedMinor),
    submitterCookie,
  );
  expect(deposited.status).toBe(201);
  const requested = await post(
    "/api/v1/trust/disbursement-requests",
    requestBody(matterId, requestedMinor),
    submitterCookie,
  );
  expect(requested.status).toBe(201);
  const ack = (await requested.json()) as {
    trustDisbursementRequestId: string;
    status: string;
  };
  // Under this firm's posture nothing is ever released by the submitter alone, so a submission that
  // came back `approved` would mean the suite is testing a different firm than it says it is.
  expect(ack.status).toBe("pending");
  return { matterId, requestId: ack.trustDisbursementRequestId };
}

const ledgerOf = async (matterId: string): Promise<LedgerBody> => {
  const response = await get(
    `/api/v1/trust/matters/${matterId}/ledger?trustAccountId=${trustAccountId}`,
    submitterCookie,
  );
  return await readJson<LedgerBody>(response);
};

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Trust Authorization Firm", databaseIdentifier: "DB_FIRM_POOL_2" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const submitter = await seedCredentialedUser("trust-submitter@example.com", {
    userName: "Submitting Attorney",
    firmId: poolFirmId,
  });
  submitterUserId = submitter.userId;
  await mirrorMemberWithOwnerRole(submitter.userId, "Submitting Attorney", poolFirmId);
  submitterCookie = await signInForSessionCookie("trust-submitter@example.com");

  // The second authorizer. Its existence is what makes the two-person rule bind in this firm and the
  // sole-trust-manager basis unavailable.
  const approver = await seedCredentialedUser("trust-approver@example.com", {
    userName: "Approving Attorney",
    firmId: poolFirmId,
  });
  approverUserId = approver.userId;
  await mirrorMemberWithDirectGrant(approver.userId, "Approving Attorney", "trust:manage");
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, 'trust:read', ?2, NULL, ?3)",
    )
    .bind(newIdentifier("grant"), approver.userId, clock.now())
    .run();
  approverCookie = await signInForSessionCookie("trust-approver@example.com");

  // A matter draws its number when it opens, so the firm needs a scheme before any matter exists.
  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: submitterCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "TRA-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  const locationId = newIdentifier("location") as LocationId;
  await firmDatabase
    .prepare(
      "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)",
    )
    .bind(locationId, "Reno", clock.now())
    .run();
  const opened = await openTrustAccount(
    firmDatabase,
    {
      name: "IOLTA — Reno",
      locationId,
      jurisdiction: "US-NV",
      currency: "USD",
      openedOn: "2026-08-01",
    },
    { clock },
  );
  await commitEffectBatch(firmDatabase, opened.effect, { now: () => clock.now() });
  trustAccountId = opened.trustAccountId;

  // This firm chooses the strict posture, through the route a firm administrator would use. Every
  // per-firm database is seeded with the authority-based one — a holder acts alone — so a suite
  // about the TWO-PERSON shape has to state what it is testing rather than inherit it. Authority is
  // left off here because who holds it is a separate axis, exercised in the trust package's own
  // authority suite; the approver below holds the bookkeeping capability only.
  const posture = await SELF.fetch("https://example.com/api/v1/trust/authorization-policy", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: submitterCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ policy: "always", requireAuthorizedApprover: false }),
  });
  expect(posture.status).toBe(201);
});

describe("two-person disbursement authorization", () => {
  it("holds the money until a second member approves, then posts it in that member's name", async () => {
    const { matterId, requestId } = await pendingRequest("Approval Matter", 500000, 120000);

    const queued = await get(
      `/api/v1/trust/disbursement-requests?trustAccountId=${trustAccountId}`,
      approverCookie,
    );
    expect(queued.status).toBe(200);
    const queue = (await queued.json()) as {
      requests: { id: string; payee: string; requestedBy: string }[];
    };
    expect(queue.requests).toContainEqual(
      expect.objectContaining({
        id: requestId,
        payee: "Second Judicial District Court",
        requestedBy: submitterUserId,
      }),
    );

    const before = await ledgerOf(matterId);
    expect(before.balanceMinor).toBe(500000);
    expect(before.movements.map((movement) => movement.kind)).toEqual(["deposit"]);

    const approved = await post(
      `/api/v1/trust/disbursement-requests/${requestId}/approval`,
      undefined,
      approverCookie,
    );
    expect(approved.status).toBe(201);
    expect(await approved.json()).toMatchObject({
      trustDisbursementRequestId: requestId,
      authorizationBasis: "second_person",
    });

    const after = await ledgerOf(matterId);
    expect(after.balanceMinor).toBe(380000);
    const disbursement = after.movements.find((movement) => movement.kind === "disbursement");
    // The two roles the split exists for: the submitter wrote the record, the approver let the money
    // go, and the movement can tell them apart.
    expect(disbursement).toMatchObject({
      recordedBy: submitterUserId,
      authorizedBy: approverUserId,
      authorizationBasis: "second_person",
      disbursementRequestId: requestId,
    });
  });

  it("refuses the submitter's own approval with 422 and moves nothing", async () => {
    const { matterId, requestId } = await pendingRequest("Self Approval Matter", 500000, 120000);
    const response = await post(
      `/api/v1/trust/disbursement-requests/${requestId}/approval`,
      undefined,
      submitterCookie,
    );
    expect(response.status).toBe(422);
    expect((await readJson<ProblemBody>(response)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-disbursement-authorization-refused",
    );
    expect((await ledgerOf(matterId)).balanceMinor).toBe(500000);
  });

  it("refuses a request the ledger can no longer fund, naming the shortfall", async () => {
    const { matterId, requestId } = await pendingRequest("Stale Matter", 500000, 400000);

    // The balance moves on between the proposal and the decision — here by an approved payment to
    // somebody else out of the same client ledger.
    const drain = await post(
      "/api/v1/trust/disbursement-requests",
      { ...requestBody(matterId, 300000), payee: "Reno Process Servers" },
      submitterCookie,
    );
    expect(drain.status).toBe(201);
    const drainId = (await readJson<{ trustDisbursementRequestId: string }>(drain))
      .trustDisbursementRequestId;
    expect(
      (
        await post(
          `/api/v1/trust/disbursement-requests/${drainId}/approval`,
          undefined,
          approverCookie,
        )
      ).status,
    ).toBe(201);

    const stale = await post(
      `/api/v1/trust/disbursement-requests/${requestId}/approval`,
      undefined,
      approverCookie,
    );
    expect(stale.status).toBe(409);
    const problem = (await stale.json()) as { type: string; detail: string };
    expect(problem.type).toBe("https://api.magnacarta.esq/problems/trust-insufficient-available");
    expect(problem.detail).toContain("400000");
    expect(problem.detail).toContain("200000");

    // Only the drain posted; the stale request is still pending and the ledger is untouched by it.
    const ledger = await ledgerOf(matterId);
    expect(ledger.balanceMinor).toBe(200000);
    expect(ledger.movements.filter((movement) => movement.kind === "disbursement")).toHaveLength(1);
  });

  it("replays a repeated Idempotency-Key on the submission rather than queuing a second request", async () => {
    const matterId = await openMatter("Replayed Submission Matter", "entity_replay_submission");
    expect(
      (await post("/api/v1/trust/deposits", depositBody(matterId, 500000), submitterCookie)).status,
    ).toBe(201);

    const key = crypto.randomUUID();
    const body = requestBody(matterId, 120000);
    const first = await post("/api/v1/trust/disbursement-requests", body, submitterCookie, key);
    const second = await post("/api/v1/trust/disbursement-requests", body, submitterCookie, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());

    const ledger = await ledgerOf(matterId);
    const queued = await get(
      `/api/v1/trust/disbursement-requests?trustAccountId=${trustAccountId}`,
      approverCookie,
    );
    const queue = (await queued.json()) as { requests: { trustLedgerNodeId: string }[] };
    expect(
      queue.requests.filter((request) => request.trustLedgerNodeId === ledger.trustLedgerNodeId),
    ).toHaveLength(1);
  });

  it("replays a repeated Idempotency-Key on the approval rather than paying twice", async () => {
    const { matterId, requestId } = await pendingRequest(
      "Replayed Approval Matter",
      500000,
      120000,
    );
    const key = crypto.randomUUID();
    const path = `/api/v1/trust/disbursement-requests/${requestId}/approval`;

    const first = await post(path, undefined, approverCookie, key);
    const second = await post(path, undefined, approverCookie, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());

    const ledger = await ledgerOf(matterId);
    expect(ledger.balanceMinor).toBe(380000);
    expect(ledger.movements.filter((movement) => movement.kind === "disbursement")).toHaveLength(1);
  });

  it("answers a second decision on a settled request with 409", async () => {
    const { requestId } = await pendingRequest("Settled Matter", 500000, 120000);
    expect(
      (
        await post(
          `/api/v1/trust/disbursement-requests/${requestId}/approval`,
          undefined,
          approverCookie,
        )
      ).status,
    ).toBe(201);

    const again = await post(
      `/api/v1/trust/disbursement-requests/${requestId}/rejection`,
      { reason: "Too late" },
      approverCookie,
    );
    expect(again.status).toBe(409);
    expect((await readJson<ProblemBody>(again)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-disbursement-not-pending",
    );
  });

  it("records a rejection with its reason and leaves the ledger alone", async () => {
    const { matterId, requestId } = await pendingRequest("Rejection Matter", 500000, 120000);
    const rejected = await post(
      `/api/v1/trust/disbursement-requests/${requestId}/rejection`,
      { reason: "The invoice this pays has not been approved" },
      approverCookie,
    );
    expect(rejected.status).toBe(201);
    expect(await rejected.json()).toMatchObject({
      trustDisbursementRequestId: requestId,
      decision: "rejected",
    });

    const ledger = await ledgerOf(matterId);
    expect(ledger.balanceMinor).toBe(500000);
    expect(ledger.movements.map((movement) => movement.kind)).toEqual(["deposit"]);
    const queued = await get(
      `/api/v1/trust/disbursement-requests?trustAccountId=${trustAccountId}`,
      approverCookie,
    );
    const queue = (await queued.json()) as { requests: { id: string }[] };
    expect(queue.requests.map((request) => request.id)).not.toContain(requestId);
  });

  it("lets the submitter withdraw their own request, and refuses anyone else's withdrawal", async () => {
    const { requestId } = await pendingRequest("Withdrawal Matter", 500000, 120000);

    const byOther = await post(
      `/api/v1/trust/disbursement-requests/${requestId}/withdrawal`,
      { reason: "Not mine to take back" },
      approverCookie,
    );
    expect(byOther.status).toBe(422);
    expect((await readJson<ProblemBody>(byOther)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-disbursement-authorization-refused",
    );

    const withdrawn = await post(
      `/api/v1/trust/disbursement-requests/${requestId}/withdrawal`,
      { reason: "Paid from the operating account instead" },
      submitterCookie,
    );
    expect(withdrawn.status).toBe(201);
    expect(await withdrawn.json()).toMatchObject({
      trustDisbursementRequestId: requestId,
      decision: "withdrawn",
    });
  });
});
