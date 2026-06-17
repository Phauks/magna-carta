import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { applyPerFirmMigrations } from "./support/apply-per-firm-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Directory capstone e2e: one journey across the REAL HTTP surface over Miniflare bindings,
// composing every layer the directory feature built. A person and an organization are created (idempotent
// mutations), aliases and a sensitive identifier are attached, an edge links them, a matter party is
// linked, a duplicate is surfaced and merged, and the merge's invariants are asserted end-to-end —
// the matter party + edge repointed to the master, the merged-away alias STILL resolving (to the
// master) in duplicate detection, and the entity_merge event recorded. Finally the audited SSN read
// returns the plaintext AND writes one decrypt-audit row WITH the permission, and is refused 403
// WITHOUT it. Every mutation rides an Idempotency-Key (the chokepoint requires one).

let firmId: FirmId;
let ownerUserId: UserId;
let ownerCookie: string;
let readOnlyCookie: string;

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
  firmId = (await seedFirm({ name: "Directory E2E Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await seedFirmKey(firmId);

  const owner = await seedCredentialedUser("directory-e2e-owner@example.com", {
    userName: "Directory E2E Owner",
    firmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Directory E2E Owner");
  ownerCookie = await signInForSessionCookie("directory-e2e-owner@example.com");

  const readOnly = await seedCredentialedUser("directory-e2e-readonly@example.com", {
    userName: "Directory E2E Read Only",
    firmId,
  });
  await mirrorMemberWithRole(readOnly.userId, "Directory E2E Read Only", "Read-only");
  readOnlyCookie = await signInForSessionCookie("directory-e2e-readonly@example.com");
});

function headers(cookie: string, withKey: boolean): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function post(path: string, body: unknown, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: headers(cookie, true),
    body: JSON.stringify(body),
  });
}

async function get(path: string, cookie = ownerCookie) {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

// One decrypt-audit row count for a subject (the audit_log row written before any plaintext).
async function decryptAuditCount(subjectId: string): Promise<number> {
  const row = await env.DB_FIRM_POOL_1.prepare(
    "SELECT COUNT(*) AS count FROM audit_log WHERE event = 'protected.decrypt' AND subject_id = ?1",
  )
    .bind(subjectId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

describe("directory e2e — full journey over the HTTP surface", () => {
  // Carried across the ordered steps below.
  const createdEntityIdentifiers: {
    person?: string;
    organization?: string;
    duplicatePerson?: string;
    matterId?: string;
    matterPartyId?: string;
    mergeId?: string;
  } = {};

  it("creates a person and an organization (idempotent mutations)", async () => {
    const personResponse = await post("/api/v1/directory/persons", {
      given: "Catherine",
      family: "Smith",
    });
    expect(personResponse.status).toBe(201);
    createdEntityIdentifiers.person = (await jsonOf<{ id: string }>(personResponse)).id;
    expect(createdEntityIdentifiers.person).toMatch(/^directoryPerson_/);

    const orgResponse = await post("/api/v1/directory/organizations", {
      legalName: "Acme Holdings Pty Ltd",
    });
    expect(orgResponse.status).toBe(201);
    createdEntityIdentifiers.organization = (await jsonOf<{ id: string }>(orgResponse)).id;
    expect(createdEntityIdentifiers.organization).toMatch(/^directoryOrganization_/);
  });

  it("adds an alias name to the person and a trading name to the organization", async () => {
    expect(
      createdEntityIdentifiers.person,
      "person id must be set by the previous step",
    ).toBeDefined();
    expect(
      createdEntityIdentifiers.organization,
      "organization id must be set by the previous step",
    ).toBeDefined();
    const personName = await post(
      `/api/v1/directory/entities/${createdEntityIdentifiers.person}/names`,
      {
        nameRole: "maiden",
        given: "Catherine",
        family: "Jones",
      },
    );
    expect(personName.status).toBe(201);

    const orgName = await post(
      `/api/v1/directory/entities/${createdEntityIdentifiers.organization}/names`,
      {
        nameRole: "dba",
        legalName: "Acme Trading",
      },
    );
    expect(orgName.status).toBe(201);
  });

  it("links the person and the organization with an edge", async () => {
    expect(
      createdEntityIdentifiers.person,
      "person id must be set by the previous step",
    ).toBeDefined();
    expect(
      createdEntityIdentifiers.organization,
      "organization id must be set by the previous step",
    ).toBeDefined();
    const edge = await post("/api/v1/directory/edges", {
      from: createdEntityIdentifiers.person,
      to: createdEntityIdentifiers.organization,
      edgeType: "affiliation",
    });
    expect(edge.status).toBe(201);
    expect((await jsonOf<{ id: string }>(edge)).id).toMatch(/^directoryEdge_/);
  });

  it("seals a sensitive identifier (SSN) on the person", async () => {
    expect(
      createdEntityIdentifiers.person,
      "person id must be set by the previous step",
    ).toBeDefined();
    const added = await post(
      `/api/v1/directory/entities/${createdEntityIdentifiers.person}/identifiers`,
      {
        type: "ssn",
        value: "123-45-6789",
      },
    );
    expect(added.status).toBe(201);

    // The plaintext never lands in the clear: the stored row holds only ciphertext + a blind index.
    const stored = await env.DB_FIRM_POOL_1.prepare(
      "SELECT value_ciphertext, value_blind_index FROM directory_identifier WHERE entity_id = ?1 AND identifier_type = 'ssn'",
    )
      .bind(createdEntityIdentifiers.person ?? "")
      .first<{ value_ciphertext: string; value_blind_index: string | null }>();
    expect(stored?.value_ciphertext).toEqual(expect.any(String));
    expect(stored?.value_ciphertext).not.toContain("123-45-6789");
    expect(stored?.value_ciphertext).not.toContain("123456789");
    expect(stored?.value_blind_index).toEqual(expect.any(String));
  });

  it("links the person to a matter as a party", async () => {
    expect(
      createdEntityIdentifiers.person,
      "person id must be set by the previous step",
    ).toBeDefined();
    // A matter to link the party to (the e2e firm's owner is the responsible member).
    const matter = await post("/api/v1/matters", {
      title: "Smith v. Acme",
      status: "prospective",
      responsibleMemberId: ownerUserId,
    });
    expect(matter.status).toBe(201);
    createdEntityIdentifiers.matterId = (await jsonOf<{ matterId: string }>(matter)).matterId;

    const party = await post("/api/v1/directory/matter-parties", {
      matterId: createdEntityIdentifiers.matterId,
      entityId: createdEntityIdentifiers.person,
      role: "client",
    });
    expect(party.status).toBe(201);
    createdEntityIdentifiers.matterPartyId = (await jsonOf<{ id: string }>(party)).id;
    expect(createdEntityIdentifiers.matterPartyId).toMatch(/^matterParty_/);
  });

  it("surfaces a duplicate of the person via duplicate-candidates", async () => {
    expect(
      createdEntityIdentifiers.person,
      "person id must be set by the previous step",
    ).toBeDefined();
    // A near-duplicate person — same surname phonetics ("Smyth" sounds like "Smith").
    const dup = await post("/api/v1/directory/persons", { given: "Cathryn", family: "Smyth" });
    expect(dup.status).toBe(201);
    createdEntityIdentifiers.duplicatePerson = (await jsonOf<{ id: string }>(dup)).id;

    // Probing the duplicate's own facts surfaces the original (phonetic + trigram channels).
    const candidates = await post("/api/v1/directory/duplicate-candidates", {
      kind: "person",
      given: "Cathryn",
      family: "Smyth",
      excludeEntityId: createdEntityIdentifiers.duplicatePerson,
    });
    expect(candidates.status).toBe(200);
    const body = await jsonOf<{ data: { entityId: string }[] }>(candidates);
    expect(
      body.data.some((candidate) => candidate.entityId === createdEntityIdentifiers.person),
    ).toBe(true);
  });

  it("merges the duplicate into the original and repoints its inbound references", async () => {
    expect(
      createdEntityIdentifiers.person,
      "person id must be set by the previous step",
    ).toBeDefined();
    expect(
      createdEntityIdentifiers.duplicatePerson,
      "duplicatePerson id must be set by the previous step",
    ).toBeDefined();
    expect(
      createdEntityIdentifiers.organization,
      "organization id must be set by the previous step",
    ).toBeDefined();
    expect(
      createdEntityIdentifiers.matterId,
      "matterId must be set by the previous step",
    ).toBeDefined();
    // Make the duplicate the SUBORDINATE so the merge has something to repoint: give it the edge and
    // the matter party, then merge it into the original (the master).
    const dupEdge = await post("/api/v1/directory/edges", {
      from: createdEntityIdentifiers.duplicatePerson,
      to: createdEntityIdentifiers.organization,
      edgeType: "representation",
    });
    expect(dupEdge.status).toBe(201);
    const dupParty = await post("/api/v1/directory/matter-parties", {
      matterId: createdEntityIdentifiers.matterId,
      entityId: createdEntityIdentifiers.duplicatePerson,
      role: "client",
    });
    expect(dupParty.status).toBe(201);

    const merge = await post("/api/v1/directory/merges", {
      masterId: createdEntityIdentifiers.person,
      subordinateId: createdEntityIdentifiers.duplicatePerson,
    });
    expect(merge.status).toBe(201);
    createdEntityIdentifiers.mergeId = (await jsonOf<{ mergeId: string }>(merge)).mergeId;
    expect(createdEntityIdentifiers.mergeId).toMatch(/^entityMerge_/);

    // The subordinate is archived (status='merged_into', merged_into_id=master), never deleted.
    const subordinate = await env.DB_FIRM_POOL_1.prepare(
      "SELECT status, merged_into_id, deleted_at FROM directory_person WHERE id = ?1",
    )
      .bind(createdEntityIdentifiers.duplicatePerson ?? "")
      .first<{ status: string; merged_into_id: string | null; deleted_at: string | null }>();
    expect(subordinate?.status).toBe("merged_into");
    expect(subordinate?.merged_into_id).toBe(createdEntityIdentifiers.person);
    expect(subordinate?.deleted_at).toBeNull();

    // Every inbound reference repointed: no matter_party or edge endpoint still names the subordinate.
    const danglingParty = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM matter_party WHERE entity_id = ?1",
    )
      .bind(createdEntityIdentifiers.duplicatePerson ?? "")
      .first<{ c: number }>();
    expect(danglingParty?.c).toBe(0);
    const danglingEdge = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM directory_edge WHERE from_entity_id = ?1 OR to_entity_id = ?1",
    )
      .bind(createdEntityIdentifiers.duplicatePerson ?? "")
      .first<{ c: number }>();
    expect(danglingEdge?.c).toBe(0);

    // The master now carries the repointed party.
    const masterParty = await env.DB_FIRM_POOL_1.prepare(
      "SELECT COUNT(*) AS c FROM matter_party WHERE entity_id = ?1",
    )
      .bind(createdEntityIdentifiers.person ?? "")
      .first<{ c: number }>();
    expect(masterParty?.c).toBeGreaterThanOrEqual(2);

    // The append-only entity_merge event is complete: master, subordinate, and a recorded repoint list.
    const event = await env.DB_FIRM_POOL_1.prepare(
      "SELECT master_id, subordinate_id, repointed, merged_by FROM entity_merge WHERE id = ?1",
    )
      .bind(createdEntityIdentifiers.mergeId ?? "")
      .first<{ master_id: string; subordinate_id: string; repointed: string; merged_by: string }>();
    expect(event?.master_id).toBe(createdEntityIdentifiers.person);
    expect(event?.subordinate_id).toBe(createdEntityIdentifiers.duplicatePerson);
    expect(event?.merged_by).toBe(ownerUserId);
    const repointed = JSON.parse(event?.repointed ?? "[]") as { table: string; to: string }[];
    expect(repointed.length).toBeGreaterThanOrEqual(2);
    expect(repointed.every((r) => r.to === createdEntityIdentifiers.person)).toBe(true);
  });

  it("keeps the merged-away alias matching, resolving to the master", async () => {
    expect(
      createdEntityIdentifiers.person,
      "person id must be set by the previous step",
    ).toBeDefined();
    expect(
      createdEntityIdentifiers.duplicatePerson,
      "duplicatePerson id must be set by the previous step",
    ).toBeDefined();
    // The subordinate's name rows stay alive after the merge (the conflicts-corpus rule): probing the
    // subordinate's name surfaces the MASTER, never the archived subordinate id.
    const candidates = await post("/api/v1/directory/duplicate-candidates", {
      kind: "person",
      given: "Cathryn",
      family: "Smyth",
    });
    expect(candidates.status).toBe(200);
    const body = await jsonOf<{ data: { entityId: string }[] }>(candidates);
    expect(
      body.data.some((candidate) => candidate.entityId === createdEntityIdentifiers.person),
    ).toBe(true);
    expect(
      body.data.some(
        (candidate) => candidate.entityId === createdEntityIdentifiers.duplicatePerson,
      ),
    ).toBe(false);
  });

  it("reads the SSN back WITH permission (returns plaintext, writes one decrypt-audit row)", async () => {
    expect(
      createdEntityIdentifiers.person,
      "person id must be set by the previous step",
    ).toBeDefined();
    // The identifier row id is the audit subject (the AAD binds the ciphertext to it).
    const identifierRow = await env.DB_FIRM_POOL_1.prepare(
      "SELECT id FROM directory_identifier WHERE entity_id = ?1 AND identifier_type = 'ssn'",
    )
      .bind(createdEntityIdentifiers.person ?? "")
      .first<{ id: string }>();
    const before = await decryptAuditCount(identifierRow?.id ?? "");

    const ownerRead = await get(
      `/api/v1/directory/entities/${createdEntityIdentifiers.person}/identifiers/ssn`,
    );
    expect(ownerRead.status).toBe(200);
    expect((await jsonOf<{ value: string }>(ownerRead)).value).toBe("123-45-6789");

    // Exactly one decrypt-audit row was committed by the read.
    expect(await decryptAuditCount(identifierRow?.id ?? "")).toBe(before + 1);
  });

  it("refuses the SSN read WITHOUT permission (403, no decrypt)", async () => {
    expect(
      createdEntityIdentifiers.person,
      "person id must be set by the previous step",
    ).toBeDefined();
    const identifierRow = await env.DB_FIRM_POOL_1.prepare(
      "SELECT id FROM directory_identifier WHERE entity_id = ?1 AND identifier_type = 'ssn'",
    )
      .bind(createdEntityIdentifiers.person ?? "")
      .first<{ id: string }>();
    const before = await decryptAuditCount(identifierRow?.id ?? "");

    const denied = await get(
      `/api/v1/directory/entities/${createdEntityIdentifiers.person}/identifiers/ssn`,
      readOnlyCookie,
    );
    expect(denied.status).toBe(403);

    // The chokepoint refuses before any decrypt — no audit row is written for the forbidden read.
    expect(await decryptAuditCount(identifierRow?.id ?? "")).toBe(before);
  });
});
