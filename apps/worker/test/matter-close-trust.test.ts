import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
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

// The close gate over real Miniflare bindings: a matter whose client trust ledger still holds money
// does not close, and the refusal a client receives carries the balance, where it sits, and the
// movements that clear it. The domain suites prove the rule; what is proved here is that this app
// registers it against the matter shell's close hook at all — a rule the composition root forgets to
// hand over is a rule that silently does not exist.
//
// Its own firm, because the chokepoint's per-firm rate bucket is shared by every request a file makes.

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let trustAccountId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const todayInUtc = () => new Date().toISOString().slice(0, 10);
const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };

function post(path: string, body?: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// The matter's client party, recorded straight into the firm database because there is no HTTP
// surface for it yet. A trust ledger's client attribution is derived from this link, so a matter
// without one holds no client money at all.
async function openMatter(title: string, clientEntityId: string): Promise<string> {
  const created = await post("/api/v1/matters", {
    title,
    status: "open",
    responsibleMemberId: ownerUserId,
  });
  const matterId = (await created.json()).matterId as string;
  await firmDatabase
    .prepare(
      "INSERT INTO matter_party (id, matter_id, entity_id, role, created_at, updated_at) VALUES (?1, ?2, ?3, 'client', ?4, ?4)",
    )
    .bind(newIdentifier("matterParty"), matterId, clientEntityId, clock.now())
    .run();
  return matterId;
}

interface ProblemBody {
  type: string;
  status: number;
  errors?: { code: string; detail: string }[];
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Matter Close Trust Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("matter-close-owner@example.com", {
    userName: "Close Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Close Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("matter-close-owner@example.com");

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
        { kind: "literal", text: "CLS-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  // Opening a trust account has no HTTP surface yet, so it is seeded through the domain package the
  // same way the account-management surface will build it.
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

describe("closing a matter against its trust ledger", () => {
  it("closes a matter that never held client money", async () => {
    const matterId = await openMatter("No Trust Ledger Matter", "entity_none");

    const closed = await post(`/api/v1/matters/${matterId}/close`);

    expect(closed.status).toBe(200);
  });

  it("refuses a matter whose client ledger still holds money, and says what clears it", async () => {
    const matterId = await openMatter("Funds Held Matter", "entity_held");
    const deposited = await post("/api/v1/trust/deposits", {
      trustAccountId,
      matterId,
      amountMinor: 320000,
      currency: "USD",
      effectiveDate: todayInUtc(),
      description: "Retainer received",
      method: "check",
      reference: "3300",
      source: "Held Holdings",
      purpose: "Advance on fees and costs",
    });
    expect(deposited.status).toBe(201);

    const refused = await post(`/api/v1/matters/${matterId}/close`);

    expect(refused.status).toBe(409);
    expect(refused.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await refused.json()) as ProblemBody;
    expect(problem.type).toBe("https://api.magnacarta.esq/problems/matter-close-refused");
    expect(problem.errors?.[0]?.code).toBe("trust-balance-not-zero");
    expect(problem.errors?.[0]?.detail).toContain("$3,200.00");
    expect(problem.errors?.[0]?.detail).toContain("IOLTA — Reno");
    expect(problem.errors?.[0]?.detail).toContain("disburse the remaining funds to the client");
  });

  it("closes once the balance has been paid back out", async () => {
    const matterId = await openMatter("Emptied Matter", "entity_emptied");
    await post("/api/v1/trust/deposits", {
      trustAccountId,
      matterId,
      amountMinor: 150000,
      currency: "USD",
      effectiveDate: todayInUtc(),
      description: "Retainer received",
      method: "check",
      reference: "3301",
      source: "Emptied Holdings",
      purpose: "Advance on fees and costs",
    });
    const requested = await post("/api/v1/trust/disbursement-requests", {
      trustAccountId,
      matterId,
      amountMinor: 150000,
      currency: "USD",
      effectiveDate: todayInUtc(),
      description: "Unused retainer returned",
      method: "check",
      reference: "3302",
      payee: "Emptied Holdings",
      purpose: "Refund of unused retainer",
    });
    expect(requested.status).toBe(201);
    // This member holds the authority to act on client money, and the firm's posture asks for no
    // second person, so the refund is proposed and paid in the one call — which is the only call
    // that touches the client ledger.
    expect(await requested.json()).toMatchObject({
      status: "approved",
      authorizationBasis: "policy_exempt",
    });

    const closed = await post(`/api/v1/matters/${matterId}/close`);

    expect(closed.status).toBe(200);
  });
});
