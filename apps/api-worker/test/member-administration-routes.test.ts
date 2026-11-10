import { env, SELF } from "cloudflare:test";
import type { FirmId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The firm administering its members, through the chokepoint over real Miniflare bindings.
//
// What the suite is really pinning is that a firm cannot lock itself out. A member who can change
// their own roles is a member who can grant themselves anything, so that is refused outright; and a
// firm always keeps somebody who can administer it, which falls out of the first rule rather than
// being separately enforceable — the actor holds the administration key and is never the subject.
// The outcome is what is asserted, because the refusal that states the rule in words is reachable
// only through a race between two administrators.

let firmId: FirmId;
let ownerCookie: string;
let paralegalCookie: string;
let ownerUserId: string;
let paralegalUserId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

const ROLES_URL = "https://example.com/api/v1/roles";

interface RoleListBody {
  data: {
    id: string;
    name: string;
    parentRoleId: string | null;
    permissions: string[];
    memberCount: number;
  }[];
}

function memberUrl(userId: string, suffix: string): string {
  return `https://example.com/api/v1/members/${userId}/${suffix}`;
}

async function putRoles(
  cookie: string,
  userId: string,
  roleIds: string[],
  key = crypto.randomUUID(),
) {
  return SELF.fetch(memberUrl(userId, "roles"), {
    method: "PUT",
    headers: {
      cookie,
      "content-type": "application/json",
      origin: "https://example.com",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({ roleIds }),
  });
}

async function post(cookie: string, userId: string, suffix: string, key = crypto.randomUUID()) {
  return SELF.fetch(memberUrl(userId, suffix), {
    method: "POST",
    headers: { cookie, origin: "https://example.com", "Idempotency-Key": key },
  });
}

async function readRoles(cookie: string): Promise<RoleListBody> {
  const response = await SELF.fetch(ROLES_URL, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as RoleListBody;
}

/** A seeded role's handle, read as whoever is asking — the catalog answers every member alike. */
async function roleIdNamedAs(cookie: string, name: string): Promise<string> {
  const { data } = await readRoles(cookie);
  const role = data.find((candidate) => candidate.name === name);
  if (role === undefined) throw new Error(`seeded role ${name} missing`);
  return role.id;
}

async function roleIdNamed(name: string): Promise<string> {
  return roleIdNamedAs(ownerCookie, name);
}

async function statusOf(userId: string): Promise<string | undefined> {
  return (
    await firmDatabase
      .prepare("SELECT status FROM member WHERE user_id = ?1")
      .bind(userId)
      .first<{ status: string }>()
  )?.status;
}

async function countAudits(event: string): Promise<number> {
  return (
    (
      await firmDatabase
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?1")
        .bind(event)
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Member Administration Test Firm" })).firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);

  const owner = await seedCredentialedUser("member-admin-owner@example.com", {
    userName: "Admin Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Admin Owner", firmId);
  ownerCookie = await signInForSessionCookie("member-admin-owner@example.com");

  // A seat that reads the roster and administers nobody — the denial has to be asserted against a
  // real seat rather than a member stripped of one key, so it keeps meaning something.
  const paralegal = await seedCredentialedUser("member-admin-paralegal@example.com", {
    userName: "Admin Paralegal",
    firmId,
  });
  paralegalUserId = paralegal.userId;
  await mirrorMemberWithRole(paralegal.userId, "Admin Paralegal", firmId, "Paralegal");
  paralegalCookie = await signInForSessionCookie("member-admin-paralegal@example.com");
});

describe("the firm's roles", () => {
  it("lists the seeded roles with what each carries, sub-roles naming their parent", async () => {
    const { data } = await readRoles(ownerCookie);
    expect(data.map((role) => role.name).toSorted()).toEqual([
      "Admin",
      "Associate",
      "Attorney",
      "Billing",
      "Paralegal",
      "Partner",
      "Read-only",
    ]);
    const attorneyId = data.find((role) => role.name === "Attorney")?.id;
    expect(data.find((role) => role.name === "Partner")?.parentRoleId).toBe(attorneyId);
    expect(data.find((role) => role.name === "Associate")?.parentRoleId).toBe(attorneyId);
    expect(data.find((role) => role.name === "Attorney")?.parentRoleId).toBeNull();
    const owner = data.find((role) => role.name === "Admin");
    expect(owner?.permissions).toContain("firm:manageMembers");
    expect(owner?.memberCount).toBeGreaterThanOrEqual(1);
  });

  it("is readable by a member who administers nobody", async () => {
    // Reading what a role means rides the roster read, not the administration key: a member who
    // can see that a colleague is a Paralegal should be able to see what the firm decided that is.
    const { data } = await readRoles(paralegalCookie);
    expect(data.length).toBe(7);
  });
});

describe("changing what a member holds", () => {
  it("refuses a member who cannot administer the firm", async () => {
    const attorney = await roleIdNamed("Attorney");
    const response = await putRoles(paralegalCookie, ownerUserId, [attorney]);
    expect(response.status).toBe(403);
  });

  it("refuses a member changing their own roles", async () => {
    const attorney = await roleIdNamed("Attorney");
    const response = await putRoles(ownerCookie, ownerUserId, [attorney]);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { type: string }).type).toContain("self-administration");
  });

  it("refuses a role handle this firm does not have", async () => {
    const response = await putRoles(ownerCookie, paralegalUserId, ["role_notarealrolehandle"]);
    expect(response.status).toBe(422);
  });

  it("refuses a sub-role without the role it sits under", async () => {
    const partner = await roleIdNamed("Partner");
    const response = await putRoles(ownerCookie, paralegalUserId, [partner]);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { type: string }).type).toContain("role-family");
  });

  it("refuses two sub-roles of one role", async () => {
    const attorney = await roleIdNamed("Attorney");
    const partner = await roleIdNamed("Partner");
    const associate = await roleIdNamed("Associate");
    const response = await putRoles(ownerCookie, paralegalUserId, [attorney, partner, associate]);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { type: string }).type).toContain("role-family");
  });

  it("gives a Partner what Attorney allows and what Partner adds", async () => {
    const attorney = await roleIdNamed("Attorney");
    const partner = await roleIdNamed("Partner");
    const paralegal = await roleIdNamed("Paralegal");
    const response = await putRoles(ownerCookie, paralegalUserId, [attorney, partner]);
    expect(response.status).toBe(200);
    const me = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: paralegalCookie },
    });
    const permissions = ((await me.json()) as { permissions: string[] }).permissions;
    expect(permissions).toContain("trust:authorize"); // from Attorney
    expect(permissions).toContain("reports:financial"); // added by Partner
    // Put the seat back as it was for the tests that follow.
    expect((await putRoles(ownerCookie, paralegalUserId, [paralegal])).status).toBe(200);
  });

  it("sets the whole set, and audits the change once", async () => {
    const before = await countAudits("member.roles_changed");
    const attorney = await roleIdNamed("Attorney");
    const billing = await roleIdNamed("Billing");
    const response = await putRoles(ownerCookie, paralegalUserId, [attorney, billing]);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { roleIds: string[] }).roleIds.toSorted()).toEqual(
      [attorney, billing].toSorted(),
    );
    expect(await countAudits("member.roles_changed")).toBe(before + 1);
  });

  it("records nothing for a change that changes nothing", async () => {
    const before = await countAudits("member.roles_changed");
    const attorney = await roleIdNamed("Attorney");
    const billing = await roleIdNamed("Billing");
    const response = await putRoles(ownerCookie, paralegalUserId, [billing, attorney]);
    expect(response.status).toBe(200);
    expect(await countAudits("member.roles_changed")).toBe(before);
  });

  it("keeps an administrator standing however the roles are moved around", async () => {
    // The firm can never be left without one through this route, and the reason is structural
    // rather than a check: the actor holds firm:manageMembers and is never the subject, so an
    // active administrator is always left. Asserted as the OUTCOME rather than as a refusal,
    // because the refusal that states the rule is only reachable through a race.
    const readOnly = await roleIdNamed("Read-only");
    const second = await seedCredentialedUser("member-admin-second@example.com", {
      userName: "Second Administrator",
      firmId,
    });
    await mirrorMemberWithOwnerRole(second.userId, "Second Administrator", firmId);
    const secondCookie = await signInForSessionCookie("member-admin-second@example.com");

    expect((await putRoles(secondCookie, ownerUserId, [readOnly])).status).toBe(200);
    // The demoted owner can no longer reach the route at all, so they cannot take the last
    // administrator's role away either.
    expect((await putRoles(ownerCookie, second.userId, [readOnly])).status).toBe(403);
    const administrators = (await readRoles(secondCookie)).data.find(
      (role) => role.name === "Admin",
    );
    expect(administrators?.memberCount).toBe(1);

    // Put the owner back, so the deactivation cases below act as an administrator.
    const ownerRole = await roleIdNamedAs(secondCookie, "Admin");
    expect((await putRoles(secondCookie, ownerUserId, [ownerRole])).status).toBe(200);
  });

  it("replays a retried change rather than recording it twice", async () => {
    const before = await countAudits("member.roles_changed");
    const attorney = await roleIdNamed("Attorney");
    const key = crypto.randomUUID();
    const first = await putRoles(ownerCookie, paralegalUserId, [attorney], key);
    const second = await putRoles(ownerCookie, paralegalUserId, [attorney], key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await countAudits("member.roles_changed")).toBe(before + 1);
  });
});

