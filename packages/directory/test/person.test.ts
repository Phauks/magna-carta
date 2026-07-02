import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { expect, test } from "vitest";
import { createPerson, readPerson, updatePerson } from "../src/person.ts";

// Fixed clock for deterministic tests.
const clock = { now: () => "2026-06-17T00:00:00.000Z" };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

test("createPerson writes the entity, a current name row, and phonetic codes in one batch", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t5");
  const personId = await createPerson(
    database,
    { given: "Catherine", family: "Smith" },
    { clock, actorUserId: null, randomSource },
  );

  const person = await readPerson(database, personId);
  expect(person.displayName).toBe("Catherine Smith");
  expect(person.given).toBe("Catherine");
  expect(person.family).toBe("Smith");
  expect(person.status).toBe("active");

  const { results: names } = await database
    .prepare(
      "SELECT id, entity_kind, name_role, is_current, normalized_display FROM directory_name WHERE entity_id = ?1",
    )
    .bind(personId)
    .all<{
      id: string;
      entity_kind: string;
      name_role: string;
      is_current: number;
      normalized_display: string;
    }>();
  expect(names).toHaveLength(1);
  expect(names[0]?.is_current).toBe(1);
  expect(names[0]?.entity_kind).toBe("person");
  expect(names[0]?.name_role).toBe("current");
  expect(names[0]?.normalized_display).toBe("catherine smith");

  const { results: codes } = await database
    .prepare("SELECT scheme FROM directory_name_phonetic_code WHERE name_id = ?1")
    .bind(names[0]?.id)
    .all<{ scheme: string }>();
  expect(codes.map((code) => code.scheme).sort()).toEqual([
    "double_metaphone_primary",
    "double_metaphone_secondary",
  ]);
});

test("createPerson writes a directory.entity.created outbox message and an audit row", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Jane", family: "Doe" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t5-outbox") },
  );

  const { results: outbox } = await database
    .prepare("SELECT topic, payload FROM outbox")
    .all<{ topic: string; payload: string }>();
  expect(outbox).toHaveLength(1);
  expect(outbox[0]?.topic).toBe("directory.entity.created");
  expect(JSON.parse(outbox[0]?.payload ?? "{}")).toEqual({ personId });

  const { results: audit } = await database
    .prepare("SELECT event, subject_id FROM audit_log")
    .all<{ event: string; subject_id: string }>();
  expect(audit).toHaveLength(1);
  expect(audit[0]?.event).toBe("directory.person.created");
  expect(audit[0]?.subject_id).toBe(personId);
});

test("createPerson falls back to the given name for phonetic codes when family is absent", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Cher", family: "" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t5-mononym") },
  );

  const { results: names } = await database
    .prepare("SELECT id FROM directory_name WHERE entity_id = ?1")
    .bind(personId)
    .all<{ id: string }>();
  const { results: codes } = await database
    .prepare(
      "SELECT code FROM directory_name_phonetic_code WHERE name_id = ?1 AND scheme = 'double_metaphone_primary'",
    )
    .bind(names[0]?.id)
    .all<{ code: string }>();
  // "Cher" double-metaphones to a non-empty primary code — proof the given-name fallback fired.
  expect((codes[0]?.code ?? "").length).toBeGreaterThan(0);
});

test("updatePerson updates non-name standard fields", async () => {
  const database = freshDatabase();
  const personId = await createPerson(
    database,
    { given: "Jane", family: "Doe" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t5-update") },
  );

  await updatePerson(
    database,
    personId,
    { status: "merged_into", mergedIntoId: "directoryPerson_other" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t5-update-2") },
  );

  const person = await readPerson(database, personId);
  expect(person.status).toBe("merged_into");
  expect(person.mergedIntoId).toBe("directoryPerson_other");

  const { results: audit } = await database
    .prepare("SELECT event, subject_id FROM audit_log WHERE event = 'directory.person.updated'")
    .all<{ event: string; subject_id: string }>();
  expect(audit).toHaveLength(1);
  expect(audit[0]?.event).toBe("directory.person.updated");
  expect(audit[0]?.subject_id).toBe(personId);
});
