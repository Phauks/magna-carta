/*
 * Short-lived relay credentials for packet-loss measurement. Mirrors the session/permission
 * seeding harness of tools-connection.test.ts exactly: same gate (tools:speedTest), same shape of
 * assertions. The TURN secrets are absent from every test environment, so a permitted member still
 * gets 503 here — and the problem body must never name the secrets, since it is the caller-facing
 * surface of a route that mints a billable relay credential.
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
    await seedFirm({ name: "Turn Credentials Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

// Mirrors a member with no role but a single direct-grant permission — no seeded role carries
// tools:speedTest, so a direct grant is the only way to seed a member who holds it.
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

describe("GET /api/v1/tools/turn-credentials", () => {
  it("rejects an unauthenticated caller", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/tools/turn-credentials");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 403 for an authenticated member without tools:speedTest", async () => {
    await seedCredentialedUser("turn-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("turn-noperm@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/tools/turn-credentials", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 503 for a permitted member when the TURN secrets are absent, naming no secret", async () => {
    const { userId } = await seedCredentialedUser("turn-ok@example.com", {
      userName: "Turn OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithDirectGrant(userId, "Turn OK", "tools:speedTest");
    const cookie = await signInForSessionCookie("turn-ok@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/tools/turn-credentials", {
      headers: { cookie },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = await response.text();
    expect(body.toLowerCase()).not.toContain("token");
    expect(body.toLowerCase()).not.toContain("secret");
  });

  it("is registered in the emitted contract", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as { paths: Record<string, unknown> };
    expect(document.paths["/api/v1/tools/turn-credentials"]).toBeDefined();
  });

  it("emits the route into the OpenAPI document with operationId and x-mc metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as {
      paths: Record<string, { get?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/tools/turn-credentials"]?.get;
    expect(operation?.["operationId"]).toBe("toolsTurnCredentials.get");
    expect(operation).toMatchObject({
      "x-mc-operationId": "toolsTurnCredentials.get",
      "x-mc-surface": "app",
      "x-mc-authenticated": true,
      "x-mc-permission": "tools:speedTest",
      "x-mc-resource": "firm",
      "x-mc-audited": false,
    });
  });
});
