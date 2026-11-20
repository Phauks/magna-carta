import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseHandle } from "./support/firm-database-handle.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmlessCredentialedUser,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A CLIENT OF A FIRM IS NOT SOMEBODY WHO WORKS THERE. Redeeming a client invitation makes an account
// whose kind is `portalUser`, whose firm_id is NULL, and whose only tie to the firm is a portal
// membership naming a Directory person. No member row is provisioned, so no role reaches it; and the
// chokepoint answers it the reserved 404 on every route that did not list the kind. What is asserted
// here is each of those, because each one alone is what a later change would quietly undo.

let firmId: FirmId;
let issuerCookie: string;
const PERSON_ID = "directoryPerson_portalUserInvitee";
const SECOND_PERSON_ID = "directoryPerson_portalUserSecond";

let nextClientAddress = 0;
function freshClientAddress(): string {
  nextClientAddress += 1;
  return `203.0.113.${nextClientAddress % 250}`;
}

function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      "cf-connecting-ip": freshClientAddress(),
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

function issue(body: Record<string, unknown>): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/invitations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: issuerCookie,
      "idempotency-key": newIdentifier("idempotencyRecord"),
    },
    body: JSON.stringify({
      name: "Dana Whitfield",
      lastName: "Whitfield",
      dateOfBirth: "1981-06-02",
      ...body,
    }),
  });
}

async function issueClientInvitation(email: string, personId = PERSON_ID): Promise<string> {
  const response = await issue({
    kind: "clientOfFirm",
    email,
    directoryEntityId: personId,
  });
  const body = (await response.json()) as { code?: string };
  expect(response.status, JSON.stringify(body)).toBe(201);
  return body.code ?? "";
}

interface UserRow {
  readonly firm_id: string | null;
  readonly principal_kind: string;
}

async function readUser(email: string): Promise<UserRow & { readonly id: string }> {
  const row = await env.DB_CONTROL.prepare(
    'SELECT id, firm_id, principal_kind FROM "user" WHERE email = ?1',
  )
    .bind(email)
    .first<UserRow & { id: string }>();
  expect(row).not.toBeNull();
  return row!;
}

async function memberProvisionCount(userId: string): Promise<number> {
  const row = await env.DB_CONTROL.prepare(
    "SELECT COUNT(*) AS n FROM outbox WHERE topic = 'member.provision' AND payload LIKE ?1",
  )
    .bind(`%${userId}%`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Hollis and Reyes" })).firmId;
  const issuer = await seedCredentialedUser("portal-issuer@example.com", { firmId });
  await mirrorMemberWithOwnerRole(issuer.userId, "Portal Issuer", firmId);
  issuerCookie = await signInForSessionCookie("portal-issuer@example.com");
  const now = new Date().toISOString();
  await firmDatabaseHandle(firmId)
    .prepare(
      "INSERT INTO directory_person (id, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
    )
    .bind(PERSON_ID, "Dana Whitfield", now)
    .run();
  await firmDatabaseHandle(firmId)
    .prepare(
      "INSERT INTO directory_person (id, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
    )
    .bind(SECOND_PERSON_ID, "Sam Carver", now)
    .run();
});

describe("issuing a client invitation", () => {
  it("refuses one that names no Directory person", async () => {
    const response = await issue({ kind: "clientOfFirm", email: "no-person@example.com" });
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("directoryEntityId");
  });

  it("refuses one that names a person the firm does not have", async () => {
    const response = await issue({
      kind: "clientOfFirm",
      email: "unknown-person@example.com",
      directoryEntityId: "directoryPerson_nobodyHere",
    });
    expect(response.status).toBe(422);
  });

  it("refuses a staff invitation that names a person", async () => {
    const response = await issue({
      kind: "firmMember",
      email: "staff-with-person@example.com",
      directoryEntityId: PERSON_ID,
    });
    expect(response.status).toBe(422);
  });

  it("is refused by the database itself when the person is missing", async () => {
    await expect(
      env.DB_CONTROL.prepare(
        "INSERT INTO invitation (id, firm_id, kind, email, display_name, code_hash, verifier_hash, " +
          "status, attempt_count, expires_at, invited_by_user_id, created_at) VALUES " +
          "(?1, ?2, 'clientOfFirm', 'direct@example.com', 'Direct', ?3, ?3, 'pending', 0, " +
          "'2099-01-01T00:00:00.000Z', 'user_x', '2026-11-20T00:00:00.000Z')",
      )
        .bind(newIdentifier("invitation"), firmId, `hash-${newIdentifier("invitation")}`)
        .run(),
    ).rejects.toThrow(/must name a Directory person/);
  });
});

