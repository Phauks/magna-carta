import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { expect, test } from "vitest";
import { createOrganization, readOrganization } from "../src/organization.ts";
import { createPerson, readPerson } from "../src/person.ts";
import { addName, changeName, readNames } from "../src/name-history.ts";

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

test("a correction retires the mistyped name instead of keeping it as a former name", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Mary", family: "Jnoes" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-fix-a") },
  );

  await changeName(
    database,
    personId,
    { given: "Mary", family: "Jones" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-fix-b") },
    "correction",
  );

  // The record reads one name, the corrected one: the typo is not offered as a name they held.
  const page = await readNames(database, personId);
  expect(page.data.map((name) => [name.family, name.isCurrent])).toEqual([["Jones", true]]);

  // The mistyped row is still there, retired, so the history of what was on file survives.
  const { results: rows } = await database
    .prepare(
      "SELECT name_family, is_current, deleted_at, valid_to FROM directory_name WHERE entity_id = ?1 ORDER BY created_at",
    )
    .bind(personId)
    .all<{
      name_family: string;
      is_current: number;
      deleted_at: string | null;
      valid_to: string | null;
    }>();
  const retired = rows.find((row) => row.name_family === "Jnoes");
  expect(retired?.is_current).toBe(0);
  expect(retired?.deleted_at).not.toBeNull();
  expect(retired?.valid_to).not.toBeNull();

  // The entity row reads the corrected name, and the act is audited as a correction.
  const person = await readPerson(database, personId);
  expect(person?.family).toBe("Jones");
  const { results: audits } = await database
    .prepare("SELECT event FROM audit_log WHERE subject_id = ?1")
    .bind(personId)
    .all<{ event: string }>();
  expect(audits.map((row) => row.event)).toContain("directory.entity.name_corrected");
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
    .prepare("SELECT id, name_family, is_current FROM directory_name WHERE entity_id = ?1")
    .bind(personId)
    .all<{ id: string; name_family: string | null; is_current: number }>();

  const formerRow = nameRows.find((row) => row.is_current === 0);
  expect(formerRow?.name_family).toBe("Jones");

  const { results: phoneticRows } = await database
    .prepare("SELECT scheme, code FROM directory_name_phonetic_code WHERE name_id = ?1")
    .bind(formerRow?.id)
    .all<{ scheme: string; code: string }>();

  // Jones' phonetic codes must exist and be non-empty.
  expect(phoneticRows.length).toBeGreaterThan(0);
  const primaryCode = phoneticRows.find((row) => row.scheme === "double_metaphone_primary");
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
    .prepare("SELECT topic, payload FROM outbox WHERE topic = 'directory.entity.renamed'")
    .all<{ topic: string; payload: string }>();
  expect(outbox).toHaveLength(1);

  const { results: audit } = await database
    .prepare("SELECT event, subject_id FROM audit_log WHERE event = 'directory.entity.renamed'")
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
    .prepare("SELECT id, is_current FROM directory_name WHERE entity_id = ?1")
    .bind(personId)
    .all<{ id: string; is_current: number }>();

  const aliasRow = nameRows.find((row) => row.is_current === 0);
  expect(aliasRow).toBeDefined();

  const { results: phoneticRows } = await database
    .prepare("SELECT scheme, code FROM directory_name_phonetic_code WHERE name_id = ?1")
    .bind(aliasRow?.id)
    .all<{ scheme: string; code: string }>();

  expect(phoneticRows.length).toBeGreaterThan(0);
  const primaryCode = phoneticRows.find((row) => row.scheme === "double_metaphone_primary");
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

// ── double-rename invariant ──────────────────────────────────────────────────

// Guard the flip's WHERE entity_id=? AND is_current=1 scoping: renaming twice must produce
// exactly one is_current=1 row, two former rows each with valid_to set, and must not
// re-disturb the first former row's valid_to when the second rename fires.
test("double changeName: exactly one current, two former, first former valid_to undisturbed", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Alice", family: "Adams" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-s") },
  );

  // First rename: Adams → Brown.
  await changeName(
    database,
    personId,
    { given: "Alice", family: "Brown" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-t") },
  );

  // Capture the first former row's valid_to before the second rename.
  const { results: afterFirstRename } = await database
    .prepare(
      "SELECT name_family, is_current, valid_to FROM directory_name WHERE entity_id = ?1 ORDER BY created_at",
    )
    .bind(personId)
    .all<{ name_family: string | null; is_current: number; valid_to: string | null }>();

  const firstFormerAfterFirstRename = afterFirstRename.find((row) => row.name_family === "Adams");
  expect(firstFormerAfterFirstRename?.valid_to).not.toBeNull();
  const capturedFirstFormerValidTo = firstFormerAfterFirstRename?.valid_to;

  // Second rename: Brown → Clark.
  await changeName(
    database,
    personId,
    { given: "Alice", family: "Clark" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t7-u") },
  );

  const { results: rows } = await database
    .prepare(
      "SELECT name_family, name_role, is_current, valid_to FROM directory_name WHERE entity_id = ?1 ORDER BY created_at",
    )
    .bind(personId)
    .all<{
      name_family: string | null;
      name_role: string;
      is_current: number;
      valid_to: string | null;
    }>();

  // Exactly three rows total after two renames.
  expect(rows).toHaveLength(3);

  // Exactly one is_current=1 row.
  const currentRows = rows.filter((row) => row.is_current === 1);
  expect(currentRows).toHaveLength(1);
  expect(currentRows[0]?.name_family).toBe("Clark");

  // Exactly two former rows, both with valid_to set.
  const formerRows = rows.filter((row) => row.name_role === "former");
  expect(formerRows).toHaveLength(2);
  for (const row of formerRows) {
    expect(row.valid_to).not.toBeNull();
  }

  // The first former row (Adams) must not have had its valid_to overwritten by the second rename.
  const firstFormer = rows.find((row) => row.name_family === "Adams");
  expect(firstFormer?.valid_to).toBe(capturedFirstFormerValidTo);
});
