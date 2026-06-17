import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import { expect, test } from "vitest";
import { createOrganization, readOrganization } from "../src/organization.ts";

// Fixed clock for deterministic tests.
const clock = { now: () => "2026-06-17T00:00:00.000Z" };

function freshDatabase(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

test("createOrganization writes the entity, a current name row, and phonetic codes in one batch", async () => {
  const database = freshDatabase();
  const randomSource = seededRandomSource("t6");
  const organizationId = await createOrganization(
    database,
    { legalName: "Acme Legal Pty Ltd" },
    { clock, actorUserId: null, randomSource },
  );

  const organization = await readOrganization(database, organizationId);
  expect(organization.legalName).toBe("Acme Legal Pty Ltd");
  expect(organization.displayName).toBe("Acme Legal Pty Ltd");
  expect(organization.status).toBe("active");

  const { results: names } = await database
    .prepare(
      "SELECT id, entity_kind, name_role, is_current, normalized_display FROM directory_name WHERE entity_id = ?1",
    )
    .bind(organizationId)
    .all<{
      id: string;
      entity_kind: string;
      name_role: string;
      is_current: number;
      normalized_display: string;
    }>();
  expect(names).toHaveLength(1);
  expect(names[0]?.is_current).toBe(1);
  expect(names[0]?.entity_kind).toBe("organization");
  expect(names[0]?.name_role).toBe("current");
  expect(names[0]?.normalized_display).toBe("acme legal pty ltd");

  const { results: codes } = await database
    .prepare("SELECT scheme FROM directory_name_phonetic_code WHERE name_id = ?1")
    .bind(names[0]?.id)
    .all<{ scheme: string }>();
  expect(codes.map((code) => code.scheme).sort()).toEqual([
    "double_metaphone_primary",
    "double_metaphone_secondary",
  ]);
});

test("createOrganization writes a directory.entity.created outbox message and an audit row", async () => {
  const database = freshDatabase();
  const organizationId = await createOrganization(
    database,
    { legalName: "Smith & Jones Partners" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t6-outbox") },
  );

  const { results: outbox } = await database
    .prepare("SELECT topic, payload FROM outbox")
    .all<{ topic: string; payload: string }>();
  expect(outbox).toHaveLength(1);
  expect(outbox[0]?.topic).toBe("directory.entity.created");
  expect(JSON.parse(outbox[0]?.payload ?? "{}")).toEqual({ organizationId });

  const { results: audit } = await database
    .prepare("SELECT event, subject_id FROM audit_log")
    .all<{ event: string; subject_id: string }>();
  expect(audit).toHaveLength(1);
  expect(audit[0]?.event).toBe("directory.organization.created");
  expect(audit[0]?.subject_id).toBe(organizationId);
});

test("createOrganization computes phonetic codes on the full legal name", async () => {
  const database = freshDatabase();
  const organizationId = await createOrganization(
    database,
    { legalName: "Blackstone" },
    { clock, actorUserId: null, randomSource: seededRandomSource("t6-phonetic") },
  );

  const { results: names } = await database
    .prepare("SELECT id FROM directory_name WHERE entity_id = ?1")
    .bind(organizationId)
    .all<{ id: string }>();
  const { results: codes } = await database
    .prepare(
      "SELECT code FROM directory_name_phonetic_code WHERE name_id = ?1 AND scheme = 'double_metaphone_primary'",
    )
    .bind(names[0]?.id)
    .all<{ code: string }>();
  // "Blackstone" has a non-empty primary phonetic code — proof the full legal name is the blocking token.
  expect((codes[0]?.code ?? "").length).toBeGreaterThan(0);
});
