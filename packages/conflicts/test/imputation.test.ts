import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { createPerson } from "@magna-carta/directory/person";
import { linkMatterParty } from "@magna-carta/directory/party";
import { expect, test } from "vitest";
import { findImputationHits, findMemberEntities } from "../src/imputation.ts";

const clock = { now: () => "2026-07-09T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;
const MATTER = "matter_1";

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

// createMigratedNodeDatabase's `database` handle is the async D1-shaped adapter used by the domain
// write paths (createPerson, linkMatterParty); it has no synchronous exec. Seeding raw rows the tests
// need up front (the matter shell, and each test's member row) goes through `raw`, the underlying
// node:sqlite handle, instead.
async function imputationDatabase() {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  // matter.responsible_member_id is NOT NULL, so the matter's owning member must exist first — a
  // distinct id from the personnel each test seeds below.
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Actor', 'active', '${clock.now()}')`,
  );
  raw.exec(
    `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at) VALUES ('${MATTER}', 'Test Matter', 'open', '${ACTOR}', '${clock.now()}', '${clock.now()}')`,
  );
  return { database: database as unknown as BatchDatabase, raw };
}

test("a member linked to a matter party surfaces as an imputation hit", async () => {
  const { database, raw } = await imputationDatabase();
  const options = writeOptions("member-is-party");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_partner', 'Ada Partner', 'active', '${clock.now()}')`,
  );
  const personId = await createPerson(database, { given: "Ada", family: "Partner" }, options);
  raw.exec(`UPDATE directory_person SET member_id = 'user_partner' WHERE id = '${personId}'`);
  await linkMatterParty(
    database,
    { matterId: MATTER, entityId: personId, role: "opposing_party" },
    options,
  );

  const hits = await findImputationHits(database, [MATTER]);
  expect(hits).toHaveLength(1);
  // The length assertion above is what makes these indexed reads safe.
  expect(hits[0]!.memberUserId).toBe("user_partner");
  expect(hits[0]!.role).toBe("opposing_party");
});

// The "Smith Law" regression: a firm partner sharing a surname with a client is not a conflict.
// Imputation matches by identity, never by name similarity.
test("a member whose name merely resembles a party produces no imputation hit", async () => {
  const { database, raw } = await imputationDatabase();
  const options = writeOptions("smith-law");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_founder', 'John Smith', 'active', '${clock.now()}')`,
  );
  // A client with the same surname, NOT linked to any member.
  const clientId = await createPerson(database, { given: "Jane", family: "Smith" }, options);
  await linkMatterParty(
    database,
    { matterId: MATTER, entityId: clientId, role: "client" },
    options,
  );

  const hits = await findImputationHits(database, [MATTER]);
  expect(hits).toEqual([]);
});

test("a deactivated member still imputes", async () => {
  const { database, raw } = await imputationDatabase();
  const options = writeOptions("deactivated");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_former', 'Bea Former', 'deactivated', '${clock.now()}')`,
  );
  const personId = await createPerson(database, { given: "Bea", family: "Former" }, options);
  raw.exec(`UPDATE directory_person SET member_id = 'user_former' WHERE id = '${personId}'`);
  await linkMatterParty(
    database,
    { matterId: MATTER, entityId: personId, role: "witness" },
    options,
  );

  // Rule 1.10 imputation does not lapse when a lawyer leaves; the conflict remains the firm's.
  const hits = await findImputationHits(database, [MATTER]);
  expect(hits).toHaveLength(1);
});

test("a soft-deleted matter party does not impute", async () => {
  const { database, raw } = await imputationDatabase();
  const options = writeOptions("soft-deleted");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_partner', 'Ada Partner', 'active', '${clock.now()}')`,
  );
  const personId = await createPerson(database, { given: "Ada", family: "Partner" }, options);
  raw.exec(`UPDATE directory_person SET member_id = 'user_partner' WHERE id = '${personId}'`);
  await linkMatterParty(
    database,
    { matterId: MATTER, entityId: personId, role: "client" },
    options,
  );
  raw.exec(`UPDATE matter_party SET deleted_at = '${clock.now()}' WHERE matter_id = '${MATTER}'`);

  const hits = await findImputationHits(database, [MATTER]);
  expect(hits).toEqual([]);
});

// With no matter named, Firm Employees asks whether anybody the check reached IS one of the firm's
// own people — the same identity join, over the reached entities instead of a matter's parties.
test("a reached entity linked to a member is found without any matter", async () => {
  const { database, raw } = await imputationDatabase();
  const options = writeOptions("member-reached");
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('user_partner', 'Ada Partner', 'active', '${clock.now()}')`,
  );
  const memberPerson = await createPerson(database, { given: "Ada", family: "Partner" }, options);
  raw.exec(`UPDATE directory_person SET member_id = 'user_partner' WHERE id = '${memberPerson}'`);
  const stranger = await createPerson(database, { given: "Ada", family: "Partner" }, options);

  const found = await findMemberEntities(database, [stranger, memberPerson]);
  // Identity, not name: the stranger shares every letter of the name and is not found.
  expect(found).toEqual([{ memberUserId: "user_partner", entityId: memberPerson }]);
});

test("the member lookup reads a closure larger than one query's parameters", async () => {
  const { database } = await imputationDatabase();
  const many = Array.from({ length: 1_200 }, (_, index) => `person_unknown${String(index)}`);
  await expect(findMemberEntities(database, many)).resolves.toEqual([]);
});
