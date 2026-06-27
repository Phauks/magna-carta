import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import { resolveSupportSession } from "../src/support/resolve-support-session.ts";
import { mintSupportSessionToken } from "../src/support/support-session-token.ts";
import {
  insertPlatformStaffStatement,
  insertSupportGrantStatement,
  redeemSupportGrantStatement,
} from "@magna-carta/data-access/support-access-statements";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

function ctxWith(token: string | undefined): {
  req: { header: (n: string) => string | undefined };
  env: typeof env;
} {
  return {
    env,
    req: { header: (name: string) => (name === "X-Support-Session" ? token : undefined) },
  } as never;
}

async function seedActiveGrant(tier: "diagnostic" | "privileged") {
  const { firmId } = await seedFirm();
  const requesterUserId = newIdentifier("user");
  const grantId = newIdentifier("supportGrant");
  const principalId = newIdentifier("platformStaff");
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 3_600_000).toISOString();
  await insertSupportGrantStatement(env.DB_CONTROL as never, {
    id: grantId,
    firmId,
    requestedByUserId: requesterUserId,
    tier,
    status: "active",
    reason: null,
    requiresCosign: false,
    expiresAt,
    now: nowIso,
  }).run();
  await redeemSupportGrantStatement(env.DB_CONTROL as never, { id: grantId, principalId }).run();
  // Seed the platform_staff row so the per-request liveness check finds an active principal.
  await insertPlatformStaffStatement(env.DB_CONTROL as never, {
    id: principalId,
    email: `staff-${principalId}@example.com`,
    displayName: "Test Staff",
    role: "support",
    now: nowIso,
  }).run();
  const token = await mintSupportSessionToken(env.AUTH_SECRET, {
    grantId,
    principalId,
    firmId,
    requesterUserId,
    tier,
    exp: Math.floor(Date.parse(expiresAt) / 1000),
  });
  return { firmId, requesterUserId, grantId, principalId, token, expiresAt };
}

describe("resolveSupportSession", () => {
  it("returns null with no header", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(await resolveSupportSession(env, ctxWith(undefined) as never, nowSeconds)).toBeNull();
  });

  it("resolves an active grant to a support session (firm + requester from the grant row)", async () => {
    const seed = await seedActiveGrant("diagnostic");
    const nowSeconds = Math.floor(Date.now() / 1000);
    const session = await resolveSupportSession(env, ctxWith(seed.token) as never, nowSeconds);
    expect(session?.firmId).toBe(seed.firmId);
    expect(session?.userId).toBe(seed.requesterUserId);
    expect(session?.support?.tier).toBe("diagnostic");
    expect(session?.support?.principalId).toBe(seed.principalId);
  });

  it("rejects a token whose grant was revoked (live check)", async () => {
    const seed = await seedActiveGrant("diagnostic");
    await env.DB_CONTROL.prepare("UPDATE support_grant SET status = 'revoked' WHERE id = ?1")
      .bind(seed.grantId)
      .run();
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(await resolveSupportSession(env, ctxWith(seed.token) as never, nowSeconds)).toBeNull();
  });

  it("rejects a token whose platform_staff principal has been disabled (live liveness check)", async () => {
    const seed = await seedActiveGrant("diagnostic");
    await env.DB_CONTROL.prepare("UPDATE platform_staff SET status = 'disabled' WHERE id = ?1")
      .bind(seed.principalId)
      .run();
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(await resolveSupportSession(env, ctxWith(seed.token) as never, nowSeconds)).toBeNull();
  });
});
