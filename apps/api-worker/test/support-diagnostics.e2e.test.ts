import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { insertPlatformStaffStatement } from "@magna-carta/data-access/support-access-statements";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A single firm seeded once; its per-firm data lives in the FirmDatabase Durable Object
// (addressed by firmId, self-migrating on first access).
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Support Diagnostics Test Firm" })).firmId;
  // Seed a member with the Admin role so they carry support:request (seeded to every default
  // role by the per-firm DO migrations) but NOT diagnostics:overview (never seeded to any firm role).
  const { userId } = await seedCredentialedUser("diag-e2e@example.com", { firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, "Diagnostics E2E Member", poolFirmId);
});

const DIAGNOSTIC_OVERVIEW_URL = "https://example.com/api/v1/support/diagnostics/overview";

// Requests a diagnostic grant as the given member, seeds a fresh platform_staff principal, and
// redeems the grant for a support-session token. Returns the token string.
async function openDiagnosticSession(cookie: string): Promise<string> {
  const grantResponse = await SELF.fetch("https://example.com/api/v1/support/grants", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie,
    },
    body: JSON.stringify({ tier: "diagnostic", reason: "end-to-end test" }),
  });
  expect(grantResponse.status).toBe(201);
  const grant = (await grantResponse.json()) as { id: string };

  // Seed a fresh platform_staff principal for each session to avoid id collisions.
  const principalId = newIdentifier("platformStaff");
  await insertPlatformStaffStatement(env.DB_CONTROL as never, {
    id: principalId,
    email: `${principalId}@staff.example`,
    displayName: "E2E Staff",
    role: "support",
    now: new Date().toISOString(),
  }).run();

  // Redeem the grant: the platform-admin key guards the route; an idempotency key is required.
  const redeemResponse = await SELF.fetch("https://example.com/api/v1/support/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY,
    },
    body: JSON.stringify({ grantId: grant.id, principalId }),
  });
  expect(redeemResponse.status).toBe(201);
  return ((await redeemResponse.json()) as { token: string }).token;
}

describe("diagnostic overview — tier enforcement end to end", () => {
  it("a normal firm member lacks diagnostics:overview and is denied (403)", async () => {
    const cookie = await signInForSessionCookie("diag-e2e@example.com");
    const response = await SELF.fetch(DIAGNOSTIC_OVERVIEW_URL, {
      headers: { origin: "https://example.com", cookie },
    });
    expect(response.status).toBe(403);
  });

  it("a diagnostic support-session token is allowed and returns firm state (200)", async () => {
    const cookie = await signInForSessionCookie("diag-e2e@example.com");
    const token = await openDiagnosticSession(cookie);
    const response = await SELF.fetch(DIAGNOSTIC_OVERVIEW_URL, {
      headers: { "X-Support-Session": token },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body["firmStatus"]).toBe("string");
    expect(typeof body["firmId"]).toBe("string");
    expect(typeof body["activeMemberCount"]).toBe("number");
    expect(typeof body["bucketProvisioned"]).toBe("boolean");
  });

  it("a token backed by a revoked grant is denied (401)", async () => {
    const cookie = await signInForSessionCookie("diag-e2e@example.com");
    const token = await openDiagnosticSession(cookie);
    // Revoke every active grant to invalidate the token at the live-grant check.
    await env.DB_CONTROL.prepare(
      "UPDATE support_grant SET status = 'revoked' WHERE status = 'active'",
    ).run();
    const response = await SELF.fetch(DIAGNOSTIC_OVERVIEW_URL, {
      headers: { "X-Support-Session": token },
    });
    expect(response.status).toBe(401);
  });
});
