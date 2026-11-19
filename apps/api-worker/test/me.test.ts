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
      // Admin's seeded role_permission rows: firm:manageMembers (0002_member-rbac.sql) +
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
      // firm:manageReleaseChannel (0024_seed-release-channel-permission.sql, Admin only) + the
      // costs: grants (0028_burly_piledriver: costs:track + costs:approve onto Admin) +
      // support:request / support:cosign / support:manage (0029_support-access-permissions,
      // Admin gets all three; other roles get support:request only) +
      // tools:fileTypeVerifier (0032_seed-tools-file-type-verifier.sql, seeded onto every default role) +
      // tools:fileWorkbench (20260901T000000_seed-file-workbench-permission, seeded onto every
      // default role: it opens the bench, and each capability inside it still carries its own key) +
      // tools:decryption (in the 20260704T041516 baseline) +
      // tools:fileRepair (20260704T041517_seed-tools-file-repair) — both seeded onto every default role +
      // tools:speedTest (20260704T041519_seed-tools-speed-test, seeded onto every default role; it was
      // the one tools:* permission no role carried) +
      // templates:manage / documents:assemble (20260804T150001_seed-document-automation-permissions:
      // templates:manage is administrative and reaches Admin only; documents:assemble goes to
      // the practising roles).
      // Sorted.
      permissions: [
        // The six billing keys split by what they let a member do: reading and drafting reach the
        // practitioner set, finalizing and crediting reach Admin + Attorney, applying client
        // money reaches Admin + Attorney + Billing, and configuring the account-role map is
        // Admin alone (20260805T230000_billing-invoices). Admin holds all six.
        "billing:apply",
        "billing:configure",
        "billing:credit",
        "billing:draft",
        "billing:finalize",
        "billing:read",
        // calendar:read reaches every default role — "when is the hearing" is a question every seat
        // in a firm asks; calendar:manage asserts when a hearing IS and reaches Admin,
        // Attorney, and Paralegal only (20260806T000000_case-calendar).
        "calendar:manage",
        // What may be copied to members' own calendars at a provider: Admin alone.
        "calendar:manageSyncPolicy",
        "calendar:read",
        // The three communications keys reach Admin. communications:read also reaches Billing
        // ("did anyone ever reach this client about the unpaid invoice" is a clerk's question) and
        // communications:reviewUnrouted stops at Admin and Paralegal — working the queue of
        // calls nobody has filed is reception's job, and its contents are unsorted by construction
        // (20260907T030000_communication-log).
        "communications:log",
        "communications:read",
        "communications:reviewUnrouted",
        // conflicts:read / conflicts:run are seeded onto every default role (any member may screen a
        // consultation); conflicts:dispose is narrower and reaches Admin + Attorney only, and
        // conflicts:configure narrower still — Admin alone, because it sets what every future
        // check searches rather than acting on any one of them.
        "conflicts:configure",
        "conflicts:dispose",
        "conflicts:read",
        "conflicts:run",
        "costs:approve",
        "costs:track",
        // custody:read reaches every default role (a billing clerk answering "do we hold the deed"
        // needs it); custody:manage moves physical originals and reaches Admin, Attorney, and
        // Paralegal only (20260804T160001_seed-custody-catalog).
        "custody:manage",
        "custody:read",
        "customFields:manage",
        "customFields:purge",
        "directory:edit",
        "directory:viewSensitiveIdentifiers",
        // The five discovery keys reach Admin, Attorney, and Paralegal, and none of them
        // reaches Billing or Read-only. Its OWN namespace is the access rule: a review set is
        // reachable from a discovery grant and from nothing else, never from matters:* or files:*,
        // because material produced by another party may be attorney's-eyes-only under a protective
        // order. Five keys rather than a read/manage pair so a firm can grant discovery:read and
        // discovery:review alone to a contract reviewer — and even then the review set's own access
        // list is checked beside the grant.
        "discovery:load",
        "discovery:manageReviewSets",
        "discovery:produce",
        "discovery:read",
        "discovery:review",
        "documents:assemble",
        // The four co-editing keys. documents:edit and documents:checkout reach the three
        // content-writing seats (Admin, Attorney, Paralegal) — the same set files:upload and
        // documents:assemble already reach, because typing a new version and uploading one are the
        // same act through two doors. documents:reconcile stops at Admin + Attorney: choosing
        // which of two divergent copies is the firm's text of record is the files:delete bracket.
        // documents:forceReleaseLock stops at Admin alone, because an override every editor
        // also holds is not an override
        // (20260819T220000_seed-document-editing-and-tools-permissions).
        "documents:checkout",
        "documents:edit",
        "documents:forceReleaseLock",
        "documents:reconcile",
        // Reading and clearing one's OWN download shelf, so it seeds to every role that can be
        // handed a generated file at all — the same reasoning notifications:read carries.
        "downloads:shelf",
        "emails:file",
        // Deliberately separate from emails:manageLinks: filing mail and configuring the machine to
        // file mail are different grants. Admin and Attorney carry it by seed; Paralegal gets
        // it only by an explicit firm grant.
        "emails:manageAutoFileRules",
        "emails:manageCaptureAddresses",
        "emails:manageLinks",
        "emails:read",
        "esign:seal",
        "esign:send",
        "esign:sign",
        "exhibits:issue",
        "exhibits:manage",
        "files:delete",
        "files:manageDocumentTypes",
        "files:organize",
        "files:upload",
        // Writing one's own name reaches every seat, Read-only included: it is the platform's one
        // self-scoped mutation, and every statement behind it is scoped to the session's own user id.
        "firm:editOwnProfile",
        // Seeded to Admin ALONE by 20260909T000000_seed-ai-settings-permission, and
        // deliberately not to the seats that hold magnus:converse: asking the assistant a
        // question is ordinary work, deciding that the firm's privileged content may leave for
        // a third-party model is not.
        "firm:manageAiSettings",
        "firm:manageEditingPolicy",
        "firm:manageMembers",
        // The firm's notification policy — the in-app floor, retention window and digest hour —
        // reaches Admin only. Deliberately NOT notifications:read, which every default role
        // including Read-only carries (20260819T140000_seed-notification-policy-permission).
        "firm:manageNotificationPolicy",
        // What the firm is CALLED to its clients — the name on an invoice, in the portal and on
        // every generated document. Admin alone, and its own key rather than a corner of
        // firm:manageMembers: administering who works here and deciding what the firm is called
        // are different acts, and the second reaches paper that has already left the building.
        "firm:manageProfile",
        "firm:manageReleaseChannel",
        // Seeded to Admin alone by 20260907T090000_seed-report-policy-permission.
        "firm:manageReportPolicy",
        "firm:manageScanPolicy",
        // Whether the contents of the firm's files are indexed for search: Owner/Admin alone, the
        // firm:manageScanPolicy bracket (seed-search-settings-permission).
        "firm:manageSearchSettings",
        "firm:manageSecrets",
        // Seeded to every default role, Read-only included — reading who is on the firm is not the
        // privilege that firm:manageMembers above is.
        "firm:readMembers",
        "firm:reportIncident",
        "firm:scanFile",
        // Bringing records in from the system the firm is leaving: Owner/Admin alone.
        "firm:transferRecords",
        "incidents:viewDescription",
        // The four intake keys. intake:read and intake:record reach every seat that does firm work
        // (Admin, Attorney, Paralegal, Billing); intake:waive and intake:manageProcedures stop
        // at Admin and Attorney, because waiving a required step is the recorded override of
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
        // Both assistant keys reach Admin: magnus:converse is seeded to the seats that do
        // legal work (Admin, Attorney, Paralegal), and magnus:readAllConversations — reading
        // every member's conversation, a supervision capability — stops at Admin
        // (20260806T050000_magnus-conversations). Holding them turns nothing on: both firm-level
        // consent settings default closed and every route reads them before anything else.
        "magnus:converse",
        "magnus:readAllConversations",
        // Both asset keys reach Admin, Attorney, and Paralegal and neither reaches Billing or
        // Read-only — narrower than custody:read and calendar:read, because the register
        // concentrates what an estate owns and what it is worth in one surface
        // (20260806T020000_matter-assets). Opening a FULL account number needs
        // directory:viewSensitiveIdentifiers on top, which is above.
        "matterAssets:manage",
        "matterAssets:read",
        "matters:close",
        "matters:create",
        "matters:edit",
        "matters:hold",
        "matters:manageNumbering",
        // Seeded to Admin alone: how long the firm keeps a closed matter's paper file is
        // its policy, not a choice for whoever is closing a matter.
        "matters:manageRetention",
        "matters:manageTypes",
        "matters:open",
        "matters:renumber",
        "matters:reopen",
        "matters:viewNumbering",
        // meetings:join reaches Admin, Attorney, Paralegal and Billing — being in a meeting
        // about a case is not a privilege of the seats that argue it; meetings:host stops short of
        // Billing, because convening and closing a meeting on a firm's calendar is the practising
        // seats' act (20260919T001020_seed-meetings-permissions).
        "meetings:host",
        "meetings:join",
        // Whether the firm's meetings may be recorded, captioned and summarized at all reaches
        // Owner/Admin alone, the firm:manageAiSettings bracket: recording one meeting is a
        // practitioner's act, deciding for every meeting is the firm's
        // (20261110T000108_seed-meeting-settings-permission).
        "meetings:manageSettings",
        // meetings:record is seeded to exactly the seats that hold meetings:host, so no firm's
        // behaviour changes the day it lands (20261110T000101_meeting-recording-and-who-was-told).
        "meetings:record",
        // Seeded onto EVERY default role including Read-only — the deliberate contrast with
        // trust:read (20260807T020000_notifications-delivery). Reading one's own feed is not a
        // privilege: it is scoped to the session's own user id and every row is filtered by matter
        // visibility at read time, so the key grants sight of nothing the member could not already
        // reach, and a firm whose staff cannot see their own deadlines is a firm the feature failed.
        // The two matter-notes keys, each seeded to the same three practising seats — Admin,
        // Attorney and Paralegal — and to neither Billing nor Read-only. (The edit-and-delete model
        // replaced the separate withdrawal key.)
        "notes:read",
        "notes:write",
        "notifications:read",
        // Every reports key is Admin alone — narrower than the trust and billing reads a firm
        // grants more widely, because an aggregate across every matter and client is a different
        // exposure from a per-matter read. reports:productivity is narrower still in kind: a report
        // about people rather than about money.
        // Exporting a report's rows, seeded wherever a report can be read at all: the export is the
        // same figures the reader already has, in a file.
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
        // Admin, Attorney, Paralegal and Billing, because chasing a retainer replenishment is
        // a billing clerk's own work and a list that cannot hold it sends them to a spreadsheet.
        // tasks:assign is separate because putting work in a colleague's NAME is a different act
        // from fixing a due date, and a firm may reserve it without reserving the rest.
        // tasks:managePlans is narrower again — Admin and Attorney — because a matter plan is
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
        // credential-less lookup already has: they open a government or listing website in a new
        // tab, read nothing of the firm's, hold no credential and store nothing
        // (20260819T220000_seed-document-editing-and-tools-permissions).
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
        "tools:legalCitations",
        "tools:metadataScrubber",
        "tools:ocr",
        "tools:propertyListings",
        "tools:propertyRecords",
        "tools:safeBrowse",
        // The Tools tile for shipping is Admin alone, matching shipping:manage above: every
        // operation behind the tile is gated on that key, so a wider tile would be a tool whose
        // every button the holder's role refuses.
        "tools:shipping",
        "tools:speedTest",
        "tools:whois",
        // trust:read reaches Admin, Attorney, Paralegal, and Billing; trust:manage moves
        // client money and reaches Admin, Attorney, and Billing
        // (20260805T120001_seed-trust-permissions). Read-only carries neither. trust:authorize is
        // the authority to act on client money — what the firm's authorization policy can require
        // of whoever lets a disbursement or an earned-fee application go, and the key that changes
        // that policy — and it reaches Admin and Attorney only
        // (20260807T050000_trust-authorization-policy): deliberately narrower than trust:manage,
        // which also reaches Billing.
        "trust:authorize",
        // Putting the FIRM'S own money into a client trust account — the one deliberate exception
        // to no-commingling, permitted for a single purpose and only in the amount necessary for
        // it — is narrower still: Admin alone by seed
        // (20260812T000001_seed-trust-firm-funds-permission).
        "trust:firmFunds",
        "trust:manage",
        "trust:read",
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
    //
    // The empty permission list is the SYMPTOM and is not, by itself, an explanation: a member who
    // genuinely holds no role reads the same. So the reply names the window as well, and the app's
    // own guards read that field rather than inferring a wait from an absence.
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
      membership: { state: "provisioning" },
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
