import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { expect, test } from "vitest";
import { readEntityDisplayNames } from "../src/subject-facts.ts";

/*
 * How a surfaced entity is NAMED for a reader, which is a different question from what the matcher
 * compares — and the failure modes are what matter here rather than the happy path. A conflicts hit
 * always has a party, so every way of not producing a name has to be distinguishable from "no party
 * matched", which is the one thing this must never look like.
 *
 * The rows are written directly rather than through the Directory's own create paths: this reads
 * two node tables and composes their name columns, and driving it through the write API would test
 * that API instead. `createMigratedNodeDatabase` gives the real per-firm schema, so the column names
 * are the ones production has.
 */

const PERSON = "directoryPerson_dana";
const PERSON_PARTS_ONLY = "directoryPerson_parts";
const PERSON_UNNAMED = "directoryPerson_blank";
const ORGANIZATION = "directoryOrganization_coastal";
const ORGANIZATION_LEGAL_ONLY = "directoryOrganization_marchetti";
const INSTANT = "2026-09-02T00:00:00.000Z";

function seeded() {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(
    `INSERT INTO directory_person (id, display_name, name_given, name_family, created_at, updated_at)
       VALUES ('${PERSON}', 'Dana Reyes', 'Dana', 'Reyes', '${INSTANT}', '${INSTANT}'),
              ('${PERSON_PARTS_ONLY}', NULL, 'Ines', 'Herrera', '${INSTANT}', '${INSTANT}'),
              ('${PERSON_UNNAMED}', NULL, NULL, NULL, '${INSTANT}', '${INSTANT}')`,
  );
  raw.exec(
    `INSERT INTO directory_organization (id, display_name, legal_name, created_at, updated_at)
       VALUES ('${ORGANIZATION}', 'Coastal', 'Coastal Holdings, LLC', '${INSTANT}', '${INSTANT}'),
              ('${ORGANIZATION_LEGAL_ONLY}', NULL, 'Marchetti Capital Partners', '${INSTANT}', '${INSTANT}')`,
  );
  return database;
}

test("names a person and an organization from one call over both node tables", async () => {
  const names = await readEntityDisplayNames(seeded(), [PERSON, ORGANIZATION]);
  expect(names.get(PERSON)).toEqual({ kind: "person", displayName: "Dana Reyes" });
  expect(names.get(ORGANIZATION)).toEqual({ kind: "organization", displayName: "Coastal" });
});

test("falls back to the name parts, and to the legal name, when no display name is stored", async () => {
  const names = await readEntityDisplayNames(seeded(), [
    PERSON_PARTS_ONLY,
    ORGANIZATION_LEGAL_ONLY,
  ]);
  expect(names.get(PERSON_PARTS_ONLY)?.displayName).toBe("Ines Herrera");
  expect(names.get(ORGANIZATION_LEGAL_ONLY)?.displayName).toBe("Marchetti Capital Partners");
});

test("a record that exists and carries no name is present with a null name", async () => {
  // Distinct from being absent from the map, and the surface says two different things about them:
  // the Directory holds this record and nobody has named it.
  const names = await readEntityDisplayNames(seeded(), [PERSON_UNNAMED]);
  expect(names.has(PERSON_UNNAMED)).toBe(true);
  expect(names.get(PERSON_UNNAMED)).toEqual({ kind: "person", displayName: null });
});

test("an entity that does not resolve is absent rather than an error", async () => {
  // The conflicts log is append-only, so a hit can name an entity a later merge reshaped. Failing
  // the whole read would make one stale reference hide every other party on the check.
  const names = await readEntityDisplayNames(seeded(), [
    PERSON,
    "directoryPerson_merged_away",
    "directoryOrganization_gone",
  ]);
  expect(names.has(PERSON)).toBe(true);
  expect(names.has("directoryPerson_merged_away")).toBe(false);
  expect(names.has("directoryOrganization_gone")).toBe(false);
});

test("an id with an unknown prefix is skipped, never guessed into a table", async () => {
  const names = await readEntityDisplayNames(seeded(), ["matter_not_an_entity", "", PERSON]);
  expect([...names.keys()]).toEqual([PERSON]);
});

test("reads more entities than D1's bound-parameter cap by chunking them", async () => {
  // The cap is 100 per query. A check against a wide corpus surfaces more hits than that, and the
  // whole point of this read is that a hit list costs one query per node table rather than one per
  // row — so the bound has to be handled here rather than by the caller slicing its own hits.
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const ids = Array.from({ length: 250 }, (_, index) => `directoryPerson_bulk${index}`);
  const values = ids
    .map((id, index) => `('${id}', 'Person ${index}', NULL, NULL, '${INSTANT}', '${INSTANT}')`)
    .join(", ");
  raw.exec(
    `INSERT INTO directory_person (id, display_name, name_given, name_family, created_at, updated_at) VALUES ${values}`,
  );

  const names = await readEntityDisplayNames(database, ids);
  expect(names.size).toBe(250);
  expect(names.get("directoryPerson_bulk0")?.displayName).toBe("Person 0");
  expect(names.get("directoryPerson_bulk249")?.displayName).toBe("Person 249");
});

test("a repeated id is read once", async () => {
  // Several hits can name the same entity — a party reached directly and again through the graph —
  // and the read must not grow with the repetition.
  const names = await readEntityDisplayNames(seeded(), [PERSON, PERSON, PERSON, ORGANIZATION]);
  expect(names.size).toBe(2);
});
