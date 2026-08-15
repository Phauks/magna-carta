import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { createPerson } from "@magna-carta/directory/person";
import { createOrganization } from "@magna-carta/directory/organization";
import { createEdge } from "@magna-carta/directory/edges";
import { expect, test } from "vitest";
import { expandGraph, type ExpansionBudget } from "../src/expansion.ts";
import { DEFAULT_CLOSURE_CAP, type EdgeClassBudgets } from "../src/settings.ts";

const NOW = "2026-07-09T00:00:00.000Z";
const clock = { now: () => NOW };
const ACTOR = "user_actor" as UserId;

function writeOptions(seed: string) {
  return { clock, actorUserId: ACTOR, randomSource: seededRandomSource(seed) };
}

// A uniform budget across every budgeted class — the shape the shipped single `depth` integer meant,
// so the tests that predate typed budgets keep asserting exactly what they asserted.
function uniformBudget(
  hops: number,
  overrides: Partial<EdgeClassBudgets> = {},
  closureCap = DEFAULT_CLOSURE_CAP,
): ExpansionBudget {
  return {
    edgeClassBudgets: {
      control: hops,
      family: hops,
      representation: hops,
      ...overrides,
    },
    closureCap,
    asOf: NOW,
  };
}

async function graphDatabase(): Promise<BatchDatabase> {
  const { database } = createMigratedNodeDatabase("per-firm");
  return database as unknown as BatchDatabase;
}

test("a seed with no edges expands to itself at depth zero", async () => {
  const database = await graphDatabase();
  const options = writeOptions("solo");
  const personId = await createPerson(database, { given: "Solo", family: "Party" }, options);

  const expanded = await expandGraph(database, [personId], uniformBudget(1));
  expect(expanded.entities).toEqual([{ entityId: personId, path: [] }]);
  expect(expanded.truncation).toBeNull();
});

