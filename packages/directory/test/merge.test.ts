import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { assertPermission } from "@magna-carta/access-control/registry";
import { expect, test } from "vitest";
import { createPerson } from "../src/person.ts";
import { createEdge } from "../src/edges.ts";
import { createCategory, assignCategory } from "../src/categories.ts";
import { type DirectoryIdentifierContext } from "../src/identifiers.ts";
import { findDuplicateCandidates } from "../src/search.ts";
import {
  mergeEntities,
  MergeSameEntityError,
  MergeEntityNotFoundError,
  MergeKindMismatchError,
  MergeAlreadyMergedError,
} from "../src/merge.ts";
import { assertNoDanglingToSubordinate } from "../src/fitness.ts";

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const VIEW_SENSITIVE = assertPermission("directory:viewSensitiveIdentifiers");

const clock = { now: () => "2026-06-17T00:00:00.000Z" };

interface TestContext {
  readonly database: BatchDatabase;
  readonly ctx: DirectoryIdentifierContext;
  // A fresh seeded source so each minted id in a test is deterministic but distinct from the ctx one.
  readonly options: {
    clock: typeof clock;
    actorUserId: UserId;
    randomSource: ReturnType<typeof seededRandomSource>;
  };
}

async function directoryTestContext(seed: string): Promise<TestContext> {
  const { database } = createMigratedNodeDatabase("per-firm");
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const provider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
      firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
  });
  const randomSource = seededRandomSource(seed);

  const ctx: DirectoryIdentifierContext = {
    firmId: FIRM,
    firmKeyVersion: 1,
    firmKeyProvider: provider,
    database,
    effectivePermissions: new Set([VIEW_SENSITIVE]) as never,
    actorUserId: ACTOR,
    clock,
    randomSource,
  };

  return {
    database,
    ctx,
    options: { clock, actorUserId: ACTOR, randomSource },
  };
}

// Seed the matter row matter_party references — both matter_party.matter_id and matter.responsible_
// member_id are real foreign keys, enforced in the test database, so a member and a matter row must
// exist first.
async function seedMatter(database: BatchDatabase, matterId: string): Promise<void> {
  await database
    .prepare(
      `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_a', 'Member A', 'active', ?1)`,
    )
    .bind(clock.now())
    .run();
  await database
    .prepare(
      `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES (?1, 'Demo Matter', 'open', 'user_a', ?2, ?2)`,
    )
    .bind(matterId, clock.now())
    .run();
}

// Seed a matter_party row directly — linkMatterParty is Task 14, but the table exists from Task 1 and
// the merge must repoint it.
async function seedMatterParty(
  database: BatchDatabase,
  matterId: string,
  entityId: string,
  role: string,
): Promise<string> {
  const id = `matterParty_${role}_${entityId.slice(-8)}`;
  await database
    .prepare(
      `INSERT INTO matter_party (id, matter_id, entity_id, role, valid_from, valid_to, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?5, NULL)`,
    )
    .bind(id, matterId, entityId, role, clock.now())
    .run();
  return id;
}