describe("withdrawing and restoring a member's access", () => {
  it("refuses a member deactivating themselves", async () => {
    const response = await post(ownerCookie, ownerUserId, "deactivation");
    expect(response.status).toBe(403);
    expect(await statusOf(ownerUserId)).toBe("active");
  });

  it("refuses a member who cannot administer the firm", async () => {
    const response = await post(paralegalCookie, ownerUserId, "deactivation");
    expect(response.status).toBe(403);
  });

  it("deactivates, and the member then resolves to no permissions at all", async () => {
    const before = await countAudits("member.deactivated");
    const response = await post(ownerCookie, paralegalUserId, "deactivation");
    expect(response.status).toBe(200);
    expect(await statusOf(paralegalUserId)).toBe("deactivated");
    expect(await countAudits("member.deactivated")).toBe(before + 1);

    // The deactivated member's own session is now refused: the firm resolves them as absent rather
    // than as a member holding nothing, which is what the roster read's own contract promises.
    const bootstrap = await SELF.fetch("https://example.com/api/v1/me", {
      headers: { cookie: paralegalCookie },
    });
    expect(bootstrap.status).toBe(404);
  });

  it("answers a deactivation of an already-deactivated member without recording one", async () => {
    const before = await countAudits("member.deactivated");
    const response = await post(ownerCookie, paralegalUserId, "deactivation");
    expect(response.status).toBe(200);
    expect(await countAudits("member.deactivated")).toBe(before);
  });

  it("restores access, and the roles held before are still held", async () => {
    const response = await post(ownerCookie, paralegalUserId, "reactivation");
    expect(response.status).toBe(200);
    expect(await statusOf(paralegalUserId)).toBe("active");
    const held = await firmDatabase
      .prepare("SELECT COUNT(*) AS n FROM member_role WHERE member_user_id = ?1")
      .bind(paralegalUserId)
      .first<{ n: number }>();
    expect(held?.n).toBeGreaterThan(0);
  });

  it("keeps an administrator standing however access is withdrawn", async () => {
    // Same structural argument as the role change: the actor is an administrator and is never the
    // subject, so withdrawing access can never leave the firm with nobody.
    const administrators = (await readRoles(ownerCookie)).data.find(
      (role) => role.name === "Admin",
    );
    expect(administrators?.memberCount).toBeGreaterThanOrEqual(1);
    expect((await post(ownerCookie, ownerUserId, "deactivation")).status).toBe(403);
    expect(await statusOf(ownerUserId)).toBe("active");
  });
});
