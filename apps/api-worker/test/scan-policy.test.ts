import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // The FirmDatabase Durable Object self-migrates the full per-firm lineage (incl.
  // 0030 — Admin gets firm:manageScanPolicy) on first access, so there is no
  // separate per-firm migration to apply here.
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
    await mirrorMemberWithOwnerRole(userId, "Scan Policy Reader", poolFirmId);
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
    await mirrorMemberWithOwnerRole(userId, "Scan Policy Patcher", poolFirmId);
    ownerCookie = await signInForSessionCookie("scan-policy-patch@example.com");
  });

  it("updates flaggedTreatment and returns 200 with the resolved settings", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: "https://example.com",
        "Idempotency-Key": crypto.randomUUID(),
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

  it("is idempotent: replaying the same Idempotency-Key writes exactly one audit row", async () => {
    const key = crypto.randomUUID();
    const send = () =>
      SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
        method: "PATCH",
        headers: {
          cookie: ownerCookie,
          "content-type": "application/json",
          origin: "https://example.com",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ stepUpReauthOnFlagged: true }),
      });
    const countAudits = async () =>
      (
        await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
          .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.scan_policy_updated'")
          .first<{ n: number }>()
      )?.n ?? 0;

    const before = await countAudits();
    const first = await send();
    expect(first.status).toBe(200);
    const second = await send();
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    // Only the first write created an audit row; the replay added none.
    expect((await countAudits()) - before).toBe(1);
  });

  it("an empty PATCH body writes no audit row and returns the current settings", async () => {
    const before =
      (
        await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
          .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.scan_policy_updated'")
          .first<{ n: number }>()
      )?.n ?? 0;
    const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: "https://example.com",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["flaggedTreatment"]).toBeDefined();
    const after =
      (
        await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
          .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'firm.scan_policy_updated'")
          .first<{ n: number }>()
      )?.n ?? 0;
    expect(after).toBe(before);
  });

  it("returns 422 for an invalid PATCH body (invalid tier)", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/firm/scan-policy", {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        "content-type": "application/json",
        origin: "https://example.com",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ policy: { tier: "invalid", suspiciousScoreFloor: 0 } }),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("GET /api/v1/firm/scan-policy/score-histogram", () => {
  it("returns the no-engine empty shape (200) through the bound stub", async () => {
    // SCAN_SERVICE resolves to the no-engine stub in the test pool (vitest.config.ts), which answers the
    // histogram path with the empty shape — so this exercises the full bound/proxy path and asserts the
    // route returns it. The genuinely-unbound and fault branches are unit-tested in
    // test/files/score-histogram.test.ts; the live-engine path is CI/deploy-gated.
    const { userId } = await seedCredentialedUser("scan-policy-hist@example.com", {
      userName: "Scan Policy Histogram Reader",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Scan Policy Histogram Reader", poolFirmId);
    const cookie = await signInForSessionCookie("scan-policy-hist@example.com");
    const response = await SELF.fetch(
      "https://example.com/api/v1/firm/scan-policy/score-histogram",
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      engineVersion: null,
      minScoreGate: null,
      total: 0,
      buckets: [],
    });
  });

  it("returns 403 for an authenticated member without firm:manageScanPolicy", async () => {
    await seedCredentialedUser("scan-policy-hist-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("scan-policy-hist-noperm@example.com");
    const response = await SELF.fetch(
      "https://example.com/api/v1/firm/scan-policy/score-histogram",
      { headers: { cookie } },
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
