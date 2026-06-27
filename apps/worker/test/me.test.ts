import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The pool firm is seeded once here and every test attaches its users to it. Its per-firm data lives
// in the firm's FirmDatabase Durable Object (addressed by firmId, self-migrating on first access).
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Me Test Firm" })).firmId;
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
    await mirrorMemberWithOwnerRole(userId, "Me Test User", poolFirmId);
    const sessionCookie = await signInForSessionCookie("me-member@example.com");

    const response = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      user: { id: userId, name: "Me Test User", email: "me-member@example.com" },
      firm: { id: firmId, name: "Me Test Firm" },
      // Owner/Admin's seeded role_permission rows: firm:manageMembers (0002_member-rbac.sql) +
      // firm:reportIncident (0003_incident-intake.sql, seeded onto every default role) + the slice
      // 1·1 matters/locations/files grants (0004_matters-locations-file-manager.sql) + the slice 1·2
      // firm:manageSecrets / incidents:viewDescription grants (0006) + shipping:manage
      // (0008_elite_genesis) + the slice 1·3 directory:edit / directory:viewSensitiveIdentifiers
      // grants (0009_directory) + tools:firmUsage (0010_seed-tools-firm-usage.sql) + the slice 1·4
      // customFields:manage / customFields:purge grants (0013_custom-fields.sql) + the time: grants
      // (0021_outgoing_talon) + tools:whois / tools:safeBrowse (0017_seed-tools-web-domains.sql,
      // seeded onto every default role) + tools:fileConverter (0018_seed-tools-file-converter.sql) +
      // firm:scanFile (0019_seed-scan-file-permission.sql) + tools:metadataScrubber
      // (0020_seed-tools-metadata-scrubber.sql, seeded onto every default role) +
      // tools:fileIntegrity (0022_seed-tools-file-integrity.sql, seeded onto every default role) +
      // firm:manageReleaseChannel (0024_seed-release-channel-permission.sql, Owner/Admin only) +
      // support:request / support:cosign / support:manage (0028_support-access-permissions.sql,
      // Owner/Admin gets all three; other roles get support:request only). Sorted.
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
        "firm:manageReleaseChannel",
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
        "support:cosign",
        "support:manage",
        "support:request",
        "time:approve",
        "time:manageRates",
        "time:manageSettings",
        "time:manageUtbms",
        "time:track",
        "time:viewFirm",
        "tools:fileConverter",
        "tools:fileIntegrity",
        "tools:firmUsage",
        "tools:metadataScrubber",
        "tools:safeBrowse",
        "tools:whois",
      ],
    });
    expect(body.channel).toBe("stable");
    expect(body.flags).toEqual({ "release-channels.smoke": false });
  });

  it("answers 404 when the session member is DEACTIVATED in the firm database (absent — the deactivated-context promise)", async () => {
    const { userId } = await seedCredentialedUser("me-deactivated@example.com", {
      userName: "Deactivated Member",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Deactivated Member", poolFirmId);
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("UPDATE member SET status = 'deactivated' WHERE user_id = ?1")
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
      channel: "stable",
      flags: { "release-channels.smoke": false },
    });
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
