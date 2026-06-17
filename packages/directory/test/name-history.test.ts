import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { expect, test } from "vitest";
import { createOrganization, readOrganization } from "../src/organization.ts";
import { createPerson, readPerson } from "../src/person.ts";
import { addName, changeName } from "../src/name-history.ts";

// Fixed clock for deterministic tests.
const clock = { now: () => "2026-06-17T00:00:00.000Z" };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// ── changeName — person ──────────────────────────────────────────────────────

test("changeName preserves history and keeps exactly one current name", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Mary", family: "Jones" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-a") },
  );

  await changeName(
    database,
    personId,
    { given: "Mary", family: "Smith" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-b") },
  );

  const { results: rows } = await database
    .prepare(
      "SELECT name_role, is_current, valid_to FROM directory_name WHERE entity_id = ?1 ORDER BY created_at",
    )
    .bind(personId)
    .all<{ name_role: string; is_current: number; valid_to: string | null }>();

  expect(rows).toHaveLength(2);

  const current = rows.filter((row) => row.is_current === 1);
  expect(current).toHaveLength(1);

  const former = rows.find((row) => row.is_current === 0);
  expect(former?.name_role).toBe("former");
  expect(former?.valid_to).not.toBeNull();
});

test("the former name still produces phonetic codes (conflicts corpus)", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Mary", family: "Jones" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-c") },
  );

  await changeName(
    database,
    personId,
    { given: "Mary", family: "Smith" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-d") },
  );

  // The former name row (Jones) must still have its phonetic code rows so the
  // conflicts corpus can match on maiden/previous names.
  const { results: nameRows } = await database
    .prepare(
      "SELECT id, name_family, is_current FROM directory_name WHERE entity_id = ?1",
    )
    .bind(personId)
    .all<{ id: string; name_family: string | null; is_current: number }>();

  const formerRow = nameRows.find((row) => row.is_current === 0);
  expect(formerRow?.name_family).toBe("Jones");

  const { results: phoneticRows } = await database
    .prepare(
      "SELECT scheme, code FROM directory_name_phonetic_code WHERE name_id = ?1",
    )
    .bind(formerRow?.id)
    .all<{ scheme: string; code: string }>();

  // Jones' phonetic codes must exist and be non-empty.
  expect(phoneticRows.length).toBeGreaterThan(0);
  const primaryCode = phoneticRows.find(
    (row) => row.scheme === "double_metaphone_primary",
  );
  expect(primaryCode?.code.length).toBeGreaterThan(0);
});

test("changeName updates the entity row's denormalized name columns", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Mary", family: "Jones" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-e") },
  );

  await changeName(
    database,
    personId,
    { given: "Mary", family: "Smith" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-f") },
  );

  const person = await readPerson(database, personId);
  expect(person.family).toBe("Smith");
  expect(person.given).toBe("Mary");
  expect(person.displayName).toBe("Mary Smith");
});

test("changeName emits a directory.entity.renamed outbox message and audit row", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Mary", family: "Jones" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-g") },
  );

  await changeName(
    database,
    personId,
    { given: "Mary", family: "Smith" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-h") },
  );

  const { results: outbox } = await database
    .prepare(
      "SELECT topic, payload FROM outbox WHERE topic = 'directory.entity.renamed'",
    )
    .all<{ topic: string; payload: string }>();
  expect(outbox).toHaveLength(1);

  const { results: audit } = await database
    .prepare(
      "SELECT event, subject_id FROM audit_log WHERE event = 'directory.entity.renamed'",
    )
    .all<{ event: string; subject_id: string }>();
  expect(audit).toHaveLength(1);
  expect(audit[0]?.subject_id).toBe(personId);
});

// ── changeName — organization ────────────────────────────────────────────────

