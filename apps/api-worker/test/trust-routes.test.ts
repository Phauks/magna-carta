import { civilDateOf, todayInUtc } from "@magna-carta/civil-time/civil-date";
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

// The trust-movement HTTP surface over real Miniflare bindings. What is proved here is the wiring the
// domain suites cannot reach: that the chokepoint gates these routes on trust:manage, that a movement
// commits its ledger entry, its balances, and its client-ledger record in ONE idempotent batch, that a
// replayed Idempotency-Key does not move the money twice, and that each trust refusal surfaces as the
// status a client can act on.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let noTrustCookie: string;
let clerkCookie: string;
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

// The matter's client party, recorded straight into the firm database because there is no HTTP
// surface for it yet. It is not decoration on these routes: a trust ledger's client attribution is
// DERIVED from this link, so a matter without one holds no client money at all.
async function recordClientParty(matterId: string, clientEntityId: string): Promise<void> {
  await firmDatabase
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
    )
    .bind(newIdentifier("matterParty"), matterId, clientEntityId, clock.now())
    .run();
}

async function openMatter(title: string, clientEntityId = "entity_webb"): Promise<string> {
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
  const matterId = (await readJson<{ matterId: string }>(created)).matterId;
  await recordClientParty(matterId, clientEntityId);
  return matterId;
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

  // A member who may do the bookkeeping but has NOT been given the authority to act on client
  // money: exactly the member the firm's posture routes to somebody else.
  const clerk = await seedCredentialedUser("trust-clerk@example.com", {
    userName: "Trust Clerk",
    firmId: poolFirmId,
  });
  await mirrorMemberWithDirectGrant(clerk.userId, "Trust Clerk", "trust:manage");
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, 'trust:read', ?2, NULL, ?3)",
    )
    .bind(newIdentifier("grant"), clerk.userId, clock.now())
    .run();
  clerkCookie = await signInForSessionCookie("trust-clerk@example.com");

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

