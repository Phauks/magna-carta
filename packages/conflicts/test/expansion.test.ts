import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { createPerson } from "@magna-carta/directory/person";
import { createOrganization } from "@magna-carta/directory/organization";
import { createEdge } from "@magna-carta/directory/edges";
import { expect, test } from "vitest";
import { expandGraph, WALK_CEILING, type ExpansionOptions } from "../src/expansion.ts";

// The walk follows every recorded relationship to closure. What is worth a test is that it really
// does — every class, every hop, ended relationships included — and that the one bound it has, the
// platform's ceiling, is recorded when reached and never applied quietly.

const NOW = "2026-07-09T00:00:00.000Z";
const clock = { now: () => NOW };
const ACTOR = "user_actor" as UserId;

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

function walk(ceiling = WALK_CEILING): ExpansionOptions {
  return { asOf: NOW, ceiling };
}

async function graphDatabase(): Promise<BatchDatabase> {
  const { database } = createMigratedNodeDatabase("per-firm");
  return database as unknown as BatchDatabase;
}

type Edge = Parameters<typeof createEdge>[1];

function edge(from: string, to: string, edgeType: string, over: Partial<Edge> = {}): Edge {
  return {
    from,
    to,
    edgeType,
    role: null,
    note: null,
    validFrom: null,
    validTo: null,
    ...over,
  } as Edge;
}

test("a seed with no edges expands to itself", async () => {
  const database = await graphDatabase();
  const options = writeOptions("solo");
  const personId = await createPerson(database, { given: "Solo", family: "Party" }, options);

  const expanded = await expandGraph(database, [personId], walk());
  expect(expanded.entities).toEqual([{ entityId: personId, path: [] }]);
  expect(expanded.truncation).toBeNull();
  expect(expanded.longestPathLength).toBe(0);
});

test("one hop reaches an organization's principal and records the connecting path", async () => {
  const database = await graphDatabase();
  const options = writeOptions("principal");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(database, { given: "Ada", family: "Principal" }, options);
  await createEdge(
    database,
    edge(principalId, orgId, "affiliation", { role: "principal" }),
    options,
  );

  const expanded = await expandGraph(database, [orgId], walk());
  const reached = expanded.entities.find((entity) => entity.entityId === principalId);
  expect(reached).toBeDefined();
  expect(reached?.path).toHaveLength(1);
  expect(reached?.path[0]?.edgeType).toBe("affiliation");
  expect(reached?.path[0]?.expiredAtCheck).toBe(false);
  expect(expanded.longestPathLength).toBe(1);
});

test("a corporate chain of any length is fully traversed", async () => {
  const database = await graphDatabase();
  const options = writeOptions("corporate-closure");
  const parentId = await createOrganization(database, { legalName: "Parent Co" }, options);
  const childId = await createOrganization(database, { legalName: "Child Co" }, options);
  const grandchildId = await createOrganization(database, { legalName: "Grandchild Co" }, options);
  await createEdge(database, edge(parentId, childId, "corporate_subsidiary"), options);
  await createEdge(database, edge(childId, grandchildId, "corporate_subsidiary"), options);

  const expanded = await expandGraph(database, [parentId], walk());
  expect(expanded.entities.map((entity) => entity.entityId)).toContain(grandchildId);
  expect(expanded.longestPathLength).toBe(2);
});

test("a control edge two hops out is reached, because nothing budgets a class any more", async () => {
  // The case the old per-class budget existed to STOP — a subject's principal's other directorship
  // — is exactly the case the owner's ruling reaches for: a limit on the walk is a conflict the
  // firm does not find.
  const database = await graphDatabase();
  const options = writeOptions("two-hops");
  const subject = await createOrganization(database, { legalName: "Subject Co" }, options);
  const principal = await createPerson(database, { given: "Pat", family: "Principal" }, options);
  const otherBoard = await createOrganization(database, { legalName: "Other Board Co" }, options);
  await createEdge(database, edge(principal, subject, "director_of"), options);
  await createEdge(database, edge(principal, otherBoard, "director_of"), options);

  const expanded = await expandGraph(database, [subject], walk());
  const ids = expanded.entities.map((entity) => entity.entityId);
  expect(ids).toContain(principal);
  expect(ids).toContain(otherBoard);
  const reached = expanded.entities.find((entity) => entity.entityId === otherBoard);
  expect(reached?.path.map((step) => step.edgeType)).toEqual(["director_of", "director_of"]);
});

