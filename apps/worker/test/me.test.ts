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

// firm.database_identifier is UNIQUE and storage is shared within this file, so the resolvable
// pool firm is seeded once here and every test attaches its users to it.
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  // DB_FIRM_POOL_1 stands in for a provisioned firm's database: migrated with the full per-firm
  // lineage (0000 + 0001_ledger-core + 0002_member-rbac), which also lands the seeded roles.
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (await seedFirm({ name: "Me Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
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
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("returns the session user, firm, and effective permissions including the role seeds", async () => {
    const { userId, firmId } = await seedCredentialedUser("me-member@example.com", {
      userName: "Me Test User",
      firmId: poolFirmId,
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
      // Owner/Admin's seeded role_permission rows: firm:manageMembers (0002_member-rbac.sql) +
      // firm:reportIncident (0003_incident-intake.sql, seeded onto every default role) + the slice
      // 1·1 matters/locations/files grants (0004_matters-locations-file-manager.sql) + the slice 1·2
      // firm:manageSecrets / incidents:viewDescription grants (0006) + shipping:manage
      // (0008_elite_genesis) + the slice 1·3 directory:edit / directory:viewSensitiveIdentifiers
      // grants (0009_directory) + tools:firmUsage (0010_seed-tools-firm-usage.sql) + the slice 1·4
      // customFields:manage / customFields:purge grants (0013_custom-fields.sql) + tools:whois /
      // tools:safeBrowse (0017_seed-tools-web-domains.sql, seeded onto every default role) +
      // tools:fileConverter (0018_seed-tools-file-converter.sql) + firm:scanFile
      // (0019_seed-scan-file-permission.sql) + tools:metadataScrubber
      // (0020_seed-tools-metadata-scrubber.sql, seeded onto every default role) + tools:fileIntegrity
      // (0021_seed-tools-file-integrity.sql, seeded onto every default role). Sorted.
      permissions: [
        "customFields:manage",
        "customFields:purge",
        "directory:edit",
        "directory:viewSensitiveIdentifiers",
        "files:delete",
        "files:manageDocumentTypes",
        "files:organize",
        "files:upload",
        "firm:manageMembers",
        "firm:manageSecrets",
        "firm:reportIncident",
        "firm:scanFile",
        "incidents:viewDescription",
        "locations:manage",
        "matters:close",
        "matters:create",
        "matters:edit",
        "matters:manageNumbering",
        "matters:manageTypes",
        "matters:open",
        "matters:renumber",
        "matters:reopen",
        "shipping:manage",
        "tools:fileConverter",
        "tools:fileIntegrity",
        "tools:firmUsage",
        "tools:metadataScrubber",
        "tools:safeBrowse",
        "tools:whois",
      ],
    });
  });

  it("answers 404 when the session member is DEACTIVATED in the firm database (absent — the deactivated-context promise)", async () => {
    const { userId } = await seedCredentialedUser("me-deactivated@example.com", {
      userName: "Deactivated Member",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Deactivated Member");
    await env.DB_FIRM_POOL_1.prepare("UPDATE member SET status = 'deactivated' WHERE user_id = ?1")
      .bind(userId)
      .run();
    const sessionCookie = await signInForSessionCookie("me-deactivated@example.com");

    const response = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: sessionCookie },
    });
    // A deactivated member is ABSENT, not forbidden — indistinguishable from the firm/member not
    // existing at all (never an existence oracle, and never a 403 that confirms the distinction).
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/not-found",
      title: "Not found",
      status: 404,
    });
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("answers 200 with EMPTY permissions for a never-mirrored user (sweep lag is transient and self-heals)", async () => {
    // No mirrorMemberWithOwnerRole call: the user exists on the control plane but the per-firm
    // member row has not landed yet — the owner-activation window between invite and the outbox
    // sweep. Deliberately NOT a 404: that state self-heals, deactivation is a deliberate state.
    const { userId, firmId } = await seedCredentialedUser("me-unmirrored@example.com", {
      userName: "Unmirrored User",
      firmId: poolFirmId,
    });
    const sessionCookie = await signInForSessionCookie("me-unmirrored@example.com");

    const response = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: userId, name: "Unmirrored User", email: "me-unmirrored@example.com" },
      firm: { id: firmId, name: "Me Test Firm" },
      permissions: [],
    });
  });

  it("answers 404 when the session firm's database resolves to no binding (cross-firm reserve)", async () => {
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
    expect(body["errorId"]).toMatch(/^error_/);
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
    // (docs/conventions/api.md).
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
