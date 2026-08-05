import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { isPermission } from "@magna-carta/access-control/registry";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { runScheduledSweep } from "../src/scheduled.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  captureResetToken,
  liveCookie,
  PASSWORD,
  postJson,
  setCookies,
  signIn,
} from "./support/test-auth.ts";
import { createAuthenticator, secretFromTotpUri } from "./support/totp.ts";

// The end-to-end capstone: one journey composed over the REAL HTTP surface (SELF fetch) —
// provision two firms → sweep mirrors the owners → owner A activates through the emailed reset
// link → signs in → enrolls TOTP → completes a full 2FA login → reads /api/v1/me → invites the
// future paralegal → sweep mirrors the invitee — then the tenant-isolation asserts: firm B's
// database and control-plane rows carry no trace of firm A's activity.
//
// Storage is per-test-FILE and shared across this file's tests, so the journey runs as ONE
// sequence of `it` steps over module-level state (the firms.test.ts pattern). Each firm's per-firm
// database is its firmId-addressed FirmDatabase DO, which self-migrates on first access.

beforeAll(async () => {
  // Control plane only — each firm's FirmDatabase DO self-migrates to head on first access (that
  // is part of what this e2e proves), so the per-firm migrations are deliberately NOT pre-applied.
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

interface ProvisionResponseBody {
  id: string;
  name: string;
  status: string;
  owner: { id: string; email: string; name: string };
}

const FIRM_A_INPUT = {
  name: "E2E Firm Alpha",
  owner: { email: "e2e-alpha-owner@example.com", name: "Alpha Owner" },
};
const FIRM_B_INPUT = {
  name: "E2E Firm Beta",
  owner: { email: "e2e-beta-owner@example.com", name: "Beta Owner" },
};
const PARALEGAL_EMAIL = "e2e-paralegal@example.com";
const PARALEGAL_NAME = "Future Paralegal";

// Set by the journey's earlier steps; later steps run in this file's guaranteed-sequential order.
let firmA: ProvisionResponseBody;
let firmB: ProvisionResponseBody;
let ownerSecretBase32: string;
let ownerSessionCookie: string;
let invitedParalegalId: string;

async function postFirms(body: unknown): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/firms", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

describe("end-to-end", () => {
  it("provisions firm A and firm B, each backed by its own self-migrating firm database", async () => {
    const responseA = await postFirms(FIRM_A_INPUT);
    expect(responseA.status).toBe(201);
    firmA = (await responseA.json()) as ProvisionResponseBody;
    expect(firmA.status).toBe("active");

    const responseB = await postFirms(FIRM_B_INPUT);
    expect(responseB.status).toBe(201);
    firmB = (await responseB.json()) as ProvisionResponseBody;
    expect(firmB.status).toBe("active");

    // Each firm's per-firm database is its firmId-addressed FirmDatabase DO, which self-migrated to
    // head on first access (no provisioning step) — the Owner/Admin role seed is resolvable in
    // each, the handle every later isolation assert keys its direct database reads off.
    for (const firmId of [firmA.id, firmB.id]) {
      const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
      const roleRows = await firmDatabase
        .prepare("SELECT id FROM role WHERE name = 'Owner/Admin'")
        .all<{ id: string }>();
      expect(roleRows.results[0]?.id).toMatch(/^role_/);
    }
  });

  it("mirrors both owners into their own firm databases with Owner/Admin via the sweep", async () => {
    // This explicit sweep is kept for DETERMINISM: it is awaited, so the owner mirrors below are
    // guaranteed present when asserted. In production each provision ALSO fires a best-effort
    // request-path sweep on commit (the R1 latency optimization), which over the SELF surface may
    // already have dispatched both owner rows — so this sweep's own dispatched count is incidental
    // (it can be 0 when the request-path sweeps won the race) and is deliberately not asserted; the
    // member-row checks below are the real proof.
    const report = await runScheduledSweep(env);
    expect(report.controlPlane.failed).toBe(0);

    for (const [owner, firmId] of [
      [firmA.owner, firmA.id],
      [firmB.owner, firmB.id],
    ] as const) {
      const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
      const memberResults = await firmDatabase
        .prepare("SELECT display_name, status FROM member WHERE user_id = ?1")
        .bind(owner.id)
        .all<{ display_name: string; status: string }>();
      const memberRow = memberResults.results[0];
      expect(memberRow).toEqual({ display_name: owner.name, status: "active" });

      const roleRows = await firmDatabase
        .prepare(
          "SELECT role.name AS role_name FROM member_role JOIN role ON role.id = member_role.role_id WHERE member_role.member_user_id = ?1",
        )
        .bind(owner.id)
        .all<{ role_name: string }>();
      expect(roleRows.results).toEqual([{ role_name: "Owner/Admin" }]);
    }
  });

  it("activates owner A through the emailed reset link: password set, email verified, sign-in live", async () => {
    // The activation email travels through the SendEmail port; the capturing adapter hands the
    // test the reset link the owner would click (the Path A activation every invitee travels).
    const { token, sentEmails } = await captureResetToken(FIRM_A_INPUT.owner.email);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.to).toBe(FIRM_A_INPUT.owner.email);

    // Setting the password over the real HTTP surface: the reset CREATES the credential account
    // for the account-less owner, and the onPasswordReset hook flips email_verified.
    const resetResponse = await postJson("/api/auth/reset-password", {
      newPassword: PASSWORD,
      token,
    });
    expect(resetResponse.status).toBe(200);
    expect(await resetResponse.json()).toMatchObject({ status: true });

    const userRow = await env.DB_CONTROL.prepare('SELECT email_verified FROM "user" WHERE id = ?1')
      .bind(firmA.owner.id)
      .first<{ email_verified: number }>();
    expect(userRow?.email_verified).toBe(1);

    const signInResponse = await signIn(FIRM_A_INPUT.owner.email);
    expect(signInResponse.status).toBe(200);
    const sessionCookie = liveCookie(setCookies(signInResponse), "session_token");
    expect(sessionCookie).toBeDefined();
    ownerSessionCookie = sessionCookie?.pair ?? "";
  });

  it("enrolls owner A in TOTP: enable + verify-totp flips two_factor_enabled", async () => {
    const enableResponse = await postJson(
      "/api/auth/two-factor/enable",
      { password: PASSWORD },
      ownerSessionCookie,
    );
    expect(enableResponse.status).toBe(200);
    const { totpURI } = (await enableResponse.json()) as { totpURI: string };
    ownerSecretBase32 = secretFromTotpUri(totpURI);

    const verifyResponse = await postJson(
      "/api/auth/two-factor/verify-totp",
      { code: createAuthenticator(ownerSecretBase32).generate() },
      ownerSessionCookie,
    );
    expect(verifyResponse.status).toBe(200);

    const userRow = await env.DB_CONTROL.prepare(
      'SELECT two_factor_enabled FROM "user" WHERE id = ?1',
    )
      .bind(firmA.owner.id)
      .first<{ two_factor_enabled: number }>();
    expect(userRow?.two_factor_enabled).toBe(1);

    // Audit trail, by filtered count (never a pinned sequence — the 2FA-enable session rotation
    // fires an extra login.success): at least one login, exactly one enablement.
    const auditRows = await env.DB_CONTROL.prepare(
      "SELECT event FROM auth_audit WHERE user_id = ?1",
    )
      .bind(firmA.owner.id)
      .all<{ event: string }>();
    const events = auditRows.results.map((row) => row.event);
    expect(events.filter((event) => event === "login.success").length).toBeGreaterThanOrEqual(1);
    expect(events.filter((event) => event === "two_factor.enabled")).toHaveLength(1);
  });

  it("completes a fresh 2FA login: session withheld until the TOTP code lands", async () => {
    const challengeResponse = await signIn(FIRM_A_INPUT.owner.email);
    expect(challengeResponse.status).toBe(200);
    expect(await challengeResponse.json()).toMatchObject({ twoFactorRedirect: true });
    const challengeCookies = setCookies(challengeResponse);
    expect(liveCookie(challengeCookies, "session_token")).toBeUndefined();
    const twoFactorCookie = liveCookie(challengeCookies, "two_factor");
    expect(twoFactorCookie).toBeDefined();

    const completeResponse = await postJson(
      "/api/auth/two-factor/verify-totp",
      { code: createAuthenticator(ownerSecretBase32).generate() },
      twoFactorCookie?.pair,
    );
    expect(completeResponse.status).toBe(200);
    const completedSession = liveCookie(setCookies(completeResponse), "session_token");
    expect(completedSession).toBeDefined();
    // The journey continues on the 2FA-completed session.
    ownerSessionCookie = completedSession?.pair ?? "";
  });

  it("GET /api/v1/me answers firm A and the Owner/Admin permissions", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: ownerSessionCookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: {
        id: firmA.owner.id,
        name: FIRM_A_INPUT.owner.name,
        email: FIRM_A_INPUT.owner.email,
      },
      firm: { id: firmA.id, name: FIRM_A_INPUT.name },
      // A firm defaults to the stable release channel; the throwaway catalog flag resolves to its
      // safe default with no flag provider bound in the test pool.
      channel: "stable",
      flags: { "release-channels.smoke": false },
      // Owner/Admin's seeded role_permission rows: firm:manageMembers (0002) + firm:reportIncident
      // (0003, seeded onto every default role) + the slice 1·1 matters/locations/files grants
      // (0004_matters-locations-file-manager.sql) + the slice 1·2 firm:manageSecrets /
      // incidents:viewDescription grants (0006) + shipping:manage (0008_elite_genesis) + the slice
      // 1·3 directory:edit / directory:viewSensitiveIdentifiers grants (0009_directory) +
      // tools:firmUsage (0010_seed-tools-firm-usage.sql) + the slice 1·4 customFields:manage /
      // customFields:purge grants (0013_custom-fields.sql) + the time: grants (0021_outgoing_talon) +
      // tools:whois / tools:safeBrowse (0017_seed-tools-web-domains.sql, seeded onto every default
      // role) + tools:fileConverter (0018_seed-tools-file-converter.sql) + firm:scanFile
      // (0019_seed-scan-file-permission.sql) + tools:metadataScrubber
      // (0020_seed-tools-metadata-scrubber.sql, seeded onto every default role) +
      // tools:fileIntegrity (0022_seed-tools-file-integrity.sql, seeded onto every default role) +
      // firm:manageReleaseChannel (0024_seed-release-channel-permission, Owner/Admin only) + the
      // costs: grants (0028_burly_piledriver: costs:track + costs:approve onto Owner/Admin) +
      // tools:fileTypeVerifier (0032_seed-tools-file-type-verifier.sql, seeded onto every default role) +
      // firm:manageScanPolicy (0030_seed-scan-policy-permission, Owner/Admin only) + the support:
      // grants (0031_support-access-permissions: support:request onto every default role,
      // support:cosign / support:manage onto Owner/Admin) +
      // tools:decryption (0035_seed-tools-decryption.sql, seeded onto every default role).
      // Sorted.
      permissions: [
        // conflicts:read / conflicts:run are seeded onto every default role (any member may screen a
        // prospective matter); conflicts:dispose is narrower and reaches Owner/Admin + Attorney only.
        "conflicts:dispose",
        "conflicts:read",
        "conflicts:run",
        "costs:approve",
        "costs:track",
        // custody:read reaches every default role (a billing clerk answering "do we hold the deed"
        // needs it); custody:manage moves physical originals and reaches Owner/Admin, Attorney, and
        // Paralegal only (20260804T160001_seed-custody-catalog).
        "custody:manage",
        "custody:read",
        "customFields:manage",
        "customFields:purge",
        "directory:edit",
        "directory:viewSensitiveIdentifiers",
        "documents:assemble",
        "emails:file",
        "emails:manageCaptureAddresses",
        "emails:manageLinks",
        "emails:read",
        "esign:seal",
        "files:delete",
        "files:manageDocumentTypes",
        "files:organize",
        "files:upload",
        "firm:manageMembers",
        "firm:manageReleaseChannel",
        "firm:manageScanPolicy",
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
        "templates:manage",
        "time:approve",
        "time:manageRates",
        "time:manageSettings",
        "time:manageUtbms",
        "time:track",
        "time:viewFirm",
        "tools:aiTextDetection",
        "tools:decryption",
        "tools:emailInspector",
        "tools:fileConverter",
        "tools:fileIntegrity",
        "tools:fileRepair",
        "tools:fileTypeVerifier",
        "tools:firmUsage",
        "tools:metadataScrubber",
        "tools:ocr",
        "tools:safeBrowse",
        "tools:speedTest",
        "tools:whois",
        // trust:read reaches Owner/Admin, Attorney, Paralegal, and Billing; trust:manage moves
        // client money and reaches Owner/Admin, Attorney, and Billing
        // (20260805T120001_seed-trust-permissions). Read-only carries neither.
        "trust:manage",
        "trust:read",
      ],
    });
  });

  it("owner A invites the future paralegal; the sweep mirrors the member into firm A's database", async () => {
    const inviteResponse = await SELF.fetch("https://example.com/api/v1/members", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://example.com",
        cookie: ownerSessionCookie,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ email: PARALEGAL_EMAIL, name: PARALEGAL_NAME }),
    });
    expect(inviteResponse.status).toBe(201);
    const inviteBody = (await inviteResponse.json()) as { id: string; email: string };
    expect(inviteBody.email).toBe(PARALEGAL_EMAIL);
    invitedParalegalId = inviteBody.id;

    const report = await runScheduledSweep(env);
    expect(report.controlPlane.failed).toBe(0);

    const firmADatabase = firmDatabaseFor(env.FIRM_DATABASE, firmA.id);
    const memberResults = await firmADatabase
      .prepare("SELECT display_name, status FROM member WHERE user_id = ?1")
      .bind(invitedParalegalId)
      .all<{ display_name: string; status: string }>();
    const memberRow = memberResults.results[0];
    expect(memberRow).toEqual({ display_name: PARALEGAL_NAME, status: "active" });

    // The invite carries no role (roleName rides the outbox as null): the member lands roleless —
    // the role-assignment API is a later slice. The seeded Paralegal role IS resolvable in firm
    // A's database, ready for that slice to assign.
    const roleAssignmentResults = await firmADatabase
      .prepare("SELECT COUNT(*) AS count FROM member_role WHERE member_user_id = ?1")
      .bind(invitedParalegalId)
      .all<{ count: number }>();
    expect(roleAssignmentResults.results[0]?.count).toBe(0);
    const paralegalRoleResults = await firmADatabase
      .prepare("SELECT id FROM role WHERE name = 'Paralegal'")
      .all<{ id: string }>();
    expect(paralegalRoleResults.results[0]?.id).toMatch(/^role_/);
  });

  it("leaves no trace of firm A's activity in firm B (tenant isolation)", async () => {
    // Firm B's database holds EXACTLY its own owner — by exhaustive enumeration, so no row for
    // the invitee or firm A's owner can hide; same for the role assignments.
    const firmBDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmB.id);
    const firmBMembers = await firmBDatabase
      .prepare("SELECT user_id FROM member ORDER BY user_id")
      .all<{ user_id: string }>();
    expect(firmBMembers.results).toEqual([{ user_id: firmB.owner.id }]);
    const firmBRoleAssignments = await firmBDatabase
      .prepare("SELECT member_user_id FROM member_role ORDER BY member_user_id")
      .all<{ member_user_id: string }>();
    expect(firmBRoleAssignments.results).toEqual([{ member_user_id: firmB.owner.id }]);

    // Firm B's control-plane slice is untouched beyond its own: its only user is its owner, and
    // the invitee's user row belongs to firm A.
    const firmBUsers = await env.DB_CONTROL.prepare(
      'SELECT id, email FROM "user" WHERE firm_id = ?1',
    )
      .bind(firmB.id)
      .all<{ id: string; email: string }>();
    expect(firmBUsers.results).toEqual([{ id: firmB.owner.id, email: FIRM_B_INPUT.owner.email }]);
    const invitedUserRow = await env.DB_CONTROL.prepare('SELECT firm_id FROM "user" WHERE id = ?1')
      .bind(invitedParalegalId)
      .first<{ firm_id: string }>();
    expect(invitedUserRow?.firm_id).toBe(firmA.id);
  });
});

