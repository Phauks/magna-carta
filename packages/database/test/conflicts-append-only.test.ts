import { createMigratedNodeDatabase } from "../src/node-sqlite.ts";
import { expect, test } from "vitest";

const INSERT_CHECK = `INSERT INTO conflicts_check
  (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at)
  VALUES ('conflictsCheck_1', 'comprehensive', NULL, '[]', '{}', 'balanced', 1, '{}', 0, NULL, '2026-07-09T00:00:00.000Z')`;

test("conflicts_check rejects UPDATE", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(INSERT_CHECK);
  expect(() =>
    raw.exec(`UPDATE conflicts_check SET depth = 2 WHERE id = 'conflictsCheck_1'`),
  ).toThrow(/append-only/);
});

test("conflicts_check rejects DELETE", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(INSERT_CHECK);
  expect(() => raw.exec(`DELETE FROM conflicts_check WHERE id = 'conflictsCheck_1'`)).toThrow(
    /append-only/,
  );
});

test("conflicts_hit and conflicts_disposition reject UPDATE and DELETE", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(INSERT_CHECK);
  raw.exec(`INSERT INTO conflicts_hit
    (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at)
    VALUES ('conflictsHit_1', 'conflictsCheck_1', 'directoryPerson_1', 'party', 1, '{}', '[]', '2026-07-09T00:00:00.000Z')`);
  raw.exec(`INSERT INTO conflicts_disposition
    (id, hit_id, kind, rationale, reviewer_user_id, created_at)
    VALUES ('conflictsDisposition_1', 'conflictsHit_1', 'cleared', 'unrelated party', 'user_1', '2026-07-09T00:00:00.000Z')`);

  expect(() => raw.exec(`UPDATE conflicts_hit SET evidence_tier = 4`)).toThrow(/append-only/);
  expect(() => raw.exec(`DELETE FROM conflicts_hit`)).toThrow(/append-only/);
  expect(() => raw.exec(`UPDATE conflicts_disposition SET kind = 'cleared'`)).toThrow(
    /append-only/,
  );
  expect(() => raw.exec(`DELETE FROM conflicts_disposition`)).toThrow(/append-only/);
});

test("a reversal is a second disposition row, not an update", () => {
  const { raw } = createMigratedNodeDatabase("per-firm");
  raw.exec(INSERT_CHECK);
  raw.exec(`INSERT INTO conflicts_hit
    (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at)
    VALUES ('conflictsHit_1', 'conflictsCheck_1', 'directoryPerson_1', 'party', 1, '{}', '[]', '2026-07-09T00:00:00.000Z')`);
  raw.exec(`INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, created_at)
    VALUES ('conflictsDisposition_1', 'conflictsHit_1', 'cleared', 'looked unrelated', 'user_1', '2026-07-09T00:00:00.000Z')`);
  raw.exec(`INSERT INTO conflicts_disposition (id, hit_id, kind, rationale, reviewer_user_id, created_at)
    VALUES ('conflictsDisposition_2', 'conflictsHit_1', 'representation_declined', 'on review, adverse', 'user_1', '2026-07-09T01:00:00.000Z')`);

  const rows = raw
    .prepare(
      `SELECT kind FROM conflicts_disposition WHERE hit_id = 'conflictsHit_1' ORDER BY created_at ASC`,
    )
    .all() as Array<{ kind: string }>;
  expect(rows.map((r) => r.kind)).toEqual(["cleared", "representation_declined"]);
});
