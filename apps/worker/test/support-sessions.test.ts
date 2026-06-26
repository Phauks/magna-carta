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

function redeem(body: unknown, withKey = true) {
  return SELF.fetch("https://example.com/api/v1/support/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
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
});
