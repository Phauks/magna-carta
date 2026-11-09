/*
 * The connection route reports what the edge sees about the caller and touches no database, so
 * its round trip measures a real authenticated API call. It is gated on tools:speedTest like
 * every other tool surface.
 */
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { seedCredentialedUser, seedFirm, signInForSessionCookie } from "./support/test-auth.ts";

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Connection Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

// Mirrors a member with no role but a single direct-grant permission — no seeded role carries
// tools:speedTest (unlike tools:firmUsage/tools:whois, which Admin holds), so a direct
// grant is the only way to seed a member who holds it.
async function mirrorMemberWithDirectGrant(
  userId: UserId,
  displayName: string,
  permission: string,
): Promise<void> {
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await firmDatabase
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, permission, new Date().toISOString())
    .run();
}

describe("GET /api/v1/tools/connection", () => {
  it("rejects an unauthenticated caller", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/tools/connection");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 403 for an authenticated member without tools:speedTest", async () => {
    // Never mirrored into a role → present (not deactivated) but holds no permission → 403, not 404.
    await seedCredentialedUser("connection-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("connection-noperm@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/tools/connection", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns the edge-view shape for a member holding tools:speedTest", async () => {
    const { userId } = await seedCredentialedUser("connection-ok@example.com", {
      userName: "Connection OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithDirectGrant(userId, "Connection OK", "tools:speedTest");
    const cookie = await signInForSessionCookie("connection-ok@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/tools/connection", {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    // request.cf is undefined under Miniflare, so the handler's documented local-runtime
    // degradation applies: asn 0 and empty strings, not fabricated edge values. Assert the shape
    // and types the zod schema declares, not real edge data.
    const body = await response.json();
    expect(body).toEqual({
      ip: "",
      asn: 0,
      asOrganization: "",
      colo: "",
      country: "",
    });
  });

  it("is registered in the emitted contract", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as { paths: Record<string, unknown> };
    expect(document.paths["/api/v1/tools/connection"]).toBeDefined();
  });

  it("emits the route into the OpenAPI document with operationId and x-mc metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as {
      paths: Record<string, { get?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/tools/connection"]?.get;
    expect(operation?.["operationId"]).toBe("toolsConnection.get");
    expect(operation).toMatchObject({
      "x-mc-operationId": "toolsConnection.get",
      "x-mc-surface": "app",
      "x-mc-authenticated": true,
      "x-mc-permission": "tools:speedTest",
      "x-mc-resource": "firm",
      "x-mc-audited": false,
    });
  });
});
