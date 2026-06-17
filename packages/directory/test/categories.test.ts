import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { expect, test } from "vitest";
import { createCategory, assignCategory, readCategories } from "../src/categories.ts";
import { createOrganization } from "../src/organization.ts";
import { createPerson } from "../src/person.ts";

// Fixed clock for deterministic tests.
const clock = { now: () => "2026-06-17T00:00:00.000Z" };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

test("createCategory creates a category with the right fields", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-create");

  const { id } = await createCategory(
    database,
    { name: "Opposing Counsel", appliesTo: "person" },
    { clock, actorUserId: null, randomSource },
  );

  expect(id).toMatch(/^directoryCategory_/);

  const { results } = await database
    .prepare(
      "SELECT id, name, applies_to, position, archived FROM directory_category WHERE id = ?1",
    )
    .bind(id)
    .all<{ id: string; name: string; applies_to: string; position: number; archived: number }>();

  expect(results).toHaveLength(1);
  expect(results[0]?.name).toBe("Opposing Counsel");
  expect(results[0]?.applies_to).toBe("person");
  expect(results[0]?.position).toBe(0);
  expect(results[0]?.archived).toBe(0);
});

test("createCategory writes an audit row for directory.category.created", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-audit");

  const { id } = await createCategory(
    database,
    { name: "Client", appliesTo: "both" },
    { clock, actorUserId: null, randomSource },
  );

  const { results: audit } = await database
    .prepare("SELECT event, subject_id FROM audit_log WHERE event = 'directory.category.created'")
    .all<{ event: string; subject_id: string }>();

  expect(audit).toHaveLength(1);
  expect(audit[0]?.event).toBe("directory.category.created");
  expect(audit[0]?.subject_id).toBe(id);
});

test("createCategory respects an explicit position", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-position");

  const { id } = await createCategory(
    database,
    { name: "VIP", appliesTo: "person", position: 5 },
    { clock, actorUserId: null, randomSource },
  );

  const { results } = await database
    .prepare("SELECT position FROM directory_category WHERE id = ?1")
    .bind(id)
    .all<{ position: number }>();

  expect(results[0]?.position).toBe(5);
});

test("assignCategory links a person-kind entity to a person-only category and succeeds", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-assign-person");

  const personId = await createPerson(
    database,
    { given: "Alice", family: "Smith" },
    { clock, actorUserId: null, randomSource },
  );

  const { id: categoryId } = await createCategory(
    database,
    { name: "Opposing Counsel", appliesTo: "person" },
    { clock, actorUserId: null, randomSource },
  );

  await expect(
    assignCategory(
      database,
      { entityId: personId, categoryId },
      { clock, actorUserId: null, randomSource },
    ),
  ).resolves.toBeUndefined();

  const { results } = await database
    .prepare(
      "SELECT entity_id, category_id FROM directory_entity_category WHERE entity_id = ?1 AND category_id = ?2",
    )
    .bind(personId, categoryId)
    .all<{ entity_id: string; category_id: string }>();

  expect(results).toHaveLength(1);
});

test("assignCategory links an org-kind entity to an organization-only category and succeeds", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-assign-org");

  const organizationId = await createOrganization(
    database,
    { legalName: "Acme LLC" },
    { clock, actorUserId: null, randomSource },
  );

  const { id: categoryId } = await createCategory(
    database,
    { name: "Corporate Client", appliesTo: "organization" },
    { clock, actorUserId: null, randomSource },
  );

  await expect(
    assignCategory(
      database,
      { entityId: organizationId, categoryId },
      { clock, actorUserId: null, randomSource },
    ),
  ).resolves.toBeUndefined();
});

test("assignCategory with applies_to='both' accepts a person entity", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-both-person");

  const personId = await createPerson(
    database,
    { given: "Bob", family: "Jones" },
    { clock, actorUserId: null, randomSource },
  );

  const { id: categoryId } = await createCategory(
    database,
    { name: "VIP", appliesTo: "both" },
    { clock, actorUserId: null, randomSource },
  );

  await expect(
    assignCategory(
      database,
      { entityId: personId, categoryId },
      { clock, actorUserId: null, randomSource },
    ),
  ).resolves.toBeUndefined();
});

test("assignCategory with applies_to='both' accepts an organization entity", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-both-org");

  const organizationId = await createOrganization(
    database,
    { legalName: "Beta Corp" },
    { clock, actorUserId: null, randomSource },
  );

  const { id: categoryId } = await createCategory(
    database,
    { name: "VIP", appliesTo: "both" },
    { clock, actorUserId: null, randomSource },
  );

  await expect(
    assignCategory(
      database,
      { entityId: organizationId, categoryId },
      { clock, actorUserId: null, randomSource },
    ),
  ).resolves.toBeUndefined();
});

