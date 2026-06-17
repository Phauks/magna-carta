import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { expect, test } from "vitest";
import { createEdge, readEdges } from "../src/edges.ts";
import { createOrganization } from "../src/organization.ts";
import { createPerson } from "../src/person.ts";

// Fixed clock for deterministic tests.
const clock = { now: () => "2026-06-17T00:00:00.000Z" };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

test("createEdge accepts all EdgeType values and validates endpoints", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t10-main");

  const personId = await createPerson(
    database,
    { given: "Ann", family: "Lee" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );
  const organizationId = await createOrganization(
    database,
    { legalName: "Acme LLC" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );

  const edgeId = await createEdge(
    database,
    {
      from: personId,
      to: organizationId,
      edgeType: "affiliation",
      role: "principal",
      note: null,
      validFrom: null,
      validTo: null,
    },
    { clock, actorUserId: null, randomSource },
  );

  expect(edgeId).toMatch(/^directoryEdge_/);

  const edges = await readEdges(database, personId);
  expect(edges.map((e) => e.edgeType)).toContain("affiliation");
  expect(edges.find((e) => e.id === edgeId)?.role).toBe("principal");
});

test("createEdge writes an audit row for directory.edge.created", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t10-audit");

  const personId = await createPerson(
    database,
    { given: "Bob", family: "Brown" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );
  const organizationId = await createOrganization(
    database,
    { legalName: "Beta Corp" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );

  const edgeId = await createEdge(
    database,
    {
      from: personId,
      to: organizationId,
      edgeType: "representation",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    { clock, actorUserId: null, randomSource },
  );

  const { results: audit } = await database
    .prepare("SELECT event, subject_id FROM audit_log WHERE event = 'directory.edge.created'")
    .all<{ event: string; subject_id: string }>();

  expect(audit).toHaveLength(1);
  expect(audit[0]?.event).toBe("directory.edge.created");
  expect(audit[0]?.subject_id).toBe(edgeId);
});

test("readEdges returns both inbound and outbound active edges", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t10-edges");

  const personId = await createPerson(
    database,
    { given: "Carol", family: "Jones" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );
  const org1Id = await createOrganization(
    database,
    { legalName: "Org One" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );
  const org2Id = await createOrganization(
    database,
    { legalName: "Org Two" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );

  // person → org1 (outbound from person)
  await createEdge(
    database,
    {
      from: personId,
      to: org1Id,
      edgeType: "affiliation",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    { clock, actorUserId: null, randomSource },
  );
  // org2 → person (inbound to person)
  await createEdge(
    database,
    {
      from: org2Id,
      to: personId,
      edgeType: "role_assignment",
      role: null,
      note: null,
      validFrom: null,
      validTo: null,
    },
    { clock, actorUserId: null, randomSource },
  );

  const edges = await readEdges(database, personId);
  expect(edges).toHaveLength(2);

  const types = edges.map((e) => e.edgeType).sort();
  expect(types).toContain("affiliation");
  expect(types).toContain("role_assignment");
});

test("rejects an unknown edge type with invalid-edge-type", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t10-invalid-type");

  const personId = await createPerson(
    database,
    { given: "Dave", family: "Gray" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );
  const organizationId = await createOrganization(
    database,
    { legalName: "Gamma Inc" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );

  await expect(
    createEdge(
      database,
      {
        from: personId,
        to: organizationId,
        edgeType: "bogus" as never,
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      { clock, actorUserId: null, randomSource },
    ),
  ).rejects.toMatchObject({ code: "invalid-edge-type" });
});

test("rejects a non-existent from-endpoint with unknown-entity", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t10-missing-from");

  const organizationId = await createOrganization(
    database,
    { legalName: "Delta Ltd" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );

  await expect(
    createEdge(
      database,
      {
        from: "directoryPerson_doesnotexist" as never,
        to: organizationId,
        edgeType: "affiliation",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      { clock, actorUserId: null, randomSource },
    ),
  ).rejects.toMatchObject({ code: "unknown-entity" });
});

test("rejects a non-existent to-endpoint with unknown-entity", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t10-missing-to");

  const personId = await createPerson(
    database,
    { given: "Eve", family: "White" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );

  await expect(
    createEdge(
      database,
      {
        from: personId,
        to: "directoryOrganization_doesnotexist" as never,
        edgeType: "corporate_parent",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      { clock, actorUserId: null, randomSource },
    ),
  ).rejects.toMatchObject({ code: "unknown-entity" });
});

test("rejects a soft-deleted endpoint with unknown-entity", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t10-deleted");

  const personId = await createPerson(
    database,
    { given: "Frank", family: "Black" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );
  const organizationId = await createOrganization(
    database,
    { legalName: "Epsilon LLC" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );

  // Soft-delete the person by setting deleted_at directly in the DB.
  await database
    .prepare("UPDATE directory_person SET deleted_at = ?1 WHERE id = ?2")
    .bind("2026-06-17T00:00:00.000Z", personId)
    .run();

  await expect(
    createEdge(
      database,
      {
        from: personId,
        to: organizationId,
        edgeType: "affiliation",
        role: null,
        note: null,
        validFrom: null,
        validTo: null,
      },
      { clock, actorUserId: null, randomSource },
    ),
  ).rejects.toMatchObject({ code: "unknown-entity" });
});

test("createEdge supports all seven EdgeType values", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t10-all-types");

  const personId = await createPerson(
    database,
    { given: "Gina", family: "Clark" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );
  const organizationId = await createOrganization(
    database,
    { legalName: "Zeta Corp" },
    {
      clock,
      actorUserId: null,
      randomSource,
    },
  );

  const allEdgeTypes = [
    "affiliation",
    "relationship",
    "corporate_parent",
    "corporate_subsidiary",
    "corporate_successor",
    "representation",
    "role_assignment",
  ] as const;

  for (const edgeType of allEdgeTypes) {
    await expect(
      createEdge(
        database,
        {
          from: personId,
          to: organizationId,
          edgeType,
          role: null,
          note: null,
          validFrom: null,
          validTo: null,
        },
        { clock, actorUserId: null, randomSource },
      ),
    ).resolves.toMatch(/^directoryEdge_/);
  }
});
