import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
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
  poolFirmId = (await seedFirm({ name: "Support Grants Test Firm" })).firmId;
  // Seed the member who will request grants. Admin carries support:request (seeded to every
  // default role in the per-firm migrations). The FirmDatabase DO self-migrates on first
  // mirrorMemberWithOwnerRole access, applying those role_permission rows automatically.
  const { userId } = await seedCredentialedUser("req-diag@example.com", { firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, "Support Requester", poolFirmId);
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

  it("returns 403 for an authenticated user who lacks the support:request permission", async () => {
    // Seed a user without calling mirrorMemberWithOwnerRole — they have no role assignment in
    // the FirmDatabase, so their effective permission set is empty → 403 from the RBAC gate.
    await seedCredentialedUser("no-perm-support@example.com", { firmId: poolFirmId });
    const cookie = await signInForSessionCookie("no-perm-support@example.com");
    const res = await SELF.fetch("https://example.com/api/v1/support/grants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie,
      },
      body: JSON.stringify({ tier: "diagnostic", reason: "test" }),
    });
    expect(res.status).toBe(403);
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
