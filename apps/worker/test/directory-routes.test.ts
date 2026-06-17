import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenAPIDocument } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Slice 1·3 directory route surface, driven through the chokepoint over real Miniflare bindings: the
// person/organization create+read, the name/identifier/edge/category writes, fuzzy search, duplicate
// candidates, merge, and the matter-party link — plus the protected sensitive-identifier read whose
// decrypt is gated by directory:viewSensitiveIdentifiers (a member without it is refused 403 by the
// chokepoint, before any decrypt). Mutations require an Idempotency-Key (the chokepoint gate).

let poolFirmId: FirmId;
let ownerCookie: string;
let readOnlyCookie: string;

// Mirror a member carrying a named seeded role (the Read-only role grants no directory permission).
async function mirrorMemberWithRole(userId: UserId, displayName: string, roleName: string) {
  const role = await env.DB_FIRM_POOL_1.prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .first<{ id: string }>();
  if (role === null) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(env.DB_FIRM_POOL_1, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(env.DB_FIRM_POOL_1, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  await applyPerFirmMigrations(env.DB_FIRM_POOL_1);
  poolFirmId = (
    await seedFirm({ name: "Directory Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await seedFirmKey(poolFirmId);

  const owner = await seedCredentialedUser("directory-owner@example.com", {
    userName: "Directory Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Directory Owner");
  ownerCookie = await signInForSessionCookie("directory-owner@example.com");

  const readOnly = await seedCredentialedUser("directory-readonly@example.com", {
    userName: "Read Only",
    firmId: poolFirmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("directory-readonly@example.com");
});

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie, withKey = true) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(cookie, withKey),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

describe("directory person routes", () => {
  it("creates a person, reads it back, and finds it by fuzzy search", async () => {
    const created = await post("/api/v1/directory/persons", {
      given: "Catherine",
      family: "Smith",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).toMatch(/^directoryPerson_/);

    const read = await get(`/api/v1/directory/persons/${id}`);
    expect(read.status).toBe(200);
    const person = (await read.json()) as { id: string; displayName: string };
    expect(person.id).toBe(id);
    expect(person.displayName).toBe("Catherine Smith");

    // Fuzzy trigram search tolerates a typo.
    const search = await get("/api/v1/directory/search?q=Cathrine");
    expect(search.status).toBe(200);
    const hits = (await search.json()) as { data: { entityId: string }[] };
    expect(hits.data.some((hit) => hit.entityId === id)).toBe(true);
  });

  it("requires an Idempotency-Key on the create mutation (400 without)", async () => {
    const response = await post(
      "/api/v1/directory/persons",
      { given: "No", family: "Key" },
      ownerCookie,
      false,
    );
    expect(response.status).toBe(400);
  });
});

describe("directory organization + duplicate-candidate routes", () => {
  it("creates an organization and surfaces a duplicate candidate", async () => {
    const created = await post("/api/v1/directory/organizations", {
      legalName: "Acme Legal Pty Ltd",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const candidates = await post("/api/v1/directory/duplicate-candidates", {
      kind: "organization",
      legalName: "Acme Legal Pty Ltd",
    });
    expect(candidates.status).toBe(200);
    const body = (await candidates.json()) as { data: { entityId: string }[] };
    expect(body.data.some((candidate) => candidate.entityId === id)).toBe(true);
  });
});

describe("directory sensitive-identifier read gate", () => {
  it("adds an identifier, then refuses the decrypt read without directory:viewSensitiveIdentifiers (403)", async () => {
    const created = await post("/api/v1/directory/persons", {
      given: "Sensitive",
      family: "Subject",
    });
    const { id } = (await created.json()) as { id: string };

    const added = await post(`/api/v1/directory/entities/${id}/identifiers`, {
      type: "ssn",
      value: "123-45-6789",
    });
    expect(added.status).toBe(201);

    // The owner holds directory:viewSensitiveIdentifiers (seeded onto Owner/Admin) — the decrypt
    // returns the plaintext.
    const ownerRead = await get(`/api/v1/directory/entities/${id}/identifiers/ssn`);
    expect(ownerRead.status).toBe(200);
    expect(((await ownerRead.json()) as { value: string }).value).toBe("123-45-6789");

    // The Read-only member lacks the permission — the chokepoint refuses before any decrypt.
    const denied = await get(`/api/v1/directory/entities/${id}/identifiers/ssn`, readOnlyCookie);
    expect(denied.status).toBe(403);
  });
});

describe("directory contract", () => {
  it("registers the directory operations in the OpenAPI document", () => {
    const document = buildOpenAPIDocument();
    const operationIds = new Set<string>();
    for (const item of Object.values(document.paths ?? {})) {
      for (const method of ["get", "post"] as const) {
        const operation = (item as Record<string, { operationId?: string } | undefined>)[method];
        if (operation?.operationId) operationIds.add(operation.operationId);
      }
    }
    expect(operationIds.has("directory.createPerson")).toBe(true);
    expect(operationIds.has("directory.getPerson")).toBe(true);
    expect(operationIds.has("directory.search")).toBe(true);
    expect(operationIds.has("directory.readIdentifier")).toBe(true);
  });
});
