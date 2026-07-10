import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import {
  createFirmKeyProvider,
  type WrappedKeyRow,
} from "@magna-carta/data-access/firm-key-provider";
import { generateFirmKeyBytes, importRootKek, wrapFirmKey } from "@magna-carta/encryption/keys";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { assertPermission } from "@magna-carta/access-control/registry";
import { createPerson } from "@magna-carta/directory/person";
import { createOrganization } from "@magna-carta/directory/organization";
import { createEdge } from "@magna-carta/directory/edges";
import { mergeEntities } from "@magna-carta/directory/merge";
import { addIdentifier } from "@magna-carta/directory/identifiers";
import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import { expect, test } from "vitest";
import { matchParty } from "../src/matching.ts";
import { runConflictsCheck } from "../src/run-check.ts";

// The exact-name probe and the directory channels both need a full DirectoryIdentifierContext
// (firm key material, effective permissions, clock, seeded randomness) — reproduced here from
// packages/conflicts/test/matching.test.ts so this file does not depend on that test's sources.

const ROOT_KEK = "bWFnbmEtY2FydGEtbG9jYWwtZGV2LXJvb3Qta2VrISE=";
const FIRM = "firm_aaaaaaaaaaaaaaaaaaaaaa" as FirmId;
const ACTOR = "user_actor" as UserId;
const VIEW_SENSITIVE = assertPermission("directory:viewSensitiveIdentifiers");

const clock = { now: () => "2026-07-09T00:00:00.000Z" };

interface TestContext {
  readonly database: BatchDatabase;
  readonly raw: { exec(sql: string): void };
  readonly ctx: DirectoryIdentifierContext;
  readonly options: { clock: typeof clock; actorUserId: UserId | null; randomSource: ReturnType<typeof seededRandomSource> };
}

async function conflictsTestContext(seed: string): Promise<TestContext> {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const rootKek = await importRootKek(ROOT_KEK);
  const wrappedFirmKey = await wrapFirmKey(rootKek, generateFirmKeyBytes());
  const provider = createFirmKeyProvider({
    rootKekBase64: ROOT_KEK,
    readWrappedKey: async (firmId: FirmId): Promise<WrappedKeyRow | null> =>
      firmId === FIRM ? { wrappedFirmKey, firmKeyVersion: 1 } : null,
  });
  const randomSource = seededRandomSource(seed);

  const ctx: DirectoryIdentifierContext = {
    firmId: FIRM,
    firmKeyVersion: 1,
    firmKeyProvider: provider,
    database,
    effectivePermissions: new Set([VIEW_SENSITIVE]) as never,
    actorUserId: ACTOR,
    clock,
    randomSource,
  };

  const options = { clock, actorUserId: ACTOR, randomSource };

  return { database, raw, ctx, options };
}

interface CheckRow {
  readonly id: string;
  readonly trigger: string;
  readonly subject_matter_id: string | null;
  readonly subject_parties_json: string;
  readonly scope_json: string;
  readonly strictness: string;
  readonly depth: number;
  readonly inputs_json: string;
  readonly floor_raised: number;
  readonly actor_user_id: string | null;
  readonly created_at: string;
}

async function readCheck(database: BatchDatabase, checkId: string): Promise<CheckRow> {
  const { results } = await database
    .prepare(`SELECT * FROM conflicts_check WHERE id = ?1`)
    .bind(checkId)
    .all<CheckRow>();
  const row = results[0];
  if (row === undefined) throw new Error(`conflicts_check row not found: ${checkId}`);
  return row;
}

interface HitRow {
  readonly id: string;
  readonly check_id: string;
  readonly entity_id: string;
  readonly source_class: string;
  readonly evidence_tier: number;
  readonly matched_fields_json: string;
  readonly graph_path_json: string;
  readonly created_at: string;
}

async function readHits(database: BatchDatabase, checkId: string): Promise<HitRow[]> {
  const { results } = await database
    .prepare(`SELECT * FROM conflicts_hit WHERE check_id = ?1 ORDER BY id ASC`)
    .bind(checkId)
    .all<HitRow>();
  return results;
}

test("a check writes one row recording the trigger, scope, strictness and depth", async () => {
  const { ctx, options } = await conflictsTestContext("run-basic");
  const clientId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);

  const checkId = await runConflictsCheck(
    ctx,
    { trigger: "comprehensive", subjectEntityIds: [clientId], scope: { sources: ["party"], strictness: "balanced", depth: 1 } },
    options,
  );

  const row = await readCheck(ctx.database, checkId);
  expect(row.trigger).toBe("comprehensive");
  expect(row.strictness).toBe("balanced");
  expect(row.depth).toBe(1);
});

