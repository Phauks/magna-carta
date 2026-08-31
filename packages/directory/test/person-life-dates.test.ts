import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { DirectoryPersonId, UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import {
  createPerson,
  InvalidPersonLifeDatesError,
  readPerson,
  setPersonLifeDates,
} from "../src/person.ts";

const clock = { now: () => "2026-08-30T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

async function seedPerson(database: BatchDatabase, seed: string): Promise<DirectoryPersonId> {
  return createPerson(database, { given: "Ada", family: "Doe" }, writeOptions(seed));
}

test("a date of birth is stored, read back, and can be asked a range question", async () => {
  const database = freshDatabase();
  const adult = await seedPerson(database, "adult");
  const child = await seedPerson(database, "child");

  await setPersonLifeDates(database, adult, { dateOfBirth: "1971-04-02" }, writeOptions("a"));
  await setPersonLifeDates(database, child, { dateOfBirth: "2014-11-30" }, writeOptions("c"));

  expect((await readPerson(database, adult)).dateOfBirth).toBe("1971-04-02");

  // The whole point of the column: this question could not be asked of a sealed identifier at all.
  const { results } = await database
    .prepare(
      "SELECT id FROM directory_person WHERE date_of_birth > ?1 AND deleted_at IS NULL ORDER BY id",
    )
    .bind("2008-08-30")
    .all<{ id: string }>();
  expect(results.map((row) => row.id)).toEqual([child]);
});

test("a recorded date of death implies the deceased flag", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "decedent");
  await setPersonLifeDates(database, personId, { dateOfDeath: "2026-01-09" }, writeOptions("d"));

  const person = await readPerson(database, personId);
  expect(person.dateOfDeath).toBe("2026-01-09");
  expect(person.deceased).toBe(true);
});

test("known dead with no date is a state the record can hold", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "unknown-date");
  await setPersonLifeDates(database, personId, { deceased: true }, writeOptions("k"));

  const person = await readPerson(database, personId);
  expect(person.deceased).toBe(true);
  expect(person.dateOfDeath).toBeNull();
});

test("an omitted field keeps its value and an explicit null clears it", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "clearing");
  await setPersonLifeDates(
    database,
    personId,
    { dateOfBirth: "1971-04-02", dateOfDeath: "2026-01-09" },
    writeOptions("set"),
  );

  await setPersonLifeDates(database, personId, { dateOfBirth: "1971-04-03" }, writeOptions("edit"));
  expect((await readPerson(database, personId)).dateOfDeath).toBe("2026-01-09");

  await setPersonLifeDates(
    database,
    personId,
    { dateOfDeath: null, deceased: false },
    writeOptions("clear"),
  );
  const cleared = await readPerson(database, personId);
  expect(cleared.dateOfDeath).toBeNull();
  expect(cleared.deceased).toBe(false);
  expect(cleared.dateOfBirth).toBe("1971-04-03");
});

test("a date that names no day, and a death before a birth, are both refused", async () => {
  const database = freshDatabase();
  const personId = await seedPerson(database, "bad-dates");

  await expect(
    setPersonLifeDates(database, personId, { dateOfBirth: "2026-02-30" }, writeOptions("no-day")),
  ).rejects.toBeInstanceOf(InvalidPersonLifeDatesError);
  await expect(
    setPersonLifeDates(database, personId, { dateOfBirth: "02/04/1971" }, writeOptions("shape")),
  ).rejects.toBeInstanceOf(InvalidPersonLifeDatesError);
  await expect(
    setPersonLifeDates(
      database,
      personId,
      { dateOfBirth: "1971-04-02", dateOfDeath: "1970-01-01" },
      writeOptions("order"),
    ),
  ).rejects.toBeInstanceOf(InvalidPersonLifeDatesError);
  await expect(
    setPersonLifeDates(
      database,
      personId,
      { dateOfDeath: "2026-01-09", deceased: false },
      writeOptions("contradiction"),
    ),
  ).rejects.toBeInstanceOf(InvalidPersonLifeDatesError);
});
