import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import {
  assertConflictsFitness,
  ConflictsFitnessError,
  findInvalidHitEvidence,
  findMissingAppendOnlyTriggers,
  findOrphanDispositions,
  findOrphanHits,
  findPlaintextIdentifiersInChecks,
} from "../src/fitness.ts";

// Fitness function: the log-wide conflicts invariant audit. assertConflictsFitness sweeps the corpus
// and proves five invariants hold — all six append-only guard triggers exist, no orphan hit, no
// orphan disposition, no plaintext identifier in a check's inputs_json, and every hit's evidence is
// well-formed. Each probe is driven both ways: a sound log passes, and a single seeded violation
// fails with the offending row named.

const ACTOR = "user_actor" as UserId;
const CLOCK_NOW = "2026-07-10T00:00:00.000Z";

interface Harness {
  readonly database: BatchDatabase;
  readonly raw: { exec(sql: string): void };
}

// Seeds one fully-linked, schema-valid row per table — a sound log — and returns the ids. Seeded
// directly through the raw node:sqlite handle: the matching/scoring pipeline is irrelevant to these
// probes, only real, referenceable, constraint-satisfying rows matter.
function seedSoundLog(
  raw: { exec(sql: string): void },
  randomSource: ReturnType<typeof seededRandomSource>,
): { checkId: string; hitId: string; dispositionId: string } {
  const checkId = newIdentifier("conflictsCheck", randomSource);
  const hitId = newIdentifier("conflictsHit", randomSource);
  const dispositionId = newIdentifier("conflictsDisposition", randomSource);

  raw.exec(
    `INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) VALUES ('${checkId}', 'comprehensive', NULL, '[]', '{}', 'balanced', 1, '{"entityIds":["directoryPerson_abc"]}', 0, NULL, '${CLOCK_NOW}')`,
  );
  raw.exec(
    `INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at) VALUES ('${hitId}', '${checkId}', 'directoryPerson_def', 'party', 1, '[]', '[]', '${CLOCK_NOW}')`,
  );
  raw.exec(
    `INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, created_at) VALUES ('${dispositionId}', '${hitId}', 'cleared', 'unrelated party', '${ACTOR}', '${CLOCK_NOW}')`,
  );

  return { checkId, hitId, dispositionId };
}

async function seededHarness(
  seed: string,
): Promise<Harness & { randomSource: ReturnType<typeof seededRandomSource> }> {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const randomSource = seededRandomSource(seed);
  return { database, raw, randomSource };
}

test("passes when the log is sound and all six append-only triggers exist", async () => {
  const { database, raw, randomSource } = await seededHarness("triggers-sound");
  seedSoundLog(raw, randomSource);

  expect(await findMissingAppendOnlyTriggers(database)).toEqual([]);
  await expect(assertConflictsFitness(database)).resolves.toBeUndefined();
});

test("flags a dropped append-only trigger", async () => {
  const { database, raw, randomSource } = await seededHarness("triggers-dropped");
  seedSoundLog(raw, randomSource);
  raw.exec(`DROP TRIGGER conflicts_hit_no_update`);

  const missing = await findMissingAppendOnlyTriggers(database);
  expect(missing).toEqual(["conflicts_hit_no_update"]);
  await expect(assertConflictsFitness(database)).rejects.toThrow(ConflictsFitnessError);
  await expect(assertConflictsFitness(database)).rejects.toThrow(/conflicts_hit_no_update/);
});

test("passes when every hit resolves to a real check", async () => {
  const { database, raw, randomSource } = await seededHarness("hits-sound");
  seedSoundLog(raw, randomSource);

  expect(await findOrphanHits(database)).toEqual([]);
  await expect(assertConflictsFitness(database)).resolves.toBeUndefined();
});

test("flags a hit that references an unknown check", async () => {
  const { database, raw, randomSource } = await seededHarness("hits-orphan");
  seedSoundLog(raw, randomSource);
  const orphanHitId = newIdentifier("conflictsHit", randomSource);
  // The declared FOREIGN KEY is enforced by node:sqlite, so seeding a deliberately-orphaned row (the
  // corruption this probe exists to catch) needs the constraint off for this one insert.
  raw.exec(`PRAGMA foreign_keys = OFF`);
  raw.exec(
    `INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at) VALUES ('${orphanHitId}', 'conflictsCheck_missing', 'directoryPerson_ghi', 'party', 2, '[]', '[]', '${CLOCK_NOW}')`,
  );

  const orphans = await findOrphanHits(database);
  expect(orphans).toEqual([{ hitId: orphanHitId, checkId: "conflictsCheck_missing" }]);
  await expect(assertConflictsFitness(database)).rejects.toThrow(ConflictsFitnessError);
  await expect(assertConflictsFitness(database)).rejects.toThrow(new RegExp(orphanHitId));
});

