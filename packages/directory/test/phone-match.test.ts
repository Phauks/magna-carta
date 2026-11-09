import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { addPhone, removePhone } from "../src/contact-phone.ts";
import { createOrganization } from "../src/organization.ts";
import { createPerson } from "../src/person.ts";
import { findEntitiesByPhoneNumber } from "../src/phone-match.ts";

const clock = { now: () => "2026-11-09T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;
const NUMBER = { countryCallingCode: "1", nationalNumber: "7025550142" };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

async function personWithNumber(
  database: BatchDatabase,
  seed: string,
  family: string,
  number: string,
): Promise<{ personId: string; phoneId: string }> {
  const personId = await createPerson(
    database,
    { given: "Ada", family },
    writeOptions(`${seed}-person`),
  );
  const phoneId = await addPhone(
    database,
    { entityId: personId, number, contactSystem: "voice", contactUse: "mobile" },
    writeOptions(`${seed}-phone`),
  );
  return { personId, phoneId };
}

test("a number typed any of the ways people write it finds the contact who has it", async () => {
  const database = freshDatabase();
  const international = await personWithNumber(database, "a", "Plus", "+1 (702) 555-0142");
  const domestic = await personWithNumber(database, "b", "Bare", "702-555-0142");
  const leadingOne = await personWithNumber(database, "c", "One", "1 702 555 0142");
  await personWithNumber(database, "d", "Other", "+1 702 555 0199");

  const matches = await findEntitiesByPhoneNumber(database, NUMBER);
  expect(matches.map((match) => match.entityId).toSorted()).toEqual(
    [international.personId, domestic.personId, leadingOne.personId].toSorted(),
  );
  expect(matches.find((match) => match.entityId === international.personId)?.displayName).toBe(
    "Ada Plus",
  );
});

test("an organization's switchboard is a match like a person's line", async () => {
  const database = freshDatabase();
  const organizationId = await createOrganization(
    database,
    { legalName: "Whitfield Holdings LLC" },
    writeOptions("org"),
  );
  await addPhone(
    database,
    {
      entityId: organizationId,
      number: "+17025550142",
      contactSystem: "voice",
      contactUse: "work",
    },
    writeOptions("org-phone"),
  );
  const matches = await findEntitiesByPhoneNumber(database, NUMBER);
  expect(matches).toHaveLength(1);
  expect(matches[0]?.entityKind).toBe("organization");
});

test("a removed number matches nobody", async () => {
  const database = freshDatabase();
  const { phoneId } = await personWithNumber(database, "gone", "Gone", "+1 702 555 0142");
  await removePhone(database, phoneId, writeOptions("remove"));
  expect(await findEntitiesByPhoneNumber(database, NUMBER)).toEqual([]);
});

test("a number nobody has recorded answers an empty list, not a guess", async () => {
  const database = freshDatabase();
  expect(await findEntitiesByPhoneNumber(database, NUMBER)).toEqual([]);
});