test("a family hop followed by a control hop is walked through both classes", async () => {
  const database = await graphDatabase();
  const options = writeOptions("mixed-classes");
  const subject = await createPerson(database, { given: "Sam", family: "Subject" }, options);
  const spouse = await createPerson(database, { given: "Sky", family: "Spouse" }, options);
  const employer = await createOrganization(database, { legalName: "Employer Co" }, options);
  await createEdge(database, edge(subject, spouse, "relationship", { role: "spouse" }), options);
  await createEdge(database, edge(spouse, employer, "employment"), options);

  const ids = (await expandGraph(database, [subject], walk())).entities.map(
    (entity) => entity.entityId,
  );
  expect(ids).toContain(spouse);
  expect(ids).toContain(employer);
});

test("an expired edge is traversed and its expiry is recorded on the path step", async () => {
  const database = await graphDatabase();
  const options = writeOptions("expired-edge");
  const subject = await createPerson(database, { given: "Sam", family: "Subject" }, options);
  const formerSpouse = await createPerson(database, { given: "Fay", family: "Former" }, options);
  await createEdge(
    database,
    edge(subject, formerSpouse, "relationship", {
      role: "spouse",
      validFrom: "2020-01-01T00:00:00.000Z",
      // Ended well before the check reads the corpus.
      validTo: "2024-01-01T00:00:00.000Z",
    }),
    options,
  );

  const expanded = await expandGraph(database, [subject], walk());
  const reached = expanded.entities.find((entity) => entity.entityId === formerSpouse);
  // The rules on FORMER clients and FORMER relationships are the ones that most often decide a
  // conflict, so an ended relationship is walked, not skipped — and the reviewer is told it ended.
  expect(reached).toBeDefined();
  expect(reached?.path[0]?.expiredAtCheck).toBe(true);
});

test("a cycle terminates and records the first path found", async () => {
  const database = await graphDatabase();
  const options = writeOptions("cycle");
  const a = await createOrganization(database, { legalName: "Alpha" }, options);
  const b = await createOrganization(database, { legalName: "Beta" }, options);
  await createEdge(database, edge(a, b, "corporate_subsidiary"), options);
  await createEdge(database, edge(b, a, "corporate_parent"), options);

  const expanded = await expandGraph(database, [a], walk());
  expect(expanded.entities.map((entity) => entity.entityId).toSorted()).toEqual([a, b].toSorted());
  expect(expanded.truncation).toBeNull();
});

test("an entity reached two ways is shown under the shortest path", async () => {
  const database = await graphDatabase();
  const options = writeOptions("shortest");
  const subject = await createOrganization(database, { legalName: "Subject Co" }, options);
  const middle = await createOrganization(database, { legalName: "Middle Co" }, options);
  const target = await createOrganization(database, { legalName: "Target Co" }, options);
  await createEdge(database, edge(subject, middle, "corporate_subsidiary"), options);
  await createEdge(database, edge(middle, target, "corporate_subsidiary"), options);
  await createEdge(database, edge(subject, target, "affiliation"), options);

  const expanded = await expandGraph(database, [subject], walk());
  const reached = expanded.entities.find((entity) => entity.entityId === target);
  expect(reached?.path).toHaveLength(1);
});

test("expansion is deterministic across runs", async () => {
  const database = await graphDatabase();
  const options = writeOptions("determinism");
  const orgId = await createOrganization(database, { legalName: "Determined Co" }, options);
  const first = await createPerson(database, { given: "Al", family: "One" }, options);
  const second = await createPerson(database, { given: "Bea", family: "Two" }, options);
  await createEdge(database, edge(first, orgId, "affiliation"), options);
  await createEdge(database, edge(second, orgId, "affiliation"), options);

  const a = await expandGraph(database, [orgId], walk());
  const b = await expandGraph(database, [orgId], walk());
  expect(a.entities.map((entity) => entity.entityId)).toEqual(
    b.entities.map((entity) => entity.entityId),
  );
});