test("merge archives the subordinate, repoints references, and records the exact repoint list", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-merge");

  const master = await createPerson(
    database,
    { given: "John", family: "Smith" },
    { ...options, randomSource: seededRandomSource("t13-master") },
  );
  const dup = await createPerson(
    database,
    { given: "John", family: "Smith" },
    { ...options, randomSource: seededRandomSource("t13-dup") },
  );

  // dup is the beneficiary on a matter (the owner's scenario).
  await seedMatter(database, "mat_demo");
  const matterPartyId = await seedMatterParty(database, "mat_demo", dup, "beneficiary");

  await mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} });

  // Subordinate archived, not deleted.
  const { results: subRows } = await database
    .prepare("SELECT status, merged_into_id, deleted_at FROM directory_person WHERE id = ?1")
    .bind(dup)
    .all<{ status: string; merged_into_id: string | null; deleted_at: string | null }>();
  expect(subRows[0]?.status).toBe("merged_into");
  expect(subRows[0]?.merged_into_id).toBe(master);
  expect(subRows[0]?.deleted_at).toBeNull();

  // matter_party repointed to master.
  const { results: links } = await database
    .prepare("SELECT entity_id FROM matter_party WHERE matter_id = 'mat_demo'")
    .all<{ entity_id: string }>();
  expect(links.every((l) => l.entity_id === master)).toBe(true);

  // The event records the exact repoint.
  const { results: events } = await database
    .prepare(
      "SELECT repointed, survivorship, master_id, merged_by FROM entity_merge WHERE subordinate_id = ?1",
    )
    .bind(dup)
    .all<{ repointed: string; survivorship: string; master_id: string; merged_by: string }>();
  expect(events).toHaveLength(1);
  expect(events[0]?.master_id).toBe(master);
  expect(events[0]?.merged_by).toBe(ACTOR);
  expect(JSON.parse(events[0]!.repointed)).toContainEqual({
    table: "matter_party",
    row: matterPartyId,
    from: dup,
    to: master,
  });
  // Empty survivorship → recorded as an empty object (no fields taken from the subordinate).
  expect(JSON.parse(events[0]!.survivorship)).toEqual({});

  // An audit row was written for the merge.
  const { results: audit } = await database
    .prepare(
      "SELECT event FROM audit_log WHERE event = 'directory.entity.merged' AND subject_id = ?1",
    )
    .bind(dup)
    .all<{ event: string }>();
  expect(audit).toHaveLength(1);
});

test("merge repoints both directory_edge endpoints and directory_entity_category", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-edges");

  const master = await createPerson(
    database,
    { given: "Master", family: "Record" },
    { ...options, randomSource: seededRandomSource("t13e-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Dup", family: "Record" },
    { ...options, randomSource: seededRandomSource("t13e-dup") },
  );
  const other = await createPerson(
    database,
    { given: "Other", family: "Party" },
    { ...options, randomSource: seededRandomSource("t13e-other") },
  );

  // dup is the "from" endpoint of one edge and the "to" endpoint of another.
  const fromEdge = await createEdge(
    database,
    {
      from: dup,
      to: other,
      edgeType: "relationship",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    { ...options, randomSource: seededRandomSource("t13e-edge-from") },
  );
  const toEdge = await createEdge(
    database,
    {
      from: other,
      to: dup,
      edgeType: "relationship",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    { ...options, randomSource: seededRandomSource("t13e-edge-to") },
  );

  // dup is in a category.
  const { id: categoryId } = await createCategory(
    database,
    { name: "VIP", appliesTo: "both" },
    { ...options, randomSource: seededRandomSource("t13e-cat") },
  );
  await assignCategory(
    database,
    { entityId: dup, categoryId },
    { ...options, randomSource: seededRandomSource("t13e-assign") },
  );

  await mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} });

  const { results: fromRow } = await database
    .prepare("SELECT from_entity_id FROM directory_edge WHERE id = ?1")
    .bind(fromEdge)
    .all<{ from_entity_id: string }>();
  expect(fromRow[0]?.from_entity_id).toBe(master);

  const { results: toRow } = await database
    .prepare("SELECT to_entity_id FROM directory_edge WHERE id = ?1")
    .bind(toEdge)
    .all<{ to_entity_id: string }>();
  expect(toRow[0]?.to_entity_id).toBe(master);

  const { results: catRows } = await database
    .prepare("SELECT entity_id FROM directory_entity_category WHERE category_id = ?1")
    .bind(categoryId)
    .all<{ entity_id: string }>();
  expect(catRows.map((r) => r.entity_id)).toContain(master);
  expect(catRows.map((r) => r.entity_id)).not.toContain(dup);
});

test("a merged-away alias still matches in candidate generation and resolves to the master", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-corpus");

  const master = await createPerson(
    database,
    { given: "Alice", family: "Johnson" },
    { ...options, randomSource: seededRandomSource("t13c-master") },
  );
  // Subordinate carries a DISTINCT surname so a hit on its name can only come from its own
  // still-alive name row, proving master-resolution rather than a master-name match.
  const dup = await createPerson(
    database,
    { given: "Alice", family: "Zimmerman" },
    { ...options, randomSource: seededRandomSource("t13c-dup") },
  );

  await mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} });

  // Searching the subordinate's old surname must surface the master (the subordinate resolves to it).
  const candidates = await findDuplicateCandidates(ctx, {
    kind: "person",
    given: "Alice",
    family: "Zimmerman",
  });
  const entityIds = candidates.map((c) => c.entityId);
  expect(entityIds).toContain(master);
  // The subordinate id itself never appears — it resolves to the master.
  expect(entityIds).not.toContain(dup);
});

