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
  MergeUnknownFieldError,
} from "../src/merge.ts";
import { DirectoryIdempotencyConflictError } from "../src/run-directory-effect.ts";
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

// Seed a matter_party row directly rather than through linkMatterParty, so the merge-repoint tests
// exercise the merge in isolation from the link API.
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

test("merge ABSORBS a shared category instead of aborting on the composite primary key", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-cat-collide");

  const master = await createPerson(
    database,
    { given: "Cat", family: "Master" },
    { ...options, randomSource: seededRandomSource("t13cc-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Cat", family: "Dup" },
    { ...options, randomSource: seededRandomSource("t13cc-dup") },
  );

  // BOTH master and subordinate hold the same category — the collision the naive repoint aborts on.
  const { id: categoryId } = await createCategory(
    database,
    { name: "VIP", appliesTo: "both" },
    { ...options, randomSource: seededRandomSource("t13cc-cat") },
  );
  for (const [entityId, seed] of [
    [master, "t13cc-assign-master"],
    [dup, "t13cc-assign-dup"],
  ] as const) {
    await assignCategory(
      database,
      { entityId, categoryId },
      { ...options, randomSource: seededRandomSource(seed) },
    );
  }

  // The merge must succeed (not throw a PK-constraint error).
  await mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} });

  // Exactly one (master, category) link survives — the subordinate's duplicate was absorbed (deleted).
  const { results: catRows } = await database
    .prepare("SELECT entity_id FROM directory_entity_category WHERE category_id = ?1")
    .bind(categoryId)
    .all<{ entity_id: string }>();
  expect(catRows.map((r) => r.entity_id)).toEqual([master]);

  // The absorption is recorded in the entity_merge event so the merge stays reversible.
  const { results: events } = await database
    .prepare("SELECT repointed FROM entity_merge WHERE subordinate_id = ?1")
    .bind(dup)
    .all<{ repointed: string }>();
  expect(JSON.parse(events[0]!.repointed)).toContainEqual({
    table: "directory_entity_category",
    row: categoryId,
    from: dup,
    to: master,
    absorbed: true,
  });
});

test("merge ABSORBS a subordinate↔master edge instead of leaving a self-loop", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-selfloop");

  const master = await createPerson(
    database,
    { given: "Loop", family: "Master" },
    { ...options, randomSource: seededRandomSource("t13sl-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Loop", family: "Dup" },
    { ...options, randomSource: seededRandomSource("t13sl-dup") },
  );

  // An edge directly between the two entities being merged — repointing it would yield master→master.
  const selfEdge = await createEdge(
    database,
    {
      from: dup,
      to: master,
      edgeType: "relationship",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    { ...options, randomSource: seededRandomSource("t13sl-edge") },
  );

  await mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} });

  // The edge was deleted, not turned into a master→master self-loop.
  const { results: edgeRows } = await database
    .prepare("SELECT id FROM directory_edge WHERE id = ?1")
    .bind(selfEdge)
    .all<{ id: string }>();
  expect(edgeRows).toHaveLength(0);
});

test("merge ABSORBS a duplicate matter party (same matter + role) rather than double-linking", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-party-dup");

  const master = await createPerson(
    database,
    { given: "Party", family: "Master" },
    { ...options, randomSource: seededRandomSource("t13pd-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Party", family: "Dup" },
    { ...options, randomSource: seededRandomSource("t13pd-dup") },
  );

  await seedMatter(database, "mat_dup");
  // Both master and subordinate are the SAME role on the SAME matter.
  await seedMatterParty(database, "mat_dup", master, "client");
  await seedMatterParty(database, "mat_dup", dup, "client");

  await mergeEntities(ctx, { masterId: master, subordinateId: dup, survivorship: {} });

  // Exactly one client link to the master remains — the subordinate's duplicate was absorbed.
  const { results: parties } = await database
    .prepare(
      "SELECT entity_id FROM matter_party WHERE matter_id = 'mat_dup' AND role = 'client' AND deleted_at IS NULL",
    )
    .all<{ entity_id: string }>();
  expect(parties.map((p) => p.entity_id)).toEqual([master]);
});