// This firm runs the posture every per-firm database is seeded with: a member holding the authority
// to act on client money releases a payment alone, and a member without it raises one that waits.
// The owner holds the authority through the Owner role; the clerk below holds only the bookkeeping
// capability. The two-person suite, over a firm that has written the strict posture, is
// trust-authorization-routes.test.ts.
describe("trust movement routes", () => {
  it("deposits, releases a disbursement in ONE call for an authorized member, and reads the client ledger back", async () => {
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
      authorizationBasis: string | null;
      trustMovementId: string | null;
      eligibleApprovers: { userId: string }[];
    };
    expect(requestAck.trustDisbursementRequestId).toMatch(/^trustDisbursementRequest_/);
    // One call: proposed and released, with the footing on the record rather than left for a reader
    // to infer from two matching handles. Nobody is waiting on anybody, so nobody is named.
    expect(requestAck.status).toBe("approved");
    expect(requestAck.authorizationBasis).toBe("policy_exempt");
    expect(requestAck.trustMovementId).toMatch(/^trustMovement_/);
    expect(requestAck.eligibleApprovers).toEqual([]);

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
    expect(body.movements[1]?.authorizationBasis).toBe("policy_exempt");
  });

  it("routes a member WITHOUT the authority to one who has it, moving nothing and naming who can", async () => {
    const matterId = await openMatter("Trust Routing Matter", "entity_routing");
    expect((await post("/api/v1/trust/deposits", depositBody(matterId, 500000))).status).toBe(201);

    // The clerk can reach the route — the chokepoint gates it on trust:manage, which they hold — and
    // still cannot be the person who releases the money.
    const requested = await post(
      "/api/v1/trust/disbursement-requests",
      disbursementBody(matterId, 120000),
      clerkCookie,
    );
    expect(requested.status).toBe(201);
    const ack = (await requested.json()) as {
      trustDisbursementRequestId: string;
      status: string;
      authorizationBasis: string | null;
      trustMovementId: string | null;
      eligibleApprovers: { userId: string; displayName: string }[];
    };
    expect(ack.status).toBe("pending");
    expect(ack.authorizationBasis).toBeNull();
    expect(ack.trustMovementId).toBeNull();
    // The refusal a member cannot act on is the one that says only that somebody must: this names
    // the member who can.
    expect(ack.eligibleApprovers.map((approver) => approver.userId)).toEqual([ownerUserId]);

    const beforeApproval = await get(
      `/api/v1/trust/matters/${matterId}/ledger?trustAccountId=${trustAccountId}`,
    );
    expect((await readJson<{ balanceMinor: number }>(beforeApproval)).balanceMinor).toBe(500000);

    // The clerk cannot settle their own request either, and the refusal is a status a client acts on.
    const selfApproval = await post(
      `/api/v1/trust/disbursement-requests/${ack.trustDisbursementRequestId}/approval`,
      undefined,
      clerkCookie,
    );
    expect(selfApproval.status).toBe(422);

    const approved = await post(
      `/api/v1/trust/disbursement-requests/${ack.trustDisbursementRequestId}/approval`,
      undefined,
    );
    expect(approved.status).toBe(201);
    expect(await approved.json()).toMatchObject({ authorizationBasis: "second_person" });
    const after = await get(
      `/api/v1/trust/matters/${matterId}/ledger?trustAccountId=${trustAccountId}`,
    );
    expect((await readJson<{ balanceMinor: number }>(after)).balanceMinor).toBe(380000);
  });

  it("replays a repeated Idempotency-Key instead of moving the money twice", async () => {
    const matterId = await openMatter("Trust Replay Matter");
    const key = crypto.randomUUID();
    const body = depositBody(matterId, 250000);

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
      body: JSON.stringify(depositBody(matterId, 100000)),
    });
    expect(response.status).toBe(400);
  });

  it("refuses every trust route to a member without the capability", async () => {
    const matterId = await openMatter("Trust Denied Matter");
    const deposit = await post(
      "/api/v1/trust/deposits",
      depositBody(matterId, 100000),
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
    expect((await post("/api/v1/trust/deposits", depositBody(matterId, 100000))).status).toBe(201);

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
    const sourceMatterId = await openMatter("Trust Transfer Source", "entity_move");
    const destinationMatterId = await openMatter("Trust Transfer Destination", "entity_move");
    const otherClientMatterId = await openMatter(
      "Trust Transfer Other Client",
      "entity_someone_else",
    );
    expect((await post("/api/v1/trust/deposits", depositBody(sourceMatterId, 400000))).status).toBe(
      201,
    );

    const moved = await post("/api/v1/trust/matter-transfers", {
      trustAccountId,
      fromMatterId: sourceMatterId,
      toMatterId: destinationMatterId,
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
    expect((await readJson<{ balanceMinor: number }>(destination)).balanceMinor).toBe(150000);

    const refused = await post("/api/v1/trust/matter-transfers", {
      trustAccountId,
      fromMatterId: sourceMatterId,
      toMatterId: otherClientMatterId,
      amountMinor: 10000,
      currency: "USD",
      effectiveDate: todayInUtc(),
      description: "Funds moved",
      purpose: "Reallocation",
    });
    expect(refused.status).toBe(422);
    expect((await readJson<ProblemBody>(refused)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-movement-refused",
    );
  });

  // The traced attack, sent verbatim over HTTP. A member holding trust:manage aimed a transfer at
  // another client's matter and named the SOURCE client beside it; the destination leaf did not
  // exist, so it was created attributed to the source client, the composition guard was told the
  // same thing, and $5,000 of one client's money landed on another client's matter file — readable,
  // disbursable, and blocking that matter's close. The field is gone from the contract, so the
  // assertion is now unsendable; the destination's client comes from its own matter.
  it("refuses the cross-client transfer even when the old client assertion is still sent", async () => {
    const sourceMatterId = await openMatter("Attack Source", "entity_attacker");
    const victimMatterId = await openMatter("Attack Victim", "entity_victim");
    expect((await post("/api/v1/trust/deposits", depositBody(sourceMatterId, 500000))).status).toBe(
      201,
    );

    const refused = await post("/api/v1/trust/matter-transfers", {
      trustAccountId,
      fromMatterId: sourceMatterId,
      toMatterId: victimMatterId,
      // The assertion that used to carry the whole attack. It names the SOURCE's client beside the
      // VICTIM's matter; the contract no longer has a field for it, so it is not read.
      toClientEntityId: "entity_attacker",
      amountMinor: 500000,
      currency: "USD",
      effectiveDate: todayInUtc(),
      description: "Funds reallocated",
      purpose: "Reallocation",
    });
    expect(refused.status).toBe(422);
    expect((await readJson<ProblemBody>(refused)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-movement-refused",
    );

    // And the victim's matter holds no trust ledger at all — nothing was created on the way to the
    // refusal, so there is nothing to read, nothing to disburse, and nothing blocking its close.
    const victimLedger = await get(
      `/api/v1/trust/matters/${victimMatterId}/ledger?trustAccountId=${trustAccountId}`,
    );
    expect(victimLedger.status).toBe(404);
  });

  it("refuses a deposit onto a matter with no client party to attribute it to", async () => {
    const created = await post("/api/v1/matters", {
      title: "Unattributed Matter",
      status: "open",
      responsibleMemberId: ownerUserId,
    });
    const matterId = (await readJson<{ matterId: string }>(created)).matterId;
    const refused = await post("/api/v1/trust/deposits", depositBody(matterId, 100000));
    expect(refused.status).toBe(422);
    expect((await readJson<ProblemBody>(refused)).type).toBe(
      "https://api.magnacarta.esq/problems/trust-movement-refused",
    );
  });

  // The ledger's own refusals are ordinary bad input on a money route, and every one of them used to
  // escape to the app's error boundary as a 500 with an Error ID: a member typing next week's date
  // was told the platform had a bug. The route contract declares a 422 for a refused movement.
  it("answers a future effective date with the ledger's 422 rather than a 500", async () => {
    const matterId = await openMatter("Future Dated Matter", "entity_future");
    const tomorrow = civilDateOf(new Date(Date.now() + 86_400_000));
    const refused = await post("/api/v1/trust/deposits", {
      ...depositBody(matterId, 100000),
      effectiveDate: tomorrow,
    });
    expect(refused.status).toBe(422);
    const body = await readJson<ProblemBody>(refused);
    expect(body.type).toBe("https://api.magnacarta.esq/problems/ledger-entry-refused");
    expect(body.detail).toContain(tomorrow);
  });

  it("refuses a date that is not a day at the request shape, before the ledger sees it", async () => {
    const matterId = await openMatter("Impossible Date Matter", "entity_impossible");
    const refused = await post("/api/v1/trust/deposits", {
      ...depositBody(matterId, 100000),
      effectiveDate: "2026-02-30",
    });
    // The app's request-shape hook, not the ledger: 2026-02-30 passes a bare YYYY-MM-DD regex and is
    // not a day, so it never reaches a composer at all.
    expect(refused.status).toBe(422);
    expect((await readJson<ProblemBody>(refused)).type).toBe(
      "https://api.magnacarta.esq/problems/validation",
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
