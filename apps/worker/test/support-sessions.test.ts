import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import {
  insertPlatformStaffStatement,
  insertSupportGrantStatement,
} from "@magna-carta/data-access/support-access-statements";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

async function seedStaff(role: "support" | "support_lead") {
  const id = newIdentifier("platformStaff");
  await insertPlatformStaffStatement(env.DB_CONTROL as never, {
    id,
    email: `${id}@staff.example`,
    displayName: "Staff",
    role,
    now: new Date().toISOString(),
  }).run();
  return id;
}

async function seedActiveGrant(tier: "diagnostic" | "privileged") {
  const { firmId } = await seedFirm();
  const grantId = newIdentifier("supportGrant");
  await insertSupportGrantStatement(env.DB_CONTROL as never, {
    id: grantId,
    firmId,
    requestedByUserId: newIdentifier("user"),
    tier,
    status: "active",
    reason: null,
    requiresCosign: false,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    now: new Date().toISOString(),
  }).run();
  return grantId;
}

function redeem(body: unknown, withKey = true, idempotencyKey = crypto.randomUUID()) {
  return SELF.fetch("https://example.com/api/v1/support/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": idempotencyKey,
      ...(withKey ? { "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("staff redeem", () => {
  it("mints a token for a support principal on a diagnostic grant", async () => {
    const principalId = await seedStaff("support");
    const grantId = await seedActiveGrant("diagnostic");
    const res = await redeem({ grantId, principalId });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; tier: string };
    expect(body.tier).toBe("diagnostic");
    expect(body.token.includes(".")).toBe(true);
  });

  it("rejects a privileged grant for a non-lead principal (403)", async () => {
    const principalId = await seedStaff("support");
    const grantId = await seedActiveGrant("privileged");
    const res = await redeem({ grantId, principalId });
    expect(res.status).toBe(403);
  });

  it("requires the platform-admin key (401 without it)", async () => {
    const principalId = await seedStaff("support");
    const grantId = await seedActiveGrant("diagnostic");
    const res = await redeem({ grantId, principalId }, false);
    expect(res.status).toBe(401);
  });

  it("mints a token for a support_lead principal on a privileged grant", async () => {
    const principalId = await seedStaff("support_lead");
    const grantId = await seedActiveGrant("privileged");
    const res = await redeem({ grantId, principalId });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; tier: string };
    expect(body.tier).toBe("privileged");
    expect(body.token.includes(".")).toBe(true);
  });

  it("replays the stored 201 on a same-key retry (idempotency)", async () => {
    const principalId = await seedStaff("support");
    const grantId = await seedActiveGrant("diagnostic");
    const key = crypto.randomUUID();
    const res1 = await redeem({ grantId, principalId }, true, key);
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as { token: string };
    const res2 = await redeem({ grantId, principalId }, true, key);
    expect(res2.status).toBe(201);
    expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
    const body2 = (await res2.json()) as { token: string };
    expect(body2.token).toBe(body1.token);
  });

  it("second redeem with a DIFFERENT Idempotency-Key on an already-redeemed grant returns 404 (single-use)", async () => {
    // Ensures that a second principal cannot hijack a grant by using a different Idempotency-Key.
    // The first redeem stamps principal_id; subsequent new-key redeems must be refused.
    const principalId1 = await seedStaff("support");
    const principalId2 = await seedStaff("support");
    const grantId = await seedActiveGrant("diagnostic");

    const res1 = await redeem({ grantId, principalId: principalId1 });
    expect(res1.status).toBe(201);

    // Different Idempotency-Key — not a replay, a new request for the same grant.
    const res2 = await redeem({ grantId, principalId: principalId2 });
    expect(res2.status).toBe(404);

    // Only the first principal should be stamped on the grant row.
    const row = await env.DB_CONTROL.prepare("SELECT principal_id FROM support_grant WHERE id = ?1")
      .bind(grantId)
      .first<{ principal_id: string | null }>();
    expect(row?.principal_id).toBe(principalId1);
  });

  it("returns 404 for a grantId that does not exist", async () => {
    const principalId = await seedStaff("support");
    const res = await redeem({ grantId: newIdentifier("supportGrant"), principalId });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a grant that has been revoked before redeem", async () => {
    const principalId = await seedStaff("support");
    const grantId = await seedActiveGrant("diagnostic");
    await env.DB_CONTROL.prepare("UPDATE support_grant SET status = 'revoked' WHERE id = ?1")
      .bind(grantId)
      .run();
    const res = await redeem({ grantId, principalId });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a principalId that was never inserted", async () => {
    const grantId = await seedActiveGrant("diagnostic");
    const res = await redeem({ grantId, principalId: newIdentifier("platformStaff") });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a principal inserted with status disabled", async () => {
    const principalId = await seedStaff("support");
    await env.DB_CONTROL.prepare("UPDATE platform_staff SET status = 'disabled' WHERE id = ?1")
      .bind(principalId)
      .run();
    const grantId = await seedActiveGrant("diagnostic");
    const res = await redeem({ grantId, principalId });
    expect(res.status).toBe(404);
  });
});
