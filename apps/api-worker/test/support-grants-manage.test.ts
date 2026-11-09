import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import { insertSupportGrantStatement } from "@magna-carta/data-access/support-access-statements";

// A single firm seeded once; its per-firm data lives in the FirmDatabase Durable Object
// (addressed by firmId, self-migrating on first access).
let poolFirmId: FirmId;
let mgrUserId: UserId;
let mgrCookie: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Support Manage Test Firm" })).firmId;
  // Seed the member who will manage grants. Admin carries support:manage and support:cosign
  // (seeded to every default role in the per-firm migrations). The FirmDatabase DO self-migrates
  // on first mirrorMemberWithOwnerRole access, applying those role_permission rows automatically.
  const seeded = await seedCredentialedUser("mgr@example.com", { firmId: poolFirmId });
  mgrUserId = seeded.userId;
  await mirrorMemberWithOwnerRole(mgrUserId, "Support Manager", poolFirmId);
  mgrCookie = await signInForSessionCookie("mgr@example.com");
});

describe("POST /api/v1/support/grants/{grantId}/revoke", () => {
  it("revoke via firm-A admin does NOT mutate a grant in firm B (cross-firm isolation)", async () => {
    // Seed a second firm (firm B) and insert an active grant into it. Firm-A's authenticated
    // admin then attempts to revoke firm-B's grant — the route and the guarded UPDATE must both
    // reject it, returning 404 and leaving the grant untouched.
    const { firmId: firmBId } = await seedFirm({ name: `Firm B Cross-Firm ${Date.now()}` });
    const grantBId = newIdentifier("supportGrant");
    const now = new Date().toISOString();
    await insertSupportGrantStatement(env.DB_CONTROL as never, {
      id: grantBId,
      firmId: firmBId,
      requestedByUserId: mgrUserId,
      tier: "diagnostic",
      status: "active",
      reason: null,
      requiresCosign: false,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      now,
    }).run();

    // Firm-A admin attempts to revoke a grant that belongs to firm B.
    const res = await SELF.fetch(`https://example.com/api/v1/support/grants/${grantBId}/revoke`, {
      method: "POST",
      headers: {
        origin: "https://example.com",
        cookie: mgrCookie,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(404);

    // The grant in firm B must still be active — no cross-firm mutation.
    const row = await env.DB_CONTROL.prepare("SELECT status FROM support_grant WHERE id = ?1")
      .bind(grantBId)
      .first<{ status: string }>();
    expect(row?.status).toBe("active");
  });

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

  it("cosign via firm-A admin does NOT mutate a grant in firm B (cross-firm isolation)", async () => {
    // Seed a second firm (firm B) and insert a privileged requested grant there. Firm-A's
    // authenticated admin attempts to cosign firm-B's grant — the route and the guarded UPDATE
    // must both reject it, returning 404 and leaving the grant status untouched.
    const { firmId: firmBId } = await seedFirm({ name: `Firm B Cosign Cross-Firm ${Date.now()}` });
    const grantBId = newIdentifier("supportGrant");
    const now = new Date().toISOString();
    await insertSupportGrantStatement(env.DB_CONTROL as never, {
      id: grantBId,
      firmId: firmBId,
      requestedByUserId: mgrUserId,
      tier: "privileged",
      status: "requested",
      reason: "access needed",
      requiresCosign: true,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      now,
    }).run();

    // Firm-A admin attempts to cosign a grant that belongs to firm B.
    const res = await SELF.fetch(`https://example.com/api/v1/support/grants/${grantBId}/cosign`, {
      method: "POST",
      headers: {
        origin: "https://example.com",
        cookie: mgrCookie,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(404);

    // The grant in firm B must still be in the requested state — no cross-firm mutation.
    const row = await env.DB_CONTROL.prepare("SELECT status FROM support_grant WHERE id = ?1")
      .bind(grantBId)
      .first<{ status: string }>();
    expect(row?.status).toBe("requested");
  });
});
