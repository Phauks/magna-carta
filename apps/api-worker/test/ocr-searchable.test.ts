import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/app.ts";
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

async function ownerCookie(email: string, name: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { userName: name, firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, name, poolFirmId);
  return signInForSessionCookie(email);
}

async function post(cookie: string | null, body: string | null): Promise<Response> {
  return await app.request(
    "https://example.com/api/v1/ocr/searchable",
    {
      method: "POST",
      headers: {
        ...(cookie === null ? {} : { cookie }),
        "content-type": "application/octet-stream",
        ...(body === null
          ? {}
          : { "content-length": String(new TextEncoder().encode(body).length) }),
      },
      ...(body === null ? {} : { body }),
    },
    env,
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "OCR Searchable Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // Grant tools:ocr directly so the route tests do not depend on migration ordering in the pool.
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_ocrSearchableTest", OWNER_ADMIN_ROLE_ID, "tools:ocr")
    .run();
});

describe("POST /api/v1/ocr/searchable", () => {
  it("streams the engine's searchable PDF back as application/pdf", async () => {
    const cookie = await ownerCookie("ocr-searchable-ok@example.com", "OCR One");
    const response = await post(cookie, "%PDF-1.7 scan");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(await response.text()).toContain("%PDF");
  });

  it("rejects an empty body with 400", async () => {
    const cookie = await ownerCookie("ocr-searchable-empty@example.com", "OCR Two");
    const response = await post(cookie, null);
    expect(response.status).toBe(400);
  });

  it("refuses an unauthenticated request", async () => {
    const response = await post(null, "%PDF-1.7 scan");
    expect(response.status).toBe(401);
  });
});