test("a matter with no parties produces an empty run, not an error", async () => {
  const { ctx, options } = await conflictsTestContext("empty");
  const checkId = await runConflictsCheck(
    ctx,
    { trigger: "preliminary", subjectEntityIds: [], scope: { sources: ["party"], strictness: "balanced", depth: 1 } },
    options,
  );
  const hits = await readHits(ctx.database, checkId);
  expect(hits).toEqual([]);
});

test("a source that cannot run records as unavailable, never as clean", async () => {
  const { ctx, options } = await conflictsTestContext("unavailable");
  const checkId = await runConflictsCheck(
    ctx,
    { trigger: "comprehensive", subjectEntityIds: [], scope: { sources: ["party", "content"], strictness: "balanced", depth: 1 } },
    options,
  );
  const row = await readCheck(ctx.database, checkId);
  const scope = JSON.parse(row.scope_json) as Record<string, string>;
  expect(scope.content).toBe("unavailable");
  expect(scope.party).toBe("searched");
});

test("a scope below the floor is raised and the raise is recorded on the row", async () => {
  const { ctx, raw, options } = await conflictsTestContext("floor");
  raw.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('conflicts.policy', '{"floorSources":["party","graph"],"floorStrictness":"balanced","defaultDepth":1}', '2026-07-09T00:00:00.000Z')`,
  );
  const checkId = await runConflictsCheck(
    ctx,
    { trigger: "comprehensive", subjectEntityIds: [], scope: { sources: ["party"], strictness: "balanced", depth: 1 } },
    options,
  );
  const row = await readCheck(ctx.database, checkId);
  expect(row.floor_raised).toBe(1);
  expect(JSON.parse(row.scope_json).graph).toBe("searched");
});

test("no plaintext identifier value reaches the log", async () => {
  const { ctx, options } = await conflictsTestContext("no-plaintext");
  const personId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);
  await addIdentifier(ctx, personId, { type: "ssn", value: "123-45-6789" });

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [personId],
      scope: { sources: ["party"], strictness: "balanced", depth: 1 },
    },
    options,
  );
  const row = await readCheck(ctx.database, checkId);
  expect(row.inputs_json).not.toContain("123456789");
  expect(row.inputs_json).not.toContain("123-45-6789");
});

test("a merged-away former name still surfaces the surviving master", async () => {
  const { ctx, options } = await conflictsTestContext("merged");
  const master = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);
  const subordinate = await createPerson(ctx.database, { given: "Jane", family: "Doe" }, options);
  await mergeEntities(ctx, { masterId: master, subordinateId: subordinate, survivorship: {} });

  const checkId = await runConflictsCheck(
    ctx,
    { trigger: "new_party", subjectEntityIds: [], scope: { sources: ["party"], strictness: "over_inclusive", depth: 0 } },
    options,
  );
  // Match against the merged-away name; the master must surface, never the subordinate.
  const matches = await matchParty(ctx, { kind: "person", given: "Jane", family: "Doe" }, "over_inclusive");
  expect(matches.map((match) => match.entityId)).toContain(master);
  expect(matches.map((match) => match.entityId)).not.toContain(subordinate);
  expect(checkId).toBeDefined();
});

test("every hit carries its evidence tier and connecting graph path", async () => {
  const { ctx, options } = await conflictsTestContext("hit-shape");
  const orgId = await createOrganization(ctx.database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(ctx.database, { given: "Ada", family: "Principal" }, options);
  await createEdge(
    ctx.database,
    { from: principalId, to: orgId, edgeType: "affiliation", role: "principal", note: null, validFrom: null, validTo: null },
    options,
  );
  await createPerson(ctx.database, { given: "Ada", family: "Principal" }, options); // a second, unrelated Ada

  const checkId = await runConflictsCheck(
    ctx,
    { trigger: "comprehensive", subjectEntityIds: [orgId], scope: { sources: ["party", "graph"], strictness: "balanced", depth: 1 } },
    options,
  );

  const hits = await readHits(ctx.database, checkId);
  expect(hits.length).toBeGreaterThan(0);
  for (const hit of hits) {
    expect(hit.evidence_tier).toBeGreaterThanOrEqual(1);
    expect(hit.evidence_tier).toBeLessThanOrEqual(4);
    expect(() => JSON.parse(hit.graph_path_json)).not.toThrow();
  }
});

test("a replayed idempotency key writes exactly one check", async () => {
  const { ctx, options } = await conflictsTestContext("idempotent");
  const idempotency = { key: "firm:check:1", fingerprint: "fp" };
  const input = {
    trigger: "comprehensive" as const,
    subjectEntityIds: [],
    scope: { sources: ["party"] as const, strictness: "balanced" as const, depth: 1 },
  };

  const first = await runConflictsCheck(ctx, input, { ...options, idempotency });
  const second = await runConflictsCheck(ctx, input, { ...options, idempotency });

  expect(second).toBe(first);
  const { results } = await ctx.database.prepare(`SELECT COUNT(*) AS count FROM conflicts_check`).all();
  expect(results[0].count).toBe(1);
});
