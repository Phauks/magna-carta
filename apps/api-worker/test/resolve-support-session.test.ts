import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedFirm } from "./support/test-auth.ts";
import { resolveSupportSession } from "../src/http/resolve-support-session.ts";
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
  await redeemSupportGrantStatement(env.DB_CONTROL as never, {
    id: grantId,
    principalId,
    firmId,
  }).run();
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

  it("returns null for a grant whose expiresAt is in the past (time-box, distinct from revocation)", async () => {
    // Insert a grant that expired 1 second ago, but mint a token with a future exp. The token
    // passes verifySupportSessionToken (future exp), but supportGrantUsable rejects the expired
    // grant row — proving the live grant row is the authoritative source for expiry.
    const { firmId } = await seedFirm();
    const requesterUserId = newIdentifier("user");
    const grantId = newIdentifier("supportGrant");
    const principalId = newIdentifier("platformStaff");
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiredAt = new Date(nowMs - 1000).toISOString(); // 1 second ago

    await insertSupportGrantStatement(env.DB_CONTROL as never, {
      id: grantId,
      firmId,
      requestedByUserId: requesterUserId,
      tier: "diagnostic",
      status: "active",
      reason: null,
      requiresCosign: false,
      expiresAt: expiredAt,
      now: nowIso,
    }).run();
    await redeemSupportGrantStatement(env.DB_CONTROL as never, {
      id: grantId,
      principalId,
      firmId,
    }).run();
    await insertPlatformStaffStatement(env.DB_CONTROL as never, {
      id: principalId,
      email: `staff-expired-${principalId}@example.com`,
      displayName: "Expired Grant Staff",
      role: "support",
      now: nowIso,
    }).run();

    // Token has a future exp so verifySupportSessionToken passes, but the grant's expiresAt is
    // in the past so supportGrantUsable rejects it.
    const token = await mintSupportSessionToken(env.AUTH_SECRET, {
      grantId,
      principalId,
      firmId,
      requesterUserId,
      tier: "diagnostic",
      exp: Math.floor((nowMs + 3_600_000) / 1000),
    });

    const nowSeconds = Math.floor(nowMs / 1000);
    expect(await resolveSupportSession(env, ctxWith(token) as never, nowSeconds)).toBeNull();
  });

  it("returns null (never throws) when the grant row has a malformed requested_by_user_id", async () => {
    // Insert a support_grant row via raw SQL with a value that does not match the 'user_' prefix.
    // A valid token for this grant must produce null — not an uncaught 500 — proving the
    // never-throw contract holds for corrupt DB rows.
    const { firmId } = await seedFirm();
    const grantId = newIdentifier("supportGrant");
    const principalId = newIdentifier("platformStaff");
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + 3_600_000).toISOString();

    await env.DB_CONTROL.prepare(
      `INSERT INTO support_grant (id, firm_id, requested_by_user_id, tier, scope, status, reason, requires_cosign, expires_at, created_at)
       VALUES (?1, ?2, 'MALFORMED_NOT_A_USER_ID', 'diagnostic', 'self', 'active', NULL, 0, ?3, ?4)`,
    )
      .bind(grantId, firmId, expiresAt, nowIso)
      .run();
    await env.DB_CONTROL.prepare(`UPDATE support_grant SET principal_id = ?1 WHERE id = ?2`)
      .bind(principalId, grantId)
      .run();
    await insertPlatformStaffStatement(env.DB_CONTROL as never, {
      id: principalId,
      email: `staff-malformed-${principalId}@example.com`,
      displayName: "Malformed Row Staff",
      role: "support",
      now: nowIso,
    }).run();

    const token = await mintSupportSessionToken(env.AUTH_SECRET, {
      grantId,
      principalId,
      firmId,
      requesterUserId: newIdentifier("user"),
      tier: "diagnostic",
      exp: Math.floor(Date.parse(expiresAt) / 1000),
    });

    const nowSeconds = Math.floor(nowMs / 1000);
    await expect(
      resolveSupportSession(env, ctxWith(token) as never, nowSeconds),
    ).resolves.toBeNull();
  });
});
