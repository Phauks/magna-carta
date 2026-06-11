import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  signInForSessionCookie,
} from "./support/test-auth.ts";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // DB_FIRM_POOL_1 stands in for a provisioned firm's database: migrated with the full per-firm
  // lineage (0000 + 0001_ledger-core + 0002_member-rbac), which also lands the seeded roles.
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
});

describe("GET /api/v1/me", () => {
  it("answers an unauthenticated request with an RFC 9457 401 problem", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/me");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/unauthenticated",
      title: "Authentication required",
      status: 401,
      instance: "/api/v1/me",
    });
    expect(body["errorId"]).toMatch(/^err_/);
  });

  it("returns the session user, firm, and effective permissions including the role seeds", async () => {
    const { userId, firmId } = await seedCredentialedUser("me-member@example.com", {
      userName: "Me Test User",
      firmName: "Me Test Firm",
      firmDatabaseIdentifier: "DB_FIRM_POOL_1",
    });
    await mirrorMemberWithOwnerRole(userId, "Me Test User");
    const sessionCookie = await signInForSessionCookie("me-member@example.com");

    const response = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: userId, name: "Me Test User", email: "me-member@example.com" },
      firm: { id: firmId, name: "Me Test Firm" },
      // Owner/Admin's seeded role_permission rows (0002_member-rbac.sql).
      permissions: ["firm:manageMembers"],
    });
  });

  it("answers 404 when the session firm's database resolves to no binding (ADR-0052 cross-firm reserve)", async () => {
    // The firm row exists, but its database_identifier matches no binding in this deployment —
    // indistinguishable from the firm being absent: 404, never a 500 and never an existence oracle.
    await seedCredentialedUser("me-foreign@example.com", {
      firmDatabaseIdentifier: "d1-not-bound-in-this-deployment",
    });
    const sessionCookie = await signInForSessionCookie("me-foreign@example.com");

    const response = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/not-found",
      title: "Not found",
      status: 404,
    });
    expect(body["errorId"]).toMatch(/^err_/);
  });

  it("emits the route into the OpenAPI document with the native operationId and x-mc metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      paths: Record<string, { get?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/me"]?.get;
    expect(operation).toBeDefined();
    // Native operationId, not only x-mc-operationId — SDK generators key method names off it
    // (api.md spike finding #1).
    expect(operation?.["operationId"]).toBe("me.get");
    expect(operation).toMatchObject({
      "x-mc-operationId": "me.get",
      "x-mc-surface": "app",
      "x-mc-authenticated": true,
      "x-mc-permission": null,
      "x-mc-resource": "firm",
      "x-mc-audited": false,
      "x-mc-idempotency": "optional",
    });
  });
});