test("assignCategory with org entity and person-only category throws category-applies-to-mismatch", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-mismatch-org");

  const organizationId = await createOrganization(
    database,
    { legalName: "Gamma Inc" },
    { clock, actorUserId: null, randomSource },
  );

  const { id: categoryId } = await createCategory(
    database,
    { name: "Opposing Counsel", appliesTo: "person" },
    { clock, actorUserId: null, randomSource },
  );

  await expect(
    assignCategory(
      database,
      { entityId: organizationId, categoryId },
      { clock, actorUserId: null, randomSource },
    ),
  ).rejects.toMatchObject({ code: "category-applies-to-mismatch" });
});

test("assignCategory with person entity and organization-only category throws category-applies-to-mismatch", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-mismatch-person");

  const personId = await createPerson(
    database,
    { given: "Carol", family: "Brown" },
    { clock, actorUserId: null, randomSource },
  );

  const { id: categoryId } = await createCategory(
    database,
    { name: "Corporate Client", appliesTo: "organization" },
    { clock, actorUserId: null, randomSource },
  );

  await expect(
    assignCategory(
      database,
      { entityId: personId, categoryId },
      { clock, actorUserId: null, randomSource },
    ),
  ).rejects.toMatchObject({ code: "category-applies-to-mismatch" });
});

test("assignCategory with a non-existent category throws not-found", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-no-category");

  const personId = await createPerson(
    database,
    { given: "Dave", family: "Green" },
    { clock, actorUserId: null, randomSource },
  );

  await expect(
    assignCategory(
      database,
      { entityId: personId, categoryId: "directoryCategory_doesnotexist" },
      { clock, actorUserId: null, randomSource },
    ),
  ).rejects.toMatchObject({ code: "not-found" });
});

test("assignCategory with a non-existent entity throws unknown-entity", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-no-entity");

  const { id: categoryId } = await createCategory(
    database,
    { name: "VIP", appliesTo: "both" },
    { clock, actorUserId: null, randomSource },
  );

  await expect(
    assignCategory(
      database,
      { entityId: "directoryPerson_doesnotexist" as never, categoryId },
      { clock, actorUserId: null, randomSource },
    ),
  ).rejects.toMatchObject({ code: "unknown-entity" });
});

test("assignCategory writes an audit row for directory.category.assigned", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-assign-audit");

  const personId = await createPerson(
    database,
    { given: "Eve", family: "White" },
    { clock, actorUserId: null, randomSource },
  );

  const { id: categoryId } = await createCategory(
    database,
    { name: "Witness", appliesTo: "person" },
    { clock, actorUserId: null, randomSource },
  );

  await assignCategory(
    database,
    { entityId: personId, categoryId },
    { clock, actorUserId: null, randomSource },
  );

  const { results: audit } = await database
    .prepare("SELECT event, subject_id FROM audit_log WHERE event = 'directory.category.assigned'")
    .all<{ event: string; subject_id: string }>();

  expect(audit).toHaveLength(1);
  expect(audit[0]?.event).toBe("directory.category.assigned");
  expect(audit[0]?.subject_id).toBe(personId);
});

test("readCategories returns the linked categories for an entity", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-read");

  const personId = await createPerson(
    database,
    { given: "Frank", family: "Black" },
    { clock, actorUserId: null, randomSource },
  );

  const { id: cat1Id } = await createCategory(
    database,
    { name: "Opposing Counsel", appliesTo: "person", position: 1 },
    { clock, actorUserId: null, randomSource },
  );

  const { id: cat2Id } = await createCategory(
    database,
    { name: "Expert Witness", appliesTo: "person", position: 2 },
    { clock, actorUserId: null, randomSource },
  );

  await assignCategory(
    database,
    { entityId: personId, categoryId: cat1Id },
    { clock, actorUserId: null, randomSource },
  );
  await assignCategory(
    database,
    { entityId: personId, categoryId: cat2Id },
    { clock, actorUserId: null, randomSource },
  );

  const categories = await readCategories(database, personId);

  expect(categories).toHaveLength(2);

  const ids = categories.map((c) => c.id).sort();
  expect(ids).toContain(cat1Id);
  expect(ids).toContain(cat2Id);

  const cat1 = categories.find((c) => c.id === cat1Id);
  expect(cat1?.name).toBe("Opposing Counsel");
  expect(cat1?.appliesTo).toBe("person");
  expect(cat1?.position).toBe(1);
  expect(cat1?.archived).toBe(0);
});

test("readCategories returns empty array for an entity with no categories", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t11-read-empty");

  const personId = await createPerson(
    database,
    { given: "Gina", family: "Clark" },
    { clock, actorUserId: null, randomSource },
  );

  const categories = await readCategories(database, personId);
  expect(categories).toEqual([]);
});