test("depth one reaches an org's principal and records the connecting path", async () => {
  const database = await graphDatabase();
  const options = writeOptions("principal");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(database, { given: "Ada", family: "Principal" }, options);
  await createEdge(
    database,
    {
      from: principalId,
      to: orgId,
      edgeType: "affiliation",
      role: "principal",
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const expanded = await expandGraph(database, [orgId], uniformBudget(1));
  const reached = expanded.entities.find((entity) => entity.entityId === principalId);
  expect(reached).toBeDefined();
  expect(reached?.path).toHaveLength(1);
  expect(reached?.path[0]?.edgeType).toBe("affiliation");
  expect(reached?.path[0]?.expiredAtCheck).toBe(false);
});

test("depth zero expands to the seeds only", async () => {
  const database = await graphDatabase();
  const options = writeOptions("depth-zero");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(database, { given: "Ada", family: "Principal" }, options);
  await createEdge(
    database,
    {
      from: principalId,
      to: orgId,
      edgeType: "affiliation",
      role: "principal",
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const expanded = await expandGraph(database, [orgId], uniformBudget(0));
  expect(expanded.entities.map((entity) => entity.entityId)).toEqual([orgId]);
});

test("corporate-family edges traverse transitively past the depth limit", async () => {
  const database = await graphDatabase();
  const options = writeOptions("corporate-closure");
  const parentId = await createOrganization(database, { legalName: "Parent Co" }, options);
  const childId = await createOrganization(database, { legalName: "Child Co" }, options);
  const grandchildId = await createOrganization(database, { legalName: "Grandchild Co" }, options);
  await createEdge(
    database,
    {
      from: parentId,
      to: childId,
      edgeType: "corporate_subsidiary",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );
  await createEdge(
    database,
    {
      from: childId,
      to: grandchildId,
      edgeType: "corporate_subsidiary",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  // depth 1 would stop at childId for an ordinary edge type; corporate closure reaches the grandchild.
  const expanded = await expandGraph(database, [parentId], uniformBudget(1));
  expect(expanded.entities.map((entity) => entity.entityId)).toContain(grandchildId);
});

test("a corporate chain longer than every hop budget is fully traversed", async () => {
  const database = await graphDatabase();
  const options = writeOptions("long-corporate-chain");
  const chain: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    chain.push(await createOrganization(database, { legalName: `Chain ${index} Co` }, options));
  }
  for (let index = 1; index < chain.length; index += 1) {
    await createEdge(
      database,
      {
        from: chain[index - 1] as never,
        to: chain[index] as never,
        edgeType: "corporate_successor",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      options,
    );
  }

  // Every budgeted class is zero: only the corporate class can move at all, and it must reach the end.
  const expanded = await expandGraph(database, [chain[0] as string], uniformBudget(0));
  expect(expanded.entities.map((entity) => entity.entityId).toSorted()).toEqual(chain.toSorted());
  expect(expanded.truncation).toBeNull();
});

test("a control edge two hops out is not traversed at a one-hop control budget", async () => {
  const database = await graphDatabase();
  const options = writeOptions("two-hop-control");
  const subject = await createOrganization(database, { legalName: "Subject Co" }, options);
  const principal = await createPerson(database, { given: "Pat", family: "Principal" }, options);
  const otherBoard = await createOrganization(database, { legalName: "Other Board Co" }, options);
  const edge = (from: string, to: string) =>
    createEdge(
      database,
      {
        from: from as never,
        to: to as never,
        edgeType: "affiliation",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      options,
    );
  await edge(principal, subject);
  await edge(principal, otherBoard);

  const expanded = await expandGraph(database, [subject], uniformBudget(1));
  const ids = expanded.entities.map((entity) => entity.entityId);
  // The adverse organization's principal is one control hop and is reached; the principal's OTHER
  // directorship is two, and is where the budget exists to stop.
  expect(ids).toContain(principal);
  expect(ids).not.toContain(otherBoard);
});

test("each edge class spends its own budget, so a family hop does not consume the control budget", async () => {
  const database = await graphDatabase();
  const options = writeOptions("per-class-budget");
  const subject = await createPerson(database, { given: "Sam", family: "Subject" }, options);
  const spouse = await createPerson(database, { given: "Sal", family: "Spouse" }, options);
  const employer = await createOrganization(database, { legalName: "Employer Co" }, options);
  await createEdge(
    database,
    {
      from: subject,
      to: spouse,
      edgeType: "relationship",
      role: "spouse",
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );
  await createEdge(
    database,
    {
      from: spouse,
      to: employer,
      edgeType: "affiliation",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const ids = (await expandGraph(database, [subject], uniformBudget(1))).entities.map(
    (entity) => entity.entityId,
  );
  // One family hop then one control hop: two edges, but one of each class, so both budgets hold.
  expect(ids).toContain(spouse);
  expect(ids).toContain(employer);

  // Zeroing the control class alone stops at the spouse, leaving the family budget untouched.
  const narrowed = (
    await expandGraph(database, [subject], uniformBudget(1, { control: 0 }))
  ).entities.map((entity) => entity.entityId);
  expect(narrowed).toContain(spouse);
  expect(narrowed).not.toContain(employer);
});

test("an expired edge is traversed and its expiry is recorded on the path step", async () => {
  const database = await graphDatabase();
  const options = writeOptions("expired-edge");
  const subject = await createPerson(database, { given: "Sam", family: "Subject" }, options);
  const formerSpouse = await createPerson(database, { given: "Fay", family: "Former" }, options);
  await createEdge(
    database,
    {
      from: subject,
      to: formerSpouse,
      edgeType: "relationship",
      role: "spouse",
      note: null,
      validFrom: "2020-01-01T00:00:00.000Z",
      // Ended well before the check reads the corpus.
      validTo: "2024-01-01T00:00:00.000Z",
    },
    options,
  );

  const expanded = await expandGraph(database, [subject], uniformBudget(1));
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
  await createEdge(
    database,
    {
      from: a,
      to: b,
      edgeType: "corporate_subsidiary",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );
  await createEdge(
    database,
    {
      from: b,
      to: a,
      edgeType: "corporate_parent",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const expanded = await expandGraph(database, [a], uniformBudget(5));
  expect(expanded.entities.map((entity) => entity.entityId).toSorted()).toEqual([a, b].toSorted());
});

test("a node reachable by a 0-hop corporate chain expands its onward edges even when a direct edge also reaches it", async () => {
  // The relaxation regression: S reaches X two ways — directly (1 representation hop) and through a
  // corporate chain S->A->X (0 hops, budget-free). Fixing X's cost on first discovery would prune X's
  // onward representation edge to Y at the budget boundary, silently dropping a real conflict at Y.
  // Keeping the Pareto-minimal cost vectors records X at its true zero cost, so X->Y is within budget.
  const database = await graphDatabase();
  const options = writeOptions("zero-one-bfs");
  const s = await createOrganization(database, { legalName: "Seed Co" }, options);
  const a = await createOrganization(database, { legalName: "Chain Co" }, options);
  const x = await createOrganization(database, { legalName: "Shared Co" }, options);
  const y = await createOrganization(database, { legalName: "Downstream Co" }, options);
  const edge = (from: string, to: string, edgeType: "representation" | "corporate_subsidiary") =>
    createEdge(
      database,
      {
        from: from as never,
        to: to as never,
        edgeType,
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      options,
    );
  await edge(s, x, "representation"); // direct: 1 representation hop
  await edge(s, a, "corporate_subsidiary"); // 0 hops
  await edge(a, x, "corporate_subsidiary"); // 0 hops — X is reachable at cost zero
  await edge(x, y, "representation"); // X's onward edge — must be walked within the 1-hop budget

  const expanded = await expandGraph(database, [s], uniformBudget(1));
  const ids = expanded.entities.map((entity) => entity.entityId);
  expect(ids).toContain(x);
  expect(ids).toContain(y);
});

test("expansion is deterministic across runs", async () => {
  const database = await graphDatabase();
  const options = writeOptions("determinism");
  const orgId = await createOrganization(database, { legalName: "ABC Holdings" }, options);
  const first = await createPerson(database, { given: "Ada", family: "One" }, options);
  const second = await createPerson(database, { given: "Bea", family: "Two" }, options);
  await createEdge(
    database,
    {
      from: first,
      to: orgId,
      edgeType: "affiliation",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );
  await createEdge(
    database,
    {
      from: second,
      to: orgId,
      edgeType: "affiliation",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const a = await expandGraph(database, [orgId], uniformBudget(1));
  const b = await expandGraph(database, [orgId], uniformBudget(1));
  expect(a.entities.map((entity) => entity.entityId)).toEqual(
    b.entities.map((entity) => entity.entityId),
  );
});

// A fan wide enough that the cap bites: one hub with many affiliated persons.
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
    await createEdge(
      database,
      {
        from: spoke,
        to: hub,
        edgeType: "affiliation",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      options,
    );
  }
  return hub;
}

test("reaching the closure cap stops expansion and records what was not searched", async () => {
  const database = await graphDatabase();
  const hub = await fanGraph(database, "cap", 30);

  const expanded = await expandGraph(database, [hub], uniformBudget(1, {}, 10));
  expect(expanded.entities).toHaveLength(10);
  const truncation = expanded.truncation;
  expect(truncation).not.toBeNull();
  expect(truncation?.entitiesReached).toBe(10);
  expect(truncation?.closureCap).toBe(10);
  // The refused neighbours were never matched, and the count says how many searches did not happen.
  expect(truncation?.unexploredFrontierSize).toBeGreaterThan(0);
});

test("a walk that fits under the cap records no truncation at all", async () => {
  const database = await graphDatabase();
  const hub = await fanGraph(database, "under-cap", 5);

  const expanded = await expandGraph(database, [hub], uniformBudget(1, {}, 500));
  expect(expanded.entities).toHaveLength(6);
  // Null rather than a truncation record with `truncated: false`: a completed walk has nothing to
  // report about a boundary it never met.
  expect(expanded.truncation).toBeNull();
});

test("the cap truncates the same set for the same corpus", async () => {
  const database = await graphDatabase();
  const hub = await fanGraph(database, "cap-determinism", 30);

  const first = await expandGraph(database, [hub], uniformBudget(1, {}, 12));
  const second = await expandGraph(database, [hub], uniformBudget(1, {}, 12));
  expect(first.entities.map((entity) => entity.entityId)).toEqual(
    second.entities.map((entity) => entity.entityId),
  );
  expect(first.truncation).toEqual(second.truncation);
});

test("a hub is never skipped for having many edges", async () => {
  // Degree-based hub suppression is refused: a bank or a registered agent on hundreds of edges is
  // exactly where a positional conflict lives. The hub itself is reached and matched however wide it
  // is; only the SIZE of the closure is bounded, and reaching that bound is recorded.
  const database = await graphDatabase();
  const hub = await fanGraph(database, "no-degree-suppression", 40);
  const options = writeOptions("no-degree-suppression-seed");
  const subject = await createPerson(database, { given: "Sub", family: "Ject" }, options);
  await createEdge(
    database,
    {
      from: subject,
      to: hub as never,
      edgeType: "affiliation",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const expanded = await expandGraph(database, [subject], uniformBudget(1, {}, 500));
  expect(expanded.entities.map((entity) => entity.entityId)).toContain(hub);
});
