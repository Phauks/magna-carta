import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The Admin role id is a committed literal from 0002_member-rbac.sql.
const OWNER_ADMIN_ROLE_ID = "role_Gw-zKO8hOHQuNv2bWokMp";

const app = createApp();

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "AI Detection Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // tools:aiTextDetection is seeded by 0034_seed-tools-ai-text-detection.sql, but grant it directly
  // so this suite does not depend on migration ordering.
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_AiDetectRouteTest00001", OWNER_ADMIN_ROLE_ID, "tools:aiTextDetection")
    .run();
});

async function authed(email: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { userName: email, firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, email, poolFirmId);
  return signInForSessionCookie(email);
}

function post(cookie: string, body: unknown) {
  return app.request(
    "https://example.com/api/v1/ai-detection/detect",
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("POST /api/v1/ai-detection/detect", () => {
  it("refuses with 422 when the firm has not enabled external detection (default off)", async () => {
    const cookie = await authed("ai-detect-off@example.com");
    const response = await post(cookie, { text: "some pasted text" });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("rejects without the permission with 403", async () => {
    await seedCredentialedUser("ai-detect-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("ai-detect-noperm@example.com");
    const response = await post(cookie, { text: "some pasted text" });
    expect(response.status).toBe(403);
  });

  it("returns 422 'unavailable' when enabled but no platform key is configured", async () => {
    // Enable the setting for this firm, then call. The test env sets no PANGRAM_API_KEY, so the route
    // reports detection-unavailable rather than calling a live provider.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind("aiDetection.externalDetectionEnabled", "true", "2026-07-02T00:00:00.000Z")
      .run();
    const cookie = await authed("ai-detect-on@example.com");
    const response = await post(cookie, { text: "some pasted text" });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
