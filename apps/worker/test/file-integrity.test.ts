import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
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
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  // tools:fileIntegrity is seeded in a later migration. Grant it directly so the route tests
  // run before that migration lands.
  await env.DB_FIRM_POOL_1.prepare(
    "INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)",
  )
    .bind("rolePermission_FileIntegrityOwnerTest0001", OWNER_ADMIN_ROLE_ID, "tools:fileIntegrity")
    .run();

  poolFirmId = (
    await seedFirm({ name: "File Integrity Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
});

describe("POST /api/v1/file-integrity/hash", () => {
  it("returns all five digests for the streamed body", async () => {
    const { userId } = await seedCredentialedUser("file-integrity-ok@example.com", {
      userName: "Integrity OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Integrity OK");
    const cookie = await signInForSessionCookie("file-integrity-ok@example.com");
    const response = await app.request(
      "https://example.com/api/v1/file-integrity/hash",
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/octet-stream",
          "content-length": "3",
        },
        body: new TextEncoder().encode("abc"),
      },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      algorithms: { sha256: string; md5: string };
      sizeBytes: number;
    };
    expect(body.algorithms.sha256).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(body.algorithms.md5).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(body.sizeBytes).toBe(3);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const response = await app.request(
      "https://example.com/api/v1/file-integrity/hash",
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new TextEncoder().encode("abc"),
      },
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
