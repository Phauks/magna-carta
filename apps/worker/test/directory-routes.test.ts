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
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
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
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);
  const roleResult = await firmDatabase
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .all<{ id: string }>();
  const role = roleResult.results[0];
  if (role === undefined) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(firmDatabase, {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabase, {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "Directory Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await seedFirmKey(poolFirmId);

  const owner = await seedCredentialedUser("directory-owner@example.com", {
    userName: "Directory Owner",
    firmId: poolFirmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Directory Owner", poolFirmId);
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
async function put(path: string, body: unknown, cookie = ownerCookie, withKey = true) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PUT",
    headers: authHeaders(cookie, withKey),
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

// A POST that pins a caller-chosen Idempotency-Key (vs. the fresh-per-call key `post` mints), so a
// retry under the SAME key exercises the dedup path.
async function postWithFixedKey(path: string, body: unknown, idempotencyKey: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
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

  it("dedups a retried create under the same Idempotency-Key — one person, replayed response", async () => {
    const key = crypto.randomUUID();
    const body = { given: "Retry", family: "Dedup" };

    const first = await postWithFixedKey("/api/v1/directory/persons", body, key);
    expect(first.status).toBe(201);
    const { id: firstId } = (await first.json()) as { id: string };
    expect(first.headers.get("Idempotency-Replayed")).toBeNull();

    // The retry under the SAME key replays the stored response — byte-identical id, replay header set.
    const replay = await postWithFixedKey("/api/v1/directory/persons", body, key);
    expect(replay.status).toBe(201);
    const { id: replayId } = (await replay.json()) as { id: string };
    expect(replayId).toBe(firstId);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");

    // Exactly ONE person row was created across the two requests — true dedup, not a second insert.
    const countResult = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare("SELECT COUNT(*) AS c FROM directory_person WHERE id = ?1")
      .bind(firstId)
      .all<{ c: number }>();
    const count = countResult.results[0];
    expect(count?.c).toBe(1);
  });
});

// Pronouns over HTTP. The route's job is to record a whole set or refuse, and to make the empty case
// an ordinary answer rather than an error — a person who has stated nothing is the common case.
describe("directory person pronoun routes", () => {
  const SHE = {
    subject: "she",
    object: "her",
    possessiveDeterminer: "her",
    possessivePronoun: "hers",
    reflexive: "herself",
    verbNumber: "singular",
  };

  async function newPerson(given: string, family: string): Promise<string> {
    const created = await post("/api/v1/directory/persons", { given, family });
    expect(created.status).toBe(201);
    return (await created.json()).id;
  }

  async function pronounsOf(id: string) {
    const read = await get(`/api/v1/directory/persons/${id}`);
    expect(read.status).toBe(200);
    return (await read.json()).pronouns;
  }

  it("reports null for a person who has stated none, rather than an error or a guess", async () => {
    expect(await pronounsOf(await newPerson("Elizabeth", "Marchetti"))).toBeNull();
  });

  it("records a whole set and reads it back", async () => {
    const id = await newPerson("Dana", "Okafor");
    const recorded = await put(`/api/v1/directory/persons/${id}/pronouns`, { pronouns: SHE });
    expect(recorded.status).toBe(200);
    expect(await pronounsOf(id)).toEqual(SHE);
  });

  it("records a set no closed list of options would contain", async () => {
    const id = await newPerson("Rowan", "Ashcroft");
    const xe = {
      subject: "xe",
      object: "xem",
      possessiveDeterminer: "xyr",
      possessivePronoun: "xyrs",
      reflexive: "xemself",
      verbNumber: "singular",
    };
    expect((await put(`/api/v1/directory/persons/${id}/pronouns`, { pronouns: xe })).status).toBe(
      200,
    );
    expect(await pronounsOf(id)).toEqual(xe);
  });

  it("clears the set on file when null is sent", async () => {
    const id = await newPerson("Priya", "Raman");
    await put(`/api/v1/directory/persons/${id}/pronouns`, { pronouns: SHE });
    expect((await put(`/api/v1/directory/persons/${id}/pronouns`, { pronouns: null })).status).toBe(
      200,
    );
    expect(await pronounsOf(id)).toBeNull();
  });

  // Half a set is what renders "she signed their declaration", so the contract refuses it at the
  // edge rather than storing something the document layer has to defend against.
  it("refuses a set missing a form", async () => {
    const id = await newPerson("Elias", "Renn");
    const { reflexive: _reflexive, ...withoutReflexive } = SHE;
    const response = await put(`/api/v1/directory/persons/${id}/pronouns`, {
      pronouns: withoutReflexive,
    });
    // 422 is the contract's answer to a body the schema refuses; 400 is reserved for a missing
    // Idempotency-Key, which is a different mistake with a different fix.
    expect(response.status).toBe(422);
    expect(await pronounsOf(id)).toBeNull();
  });

  it("refuses a verb agreement that is neither singular nor plural", async () => {
    const id = await newPerson("Mara", "Ferreira");
    const response = await put(`/api/v1/directory/persons/${id}/pronouns`, {
      pronouns: { ...SHE, verbNumber: "dual" },
    });
    expect(response.status).toBe(422);
  });

  it("refuses a blank form rather than storing an empty pronoun", async () => {
    const id = await newPerson("Tomas", "Halvorsen");
    const response = await put(`/api/v1/directory/persons/${id}/pronouns`, {
      pronouns: { ...SHE, object: "   " },
    });
    expect(response.status).toBe(422);
    expect(await pronounsOf(id)).toBeNull();
  });

  it("is 404 for a person this firm does not have", async () => {
    const response = await put(
      "/api/v1/directory/persons/directoryPerson_MISSINGMISSINGMISS/pronouns",
      { pronouns: SHE },
    );
    expect(response.status).toBe(404);
  });

  it("refuses a caller without directory:edit", async () => {
    const id = await newPerson("Ines", "Duarte");
    const response = await put(
      `/api/v1/directory/persons/${id}/pronouns`,
      { pronouns: SHE },
      readOnlyCookie,
    );
    expect(response.status).toBe(403);
  });

  it("requires an Idempotency-Key", async () => {
    const id = await newPerson("Noor", "Haddad");
    const response = await put(
      `/api/v1/directory/persons/${id}/pronouns`,
      { pronouns: SHE },
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
    expect((await ownerRead.json()).value).toBe("123-45-6789");

    // The Read-only member lacks the permission — the chokepoint refuses before any decrypt.
    const denied = await get(`/api/v1/directory/entities/${id}/identifiers/ssn`, readOnlyCookie);
    expect(denied.status).toBe(403);
  });
});

describe("directory merged-entity write refusal", () => {
  it("keeps reading a merged-away entity but refuses a write to it with a 409 naming the master", async () => {
    const masterResponse = await post("/api/v1/directory/persons", {
      given: "Merged",
      family: "Master",
    });
    const { id: masterId } = (await masterResponse.json()) as { id: string };
    const subordinateResponse = await post("/api/v1/directory/persons", {
      given: "Merged",
      family: "Subordinate",
    });
    const { id: subordinateId } = (await subordinateResponse.json()) as { id: string };

    const merged = await post("/api/v1/directory/merges", { masterId, subordinateId });
    expect(merged.status).toBe(201);

    // The READ is unchanged: the subordinate is still fetchable and carries the pointer to follow.
    const read = await get(`/api/v1/directory/persons/${subordinateId}`);
    expect(read.status).toBe(200);
    const person = (await read.json()) as { status: string; mergedIntoId: string | null };
    expect(person.status).toBe("merged_into");
    expect(person.mergedIntoId).toBe(masterId);

    // The WRITE is refused as a conflict — not a 404 — and the problem detail names the master the
    // caller should address instead.
    const write = await post(`/api/v1/directory/entities/${subordinateId}/names`, {
      given: "Merged",
      family: "Alias",
      nameRole: "alias",
    });
    expect(write.status).toBe(409);
    expect(write.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await write.json()) as { detail: string };
    expect(problem.detail).toContain(masterId);

    // The same write against the surviving master still succeeds.
    const onMaster = await post(`/api/v1/directory/entities/${masterId}/names`, {
      given: "Merged",
      family: "Alias",
      nameRole: "alias",
    });
    expect(onMaster.status).toBe(201);
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