// ---------------------------------------------------------------------------------------------
// Conformance fitness over the emitted OpenAPI document (the conformance-sweep assertions now
// running over the REAL /v1 routes).

type OpenApiOperation = Record<string, unknown>;
interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const MUTATING_METHODS = ["post", "put", "patch", "delete"] as const;
const ALL_METHODS = ["get", "head", "options", "trace", ...MUTATING_METHODS] as const;

interface EmittedOperation {
  readonly path: string;
  readonly method: string;
  readonly operation: OpenApiOperation;
  readonly label: string; // "POST /api/v1/members" — every assertion message names its route
}

async function fetchOpenApiDocument(): Promise<OpenApiDocument> {
  const response = await SELF.fetch("https://example.com/api/openapi.json");
  expect(response.status).toBe(200);
  return (await response.json()) as OpenApiDocument;
}

function emittedOperations(
  document: OpenApiDocument,
  methods: readonly string[],
): EmittedOperation[] {
  const operations: EmittedOperation[] = [];
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (operation === undefined) continue;
      operations.push({ path, method, operation, label: `${method.toUpperCase()} ${path}` });
    }
  }
  return operations;
}

describe("route conformance fitness (emitted OpenAPI document)", () => {
  it("audits, idempotency-guards, authenticates, and registry-checks every mutating /v1 operation", async () => {
    const document = await fetchOpenApiDocument();
    const mutatingV1 = emittedOperations(document, MUTATING_METHODS).filter((entry) =>
      entry.path.startsWith("/api/v1/"),
    );

    // Non-vacuity floor: the sweep is only a fitness function if it actually saw this slice's
    // mutating routes.
    const operationIds = mutatingV1.map((entry) => entry.operation["operationId"]);
    expect(operationIds).toContain("firms.provision");
    expect(operationIds).toContain("members.invite");

    // POST routes that mutate nothing — a pure computation over the request body (a preview/render) —
    // are exempt from the audited-mutating requirement: there is no state change to audit, and
    // auditing a hot read-shaped POST (the numbering live preview, fired on every keystroke) would
    // flood audit_log. Mirrors the NON_MUTATING_POST_ALLOW_LIST in conformance.test.ts, applied here
    // to the live-served document.
    const NON_MUTATING_POST_ALLOW_LIST = new Set([
      "numbering.preview",
      "directory.duplicateCandidates",
      "shipping.rateShipment",
      "shipping.tracking",
      "customFields.previewConvert",
      "timeEntries.previewQuickAdd",
      "conversions.upload",
      "conversions.submit",
      // Pure credential mint: a staging key plus a short-TTL presigned PUT URL for a template
      // document — no firm-database write, nothing to audit (the conversions.upload precedent).
      "templates.upload",
      "safeBrowse.post",
      // Pure-compute POSTs — inspect/scrub operate over the request body only; nothing is stored.
      "metadata.inspect",
      "metadata.scrub",
      // Pure computation over the streamed request body — computes five digests; nothing is stored.
      "fileIntegrity.hash",
      // Streams the bytes to the scan Container for identification; nothing is stored.
      "fileType.verify",
      // Diagnose/repair/carve operate over the request body only, returning results in-process;
      // nothing is stored. The persisting attach variants are separate audited routes.
      "fileRepair.diagnose",
      "fileRepair.repair",
      "fileRepair.carve",
      // Pure recognition over the uploaded bytes — returns text, word boxes, and confidence;
      // nothing is stored.
      "ocr.recognize",
      // Pure recognition over the uploaded PDF — returns the same document with an invisible
      // searchable text layer; nothing is stored.
      "ocr.searchable",
      // Pure computation over the uploaded message bytes — parses and returns the structural
      // inspection; nothing is stored, no firm data is written.
      "emailInspector.inspect",
      // Analysis POST: the only write is one incidental ai_detection_usage meter row (telemetry),
      // not an auditable firm-domain mutation; auditing every detection would flood audit_log.
      "aiDetection.detect",
      // Read-shaped POST: ranks the matters an open message might belong to. The message facts ride
      // the body rather than a URL because they are the firm's mail; nothing is written or filed.
      "emails.suggestMatters",
      // Read-shaped POST: parses a bank-statement file the firm supplied and reports what is in it.
      // Nothing is stored; the separate, audited import route is what records anything.
      "trust.previewStatementImport",
    ]);

    for (const { operation, label } of mutatingV1) {
      if (!NON_MUTATING_POST_ALLOW_LIST.has(operation["operationId"] as string)) {
        expect(operation["x-mc-audited"], label).toBe(true);
      }
      // Non-null AND one of the two declared idempotency modes — a new mode must be a deliberate
      // contract change, not a typo this sweep waves through.
      expect(["required", "optional"], label).toContain(operation["x-mc-idempotency"]);
      // No mutating /v1 route is reachable without authentication metadata — this, with the
      // narrow platform-admin pin below, is the "no public signup outside /api/auth/*" guarantee.
      expect(operation["x-mc-authenticated"], label).toBe(true);
      const permission = operation["x-mc-permission"];
      expect(typeof permission, label).toBe("string");
      expect(isPermission(permission as string), `${label} permission ${String(permission)}`).toBe(
        true,
      );
    }
  });

  it("pins the platform-admin exception narrowly: only the header-guarded set rides the public surface", async () => {
    const document = await fetchOpenApiDocument();
    const v1Operations = emittedOperations(document, ALL_METHODS).filter((entry) =>
      entry.path.startsWith("/api/v1/"),
    );

    // The operations that document the platform-admin posture (x-mc-surface "public" — the
    // header-secret guard, no session): the firm provisioner and release-channel setter, the
    // platform status-page controls (declare/update/resolve an incident, set/clear a component
    // override), and the support-session redeem — all X-Platform-Admin-Key POSTs under /api/v1.
    // A future unguarded route cannot hide behind the exception, because the exception is this
    // exact set, and each member is asserted guarded below.
    const publicSurface = v1Operations.filter(
      (entry) => entry.operation["x-mc-surface"] === "public",
    );
    expect(publicSurface.map((entry) => entry.operation["operationId"]).sort()).toEqual([
      "firms.provision",
      "platform.setFirmReleaseChannel",
      "platformStatus.clearComponentOverride",
      "platformStatus.declareEvent",
      "platformStatus.postUpdate",
      "platformStatus.resolveEvent",
      "platformStatus.setComponentOverride",
      "supportSessions.redeem",
    ]);
    // And even the exception is no signup hole: each public operation is authenticated (the
    // X-Platform-Admin-Key guard) and carries a registered registry permission.
    for (const { operation, label } of publicSurface) {
      expect(operation["x-mc-authenticated"], label).toBe(true);
      expect(isPermission(operation["x-mc-permission"] as string), label).toBe(true);
    }

    // Every other /v1 operation is an app-surface (session cookie) operation.
    const publicOperations = new Set(publicSurface.map((entry) => entry.operation));
    for (const { operation, label } of v1Operations) {
      if (publicOperations.has(operation)) continue;
      expect(operation["x-mc-surface"], label).toBe("app");
    }
  });

  it("emits no operation resembling public signup outside /api/auth/*", async () => {
    const document = await fetchOpenApiDocument();
    // Better Auth's /api/auth/* router is mounted OUTSIDE the zod-openapi registry, so the
    // emitted document must contain no /api/auth path at all — and therefore no signup-shaped
    // path anywhere in it.
    for (const path of Object.keys(document.paths)) {
      expect(path, path).not.toMatch(/^\/api\/auth\//);
      expect(path, path).not.toMatch(/sign[-_]?up|register/i);
    }
    // And no mutating operation ANYWHERE in the document (not just under /v1) is emitted as
    // unauthenticated — an unauthenticated user-creating POST cannot exist in this contract.
    for (const { operation, label } of emittedOperations(document, MUTATING_METHODS)) {
      expect(operation["x-mc-authenticated"], label).toBe(true);
    }
  });

  it("ENFORCES every declared-authenticated operation behaviorally: a credential-less request answers 401", async () => {
    // Declarations alone are not enforcement: a route declaring x-mc-authenticated: true with its
    // authorize middleware omitted would pass every metadata assert above while shipping publicly
    // mutable. This sweep fires a credential-less request at every declared-authenticated
    // operation and demands the 401 problem — firms.provision included (its platform-admin guard
    // answers the same 401 on a missing X-Platform-Admin-Key). The slice 0·5 chokepoint migration
    // (metadata-DRIVEN enforcement) must keep this sweep green.
    const document = await fetchOpenApiDocument();
    const authenticated = emittedOperations(document, ALL_METHODS).filter(
      (entry) => entry.operation["x-mc-authenticated"] === true,
    );
    // Non-vacuity floor: me.get, members.invite, firms.provision at minimum.
    expect(authenticated.length).toBeGreaterThanOrEqual(3);

    for (const { path, method, label } of authenticated) {
      // Trivial substitutes for any templated params; mutating methods carry a minimal JSON body.
      const concretePath = path.replace(/\{[^}]+\}/g, "test");
      const mutating = (MUTATING_METHODS as readonly string[]).includes(method);
      const response = await SELF.fetch(`https://example.com${concretePath}`, {
        method: method.toUpperCase(),
        ...(mutating ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
      });
      // 401 exactly — never a 2xx (unenforced), and never a 404/400 that would mean some other
      // gate answered before authentication did.
      expect(response.status, label).toBe(401);
      expect(response.headers.get("content-type"), label).toContain("application/problem+json");
    }
    // The sweep fires one real request per authenticated operation, sequentially — it grows with the
    // contract, so it carries a generous timeout rather than the 5s default.
  }, 40_000);

  it("gives every /v1 operation a unique, well-formed operationId mirrored in x-mc-operationId", async () => {
    const document = await fetchOpenApiDocument();
    const v1Operations = emittedOperations(document, ALL_METHODS).filter((entry) =>
      entry.path.startsWith("/api/v1/"),
    );
    expect(v1Operations.length).toBeGreaterThanOrEqual(3); // me.get, members.invite, firms.provision

    const seenOperationIds = new Set<string>();
    for (const { operation, label } of v1Operations) {
      const operationId = operation["operationId"];
      expect(typeof operationId, label).toBe("string");
      // The shape: `<module>.<action>` in camelCase halves.
      expect(operationId, label).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
      expect(operation["x-mc-operationId"], label).toBe(operationId);
      expect(seenOperationIds.has(operationId as string), `duplicate operationId at ${label}`).toBe(
        false,
      );
      seenOperationIds.add(operationId as string);
    }
  });
});
