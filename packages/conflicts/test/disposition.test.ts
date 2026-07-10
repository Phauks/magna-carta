import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import type { ConflictsWriteOptions } from "../src/audit.ts";
import { readCurrentDisposition, recordDisposition } from "../src/disposition.ts";
import { DISPOSITION_KINDS } from "../src/types.ts";

// A disposition adjudicates a conflicts_hit row, so every test needs one on the books. Seeded
// directly through the raw node:sqlite handle rather than a full runConflictsCheck — the matching
// pipeline (parties, edges, evidence) is irrelevant here; only a real, referenceable hit id matters.

const ACTOR = "user_actor" as UserId;
const clock = { now: () => "2026-07-09T00:00:00.000Z" };

interface HitFixture {
  readonly ctx: { readonly database: BatchDatabase };
  readonly options: ConflictsWriteOptions;
  readonly hitId: string;
}

async function hitFixture(seed: string): Promise<HitFixture> {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const randomSource = seededRandomSource(seed);
  const options: ConflictsWriteOptions = { clock, actorUserId: ACTOR, randomSource };

  const checkId = newIdentifier("conflictsCheck", randomSource);
  const hitId = newIdentifier("conflictsHit", randomSource);
  raw.exec(
    `INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) VALUES ('${checkId}', 'comprehensive', NULL, '[]', '{}', 'balanced', 1, '{}', 0, NULL, '2026-07-09T00:00:00.000Z')`,
  );
  raw.exec(
    `INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, created_at) VALUES ('${hitId}', '${checkId}', 'directoryPerson_placeholder', 'party', 1, '[]', '[]', '2026-07-09T00:00:00.000Z')`,
  );

  return { ctx: { database }, options, hitId };
}

test("a disposition is recorded against a hit", async () => {
  const { ctx, options, hitId } = await hitFixture("record");
  const dispositionId = await recordDisposition(
    ctx.database,
    { hitId, kind: "cleared", rationale: "unrelated party", reviewerUserId: ACTOR },
    options,
  );
  expect(dispositionId).toMatch(/^conflictsDisposition_/);
});

test("a reversal appends a second row and becomes the current disposition", async () => {
  const { ctx, options, hitId } = await hitFixture("reversal");
  await recordDisposition(ctx.database, { hitId, kind: "cleared", rationale: "looked unrelated", reviewerUserId: ACTOR }, options);
  await recordDisposition(
    ctx.database,
    { hitId, kind: "representation_declined", rationale: "on review, adverse", reviewerUserId: ACTOR },
    { ...options, clock: { now: () => "2026-07-09T01:00:00.000Z" } },
  );

  const current = await readCurrentDisposition(ctx.database, hitId);
  expect(current?.kind).toBe("representation_declined");

  const { results } = await ctx.database.prepare(`SELECT COUNT(*) AS count FROM conflicts_disposition`).all();
  expect(results[0].count).toBe(2); // the cleared row survives — the audit trail is the point
});

test("an empty rationale is rejected", async () => {
  const { ctx, options, hitId } = await hitFixture("empty-rationale");
  await expect(
    recordDisposition(ctx.database, { hitId, kind: "cleared", rationale: "   ", reviewerUserId: ACTOR }, options),
  ).rejects.toThrow(/empty-rationale/);
});

test("a disposition against an unknown hit is rejected before any write", async () => {
  const { ctx, options } = await hitFixture("unknown-hit");
  await expect(
    recordDisposition(ctx.database, { hitId: "conflictsHit_missing", kind: "cleared", rationale: "x", reviewerUserId: ACTOR }, options),
  ).rejects.toThrow(/unknown-hit/);
});

test("every disposition kind is accepted", async () => {
  for (const kind of DISPOSITION_KINDS) {
    const { ctx, options, hitId } = await hitFixture(`kind-${kind}`);
    await expect(
      recordDisposition(ctx.database, { hitId, kind, rationale: "reason", reviewerUserId: ACTOR }, options),
    ).resolves.toBeDefined();
  }
});
