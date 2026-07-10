import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { createPerson } from "@magna-carta/directory/person";
import { createOrganization } from "@magna-carta/directory/organization";
import { createEdge } from "@magna-carta/directory/edges";
import { expect, test } from "vitest";
import { expandGraph } from "../src/expansion.ts";

const clock = { now: () => "2026-07-09T00:00:00.000Z" };
const ACTOR = "user_actor" as UserId;

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

async function graphDatabase(): Promise<BatchDatabase> {
  const { database } = createMigratedNodeDatabase("per-firm");
  return database as unknown as BatchDatabase;
}

test("a seed with no edges expands to itself at depth zero", async () => {
  const database = await graphDatabase();
  const options = writeOptions("solo");
  const personId = await createPerson(database, { given: "Solo", family: "Party" }, options);

  const expanded = await expandGraph(database, [personId], 1);
  expect(expanded).toEqual([{ entityId: personId, path: [] }]);
});

test("depth one reaches an org's principal and records the connecting path", async () => {
  const database = await graphDatabase();
  const options = writeOptions("principal");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(database, { given: "Ada", family: "Principal" }, options);
  await createEdge(
    database,
    { from: principalId, to: orgId, edgeType: "affiliation", role: "principal", note: null, validFrom: null, validTo: null },
    options,
  );

  const expanded = await expandGraph(database, [orgId], 1);
  const reached = expanded.find((entity) => entity.entityId === principalId);
  expect(reached).toBeDefined();
  expect(reached?.path).toHaveLength(1);
  expect(reached?.path[0].edgeType).toBe("affiliation");
});

test("depth zero expands to the seeds only", async () => {
  const database = await graphDatabase();
  const options = writeOptions("depth-zero");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(database, { given: "Ada", family: "Principal" }, options);
  await createEdge(
    database,
    { from: principalId, to: orgId, edgeType: "affiliation", role: "principal", note: null, validFrom: null, validTo: null },
    options,
  );

  const expanded = await expandGraph(database, [orgId], 0);
  expect(expanded.map((entity) => entity.entityId)).toEqual([orgId]);
});

test("corporate-family edges traverse transitively past the depth limit", async () => {
  const database = await graphDatabase();
  const options = writeOptions("corporate-closure");
  const parentId = await createOrganization(database, { legalName: "Parent Co" }, options);
  const childId = await createOrganization(database, { legalName: "Child Co" }, options);
  const grandchildId = await createOrganization(database, { legalName: "Grandchild Co" }, options);
  await createEdge(database, { from: parentId, to: childId, edgeType: "corporate_subsidiary", role: null, note: null, validFrom: null, validTo: null }, options);
  await createEdge(database, { from: childId, to: grandchildId, edgeType: "corporate_subsidiary", role: null, note: null, validFrom: null, validTo: null }, options);

  // depth 1 would stop at childId for an ordinary edge type; corporate closure reaches the grandchild.
  const expanded = await expandGraph(database, [parentId], 1);
  expect(expanded.map((entity) => entity.entityId)).toContain(grandchildId);
});

test("a cycle terminates and records the first path found", async () => {
  const database = await graphDatabase();
  const options = writeOptions("cycle");
  const a = await createOrganization(database, { legalName: "Alpha" }, options);
  const b = await createOrganization(database, { legalName: "Beta" }, options);
  await createEdge(database, { from: a, to: b, edgeType: "corporate_subsidiary", role: null, note: null, validFrom: null, validTo: null }, options);
  await createEdge(database, { from: b, to: a, edgeType: "corporate_parent", role: null, note: null, validFrom: null, validTo: null }, options);

  const expanded = await expandGraph(database, [a], 5);
  expect(expanded.map((entity) => entity.entityId).sort()).toEqual([a, b].sort());
});

test("expansion is deterministic across runs", async () => {
  const database = await graphDatabase();
  const options = writeOptions("determinism");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const first = await createPerson(database, { given: "Ada", family: "One" }, options);
  const second = await createPerson(database, { given: "Bea", family: "Two" }, options);
  await createEdge(database, { from: first, to: orgId, edgeType: "affiliation", role: null, note: null, validFrom: null, validTo: null }, options);
  await createEdge(database, { from: second, to: orgId, edgeType: "affiliation", role: null, note: null, validFrom: null, validTo: null }, options);

  const a = await expandGraph(database, [orgId], 1);
  const b = await expandGraph(database, [orgId], 1);
  expect(a.map((entity) => entity.entityId)).toEqual(b.map((entity) => entity.entityId));
});
