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
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The trust-movement HTTP surface over real Miniflare bindings. What is proved here is the wiring the
// domain suites cannot reach: that the chokepoint gates these routes on trust:manage, that a movement
// commits its ledger entry, its balances, and its client-ledger record in ONE idempotent batch, that a
// replayed Idempotency-Key does not move the money twice, and that each trust refusal surfaces as the
// status a client can act on.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let noTrustCookie: string;
let trustAccountId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };
const todayInUtc = () => new Date().toISOString().slice(0, 10);

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

async function openMatter(title: string): Promise<string> {
  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      title,
      status: "open",
      responsibleMemberId: ownerUserId,
    }),
  });
  return (await created.json()).matterId;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Trust Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("trust-owner@example.com", {
    userName: "Trust Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Trust Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("trust-owner@example.com");

  // A member with no trust capability at all — the chokepoint must refuse every route below.
  const noTrust = await seedCredentialedUser("trust-none@example.com", {
    userName: "No Trust",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrant(noTrust.userId, "No Trust", "firm:reportIncident");
  noTrustCookie = await signInForSessionCookie("trust-none@example.com");

  // A matter draws its number when it opens, so the firm needs a scheme before any matter exists.
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
        { kind: "literal", text: "TRS-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  // Opening a trust account has no HTTP surface yet, so the account is seeded through the domain
  // package the same way the account-management surface will build it.
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
});

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

function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

const depositBody = (matterId: string, amountMinor: number, clientEntityId = "entity_webb") => ({
  trustAccountId,
  matterId,
  clientEntityId,
  amountMinor,
  currency: "USD" as const,
  effectiveDate: todayInUtc(),
  description: "Retainer received",
  method: "check" as const,
  reference: "1041",
  source: "Webb Holdings",
  purpose: "Advance on fees and costs",
});

const disbursementBody = (matterId: string, amountMinor: number) => ({
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

// This firm has exactly one member holding trust:manage — the owner — which is the case the
// two-person rule has to answer honestly rather than by making disbursement impossible. The
// disbursement suite over a firm with several authorizers is trust-authorization-routes.test.ts.
describe("trust movement routes", () => {
  it("deposits, disburses through request and approval, and reads the client ledger back", async () => {
    const matterId = await openMatter("Trust Movement Matter");

    const deposited = await post("/api/v1/trust/deposits", depositBody(matterId, 500000));
    expect(deposited.status).toBe(201);
    const depositAck = (await deposited.json()) as { trustMovementId: string };
    expect(depositAck.trustMovementId).toMatch(/^trustMovement_/);

    const requested = await post(
      "/api/v1/trust/disbursement-requests",
      disbursementBody(matterId, 120000),
    );
    expect(requested.status).toBe(201);
    const requestAck = (await requested.json()) as {
      trustDisbursementRequestId: string;
      status: string;
    };
    expect(requestAck.trustDisbursementRequestId).toMatch(/^trustDisbursementRequest_/);
    expect(requestAck.status).toBe("pending");

    // The request on its own moves nothing.
    const beforeApproval = await get(
      `/api/v1/trust/matters/${matterId}/ledger?trustAccountId=${trustAccountId}`,
    );
    expect((await beforeApproval.json()).balanceMinor).toBe(500000);

    const approved = await post(
      `/api/v1/trust/disbursement-requests/${requestAck.trustDisbursementRequestId}/approval`,
      undefined,
    );
    expect(approved.status).toBe(201);
    // The sole trust manager approving their own request is recorded as exactly that, rather than
    // passing as an ordinary second-person approval.
    expect(await approved.json()).toMatchObject({
      authorizationBasis: "sole_trust_manager",
    });

    const ledger = await get(
      `/api/v1/trust/matters/${matterId}/ledger?trustAccountId=${trustAccountId}`,
    );
    expect(ledger.status).toBe(200);
    const body = (await ledger.json()) as {
      balanceMinor: number;
      heldMinor: number;
      availableMinor: number;
      movements: {
        kind: string;
        recordedBy: string;
        authorizedBy: string | null;
        counterpartyName: string | null;
        disbursementRequestId: string | null;
        authorizationBasis: string | null;
      }[];
    };
    expect(body.balanceMinor).toBe(380000);
    expect(body.heldMinor).toBe(0);
    expect(body.availableMinor).toBe(380000);
    expect(body.movements.map((movement) => movement.kind)).toEqual(["deposit", "disbursement"]);
    // The authorizing member is on the record for money going out, and only for money going out.
    expect(body.movements[0]?.authorizedBy).toBeNull();
    expect(body.movements[1]?.recordedBy).toBe(ownerUserId);
    expect(body.movements[1]?.authorizedBy).toBe(ownerUserId);
    expect(body.movements[1]?.counterpartyName).toBe("Second Judicial District Court");
    expect(body.movements[1]?.disbursementRequestId).toBe(requestAck.trustDisbursementRequestId);
    expect(body.movements[1]?.authorizationBasis).toBe("sole_trust_manager");
  });

  it("replays a repeated Idempotency-Key instead of moving the money twice", async () => {
    const matterId = await openMatter("Trust Replay Matter");
    const key = crypto.randomUUID();
    const body = depositBody(matterId, 250000, "entity_replay");

    const first = await post("/api/v1/trust/deposits", body, ownerCookie, key);
    expect(first.status).toBe(201);
    const second = await post("/api/v1/trust/deposits", body, ownerCookie, key);
    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await second.json()).toEqual(await first.json());

    const ledger = await get(
      `/api/v1/trust/matters/${matterId}/ledger?trustAccountId=${trustAccountId}`,
    );
    const read = (await ledger.json()) as { balanceMinor: number; movements: unknown[] };
    expect(read.balanceMinor).toBe(250000);
    expect(read.movements).toHaveLength(1);
  });

  it("refuses a deposit with no Idempotency-Key — money never moves on an unrepeatable request", async () => {
    const matterId = await openMatter("Trust Keyless Matter");
    const response = await SELF.fetch("https://example.com/api/v1/trust/deposits", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerCookie,
      },
      body: JSON.stringify(depositBody(matterId, 100000, "entity_keyless")),
    });
    expect(response.status).toBe(400);
  });

  it("refuses every trust route to a member without the capability", async () => {
    const matterId = await openMatter("Trust Denied Matter");
    const deposit = await post(
      "/api/v1/trust/deposits",
      depositBody(matterId, 100000, "entity_denied"),
      noTrustCookie,
    );
    expect(deposit.status).toBe(403);
    const requested = await post(
      "/api/v1/trust/disbursement-requests",
      disbursementBody(matterId, 100000),
      noTrustCookie,
    );
    expect(requested.status).toBe(403);
    const approved = await post(
      `/api/v1/trust/disbursement-requests/${newIdentifier("trustDisbursementRequest")}/approval`,
      undefined,
      noTrustCookie,
    );
    expect(approved.status).toBe(403);
    const ledger = await get(
      `/api/v1/trust/matters/${matterId}/ledger?trustAccountId=${trustAccountId}`,
      noTrustCookie,
    );
    expect(ledger.status).toBe(403);
    const queue = await get(
      `/api/v1/trust/disbursement-requests?trustAccountId=${trustAccountId}`,
      noTrustCookie,
    );
    expect(queue.status).toBe(403);
  });

  it("answers an over-available disbursement request with 409 and the trust problem type", async () => {
    const matterId = await openMatter("Trust Overdraw Matter");
    expect(
      (await post("/api/v1/trust/deposits", depositBody(matterId, 100000, "entity_overdraw")))
        .status,
    ).toBe(201);

    const response = await post("/api/v1/trust/disbursement-requests", {
      trustAccountId,
      matterId,
      amountMinor: 500000,
      currency: "USD",
      effectiveDate: todayInUtc(),
      description: "Payment to the client",
      method: "wire",
      payee: "A Webb",
      purpose: "Balance returned",
    });
    expect(response.status).toBe(409);
    const problem = (await response.json()) as { type: string };
    expect(problem.type).toBe("https://api.magnacarta.esq/problems/trust-insufficient-available");
  });

  it("answers an unknown disbursement request with 404", async () => {
    const response = await post(
      `/api/v1/trust/disbursement-requests/${newIdentifier("trustDisbursementRequest")}/approval`,
      undefined,
    );
    expect(response.status).toBe(404);
  });

  it("moves funds between two matters of one client, and refuses a move to another client", async () => {
    const sourceMatterId = await openMatter("Trust Transfer Source");
    const destinationMatterId = await openMatter("Trust Transfer Destination");
    const otherClientMatterId = await openMatter("Trust Transfer Other Client");
    expect(
      (await post("/api/v1/trust/deposits", depositBody(sourceMatterId, 400000, "entity_move")))
        .status,
    ).toBe(201);

    const moved = await post("/api/v1/trust/matter-transfers", {
      trustAccountId,
      fromMatterId: sourceMatterId,
      toMatterId: destinationMatterId,
      toClientEntityId: "entity_move",
      amountMinor: 150000,
      currency: "USD",
      effectiveDate: todayInUtc(),
      description: "Funds reallocated to the appeal",
      purpose: "Received against the wrong matter",
    });
    expect(moved.status).toBe(201);

    const destination = await get(
      `/api/v1/trust/matters/${destinationMatterId}/ledger?trustAccountId=${trustAccountId}`,
    );
    expect((await destination.json()).balanceMinor).toBe(150000);

    const refused = await post("/api/v1/trust/matter-transfers", {
      trustAccountId,
      fromMatterId: sourceMatterId,
      toMatterId: otherClientMatterId,
      toClientEntityId: "entity_someone_else",
      amountMinor: 10000,
      currency: "USD",
      effectiveDate: todayInUtc(),
      description: "Funds moved",
      purpose: "Reallocation",
    });
    expect(refused.status).toBe(422);
    expect((await refused.json()).type).toBe(
      "https://api.magnacarta.esq/problems/trust-movement-refused",
    );
  });

  it("answers a matter with no trust ledger with 404", async () => {
    const matterId = await openMatter("Trust Empty Matter");
    const ledger = await get(
      `/api/v1/trust/matters/${matterId}/ledger?trustAccountId=${trustAccountId}`,
    );
    expect(ledger.status).toBe(404);
  });
});