describe("redeeming a client invitation while signed in", () => {
  const email = "signed-in-client@example.com";
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    userId = (await seedFirmlessCredentialedUser(email, { userName: "Dana Whitfield" })).userId;
    cookie = await signInForSessionCookie(email);
    const code = await issueClientInvitation(email);
    const response = await post(
      "/api/v1/me/invitation-redemptions",
      { code, lastName: "Whitfield", dateOfBirth: "1981-06-02" },
      cookie,
    );
    expect(response.status, await response.clone().text()).toBe(200);
  });

  it("makes a portal client with no firm", async () => {
    const user = await readUser(email);
    expect(user.principal_kind).toBe("portalUser");
    expect(user.firm_id).toBeNull();
  });

  it("ties the account to the firm through a membership naming the person", async () => {
    const membership = await env.DB_CONTROL.prepare(
      "SELECT firm_id, directory_entity_id, status FROM portal_membership WHERE principal_id = ?1",
    )
      .bind(userId)
      .all<{ firm_id: string; directory_entity_id: string; status: string }>();
    expect(membership.results).toEqual([
      { firm_id: firmId, directory_entity_id: PERSON_ID, status: "active" },
    ]);
  });

  it("provisions no member row in the firm", async () => {
    expect(await memberProvisionCount(userId)).toBe(0);
  });

  it("is refused as absent by staff routes, including the bootstrap", async () => {
    for (const path of ["/api/v1/me", "/api/v1/matters"]) {
      const response = await SELF.fetch(`https://example.com${path}`, {
        headers: { cookie, accept: "application/json" },
      });
      expect(response.status, path).toBe(404);
    }
  });

  it("refuses a second invitation for a person who already has portal access", async () => {
    const response = await issue({
      kind: "clientOfFirm",
      email: "another-address@example.com",
      directoryEntityId: PERSON_ID,
    });
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("already-has-access");
  });

  it("can never be given a firm afterwards", async () => {
    await expect(
      env.DB_CONTROL.prepare('UPDATE "user" SET firm_id = ?2 WHERE id = ?1')
        .bind(userId, firmId)
        .run(),
    ).rejects.toThrow(/principal_kind/);
  });
});

describe("redeeming a client invitation anonymously", () => {
  it("creates a portal client with a membership and no member row", async () => {
    const email = "anonymous-client@example.com";
    const code = await issueClientInvitation(email, SECOND_PERSON_ID);
    const response = await post("/api/v1/invitations/redemptions", {
      code,
      lastName: "Whitfield",
      dateOfBirth: "1981-06-02",
    });
    expect(response.status, await response.clone().text()).toBe(200);

    const user = await readUser(email);
    expect(user.principal_kind).toBe("portalUser");
    expect(user.firm_id).toBeNull();
    const membership = await env.DB_CONTROL.prepare(
      "SELECT COUNT(*) AS n FROM portal_membership WHERE principal_id = ?1 AND firm_id = ?2",
    )
      .bind(user.id, firmId)
      .first<{ n: number }>();
    expect(membership?.n).toBe(1);
    expect(await memberProvisionCount(user.id)).toBe(0);
  });
});

describe("the kind on staff accounts", () => {
  it("makes an account that joins as staff a firm member, and keeps it one", async () => {
    const email = "joins-as-staff@example.com";
    const { userId } = await seedFirmlessCredentialedUser(email);
    expect((await readUser(email)).principal_kind).toBe("account");

    const cookie = await signInForSessionCookie(email);
    const invitation = await issue({ kind: "firmMember", email, name: "Staff Joiner" });
    const code = ((await invitation.json()) as { code: string }).code;
    const response = await post(
      "/api/v1/me/invitation-redemptions",
      { code, lastName: "Whitfield", dateOfBirth: "1981-06-02" },
      cookie,
    );
    expect(response.status, await response.clone().text()).toBe(200);

    const user = await readUser(email);
    expect(user.principal_kind).toBe("firmMember");
    expect(user.firm_id).toBe(firmId);
    expect(await memberProvisionCount(userId)).toBe(1);
    await expect(
      env.DB_CONTROL.prepare("UPDATE \"user\" SET principal_kind = 'portalUser' WHERE id = ?1")
        .bind(userId)
        .run(),
    ).rejects.toThrow(/principal_kind/);
  });
});