test("passes when every disposition resolves to a real hit", async () => {
  const { database, raw, randomSource } = await seededHarness("dispositions-sound");
  seedSoundLog(raw, randomSource);

  expect(await findOrphanDispositions(database)).toEqual([]);
  await expect(assertConflictsFitness(database)).resolves.toBeUndefined();
});

test("flags a disposition that references an unknown hit", async () => {
  const { database, raw, randomSource } = await seededHarness("dispositions-orphan");
  seedSoundLog(raw, randomSource);
  const orphanDispositionId = newIdentifier("conflictsDisposition", randomSource);
  raw.exec(`PRAGMA foreign_keys = OFF`);
  raw.exec(
    `INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, created_at) VALUES ('${orphanDispositionId}', 'conflictsHit_missing', 'cleared', 'unrelated party', '${ACTOR}', '${CLOCK_NOW}')`,
  );

  const orphans = await findOrphanDispositions(database);
  expect(orphans).toEqual([{ dispositionId: orphanDispositionId, hitId: "conflictsHit_missing" }]);
  await expect(assertConflictsFitness(database)).rejects.toThrow(ConflictsFitnessError);
  await expect(assertConflictsFitness(database)).rejects.toThrow(new RegExp(orphanDispositionId));
});

test("passes when no check carries a plaintext nine-digit identifier", async () => {
  const { database, raw, randomSource } = await seededHarness("plaintext-sound");
  seedSoundLog(raw, randomSource);

  expect(await findPlaintextIdentifiersInChecks(database)).toEqual([]);
  await expect(assertConflictsFitness(database)).resolves.toBeUndefined();
});

test("flags a check whose inputs_json contains a nine-digit run", async () => {
  const { database, raw, randomSource } = await seededHarness("plaintext-leaked");
  seedSoundLog(raw, randomSource);
  const leakedCheckId = newIdentifier("conflictsCheck", randomSource);
  raw.exec(
    `INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) VALUES ('${leakedCheckId}', 'comprehensive', NULL, '[]', '{}', 'balanced', 1, '{"leaked":"123456789"}', 0, NULL, '${CLOCK_NOW}')`,
  );

  const leaked = await findPlaintextIdentifiersInChecks(database);
  expect(leaked).toEqual([{ checkId: leakedCheckId }]);
  await expect(assertConflictsFitness(database)).rejects.toThrow(ConflictsFitnessError);
  await expect(assertConflictsFitness(database)).rejects.toThrow(new RegExp(leakedCheckId));
});

test("passes when every hit's tier is 1-4 and graph_path_json is an array", async () => {
  const { database, raw, randomSource } = await seededHarness("evidence-sound");
  seedSoundLog(raw, randomSource);

  expect(await findInvalidHitEvidence(database)).toEqual([]);
  await expect(assertConflictsFitness(database)).resolves.toBeUndefined();
});

test("flags a hit whose graph_path_json is not a JSON array", async () => {
  const { database, raw, randomSource } = await seededHarness("evidence-malformed");
  const { checkId } = seedSoundLog(raw, randomSource);
  const malformedHitId = newIdentifier("conflictsHit", randomSource);
  raw.exec(
    `INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at) VALUES ('${malformedHitId}', '${checkId}', 'directoryPerson_jkl', 'party', 2, '[]', '{"not":"an-array"}', '${CLOCK_NOW}')`,
  );

  const invalid = await findInvalidHitEvidence(database);
  expect(invalid).toEqual([
    { hitId: malformedHitId, reason: "graph_path_json does not parse to a JSON array" },
  ]);
  await expect(assertConflictsFitness(database)).rejects.toThrow(ConflictsFitnessError);
  await expect(assertConflictsFitness(database)).rejects.toThrow(new RegExp(malformedHitId));
});