test("the relink leaves no inbound reference pointing at the subordinate", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-dangle");

  const master = await createPerson(
    database,
    { given: "Master", family: "Record" },
    { ...options, randomSource: seededRandomSource("t13d-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Dup", family: "Record" },
    { ...options, randomSource: seededRandomSource("t13d-dup") },
  );
  const other = await createPerson(
    database,
    { given: "Other", family: "Party" },
    { ...options, randomSource: seededRandomSource("t13d-other") },
  );

  await seedMatter(database, "mat_demo");
  await seedMatterParty(database, "mat_demo", dup, "beneficiary");
  await createEdge(
    database,
    {
      from: dup,
      to: other,
      edgeType: "relationship",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    { ...options, randomSource: seededRandomSource("t13d-edge") },
  );
  const { id: categoryId } = await createCategory(
    database,
    { name: "VIP", appliesTo: "both" },
    { ...options, randomSource: seededRandomSource("t13d-cat") },
  );
  await assignCategory(
    database,
    { entityId: dup, categoryId },
    { ...options, randomSource: seededRandomSource("t13d-assign") },
  );

  await mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} });

  // The fitness query must find no inbound reference still pointing at the subordinate.
  await expect(assertNoDanglingToSubordinate(database, dup)).resolves.toBeUndefined();
});

test("field-level survivorship overwrites the master and records the prior master values", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-surv");

  const master = await createPerson(
    database,
    { given: "Bob", family: "Smith", middle: "A" },
    { ...options, randomSource: seededRandomSource("t13s-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Bob", family: "Smith", middle: "Quincy" },
    { ...options, randomSource: seededRandomSource("t13s-dup") },
  );

  await mergeEntities(ctx, {
    masterId: master,
    subordinateId: dup,
    survivorship: { name_middle: "subordinate" },
  });

  // The master now carries the subordinate's middle name.
  const { results: masterRows } = await database
    .prepare("SELECT name_middle FROM directory_person WHERE id = ?1")
    .bind(master)
    .all<{ name_middle: string | null }>();
  expect(masterRows[0]?.name_middle).toBe("Quincy");

  // The event records the PRIOR master value so an unmerge could restore it.
  const { results: events } = await database
    .prepare("SELECT survivorship FROM entity_merge WHERE subordinate_id = ?1")
    .bind(dup)
    .all<{ survivorship: string }>();
  expect(JSON.parse(events[0]!.survivorship)).toEqual({ name_middle: "A" });
});

test("merge guards: same entity, missing entity, kind mismatch, already merged", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-guard");

  const master = await createPerson(
    database,
    { given: "Guard", family: "Master" },
    { ...options, randomSource: seededRandomSource("t13g-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Guard", family: "Dup" },
    { ...options, randomSource: seededRandomSource("t13g-dup") },
  );

  // master == subordinate
  await expect(
    mergeEntities(ctx, { masterId: master, subordinateId: master, survivorship: {} }),
  ).rejects.toBeInstanceOf(MergeSameEntityError);

  // missing entity
  await expect(
    mergeEntities(ctx, {
      masterId: master,
      subordinateId: "directoryPerson_doesnotexist",
      survivorship: {},
    }),
  ).rejects.toBeInstanceOf(MergeEntityNotFoundError);

  // kind mismatch (person master, organization subordinate id)
  await expect(
    mergeEntities(ctx, {
      masterId: master,
      subordinateId: "directoryOrganization_xxxxxxxxxxxx",
      survivorship: {},
    }),
  ).rejects.toBeInstanceOf(MergeKindMismatchError);

  // already merged: merge dup into master, then try again
  await mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} });
  await expect(
    mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} }),
  ).rejects.toBeInstanceOf(MergeAlreadyMergedError);
});