test("changeName works for an organization: flips current to former and updates legal_name", async () => {
  const database = freshDatabase();
  const organizationId = await createOrganization(
    database,
    { legalName: "Acme Corp" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-i") },
  );

  await changeName(
    database,
    organizationId,
    { legalName: "Acme Holdings Pty Ltd" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-j") },
  );

  const { results: rows } = await database
    .prepare(
      "SELECT name_role, is_current, valid_to FROM directory_name WHERE entity_id = ?1 ORDER BY created_at",
    )
    .bind(organizationId)
    .all<{ name_role: string; is_current: number; valid_to: string | null }>();

  expect(rows).toHaveLength(2);
  const current = rows.filter((row) => row.is_current === 1);
  expect(current).toHaveLength(1);
  const former = rows.find((row) => row.is_current === 0);
  expect(former?.name_role).toBe("former");
  expect(former?.valid_to).not.toBeNull();

  const organization = await readOrganization(database, organizationId);
  expect(organization.legalName).toBe("Acme Holdings Pty Ltd");
});

// ── addName ──────────────────────────────────────────────────────────────────

test("addName appends a non-current alias row without changing the current name", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Mary", family: "Smith" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-k") },
  );

  await addName(
    database,
    personId,
    { given: "Mary", family: "Jones", nameRole: "maiden" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-l") },
  );

  const { results: rows } = await database
    .prepare(
      "SELECT name_role, is_current FROM directory_name WHERE entity_id = ?1 ORDER BY created_at",
    )
    .bind(personId)
    .all<{ name_role: string; is_current: number }>();

  // Still two rows: one current, one alias/maiden.
  expect(rows).toHaveLength(2);

  const current = rows.filter((row) => row.is_current === 1);
  expect(current).toHaveLength(1);
  expect(current[0]?.name_role).toBe("current");

  const alias = rows.find((row) => row.is_current === 0);
  expect(alias?.name_role).toBe("maiden");
});

test("addName stores phonetic codes for the added name", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Mary", family: "Smith" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-m") },
  );

  await addName(
    database,
    personId,
    { given: "Mary", family: "Jones", nameRole: "maiden" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-n") },
  );

  const { results: nameRows } = await database
    .prepare(
      "SELECT id, is_current FROM directory_name WHERE entity_id = ?1",
    )
    .bind(personId)
    .all<{ id: string; is_current: number }>();

  const aliasRow = nameRows.find((row) => row.is_current === 0);
  expect(aliasRow).toBeDefined();

  const { results: phoneticRows } = await database
    .prepare(
      "SELECT scheme, code FROM directory_name_phonetic_code WHERE name_id = ?1",
    )
    .bind(aliasRow?.id)
    .all<{ scheme: string; code: string }>();

  expect(phoneticRows.length).toBeGreaterThan(0);
  const primaryCode = phoneticRows.find(
    (row) => row.scheme === "double_metaphone_primary",
  );
  expect(primaryCode?.code.length).toBeGreaterThan(0);
});

test("addName does not update the entity row's denormalized name columns", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Mary", family: "Smith" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-o") },
  );

  await addName(
    database,
    personId,
    { given: "Mary", family: "Jones", nameRole: "maiden" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-p") },
  );

  // The person entity row's name columns must still reflect "Smith", not "Jones".
  const person = await readPerson(database, personId);
  expect(person.family).toBe("Smith");
  expect(person.displayName).toBe("Mary Smith");
});

test("addName works for an organization with a dba role", async () => {
  const database = freshDatabase();
  const organizationId = await createOrganization(
    database,
    { legalName: "Acme Corp" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-q") },
  );

  await addName(
    database,
    organizationId,
    { legalName: "Acme", nameRole: "dba" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-r") },
  );

  const { results: rows } = await database
    .prepare(
      "SELECT name_role, is_current FROM directory_name WHERE entity_id = ?1 ORDER BY created_at",
    )
    .bind(organizationId)
    .all<{ name_role: string; is_current: number }>();

  expect(rows).toHaveLength(2);
  const current = rows.filter((row) => row.is_current === 1);
  expect(current).toHaveLength(1);
  const alias = rows.find((row) => row.is_current === 0);
  expect(alias?.name_role).toBe("dba");

  // The organization's legal_name must be unchanged.
  const organization = await readOrganization(database, organizationId);
  expect(organization.legalName).toBe("Acme Corp");
});
