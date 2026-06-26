import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import { insertSupportGrantStatement } from "@magna-carta/data-access/support-access-statements";

// A single pool firm backed by DB_FIRM_POOL_1. Seeded once so database_identifier stays unique.
let poolFirmId: FirmId;
let mgrUserId: UserId;
let mgrCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (
    await seedFirm({
      name: "Support Manage Test Firm",
      databaseIdentifier: "DB_FIRM_POOL_1",
    })
  ).firmId;
  // Seed the member who will manage grants. Owner/Admin carries support:manage and support:cosign
  // (seeded to every default role in the per-firm migrations). The chokepoint resolves these
  // permissions through the role_permission rows applied by applyPerFirmMigrations.
  const seeded = await seedCredentialedUser("mgr@example.com", { firmId: poolFirmId });
  mgrUserId = seeded.userId;
  await mirrorMemberWithOwnerRole(mgrUserId, "Support Manager");
  mgrCookie = await signInForSessionCookie("mgr@example.com");
});

describe("POST /api/v1/support/grants/{grantId}/revoke", () => {
  it("an admin revokes an active grant (200, revoked)", async () => {
    const grantId = newIdentifier("supportGrant");
    const now = new Date().toISOString();
    await insertSupportGrantStatement(env.DB_CONTROL as never, {
      id: grantId,
      firmId: poolFirmId,
      requestedByUserId: mgrUserId,
      tier: "diagnostic",
      status: "active",
      reason: null,
      requiresCosign: false,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      now,
    }).run();
    const res = await SELF.fetch(`https://example.com/api/v1/support/grants/${grantId}/revoke`, {
      method: "POST",
      headers: {
        origin: "https://example.com",
        cookie: mgrCookie,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("revoked");
  });

  it("revoke of a grant belonging to a different firm is 404", async () => {
    // A grant ID that does not exist in this firm — the route must return 404 without
    // leaking whether the grant belongs to another firm (no existence oracle).
    const res = await SELF.fetch(
      `https://example.com/api/v1/support/grants/${newIdentifier("supportGrant")}/revoke`,
      {
        method: "POST",
        headers: {
          origin: "https://example.com",
          cookie: mgrCookie,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/support/grants/{grantId}/cosign", () => {
  it("an admin co-signs a requested grant (200, active)", async () => {
    // Insert a privileged grant that requires a co-sign (status=requested, requires_cosign=true).
    const grantId = newIdentifier("supportGrant");
    const now = new Date().toISOString();
    await insertSupportGrantStatement(env.DB_CONTROL as never, {
      id: grantId,
      firmId: poolFirmId,
      requestedByUserId: mgrUserId,
      tier: "privileged",
      status: "requested",
      reason: "access needed",
      requiresCosign: true,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      now,
    }).run();
    const res = await SELF.fetch(`https://example.com/api/v1/support/grants/${grantId}/cosign`, {
      method: "POST",
      headers: {
        origin: "https://example.com",
        cookie: mgrCookie,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("active");
  });

  it("cosign of a non-existent grant is 404", async () => {
    const res = await SELF.fetch(
      `https://example.com/api/v1/support/grants/${newIdentifier("supportGrant")}/cosign`,
      {
        method: "POST",
        headers: {
          origin: "https://example.com",
          cookie: mgrCookie,
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(404);
  });
});