test("repoints a contact-reference custom value and absorbs an owned value to history on merge", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-customfields");

  const master = await createPerson(
    database,
    { given: "Custom", family: "Master" },
    { ...options, randomSource: seededRandomSource("t13cf-master") },
  );
  const sub = await createPerson(
    database,
    { given: "Custom", family: "Dup" },
    { ...options, randomSource: seededRandomSource("t13cf-dup") },
  );

  // Target A: a matter field whose contact-reference points at the subordinate. The value's own row
  // (target_row_id = a matter) does not move; only its value_reference_id repoints to the master.
  await database
    .prepare(
      "INSERT INTO custom_field (id,name,kind,target,attachment_id,required,archived,converting,position,created_at) VALUES ('customField_ref','Carrier','contact-reference','matter',NULL,0,0,0,0,'t')",
    )
    .run();
  await database
    .prepare(
      "INSERT INTO custom_field_value (id,field_id,target_row_id,value_reference_id,is_current,valid_from,created_at) VALUES ('customFieldValue_a','customField_ref','matter_1',?1,1,'t','t')",
    )
    .bind(sub)
    .run();

  // Target B: an entity field with current values OWNED BY both master and subordinate (same field).
  // Repointing the subordinate's value to the master collides on the partial unique index, so it is
  // absorbed to history (moved under the master, is_current = 0) rather than deleted.
  await database
    .prepare(
      "INSERT INTO custom_field (id,name,kind,target,attachment_id,required,archived,converting,position,created_at) VALUES ('customField_own','Risk','single-line','entity',NULL,0,0,0,0,'t')",
    )
    .run();
  await database
    .prepare(
      "INSERT INTO custom_field_value (id,field_id,target_row_id,value_text,is_current,valid_from,created_at) VALUES ('customFieldValue_m','customField_own',?1,'A',1,'t','t')",
    )
    .bind(master)
    .run();
  await database
    .prepare(
      "INSERT INTO custom_field_value (id,field_id,target_row_id,value_text,is_current,valid_from,created_at) VALUES ('customFieldValue_s','customField_own',?1,'B',1,'t','t')",
    )
    .bind(sub)
    .run();

  await mergeEntities(ctx, { masterId: master, subordinateId: sub, survivorship: {} });

  // Target A: the contact-reference value repointed to the master.
  const { results: refRows } = await database
    .prepare("SELECT value_reference_id FROM custom_field_value WHERE id = 'customFieldValue_a'")
    .all<{ value_reference_id: string }>();
  expect(refRows[0]?.value_reference_id).toBe(master);

  // Target B: master's value wins — exactly one current value for the field on the master.
  const { results: currentRows } = await database
    .prepare(
      "SELECT COUNT(*) AS n FROM custom_field_value WHERE field_id = 'customField_own' AND target_row_id = ?1 AND is_current = 1",
    )
    .bind(master)
    .all<{ n: number }>();
  expect(currentRows[0]?.n).toBe(1);

  // The subordinate's owned value is preserved as history under the master (content intact).
  const { results: absorbedRows } = await database
    .prepare(
      "SELECT is_current, target_row_id, value_text, valid_to FROM custom_field_value WHERE id = 'customFieldValue_s'",
    )
    .all<{
      is_current: number;
      target_row_id: string;
      value_text: string;
      valid_to: string | null;
    }>();
  const absorbed = absorbedRows[0];
  expect(absorbed?.is_current).toBe(0);
  expect(absorbed?.target_row_id).toBe(master);
  expect(absorbed?.value_text).toBe("B");
  expect(absorbed?.valid_to).toBe(clock.now());

  // Both repoints are recorded in the entity_merge event so the merge stays reversible.
  const { results: eventRows } = await database
    .prepare("SELECT repointed FROM entity_merge WHERE subordinate_id = ?1")
    .bind(sub)
    .all<{ repointed: string }>();
  const repointed = JSON.parse(eventRows[0]!.repointed) as Array<Record<string, unknown>>;
  expect(repointed).toContainEqual({
    table: "custom_field_value",
    row: "customFieldValue_a",
    from: sub,
    to: master,
  });
  expect(repointed).toContainEqual({
    table: "custom_field_value",
    row: "customFieldValue_s",
    from: sub,
    to: master,
    absorbed: true,
  });
});

