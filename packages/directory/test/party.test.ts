import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { createPerson } from "../src/person.ts";
import {
  createPartyRole,
  linkMatterParty,
  listPartyRoles,
  readMatterParties,
} from "../src/party.ts";

const clock = { now: () => "2026-06-17T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

// Seed the member + matter rows matter_party.matter_id / matter.responsible_member_id reference —
// both are real foreign keys enforced in the test database.
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

test("linkMatterParty supports many-hats (one entity, several roles)", async () => {
  const database = freshDatabase();
  await seedMatter(database, "mat_hats");
  const personId = await createPerson(
    database,
    { given: "Robin", family: "Ward" },
    { clock, actorUserId: ACTOR, randomSource: seededRandomSource("t14-hats-person") },
  );

  await linkMatterParty(
    database,
    { matterId: "mat_hats", entityId: personId, role: "client" },
    { clock, actorUserId: ACTOR, randomSource: seededRandomSource("t14-hats-1") },
  );
  await linkMatterParty(
    database,
    { matterId: "mat_hats", entityId: personId, role: "guardian" },
    { clock, actorUserId: ACTOR, randomSource: seededRandomSource("t14-hats-2") },
  );

  const parties = await readMatterParties(database, "mat_hats");
  expect(parties).toHaveLength(2);
  expect(parties.map((party) => party.role).sort()).toEqual(["client", "guardian"]);
  // One entity wearing two hats — both rows point at the same entity.
  expect(parties.every((party) => party.entityId === personId)).toBe(true);
});

test("createPartyRole mints a directoryPartyRole_ id and listPartyRoles returns it", async () => {
  const database = freshDatabase();
  const { id } = await createPartyRole(
    database,
    { name: "Witness", position: 3 },
    { clock, actorUserId: ACTOR, randomSource: seededRandomSource("t14-role") },
  );
  expect(id.startsWith("directoryPartyRole_")).toBe(true);

  const roles = await listPartyRoles(database);
  expect(roles).toHaveLength(1);
  expect(roles[0]?.name).toBe("Witness");
  expect(roles[0]?.position).toBe(3);
});

test("listPartyRoles orders by position and excludes archived roles", async () => {
  const database = freshDatabase();
  await createPartyRole(
    database,
    { name: "Expert", position: 2 },
    { clock, actorUserId: ACTOR, randomSource: seededRandomSource("t14-role-expert") },
  );
  await createPartyRole(
    database,
    { name: "Client", position: 1 },
    { clock, actorUserId: ACTOR, randomSource: seededRandomSource("t14-role-client") },
  );
  await database
    .prepare(
      `INSERT INTO directory_party_role (id, name, archived, position) VALUES ('directoryPartyRole_archived', 'Old', 1, 0)`,
    )
    .run();

  const roles = await listPartyRoles(database);
  expect(roles.map((role) => role.name)).toEqual(["Client", "Expert"]);
});
