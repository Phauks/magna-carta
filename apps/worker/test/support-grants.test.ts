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

// A single pool firm backed by DB_FIRM_POOL_1. Seeded once so database_identifier stays unique.
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (
    await seedFirm({
      name: "Support Grants Test Firm",
      databaseIdentifier: "DB_FIRM_POOL_1",
    })
  ).firmId;
  // Seed the member who will request grants. Owner/Admin carries support:request (seeded to every
  // default role in the per-firm migrations). The chokepoint resolves support:request for this user
  // through the role_permission rows applied by applyPerFirmMigrations.
  const { userId } = await seedCredentialedUser("req-diag@example.com", { firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, "Support Requester");
});

describe("POST /api/v1/support/grants", () => {
  it("a firm member requests a diagnostic grant and receives 201 with status active", async () => {
    const cookie = await signInForSessionCookie("req-diag@example.com");
    const res = await SELF.fetch("https://example.com/api/v1/support/grants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie,
      },
      body: JSON.stringify({ tier: "diagnostic", reason: "page errors on matter list" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; tier: string };
    expect(body.status).toBe("active");
    expect(body.tier).toBe("diagnostic");
    expect(body.id.startsWith("supportGrant_")).toBe(true);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await SELF.fetch("https://example.com/api/v1/support/grants", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://example.com" },
      body: JSON.stringify({ tier: "diagnostic" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("GET /api/v1/support/grants", () => {
  it("lists the firm's grants (at least the one created above)", async () => {
    const cookie = await signInForSessionCookie("req-diag@example.com");
    const res = await SELF.fetch("https://example.com/api/v1/support/grants", {
      headers: { origin: "https://example.com", cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { grants: { id: string }[] };
    expect(Array.isArray(body.grants)).toBe(true);
    expect(body.grants.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await SELF.fetch("https://example.com/api/v1/support/grants", {
      headers: { origin: "https://example.com" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
