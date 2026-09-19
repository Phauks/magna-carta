import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { isPermission } from "@magna-carta/access-control/registry";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { runScheduledSweep } from "../src/scheduled.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { NON_MUTATING_POST_ALLOW_LIST as NON_MUTATING_POST_EXEMPTIONS } from "./support/non-mutating-post-allow-list.ts";
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
      // The owner's member record has reached the firm's own database — which is a separate fact
      // from belonging to the firm, and the one the app's guards wait on before letting anybody in.
      membership: { state: "active" },
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
      // tools:fileWorkbench (20260901T000000_seed-file-workbench-permission, seeded onto every
      // default role: it opens the bench, and each capability inside it still carries its own key) +
      // firm:manageScanPolicy (0030_seed-scan-policy-permission, Owner/Admin only) + the support:
      // grants (0031_support-access-permissions: support:request onto every default role,
      // support:cosign / support:manage onto Owner/Admin) +
      // tools:decryption (0035_seed-tools-decryption.sql, seeded onto every default role).
      // Sorted.
      permissions: [
        // The six billing keys split by what they let a member do: reading and drafting reach the
        // practitioner set, finalizing and crediting reach Owner/Admin + Attorney, applying client
        // money reaches Owner/Admin + Attorney + Billing, and configuring the account-role map is
        // Owner/Admin alone (20260805T230000_billing-invoices). Owner/Admin holds all six.
        "billing:apply",
        "billing:configure",
        "billing:credit",
        "billing:draft",
        "billing:finalize",
        "billing:read",
        // calendar:read reaches every default role — "when is the hearing" is a question every seat
        // in a firm asks; calendar:manage asserts when a hearing IS and reaches Owner/Admin,
        // Attorney, and Paralegal only (20260806T000000_case-calendar).
        "calendar:manage",
        "calendar:read",
        // The three communications keys reach Owner/Admin. communications:read also reaches Billing,
        // and communications:reviewUnrouted stops at Owner/Admin and Paralegal — working the queue of
        // calls nobody has filed is reception's job, and its contents are unsorted by construction
        // (20260907T030000_communication-log).
        "communications:log",
        "communications:read",
        "communications:reviewUnrouted",
        // conflicts:read / conflicts:run are seeded onto every default role (any member may screen a
        // consultation); conflicts:dispose is narrower and reaches Owner/Admin + Attorney only, and
        // conflicts:configure narrower still — Owner/Admin alone, because it sets what every future
        // check searches rather than acting on any one of them.
        "conflicts:configure",
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
        // The five discovery keys reach Owner/Admin, Attorney, and Paralegal, and none of them
        // reaches Billing or Read-only. Its OWN namespace is the access rule: a review set is
        // reachable from a discovery grant and from nothing else, never from matters:* or files:*,
        // because material produced by another party may be attorney's-eyes-only under a protective
        // order — and even a discovery grant is checked against the review set's own access list.
        "discovery:load",
        "discovery:manageReviewSets",
        "discovery:produce",
        "discovery:read",
        "discovery:review",
        "documents:assemble",
        // The four co-editing keys. documents:edit and documents:checkout reach the three
        // content-writing seats — the set files:upload and documents:assemble already reach.
        // documents:reconcile stops at Owner/Admin + Attorney (choosing the firm's text of record
        // is the files:delete bracket) and documents:forceReleaseLock at Owner/Admin alone
        // (20260819T220000_seed-document-editing-and-tools-permissions).
        "documents:checkout",
        "documents:edit",
        "documents:forceReleaseLock",
        "documents:reconcile",
        // Reading and clearing one's OWN download shelf, so it seeds to every role that can be
        // handed a generated file at all — the same reasoning notifications:read carries
        // (20260831T230001_seed-download-register-permission.sql).
        "downloads:shelf",
        "emails:file",
        // Deliberately separate from emails:manageLinks: filing mail and configuring the machine to
        // file mail are different grants. Owner/Admin and Attorney carry it by seed; Paralegal gets
        // it only by an explicit firm grant.
        "emails:manageAutoFileRules",
        "emails:manageCaptureAddresses",
        "emails:manageLinks",
        "emails:read",
        "esign:seal",
        "files:delete",
        "files:manageDocumentTypes",
        "files:organize",
        "files:upload",
        // Writing one's own name reaches every seat, Read-only included: it is the platform's one
        // self-scoped mutation, and every statement behind it is scoped to the session's own user id.
        "firm:editOwnProfile",
        // Seeded to Owner/Admin ALONE by 20260909T000000_seed-ai-settings-permission, and
        // deliberately not to the seats that hold magnus:converse: asking the assistant a
        // question is ordinary work, deciding that the firm's privileged content may leave for
        // a third-party model is not.
        "firm:manageAiSettings",
        "firm:manageMembers",
        // The firm's notification policy — the in-app floor, retention window and digest hour —
        // reaches Owner/Admin only. Deliberately NOT notifications:read, which every default role
        // including Read-only carries (20260819T140000_seed-notification-policy-permission).
        "firm:manageNotificationPolicy",
        // What the firm is CALLED to its clients. Owner/Admin alone, and its own key rather than a
        // corner of firm:manageMembers: administering who works here and deciding what the firm is
        // called are different acts, and the second reaches paper that has already left the building.
        "firm:manageProfile",
        "firm:manageReleaseChannel",
        // Seeded to Owner/Admin alone by 20260907T090000_seed-report-policy-permission.
        "firm:manageReportPolicy",
        "firm:manageScanPolicy",
        "firm:manageSecrets",
        // The roster read, seeded to every default role including Read-only — the same universal
        // shape as notifications:read below, and the deliberate opposite of firm:manageMembers
        // above (20260829T120000_seed-read-members-permission). Knowing who one's colleagues are is
        // not the privilege of adding one.
        "firm:readMembers",
        "firm:reportIncident",
        "firm:scanFile",
        "incidents:viewDescription",
        // The four intake keys. intake:read and intake:record reach every seat that does firm work
        // (Owner/Admin, Attorney, Paralegal, Billing); intake:waive and intake:manageProcedures stop
        // at Owner/Admin and Attorney, because waiving a required step is the recorded override of
        // an opening gate and the procedure is the firm's statement of how it takes work on
        // (20260903T150000_intake-procedure).
        "intake:manageProcedures",
        "intake:read",
        "intake:record",
        "intake:waive",
        // Decrypting a connected integration's credential so the worker can act with it —
        // deliberately not firm:manageSecrets, which would be read access to every secret the
        // firm holds in exchange for buying a postage label.
        "integrations:useConnection",
        "locations:manage",
        // Both assistant keys reach Owner/Admin: magnus:converse is seeded to the seats that do
        // legal work (Owner/Admin, Attorney, Paralegal), and magnus:readAllConversations — reading
        // every member's conversation, a supervision capability — stops at Owner/Admin
        // (20260806T050000_magnus-conversations). Holding them turns nothing on: both firm-level
        // consent settings default closed and every route reads them before anything else.
        "magnus:converse",
        "magnus:readAllConversations",
        // The asset register is narrower than custody and calendar by seed: it concentrates what an
        // estate owns and what it is worth in one surface, so both keys reach Owner/Admin, Attorney,
        // and Paralegal and neither reaches Billing or Read-only (20260806T020000_matter-assets).
        // Opening a FULL account number is a third gate that already existed —
        // directory:viewSensitiveIdentifiers, above — so matterAssets:read alone never reveals one.
        "matterAssets:manage",
        "matterAssets:read",
        "matters:close",
        "matters:create",
        "matters:edit",
        "matters:hold",
        "matters:manageNumbering",
        "matters:manageTypes",
        "matters:open",
        "matters:renumber",
        "matters:reopen",
        // The two matter-notes keys, each seeded to the same three practising seats — Owner/Admin,
        // Attorney and Paralegal — and to neither Billing nor Read-only. The separate withdrawal key
        // left with the edit-and-delete model.
        "notes:read",
        "notes:write",
        // Seeded onto every default role, Read-only included — the deliberate contrast with
        // trust:read below (20260807T020000_notifications-delivery). A member's feed is their own,
        // scoped to their own user id and filtered by matter visibility before it returns a row.
        "notifications:read",
        // Every reports key is Owner/Admin alone — narrower than the trust and billing reads a firm
        // grants more widely, because an aggregate across every matter and client is a different
        // exposure from a per-matter read. reports:productivity is narrower still in kind: a report
        // about people rather than about money.
        // Exporting a report's rows, seeded wherever a report can be read at all: the export is the
        // same figures the reader already has, in a file
        // (20260831T210000_seed-report-export-permission.sql).
        "reports:export",
        "reports:financial",
        "reports:operational",
        "reports:produce",
        "reports:productivity",
        "reports:trustCompliance",
        // One search across a matter's sections; each source stays gated by its own read key.
        "search:matter",
        "shipping:manage",
        "support:cosign",
        "support:manage",
        "support:request",
        // The four task keys. tasks:read and tasks:write reach every seat that does firm work —
        // Owner/Admin, Attorney, Paralegal and Billing, because chasing a retainer replenishment is
        // a billing clerk's own work and a list that cannot hold it sends them to a spreadsheet.
        // tasks:assign is separate because putting work in a colleague's NAME is a different act
        // from fixing a due date, and a firm may reserve it without reserving the rest.
        // tasks:managePlans is narrower again — Owner/Admin and Attorney — because a matter plan is
        // a statement about how the firm practises rather than a piece of work.
        "tasks:assign",
        "tasks:managePlans",
        "tasks:read",
        "tasks:write",
        "templates:manage",
        "time:approve",
        "time:manageRates",
        "time:manageSettings",
        "time:manageUtbms",
        "time:track",
        "time:viewFirm",
        "tools:aiTextDetection",
        // The four public-record link libraries reach every default role, the reach every other
        // credential-less lookup already has; the shipping tile below is Owner/Admin alone, matching
        // shipping:manage (20260819T220000_seed-document-editing-and-tools-permissions).
        "tools:attorneyLicense",
        "tools:businessLookup",
        "tools:decryption",
        "tools:emailInspector",
        "tools:fileConverter",
        "tools:fileIntegrity",
        "tools:fileRepair",
        "tools:fileTypeVerifier",
        "tools:fileWorkbench",
        "tools:firmUsage",
        "tools:metadataScrubber",
        "tools:ocr",
        "tools:propertyListings",
        "tools:propertyRecords",
        "tools:safeBrowse",
        "tools:shipping",
        "tools:speedTest",
        "tools:whois",
        // trust:read reaches Owner/Admin, Attorney, Paralegal, and Billing; trust:manage moves
        // client money and reaches Owner/Admin, Attorney, and Billing
        // (20260805T120001_seed-trust-permissions). Read-only carries neither. trust:authorize —
        // the authority to act on client money under the firm's authorization policy — reaches
        // Owner/Admin and Attorney only (20260807T050000_trust-authorization-policy).
        "trust:authorize",
        // Putting the FIRM'S own money into a client trust account — the one deliberate exception
        // to no-commingling, permitted for a single purpose and only in the amount necessary for
        // it — is narrower still: Owner/Admin alone by seed
        // (20260812T000001_seed-trust-firm-funds-permission).
        "trust:firmFunds",
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

// THE ANONYMOUS JOINING SET — the only mutating /v1 operations a caller with no credential at all
// may reach, enumerated here so a fourth one cannot appear without this literal being edited.
//
// Every sweep below used to say, flatly, that no unauthenticated mutating operation exists in this
// contract. That was true while accounts were provisioned exclusively by a platform operator, and
// it stopped being true the moment somebody had to be able to start a firm or redeem an invitation
// without already having an account — those callers cannot present a session, because the session
// is what they are asking for. The guarantee the sweeps actually protect is narrower and survives
// intact: no operation OUTSIDE this list is reachable unauthenticated, Better Auth's own signup
// stays closed and unmounted in this document, and each member of the list earns its place by a
// justification recorded in conformance.test.ts's PUBLIC_ALLOW_LIST.
//
// What each of them is allowed to do is deliberately small: create one control-plane row, or turn
// a token the caller already holds into an account. None of them can be reached with a firm id,
// none of them reads firm data, and all three ride the tightest rate-limit bucket.
const ANONYMOUS_JOINING_OPERATIONS: ReadonlySet<string> = new Set([
  "registrations.start",
  "registrations.confirm",
  "invitations.redeem",
]);

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

    // The read-shaped POSTs that mutate nothing, and are therefore exempt from the audited-mutating
    // requirement. The set has ONE home — this fitness function reads the document the running worker
    // serves, its twin in conformance.test.ts reads the one the route table emits, and when each kept
    // its own copy they drifted: `uploads.matches` reached only the twin, and this suite was red on
    // main until somebody looked. A route earns the exemption once, with its justification.
    const NON_MUTATING_POST_ALLOW_LIST = new Set(Object.keys(NON_MUTATING_POST_EXEMPTIONS));

    // The two doors a signed-in account with no firm may push on, and the only mutating operations
    // that legitimately name no permission while being authenticated. Adding a third is a decision
    // about who may act before belonging anywhere, not a line to append quietly.
    const FIRMLESS_JOINING_OPERATIONS = new Set([
      "onboarding.foundFirm",
      "onboarding.redeemInvitation",
    ]);

    for (const { operation, label } of mutatingV1) {
      if (!NON_MUTATING_POST_ALLOW_LIST.has(operation["operationId"] as string)) {
        expect(operation["x-mc-audited"], label).toBe(true);
      }
      // Non-null AND one of the two declared idempotency modes — a new mode must be a deliberate
      // contract change, not a typo this sweep waves through.
      expect(["required", "optional"], label).toContain(operation["x-mc-idempotency"]);
      // No mutating /v1 route is reachable without authentication metadata, EXCEPT the enumerated
      // joining set — this, with the narrow platform-admin pin below, is what keeps the contract
      // free of an accidental public signup hole.
      if (ANONYMOUS_JOINING_OPERATIONS.has(operation["operationId"] as string)) {
        // An anonymous route must name NO permission: the chokepoint never reads one for a caller
        // it did not authenticate, so naming one would be a contract that misleads its next reader
        // into thinking something is enforced. defineOpenAPIRoute refuses it at startup; this is
        // the same rule asserted over the emitted document.
        expect(operation["x-mc-authenticated"], label).toBe(false);
        expect(operation["x-mc-permission"], label).toBeNull();
        // And it rides the tightest bucket, which is the only enforcement left standing on it.
        expect(operation["x-mc-rateLimit"], label).toBe("auth");
        continue;
      }
      expect(operation["x-mc-authenticated"], label).toBe(true);
      // The third shape, and the newest: authenticated, but held by an account that belongs to no
      // firm yet. Every permission in the registry is firm-scoped, so there is no true one to name
      // — a firmless caller has no role anywhere. Naming one anyway would be the same misleading
      // contract the anonymous branch above refuses. What stands in its place is stricter than a
      // permission and is asserted here: the route admits ONLY a firmless session, so an account
      // that already has a firm cannot reach it at all, and it rides the tightest bucket.
      if (FIRMLESS_JOINING_OPERATIONS.has(operation["operationId"] as string)) {
        expect(operation["x-mc-permission"], label).toBeNull();
        expect(operation["x-mc-firmlessSession"], label).toBe("only");
        expect(operation["x-mc-rateLimit"], label).toBe("auth");
        continue;
      }
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
    // The public surface carries TWO populations, and conflating them is how a genuinely
    // unauthenticated route could hide behind the platform-admin exception. Both are enumerated.
    const publicSurface = v1Operations.filter(
      (entry) => entry.operation["x-mc-surface"] === "public",
    );
    const platformAdminSurface = publicSurface.filter(
      (entry) => !ANONYMOUS_JOINING_OPERATIONS.has(entry.operation["operationId"] as string),
    );
    expect(platformAdminSurface.map((entry) => entry.operation["operationId"]).toSorted()).toEqual([
      "firms.provision",
      "platform.setFirmReleaseChannel",
      "platformStatus.clearComponentOverride",
      "platformStatus.declareEvent",
      "platformStatus.postUpdate",
      "platformStatus.resolveEvent",
      "platformStatus.setComponentOverride",
      "supportSessions.redeem",
    ]);
    // The platform-admin exception is no signup hole: each of its operations is authenticated (by
    // the X-Platform-Admin-Key guard) and carries a registered registry permission.
    for (const { operation, label } of platformAdminSurface) {
      expect(operation["x-mc-authenticated"], label).toBe(true);
      expect(isPermission(operation["x-mc-permission"] as string), label).toBe(true);
    }
    // The joining set is the opposite posture, and every member of it must actually be present:
    // an entry that stopped being emitted would silently shrink this pin to nothing.
    expect(
      publicSurface
        .filter((entry) =>
          ANONYMOUS_JOINING_OPERATIONS.has(entry.operation["operationId"] as string),
        )
        .map((entry) => entry.operation["operationId"])
        .toSorted(),
    ).toEqual([...ANONYMOUS_JOINING_OPERATIONS].toSorted());

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
      // "signup"-shaped paths stay banned. `/api/v1/registrations` is deliberately NOT one of
      // them and is exempted by name rather than by loosening the pattern: the thing being
      // guarded against is Better Auth's own credential-creating signup leaking into this
      // contract, not the word. The platform's registration route creates no credential at all —
      // it writes a pending row and mails a link, and the password is set through the reset flow.
      if (!path.startsWith("/api/v1/registrations")) {
        expect(path, path).not.toMatch(/sign[-_]?up|register/i);
      }
    }
    // And no mutating operation ANYWHERE in the document is emitted as unauthenticated except the
    // enumerated joining set — an unauthenticated user-creating POST cannot appear in this
    // contract without this literal being edited in the same change.
    for (const { operation, label } of emittedOperations(document, MUTATING_METHODS)) {
      if (ANONYMOUS_JOINING_OPERATIONS.has(operation["operationId"] as string)) continue;
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
    // Sized to the sweep: one request per declared-authenticated operation (five hundred and
    // counting), each through the full middleware chain, on a 2-core runner shared with three other
    // workerd VMs. 40 s was enough on a quiet box and timed out on the gate.
  }, 180_000);

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
