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

// Sign in a fresh Owner-role member and return the session cookie. Each test uses a distinct email so
// the sessions never collide within the shared pool firm.
async function ownerCookie(email: string, name: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { userName: name, firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, name, poolFirmId);
  return signInForSessionCookie(email);
}

async function post(path: string, cookie: string, body: string | null): Promise<Response> {
  return await app.request(
    `https://example.com/api/v1/file-repair/${path}`,
    {
      method: "POST",
      headers: {
        cookie,
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
    await seedFirm({ name: "File Repair Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  // tools:fileRepair is seeded by 0035 (self-migrated on first DO access); grant it directly too so the
  // route tests do not depend on migration ordering in the pool.
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_FileRepairOwnerTest00001", OWNER_ADMIN_ROLE_ID, "tools:fileRepair")
    .run();
});

describe("POST /api/v1/file-repair/*", () => {
  it("diagnose returns a report with the recoverability verdict", async () => {
    const cookie = await ownerCookie("file-repair-diagnose@example.com", "Repair Diagnose");
    const response = await post("diagnose", cookie, "%PDF-1.5 broken");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { recoverability: string; repairSupported: boolean };
    expect(body.recoverability).toBe("repairable");
    expect(body.repairSupported).toBe(true);
  });

  it("repair returns the salvaged file + loss manifest when the re-scan is clean", async () => {
    const cookie = await ownerCookie("file-repair-ok@example.com", "Repair OK");
    const response = await post("repair", cookie, "a corrupt but recoverable pdf");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      files: { name: string; contentBase64: string }[];
      loss: { fullyRecovered: boolean };
    };
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.files[0]?.contentBase64.length).toBeGreaterThan(0);
    expect(typeof body.loss.fullyRecovered).toBe("boolean");
  });

  it("repair WITHHOLDS the bytes with 422 when the re-scan flags the reconstructed output", async () => {
    const cookie = await ownerCookie("file-repair-malware@example.com", "Repair Malware");
    // The stub reconstructs output the scan stub flags when the input asks for it.
    const response = await post("repair", cookie, "corrupt pdf TRIGGERMALWARE payload");
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await response.json()) as { detail: string };
    // The problem discloses only that it was flagged — never the file content or the signature.
    expect(problem.detail).not.toContain("MALWARE_EICAR");
    expect(problem.detail).not.toContain("Test.EICAR");
  });

  it("repair returns 422 when the engine cannot reconstruct the file", async () => {
    const cookie = await ownerCookie("file-repair-unrepairable@example.com", "Repair Unrepairable");
    const response = await post("repair", cookie, "hopeless UNREPAIRABLE bytes");
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("carve returns the carved files when the re-scan is clean", async () => {
    const cookie = await ownerCookie("file-repair-carve@example.com", "Repair Carve");
    const response = await post("carve", cookie, "junk with an embedded jpeg");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: unknown[] };
    expect(body.files.length).toBeGreaterThan(0);
  });

  it("returns 400 when the request body is empty", async () => {
    const cookie = await ownerCookie("file-repair-empty@example.com", "Repair Empty");
    const response = await post("diagnose", cookie, null);
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("rejects without the permission with 403", async () => {
    await seedCredentialedUser("file-repair-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("file-repair-noperm@example.com");
    const response = await post("repair", cookie, "some bytes");
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});
