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

let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1); // full lineage incl. 0006 (Owner/Admin gets tools:firmUsage)
  poolFirmId = (await seedFirm({ name: "Usage Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
});

describe("GET /api/v1/firm-usage", () => {
  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage");
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("answers 403 for an authenticated member without tools:firmUsage", async () => {
    // Never mirrored into a role → present (not deactivated) but holds no permission → 403, not 404.
    await seedCredentialedUser("usage-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("usage-noperm@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage", {
      headers: { cookie },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("returns the composed snapshot for an Owner/Admin member", async () => {
    const { userId } = await seedCredentialedUser("usage-ok@example.com", {
      userName: "Usage OK",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Usage OK"); // Owner/Admin carries tools:firmUsage (0006)
    const t = "2026-01-01T00:00:00.000Z";
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO storage_meter (storage_class, artifact_role, prefix, bytes, object_count) VALUES ('standard','original','files',1000,1)",
    ).run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO matter (id, title, description, status, matter_type_id, location_id, responsible_member_id, client_display_name, client_code, matter_number, numbered_at, opened_at, closed_at, created_at, updated_at) VALUES ('matter_u','M',NULL,'open',NULL,NULL,?1,NULL,NULL,NULL,NULL,NULL,NULL,?2,?2)",
    )
      .bind(userId, t)
      .run();
    await env.DB_FIRM_POOL_1.prepare(
      "INSERT INTO location (id, name, status, jurisdiction, number_code, address_block, footer, remit_to, created_at, updated_at) VALUES ('loc_u','HQ','active',NULL,NULL,NULL,NULL,NULL,?1,?1)",
    )
      .bind(t)
      .run();

    const cookie = await signInForSessionCookie("usage-ok@example.com");
    const response = await SELF.fetch("https://example.com/api/v1/firm-usage", {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      storage: {
        totalBytes: 1000,
        totalObjects: 1,
        byStorageClass: {
          standard: { bytes: 1000, objects: 1 },
          infrequent_access: { bytes: 0, objects: 0 },
        },
      },
      counts: {
        matters: { total: 1, prospective: 0, open: 1, closed: 0 },
        files: 0,
        fileVersions: 0,
        folders: 0,
        locations: 1,
      },
    });
  });

  it("emits the route into the OpenAPI document with operationId and x-mc metadata", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as {
      paths: Record<string, { get?: Record<string, unknown> }>;
    };
    const operation = document.paths["/api/v1/firm-usage"]?.get;
    expect(operation?.["operationId"]).toBe("firmUsage.get");
    expect(operation).toMatchObject({
      "x-mc-operationId": "firmUsage.get",
      "x-mc-surface": "app",
      "x-mc-authenticated": true,
      "x-mc-permission": "tools:firmUsage",
      "x-mc-resource": "firm",
      "x-mc-audited": false,
    });
  });
});
