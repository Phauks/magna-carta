import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { isPermission } from "@magna-carta/access-control/registry";
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

// The slice 0·4 capstone: one journey composed over the REAL HTTP surface (SELF fetch) —
// provision two firms → sweep mirrors the owners → owner A activates through the emailed reset
// link → signs in → enrolls TOTP → completes a full 2FA login → reads /api/v1/me → invites the
// future paralegal → sweep mirrors the invitee — then the tenant-isolation asserts: firm B's
// database and control-plane rows carry no trace of firm A's activity.
//
// Storage is per-test-FILE and shared across this file's tests, so the journey runs as ONE
// sequence of `it` steps over module-level state (the firms.test.ts pattern). The dev pool has
// exactly two bindings; this file provisions both firms, claiming both.

beforeAll(async () => {
  // Control plane only — the provisioner migrates each claimed pool firm database itself (that
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

describe("slice 0·4 end-to-end", () => {
  it("provisions firm A and firm B, each claiming its own dev-pool database", async () => {
    const responseA = await postFirms(FIRM_A_INPUT);
    expect(responseA.status).toBe(201);
    firmA = (await responseA.json()) as ProvisionResponseBody;
    expect(firmA.status).toBe("active");

    const responseB = await postFirms(FIRM_B_INPUT);
    expect(responseB.status).toBe(201);
    firmB = (await responseB.json()) as ProvisionResponseBody;
    expect(firmB.status).toBe("active");

    // Provision order pins the pool claims: firm A on the first binding, firm B on the second —
    // the handle every later isolation assert keys its direct database reads off.
    for (const [firmId, expectedBinding] of [
      [firmA.id, "DB_FIRM_POOL_1"],
      [firmB.id, "DB_FIRM_POOL_2"],
    ] as const) {
      const firmRow = await env.DB_CONTROL.prepare(
        "SELECT database_identifier FROM firm WHERE id = ?1",
      )
        .bind(firmId)
        .first<{ database_identifier: string }>();
      expect(firmRow?.database_identifier).toBe(expectedBinding);
    }
  });

  it("mirrors both owners into their own firm databases with Owner/Admin via the sweep", async () => {
    const report = await runScheduledSweep(env);
    expect(report.controlPlane.dispatched).toBeGreaterThanOrEqual(2);
    expect(report.controlPlane.failed).toBe(0);

    for (const [owner, firmDatabase] of [
      [firmA.owner, env.DB_FIRM_POOL_1],
      [firmB.owner, env.DB_FIRM_POOL_2],
    ] as const) {
      const memberRow = await firmDatabase
        .prepare("SELECT display_name, status FROM member WHERE user_id = ?1")
        .bind(owner.id)
        .first<{ display_name: string; status: string }>();
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
      // Owner/Admin's seeded role_permission rows (0002_member-rbac.sql).
      permissions: ["firm:manageMembers"],
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

    const memberRow = await env.DB_FIRM_POOL_1.prepare(
      "SELECT display_name, status FROM member WHERE user_id = ?1",
    )
      .bind(invitedParalegalId)
      .first<{ display_name: string; status: string }>();
    expect(memberRow).toEqual({ display_name: PARALEGAL_NAME, status: "active" });

    // The invite carries no role (roleName rides the outbox as null): the member lands roleless —
    // the role-assignment API is a later slice. The seeded Paralegal role IS resolvable in firm
    // A's database, ready for that slice to assign.
    const roleAssignmentCount = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS count FROM member_role WHERE member_user_id = ?1",
    )
      .bind(invitedParalegalId)
      .first<{ count: number }>();
    expect(roleAssignmentCount?.count).toBe(0);
    const paralegalRole = await env.DB_FIRM_POOL_1.prepare(
      "SELECT id FROM role WHERE name = 'Paralegal'",
    ).first<{ id: string }>();
    expect(paralegalRole?.id).toMatch(/^rol_/);
  });

  it("leaves no trace of firm A's activity in firm B (tenant isolation)", async () => {
    // Firm B's database holds EXACTLY its own owner — by exhaustive enumeration, so no row for
    // the invitee or firm A's owner can hide; same for the role assignments.
    const firmBMembers = await env.DB_FIRM_POOL_2.prepare(
      "SELECT user_id FROM member ORDER BY user_id",
    ).all<{ user_id: string }>();
    expect(firmBMembers.results).toEqual([{ user_id: firmB.owner.id }]);
    const firmBRoleAssignments = await env.DB_FIRM_POOL_2.prepare(
      "SELECT member_user_id FROM member_role ORDER BY member_user_id",
    ).all<{ member_user_id: string }>();
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
// Conformance fitness over the emitted OpenAPI document (the api-contract design spec's §3.5
// assertions, the spike's conformance-sweep pattern now running over the REAL /v1 routes).

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

    for (const { operation, label } of mutatingV1) {
      expect(operation["x-mc-audited"], label).toBe(true);
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

  it("pins the platform-admin exception narrowly: firms.provision alone rides the public surface", async () => {
    const document = await fetchOpenApiDocument();
    const v1Operations = emittedOperations(document, ALL_METHODS).filter((entry) =>
      entry.path.startsWith("/api/v1/"),
    );

    // Exactly ONE operation documents the platform-admin posture (x-mc-surface "public" — the
    // header-secret guard, no session): firms.provision. A future unguarded route cannot hide
    // behind the exception, because the exception is this exact set.
    const publicSurface = v1Operations.filter(
      (entry) => entry.operation["x-mc-surface"] === "public",
    );
    expect(publicSurface.map((entry) => entry.operation["operationId"])).toEqual([
      "firms.provision",
    ]);
    // And even the exception is no signup hole: authenticated (the X-Platform-Admin-Key guard)
    // with the reserved registry permission — matching how routes/firms.ts documents it.
    const provisionOperation = publicSurface[0]?.operation;
    expect(provisionOperation?.["x-mc-authenticated"]).toBe(true);
    expect(provisionOperation?.["x-mc-permission"]).toBe("firm:provision");

    // Every other /v1 operation is an app-surface (session cookie) operation this slice.
    for (const { operation, label } of v1Operations) {
      if (operation === provisionOperation) continue;
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
      // The §3.5 shape: `<module>.<action>` in camelCase halves.
      expect(operationId, label).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
      expect(operation["x-mc-operationId"], label).toBe(operationId);
      expect(seenOperationIds.has(operationId as string), `duplicate operationId at ${label}`).toBe(
        false,
      );
      seenOperationIds.add(operationId as string);
    }
  });
});
