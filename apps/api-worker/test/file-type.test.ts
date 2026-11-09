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

// The Owner/Admin role id is a committed literal from 0002_member-rbac.sql.
const OWNER_ADMIN_ROLE_ID = "role_Gw-zKO8hOHQuNv2bWokMp";

const app = createApp();

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // The firm's FirmDatabase Durable Object self-migrates on first access (resolved by firmId), so
  // create the firm row first, then reach its database.
  poolFirmId = (
    await seedFirm({ name: "File Type Verifier Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // tools:fileTypeVerifier is seeded in a later migration. Grant it directly so the route tests
  // run before that migration lands.
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind(
      "rolePermission_FileTypeVerifierOwnerTest0001",
      OWNER_ADMIN_ROLE_ID,
      "tools:fileTypeVerifier",
    )
    .run();
});

describe("POST /api/v1/file-type/verify", () => {
  it("returns a FileTypeReport with a mismatch (stub identifies a JPEG named .pdf)", async () => {
    const { userId } = await seedCredentialedUser("file-type-ok@example.com", {
      userName: "File Type OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "File Type OK", poolFirmId);
    const cookie = await signInForSessionCookie("file-type-ok@example.com");
    const response = await app.request(
      "https://example.com/api/v1/file-type/verify?filename=contract.pdf",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/octet-stream",
          "content-length": "3",
        },
        body: new Uint8Array([0xff, 0xd8, 0xff]),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      detected: string | null;
      extensionMatch: string;
      recommendedExtensions: string[];
    };
    expect(body.detected).toBe("jpeg");
    expect(body.extensionMatch).toBe("mismatch");
    expect(body.recommendedExtensions).toContain("jpg");
  });

  it("returns 400 when the request body is empty", async () => {
    const { userId } = await seedCredentialedUser("file-type-empty-body@example.com", {
      userName: "File Type Empty Body",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "File Type Empty Body", poolFirmId);
    const cookie = await signInForSessionCookie("file-type-empty-body@example.com");
    const response = await app.request(
      "https://example.com/api/v1/file-type/verify?filename=contract.pdf",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/octet-stream",
        },
        // No body — c.req.raw.body is null, triggering the 400 guard before the scan service.
      },
      env,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("rejects without the permission with 403", async () => {
    // seedCredentialedUser assigns no role; membership alone carries no permission.
    await seedCredentialedUser("file-type-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("file-type-noperm@example.com");
    const response = await app.request(
      "https://example.com/api/v1/file-type/verify?filename=contract.pdf",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/octet-stream",
          "content-length": "3",
        },
        body: new Uint8Array([0xff, 0xd8, 0xff]),
      },
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
