import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { expect, test } from "vitest";
import { createPerson, updatePerson } from "../src/person.ts";
import { createOrganization } from "../src/organization.ts";
import { searchNames } from "../src/search.ts";

// Fixed clock for deterministic tests.
const clock = { now: () => "2026-06-17T00:00:00.000Z" };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

test("trigram search finds a typo/substring match: 'cathrine' finds 'Catherine Smith'", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t8-a");
  await createPerson(
    database,
    { given: "Catherine", family: "Smith" },
    { clock, actorUserId: null, randomSource },
  );

  const hits = (await searchNames(database, "cathrine")).hits; // deliberate typo
  expect(hits.map((hit) => hit.displayName)).toContain("Catherine Smith");
});

test("soft-deleted name row is excluded from search results", async () => {
  const database = freshDatabase();

  // Create a person and then soft-delete their name row directly in the database.
  const personId = await createPerson(
    database,
    { given: "Deleted", family: "Person" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t8-b") },
  );

  // Soft-delete the name row by setting deleted_at directly.
  await database
    .prepare("UPDATE directory_name SET deleted_at = ?1 WHERE entity_id = ?2")
    .bind("2026-06-17T00:00:00.000Z", personId)
    .run();

  const hits = (await searchNames(database, "deleted person")).hits;
  const displayNames = hits.map((hit) => hit.displayName);
  expect(displayNames).not.toContain("Deleted Person");
});

test("merged_into entity is excluded from ordinary search results", async () => {
  const database = freshDatabase();

  const masterPersonId = await createPerson(
    database,
    { given: "Master", family: "Record" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t8-c") },
  );

  const mergedPersonId = await createPerson(
    database,
    { given: "Merged", family: "Away" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t8-d") },
  );

  // Mark the second person as merged into the master.
  await updatePerson(
    database,
    mergedPersonId,
    { status: "merged_into", mergedIntoId: masterPersonId },
    { clock, actorUserId: null, randomSource: seededRandomSource("t8-e") },
  );

  const hits = (await searchNames(database, "merged away")).hits;
  const entityIds = hits.map((hit) => hit.entityId);
  expect(entityIds).not.toContain(mergedPersonId);
});

test("FTS5 keyword trigrams 'and'/'not' do not throw or corrupt results (regression)", async () => {
  // "Anderson" contains the trigram "and"; "Nottingham" contains "not". Both are FTS5 boolean
  // operators when left bare in a MATCH expression — they must be quoted as phrase literals.
  const database = freshDatabase();

  await createPerson(
    database,
    { given: "Sarah", family: "Anderson" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t8-g") },
  );

  await createOrganization(
    database,
    { legalName: "Nottingham Chambers" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t8-h") },
  );

  // Neither query should throw (was a syntax error before trigrams were quoted).
  const andersonHits = (await searchNames(database, "anderson")).hits;
  expect(andersonHits.map((hit) => hit.displayName)).toContain("Sarah Anderson");

  const nottinghamHits = (await searchNames(database, "nottingham")).hits;
  expect(nottinghamHits.map((hit) => hit.displayName)).toContain("Nottingham Chambers");
});

test("short query (fewer than 3 characters) returns empty without throwing", async () => {
  const database = freshDatabase();
  await createPerson(
    database,
    { given: "Alice", family: "Brown" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t8-f") },
  );

  // Single character — must not throw.
  const singleCharHits = (await searchNames(database, "A")).hits;
  expect(singleCharHits).toEqual([]);

  // Two characters — must not throw.
  const twoCharHits = (await searchNames(database, "Al")).hits;
  expect(twoCharHits).toEqual([]);

  // Empty string — must not throw.
  const emptyHits = (await searchNames(database, "")).hits;
  expect(emptyHits).toEqual([]);
});

test("a search caps its answer and says so, rather than returning the whole directory", async () => {
  // This read carried no LIMIT at all: a broad query against a large directory returned every match
  // in one response, and the match count is driven by the caller's query rather than by anything
  // structural. The cap is what bounds it; `capped` is what stops the cap being silent.
  const database = freshDatabase();
  for (let index = 0; index < 6; index += 1) {
    await createPerson(
      database,
      { given: "Marchetti", family: `Marchetti ${String(index)}` },
      { clock, actorUserId: null, randomSource: seededRandomSource(`t8-cap-${String(index)}`) },
    );
  }

  const capped = await searchNames(database, "marchetti", 4);
  expect(capped.hits).toHaveLength(4);
  expect(capped.capped).toBe(true);

  // Under the cap, the answer is complete and says so — "no more matches" and "we stopped counting"
  // must not look alike.
  const complete = await searchNames(database, "marchetti", 50);
  expect(complete.hits.length).toBeGreaterThanOrEqual(6);
  expect(complete.capped).toBe(false);
});