// A fan wide enough that a small ceiling bites: one hub with many affiliated persons.
async function fanGraph(
  database: BatchDatabase,
  seed: string,
  spokeCount: number,
): Promise<string> {
  const options = writeOptions(seed);
  const hub = await createOrganization(database, { legalName: "Hub Co" }, options);
  for (let index = 0; index < spokeCount; index += 1) {
    const spoke = await createPerson(
      database,
      { given: "Spoke", family: `Number${index}` },
      options,
    );
    await createEdge(database, edge(spoke, hub, "affiliation"), options);
  }
  return hub;
}

test("reaching the ceiling stops expansion and records what was not searched", async () => {
  const database = await graphDatabase();
  const hub = await fanGraph(database, "ceiling", 30);

  const expanded = await expandGraph(database, [hub], walk(10));
  expect(expanded.entities).toHaveLength(10);
  const truncation = expanded.truncation;
  expect(truncation).not.toBeNull();
  expect(truncation?.entitiesReached).toBe(10);
  expect(truncation?.ceiling).toBe(10);
  // The refused neighbours were never matched, and the count says how many searches did not happen.
  expect(truncation?.unexploredFrontierSize).toBeGreaterThan(0);
});

test("a walk that fits under the ceiling records no truncation at all", async () => {
  const database = await graphDatabase();
  const hub = await fanGraph(database, "under-ceiling", 5);

  const expanded = await expandGraph(database, [hub], walk());
  expect(expanded.entities).toHaveLength(6);
  // Null rather than a truncation record with `truncated: false`: a completed walk has nothing to
  // report about a boundary it never met.
  expect(expanded.truncation).toBeNull();
});

test("the ceiling truncates the same set for the same corpus", async () => {
  const database = await graphDatabase();
  const hub = await fanGraph(database, "ceiling-determinism", 30);

  const first = await expandGraph(database, [hub], walk(12));
  const second = await expandGraph(database, [hub], walk(12));
  expect(first.entities.map((entity) => entity.entityId)).toEqual(
    second.entities.map((entity) => entity.entityId),
  );
  expect(first.truncation).toEqual(second.truncation);
});

test("the platform ceiling is the default, and nothing about a request can lower it", () => {
  // The ceiling is a constant, not a setting: a firm cannot set it, and a check's request has no
  // field for it. An order of magnitude past a real corporate group, so it is met only by a walk
  // that has left the neighbourhood of any matter.
  expect(WALK_CEILING).toBe(10_000);
});

test("a hub is never skipped for having many edges", async () => {
  // Degree-based hub suppression is refused: a bank or a registered agent on hundreds of edges is
  // exactly where a positional conflict lives. The hub itself is reached and matched however wide it
  // is; only the SIZE of the closure is bounded, and reaching that bound is recorded.
  const database = await graphDatabase();
  const hub = await fanGraph(database, "no-degree-suppression", 40);
  const options = writeOptions("no-degree-suppression-seed");
  const subject = await createPerson(database, { given: "Sub", family: "Ject" }, options);
  await createEdge(database, edge(subject, hub, "affiliation"), options);

  const expanded = await expandGraph(database, [subject], walk());
  expect(expanded.entities.map((entity) => entity.entityId)).toContain(hub);
  expect(expanded.entities).toHaveLength(42);
});

test("each round of the walk reports how far it has got", async () => {
  const database = await graphDatabase();
  const hub = await fanGraph(database, "progress", 4);
  const reports: number[] = [];
  await expandGraph(database, [hub], {
    asOf: NOW,
    onRound: (reached) => void reports.push(reached),
  });
  // One report per round, each carrying the running total: the seeds' round, then the spokes'.
  expect(reports.at(-1)).toBe(5);
  expect(reports.every((reached, index) => index === 0 || reached >= reports[index - 1]!)).toBe(
    true,
  );
});