test("merge rejects an unknown survivorship field with MergeUnknownFieldError", async () => {
  const { database, ctx, options } = await directoryTestContext("t13-badfield");

  const master = await createPerson(
    database,
    { given: "Field", family: "Master" },
    { ...options, randomSource: seededRandomSource("t13bf-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Field", family: "Dup" },
    { ...options, randomSource: seededRandomSource("t13bf-dup") },
  );

  await expect(
    mergeEntities(ctx, {
      masterId: master,
      subordinateId: dup,
      survivorship: { not_a_column: "subordinate" },
    }),
  ).rejects.toBeInstanceOf(MergeUnknownFieldError);
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

// The highest-risk dedup path. A merge committed under an Idempotency-Key writes its idempotency
// record in the SAME atomic batch (proved here: the record exists after the first merge, carrying the
// merge response). The danger is the CONCURRENT race the chokepoint middleware cannot pre-answer: two
// identical merge requests both read the subordinate as live, both pass the already-merged guard, and
// both reach the commit. runIdempotentEffect makes the loser harmless — it sees the winner's record
// (UNIQUE(key)) and replays it instead of running its own repoint batch. We drive exactly that path:
// seed the winner's completed record, then run a merge under the same key against still-live entities
// — the guards pass, the pre-check replays, and NO repoint and NO second entity_merge event happen.
test("a same-key merge replays the stored response — no double-repoint, no second entity_merge event", async () => {
  const { database, ctx, options } = await directoryTestContext("t-idem-merge");

  const master = await createPerson(
    database,
    { given: "Idem", family: "Master" },
    { ...options, randomSource: seededRandomSource("ti-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Idem", family: "Dup" },
    { ...options, randomSource: seededRandomSource("ti-dup") },
  );

  // dup carries an inbound matter_party reference the merge would repoint to the master.
  await seedMatter(database, "mat_idem");
  const matterPartyId = await seedMatterParty(database, "mat_idem", dup, "beneficiary");

  const idempotency = { key: "merge-key-1", fingerprint: "fp" };

  // First merge: commits the repoint + entity_merge event + the idempotency record in one batch.
  const firstMergeId = await mergeEntities(
    { ...ctx, idempotency },
    { masterId: master, subordinateId: dup, survivorship: {} },
  );

  // The idempotency record was written in that same batch, keyed by the merge key, carrying the
  // stored merge response — the byte-identical replay source.
  const { results: records } = await database
    .prepare("SELECT response_body FROM idempotency_key WHERE key = ?1")
    .bind("merge-key-1")
    .all<{ response_body: string }>();
  expect(records).toHaveLength(1);
  expect(JSON.parse(records[0]!.response_body)).toEqual({ mergeId: firstMergeId });

  // The concurrent loser's path: roll the subordinate back to live (as it was when the loser READ it,
  // before the winner committed) so the already-merged guard would pass, then re-run under the same
  // key. runIdempotentEffect's pre-check finds the winner's record and replays — its repoint batch
  // never runs. This is the dedup the fix adds: without the record, this second call WOULD repoint
  // again and write a second entity_merge event.
  await database
    .prepare("UPDATE directory_person SET status = 'active', merged_into_id = NULL WHERE id = ?1")
    .bind(dup)
    .run();

  const replayMergeId = await mergeEntities(
    { ...ctx, idempotency },
    { masterId: master, subordinateId: dup, survivorship: {} },
  );
  expect(replayMergeId).toBe(firstMergeId);

  // Exactly ONE entity_merge event exists for this subordinate — the replay wrote none.
  const { results: events } = await database
    .prepare("SELECT id FROM entity_merge WHERE subordinate_id = ?1")
    .bind(dup)
    .all<{ id: string }>();
  expect(events).toHaveLength(1);
  expect(events[0]?.id).toBe(firstMergeId);

  // The matter_party row is repointed to the master exactly once — the replay did not touch it.
  const { results: party } = await database
    .prepare("SELECT entity_id FROM matter_party WHERE id = ?1")
    .bind(matterPartyId)
    .all<{ entity_id: string }>();
  expect(party).toHaveLength(1);
  expect(party[0]?.entity_id).toBe(master);
});

// A same key reused with a DIFFERENT payload surfaces the fingerprint-mismatch conflict the route
// maps to a 422 — proving the directory conflict path mirrors matters.
test("a merge key reused with a different payload surfaces a fingerprint-mismatch conflict", async () => {
  const { database, ctx, options } = await directoryTestContext("t-idem-merge-fp");

  const master = await createPerson(
    database,
    { given: "Fp", family: "Master" },
    { ...options, randomSource: seededRandomSource("tifp-master") },
  );
  const dup = await createPerson(
    database,
    { given: "Fp", family: "Dup" },
    { ...options, randomSource: seededRandomSource("tifp-dup") },
  );

  await mergeEntities(
    { ...ctx, idempotency: { key: "merge-key-fp", fingerprint: "fp-a" } },
    { masterId: master, subordinateId: dup, survivorship: {} },
  );
  // Roll the subordinate back to live so the merge guards pass and runIdempotentEffect's pre-check is
  // reached — the stored record's fingerprint (fp-a) differs from this call's (fp-b), so it refuses
  // with the fingerprint-mismatch conflict the route maps to 422.
  await database
    .prepare("UPDATE directory_person SET status = 'active', merged_into_id = NULL WHERE id = ?1")
    .bind(dup)
    .run();
  await expect(
    mergeEntities(
      { ...ctx, idempotency: { key: "merge-key-fp", fingerprint: "fp-b" } },
      { masterId: master, subordinateId: dup, survivorship: {} },
    ),
  ).rejects.toBeInstanceOf(DirectoryIdempotencyConflictError);
});
