import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1); // full lineage incl. 0025 (Owner/Admin gets firm:manageScanPolicy)
  poolFirmId = (
    await seedFirm({ name: "Scan Policy Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

describe("GET /api/v1/firm/scan-policy", () => {
  it("returns the built-in defaults for a fresh firm", async () => {
    const { userId } = await seedCredentialedUser("scan-policy-get@example.com", {
      userName: "Scan Policy Reader",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Scan Policy Reader");
    const cookie = await signInForSessionCookie("scan-policy-get@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    // Defaults from DEFAULT_SCAN_POLICY (verdict.ts) and scan-policy-settings.ts
    expect(await response.json()).toEqual({
      policy: { tier: "extended", suspiciousScoreFloor: 75 },
      flaggedTreatment: "block",
      stepUpReauthOnFlagged: false,
    });
  });

  it("returns 403 for an authenticated member without firm:manageScanPolicy", async () => {
    // Seeded into the control-plane firm but NOT mirrored into the firm DB — in the
    // sweep-lag window (no member row), so the chokepoint resolves firm context but finds
    // no permissions → 403, not 404.
    await seedCredentialedUser("scan-policy-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("scan-policy-noperm@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("PATCH /api/v1/firm/scan-policy", () => {
  let ownerCookie: string;

  beforeAll(async () => {
    const { userId } = await seedCredentialedUser("scan-policy-patch@example.com", {
      userName: "Scan Policy Patcher",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Scan Policy Patcher");
    ownerCookie = await signInForSessionCookie("scan-policy-patch@example.com");
  });

  it("updates flaggedTreatment and returns 200 with the resolved settings", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: "https://example.com",
      },
      body: JSON.stringify({ flaggedTreatment: "informed-access" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["flaggedTreatment"]).toBe("informed-access");
    // Other fields remain at their defaults
    expect((body["policy"] as Record<string, unknown>)["tier"]).toBe("extended");
    expect(body["stepUpReauthOnFlagged"]).toBe(false);
  });

  it("reflects the PATCH on the subsequent GET", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
      headers: { cookie: ownerCookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["flaggedTreatment"]).toBe("informed-access");
  });

  it("returns 422 for an invalid PATCH body (invalid tier)", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: "https://example.com",
      },
      body: JSON.stringify({ policy: { tier: "invalid", suspiciousScoreFloor: 0 } }),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
