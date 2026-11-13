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
import { parseCheckInputs, readMatterConflictsPosture } from "../src/posture.ts";
import { describeCheck } from "../src/report-text.ts";
import { runConflictsCheck } from "../src/run-check.ts";
import { CANDIDATE_WRITE_CEILING } from "../src/candidate-bound.ts";
import { WALK_CEILING } from "../src/expansion.ts";

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
  readonly options: {
    clock: typeof clock;
    actorUserId: UserId | null;
    randomSource: ReturnType<typeof seededRandomSource>;
  };
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
  readonly co_party: number;
  readonly created_at: string;
}

async function readHits(database: BatchDatabase, checkId: string): Promise<HitRow[]> {
  const { results } = await database
    .prepare(`SELECT * FROM conflicts_hit WHERE check_id = ?1 ORDER BY id ASC`)
    .bind(checkId)
    .all<HitRow>();
  return results;
}

test("a check writes one row recording the trigger, scope, strictness and how deep it went", async () => {
  const { ctx, options } = await conflictsTestContext("run-basic");
  const clientId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [clientId],
      scope: { sources: ["party"], strictness: "balanced" },
    },
    options,
  );

  const row = await readCheck(ctx.database, checkId);
  expect(row.trigger).toBe("comprehensive");
  expect(row.strictness).toBe("balanced");
  // The shipped column used to carry the widest hop budget. There is no budget now, so it records
  // how deep the closure actually ran: a lone party with no relationships walks nowhere.
  expect(row.depth).toBe(0);
});

test("a check run without trigram matching records it, and finds no name by trigram overlap", async () => {
  const { ctx, options } = await conflictsTestContext("run-without-trigram");
  const clientId = await createPerson(ctx.database, { given: "Cather", family: "More" }, options);
  await createPerson(ctx.database, { given: "Bartholomew", family: "Cathermore" }, options);

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "preliminary",
      subjectEntityIds: [clientId],
      scope: { sources: ["party"], strictness: "balanced", trigramMatching: false },
    },
    options,
  );

  const row = await readCheck(ctx.database, checkId);
  expect(parseCheckInputs(row.inputs_json).matching?.trigramMatching).toBe(false);
  for (const hit of await readHits(ctx.database, checkId)) {
    expect(hit.matched_fields_json).not.toContain("trigram overlap");
  }
});

test("a matter with no parties produces an empty run, not an error", async () => {
  const { ctx, options } = await conflictsTestContext("empty");
  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "preliminary",
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "balanced" },
    },
    options,
  );
  const hits = await readHits(ctx.database, checkId);
  expect(hits).toEqual([]);
});

test("a source that cannot run records as unavailable, never as clean", async () => {
  const { ctx, options } = await conflictsTestContext("unavailable");
  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [],
      scope: { sources: ["party", "content"], strictness: "balanced" },
    },
    options,
  );
  const row = await readCheck(ctx.database, checkId);
  const scope = JSON.parse(row.scope_json) as Record<string, string>;
  expect(scope.content).toBe("unavailable");
  expect(scope.party).toBe("searched");
});

test("a check asked for the firm's own records finds a party in them, records where, and says how it looked", async () => {
  const { ctx, raw, options } = await conflictsTestContext("places");
  const clientId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Actor', 'active', '${clock.now()}')`,
  );
  raw.exec(
    `INSERT INTO magnus_conversation (id, created_by, state, created_at, updated_at)
     VALUES ('magnusConversation_1', '${ACTOR}', 'active', '${clock.now()}', '${clock.now()}')`,
  );
  raw.exec(
    `INSERT INTO magnus_turn (id, conversation_id, sequence, speaker, content, status, created_at)
     VALUES ('magnusTurn_1', 'magnusConversation_1', 1, 'magnus', 'Jane Roe was the landlord.', 'complete', '${clock.now()}')`,
  );

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "preliminary",
      subjectEntityIds: [clientId],
      scope: {
        sources: ["party"],
        strictness: "balanced",
        places: { messaging: [], tasks: ["open"], magnus: true },
      },
    },
    options,
  );

  const row = await readCheck(ctx.database, checkId);
  const scope = JSON.parse(row.scope_json) as Record<string, string>;
  expect(scope.magnus_conversations).toBe("searched");
  expect(scope.tasks).toBe("searched");
  // Messaging was not asked for, so the record does not claim it.
  expect(scope.messaging).toBeUndefined();

  const { results } = await ctx.database
    .prepare(
      `SELECT entity_id, source_class, evidence_tier, matched_fields_json, found_in_json FROM conflicts_hit WHERE check_id = ?1`,
    )
    .bind(checkId)
    .all<{
      entity_id: string;
      source_class: string;
      evidence_tier: number;
      matched_fields_json: string;
      found_in_json: string | null;
    }>();
  expect(results).toHaveLength(1);
  expect(results[0]?.entity_id).toBe(clientId);
  expect(results[0]?.source_class).toBe("content");
  expect(results[0]?.evidence_tier).toBe(2);
  expect(JSON.parse(results[0]?.found_in_json ?? "null")).toMatchObject({
    kind: "magnus_conversation",
    id: "magnusConversation_1",
    matterId: null,
  });

  const inputs = parseCheckInputs(row.inputs_json);
  expect(inputs.places).toMatchObject({
    magnus: true,
    tasks: ["open"],
    resultsFound: 1,
    resultsRefused: 0,
  });
  const statement = describeCheck(
    {
      createdAt: row.created_at,
      trigger: row.trigger,
      actorUserId: null,
      strictness: "balanced",
      depth: row.depth,
      floorRaised: false,
      subjectEntityCount: inputs.subjectEntityIds.length,
      expandedEntityCount: inputs.expandedEntityIds.length,
      skippedIdentifierTypes: [],
      places: inputs.places,
    },
    [{ evidenceTier: 2 }],
    [],
  );
  expect(statement.some((line) => line.startsWith("Magnus — every conversation"))).toBe(true);
  expect(
    statement.some((line) =>
      line.startsWith(
        "Tasks — titles and descriptions of tasks on open matters, and tasks on no matter",
      ),
    ),
  ).toBe(true);
  expect(statement.some((line) => line.startsWith("Messaging —"))).toBe(false);
});

test("a check asked for Files asks the file index, records where it found the party, and says so", async () => {
  const { ctx, raw, options } = await conflictsTestContext("files");
  const clientId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);
  raw.exec(
    `INSERT INTO member (user_id, display_name, status, created_at) VALUES ('${ACTOR}', 'Actor', 'active', '${clock.now()}')`,
  );
  raw.exec(
    `INSERT INTO matter (id, title, status, responsible_member_id, created_at, updated_at)
     VALUES ('matter_lease', 'Lease', 'open', '${ACTOR}', '${clock.now()}', '${clock.now()}')`,
  );
  raw.exec(
    `INSERT INTO file (id, matter_id, name, created_at, updated_at)
     VALUES ('file_lease', 'matter_lease', 'lease.pdf', '${clock.now()}', '${clock.now()}')`,
  );
  const request = {
    trigger: "preliminary" as const,
    subjectEntityIds: [clientId],
    scope: {
      sources: ["party" as const],
      strictness: "balanced" as const,
      places: { messaging: [], tasks: [], magnus: false, files: ["open" as const] },
    },
  };

  const searched = await runConflictsCheck(ctx, request, options, {
    query: ({ matterId }) =>
      Promise.resolve({
        kind: "files",
        fileIds: matterId === "matter_lease" ? ["file_lease"] : [],
      }),
  });
  const row = await readCheck(ctx.database, searched);
  expect((JSON.parse(row.scope_json) as Record<string, string>).files).toBe("searched");
  const { results } = await ctx.database
    .prepare(`SELECT found_in_json FROM conflicts_hit WHERE check_id = ?1`)
    .bind(searched)
    .all<{ found_in_json: string | null }>();
  expect(results.map((hit) => JSON.parse(hit.found_in_json ?? "null"))).toEqual([
    { kind: "file", id: "file_lease", matterId: "matter_lease", at: clock.now() },
  ]);
  const inputs = parseCheckInputs(row.inputs_json);
  const statement = describeCheck(
    {
      createdAt: row.created_at,
      trigger: row.trigger,
      actorUserId: null,
      strictness: "balanced",
      depth: row.depth,
      floorRaised: false,
      subjectEntityCount: 1,
      expandedEntityCount: 1,
      skippedIdentifierTypes: [],
      places: inputs.places,
    },
    [{ evidenceTier: 2 }],
    [],
  );
  expect(statement).toContain(
    "Files — the text of files on open matters across 1 of 1 matter, searched for 1 subject party by each name as an exact phrase.",
  );

  // Without the index, Files is recorded as not searched rather than as searched and empty.
  const dormant = await runConflictsCheck(ctx, request, {
    ...options,
    randomSource: seededRandomSource("files-dormant"),
  });
  const dormantRow = await readCheck(ctx.database, dormant);
  expect((JSON.parse(dormantRow.scope_json) as Record<string, string>).files).toBe("unavailable");
});

test("imputation in scope with no matter still searches, over the entities the check reached", async () => {
  const { ctx, options } = await conflictsTestContext("imputation-no-matter");
  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [],
      scope: { sources: ["party", "imputation"], strictness: "balanced" },
    },
    options,
  );
  const row = await readCheck(ctx.database, checkId);
  const scope = JSON.parse(row.scope_json) as Record<string, string>;
  expect(scope.imputation).toBe("searched");
  expect(scope.party).toBe("searched");
});

test("a scope below the floor is raised and the raise is recorded on the row", async () => {
  const { ctx, raw, options } = await conflictsTestContext("floor");
  raw.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('conflicts.policy', '{"floorSources":["party","graph"],"floorStrictness":"balanced","defaultDepth":1}', '2026-07-09T00:00:00.000Z')`,
  );
  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "balanced" },
    },
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
      scope: { sources: ["party"], strictness: "balanced" },
    },
    options,
  );
  const row = await readCheck(ctx.database, checkId);
  expect(row.inputs_json).not.toContain("123456789");
  expect(row.inputs_json).not.toContain("123-45-6789");
});

test("a shared SSN surfaces a tier-1 hit even when the names do not match", async () => {
  const { ctx, options } = await conflictsTestContext("shared-ssn");
  // Two entities the fuzzy channels can never connect: a legal name change with no shared aliases.
  const subject = await createPerson(
    ctx.database,
    { given: "Robert", family: "Zimmerman" },
    options,
  );
  const twin = await createPerson(ctx.database, { given: "Bob", family: "Dylan" }, options);
  await addIdentifier(ctx, subject, { type: "ssn", value: "123-45-6789" });
  // The same SSN entered with different formatting — the frozen normalize makes the blind index equal.
  await addIdentifier(ctx, twin, { type: "ssn", value: "123456789" });

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [subject],
      scope: { sources: ["party"], strictness: "balanced" },
    },
    options,
  );

  const hits = await readHits(ctx.database, checkId);
  const twinHit = hits.find((hit) => hit.entity_id === twin);
  expect(twinHit).toBeDefined();
  expect(twinHit?.evidence_tier).toBe(1);
  expect(JSON.parse(twinHit?.matched_fields_json ?? "[]")).toContain("exact identifier match: ssn");
  // The subject must never surface as its own hit.
  expect(hits.some((hit) => hit.entity_id === subject)).toBe(false);
});

test("a party carrying a middle name still surfaces its same-name twin at tier 2 (exact name)", async () => {
  const { ctx, options } = await conflictsTestContext("middle-name");
  // Both people are "John Q Public" — the corpus stores normalized_display "john q public". The subject
  // is read from the entity (full name), so the exact-name probe must compare "john q public", not the
  // given+family "john public" that would silently downgrade the twin out of tier 2.
  const subject = await createPerson(
    ctx.database,
    { given: "John", middle: "Q", family: "Public" },
    options,
  );
  const twin = await createPerson(
    ctx.database,
    { given: "John", middle: "Q", family: "Public" },
    options,
  );

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [subject],
      scope: { sources: ["party"], strictness: "balanced" },
    },
    options,
  );

  const hits = await readHits(ctx.database, checkId);
  const twinHit = hits.find((hit) => hit.entity_id === twin);
  expect(twinHit).toBeDefined();
  expect(twinHit?.evidence_tier).toBe(2);
  expect(JSON.parse(twinHit?.matched_fields_json ?? "[]")).toContain("exact normalized name match");
});

test("a match on another subject party surfaces flagged co_party, while a non-party match does not", async () => {
  const { ctx, options } = await conflictsTestContext("co-party");
  // Two same-named parties on the matter (a co-party collision — e.g. the same real person entered
  // twice under two roles, or two related named parties) plus one same-named entity that is NOT a party
  // to this matter (an ordinary prior/other-client conflict).
  const subjectA = await createPerson(ctx.database, { given: "John", family: "Smith" }, options);
  const subjectB = await createPerson(ctx.database, { given: "John", family: "Smith" }, options);
  const outsider = await createPerson(ctx.database, { given: "John", family: "Smith" }, options);

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [subjectA, subjectB],
      scope: { sources: ["party"], strictness: "balanced" },
    },
    options,
  );

  const hits = await readHits(ctx.database, checkId);
  // The co-party (subjectB, a named party matching subjectA) surfaces, flagged — it is no longer
  // silently dropped just because it is also a subject party.
  const coPartyHit = hits.find((hit) => hit.entity_id === subjectB);
  expect(coPartyHit).toBeDefined();
  expect(coPartyHit?.co_party).toBe(1);
  // The non-party outsider (a real prior-client conflict) surfaces as an ordinary hit, not flagged.
  const outsiderHit = hits.find((hit) => hit.entity_id === outsider);
  expect(outsiderHit).toBeDefined();
  expect(outsiderHit?.co_party).toBe(0);
  // A party never surfaces as its own hit.
  expect(hits.some((hit) => hit.entity_id === subjectA && hit.co_party === 1)).toBe(true); // A surfaces via B's match
});

test("a merged-away former name still surfaces the surviving master", async () => {
  const { ctx, options } = await conflictsTestContext("merged");
  const master = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);
  const subordinate = await createPerson(ctx.database, { given: "Jane", family: "Doe" }, options);
  await mergeEntities(ctx, { masterId: master, subordinateId: subordinate, survivorship: {} });

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "new_party",
      subjectEntityIds: [],
      scope: { sources: ["party"], strictness: "over_inclusive" },
    },
    options,
  );
  // Match against the merged-away name; the master must surface, never the subordinate.
  const matches = await matchParty(
    ctx,
    { kind: "person", given: "Jane", family: "Doe" },
    "over_inclusive",
  );
  expect(matches.map((match) => match.entityId)).toContain(master);
  expect(matches.map((match) => match.entityId)).not.toContain(subordinate);
  expect(checkId).toBeDefined();
});

test("every hit carries its evidence tier and connecting graph path", async () => {
  const { ctx, options } = await conflictsTestContext("hit-shape");
  const orgId = await createOrganization(ctx.database, { legalName: "ABC Holdings" }, options);
  const principalId = await createPerson(
    ctx.database,
    { given: "Ada", family: "Principal" },
    options,
  );
  await createEdge(
    ctx.database,
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
  const unrelatedAdaId = await createPerson(
    ctx.database,
    { given: "Ada", family: "Principal" },
    options,
  ); // a second, unrelated Ada

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [orgId],
      scope: { sources: ["party", "graph"], strictness: "balanced" },
    },
    options,
  );

  const hits = await readHits(ctx.database, checkId);
  expect(hits.length).toBeGreaterThan(0);
  for (const hit of hits) {
    expect(hit.evidence_tier).toBeGreaterThanOrEqual(1);
    expect(hit.evidence_tier).toBeLessThanOrEqual(4);
    expect(() => JSON.parse(hit.graph_path_json)).not.toThrow();
  }

  // Graph expansion reaches principalId (the affiliated Ada). Searching from principalId must never
  // surface principalId as its own hit -- an entity cannot conflict with itself -- while the genuinely
  // unrelated, identically-named Ada must still show up as a real hit.
  expect(hits.every((hit) => hit.entity_id !== principalId)).toBe(true);
  expect(hits.some((hit) => hit.entity_id === unrelatedAdaId)).toBe(true);
});

test("a replayed idempotency key writes exactly one check", async () => {
  const { ctx, options } = await conflictsTestContext("idempotent");
  const idempotency = { key: "firm:check:1", fingerprint: "fp" };
  const input = {
    trigger: "comprehensive" as const,
    subjectEntityIds: [],
    scope: { sources: ["party"] as const, strictness: "balanced" as const },
  };

  const first = await runConflictsCheck(ctx, input, { ...options, idempotency });
  const second = await runConflictsCheck(ctx, input, { ...options, idempotency });

  expect(second).toBe(first);
  const { results } = await ctx.database
    .prepare(`SELECT COUNT(*) AS count FROM conflicts_check`)
    .all();
  // A COUNT(*) always returns exactly one row, which is what makes this indexed read safe.
  expect(results[0]!.count).toBe(1);
});

test("a completed walk records that every relationship was followed to closure, under the platform's ceiling", async () => {
  const { ctx, options } = await conflictsTestContext("traversal-record");
  const clientId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);
  const spouse = await createPerson(ctx.database, { given: "Jean", family: "Roe" }, options);
  await createEdge(
    ctx.database,
    {
      from: clientId,
      to: spouse,
      edgeType: "relationship",
      role: "spouse",
      note: null,
      validFrom: null,
      validTo: null,
    },
    options,
  );

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [clientId],
      scope: { sources: ["party", "graph"], strictness: "balanced" },
    },
    options,
  );

  const row = await readCheck(ctx.database, checkId);
  const traversal = (JSON.parse(row.inputs_json) as { traversal: Record<string, unknown> })
    .traversal;
  // No budget of any class: the row says the walk went all the way, and how far that turned out to
  // be. A reader of a years-old row must not have to know that budgets were once a thing.
  expect(traversal.followedToClosure).toBe(true);
  expect(traversal.edgeClassBudgets).toBeUndefined();
  expect(traversal.longestPathLength).toBe(1);
  expect(row.depth).toBe(1);
  expect(traversal.corporateFamily).toBe("transitive");
  // The bound in force is the platform's, recorded under the key every row has always used.
  expect(traversal.closureCap).toBe(WALK_CEILING);
  expect(traversal.expiredEdgesTraversed).toBe(true);
  expect(traversal.truncated).toBe(false);
  // A completed walk has no boundary to describe, so the truncation counts are absent rather than
  // present-and-zero: a zero frontier would read as "we checked, and there was nothing beyond".
  expect(traversal["unexploredFrontierSize"]).toBeUndefined();
});

test("a run records the write ceiling in force and no truncation", async () => {
  const { ctx, options } = await conflictsTestContext("candidate-untruncated");
  const clientId = await createPerson(ctx.database, { given: "Jane", family: "Roe" }, options);

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      subjectEntityIds: [clientId],
      scope: { sources: ["party"], strictness: "balanced" },
    },
    options,
  );

  const row = await readCheck(ctx.database, checkId);
  const candidates = (JSON.parse(row.inputs_json) as { candidates: Record<string, unknown> })
    .candidates;
  // The bound in force is recorded on every check, truncating or not — a reader of a years-old row
  // must be able to tell what the run was allowed to write, not only what it happened to need. It is
  // the platform's, not the firm's: nothing in the request or the policy can move it.
  expect(candidates.candidateCap).toBe(CANDIDATE_WRITE_CEILING);
  expect(candidates.truncated).toBe(false);
  // Nothing was refused, so the refusal counts are absent rather than present-and-zero — the same
  // rule the completed traversal follows.
  expect(candidates["candidatesRefused"]).toBeUndefined();
});

test("the statement of a walk to closure says so, and reaches the posture read", async () => {
  const { ctx, options } = await conflictsTestContext("closure-statement");
  const subject = await createOrganization(ctx.database, { legalName: "Meridian Group" }, options);
  const matterId = "matter_closure";

  const checkId = await runConflictsCheck(
    ctx,
    {
      trigger: "comprehensive",
      matterId,
      subjectEntityIds: [subject],
      scope: { sources: ["party", "graph"], strictness: "balanced" },
    },
    options,
  );

  const posture = await readMatterConflictsPosture(ctx.database, matterId);
  expect(posture.latestCheck?.scope.traversal?.followedToClosure).toBe(true);
  expect(posture.latestCheck?.scope.traversal?.truncated).toBe(false);

  const row = await readCheck(ctx.database, checkId);
  const inputs = parseCheckInputs(row.inputs_json);
  const statement = describeCheck(
    {
      createdAt: row.created_at,
      trigger: row.trigger,
      actorUserId: row.actor_user_id,
      strictness: "balanced",
      depth: row.depth,
      floorRaised: row.floor_raised === 1,
      subjectEntityCount: inputs.subjectEntityIds.length,
      expandedEntityCount: inputs.expandedEntityIds.length,
      skippedIdentifierTypes: inputs.skippedIdentifierTypes,
      traversal: inputs.traversal,
      candidates: inputs.candidates,
    },
    [],
    [
      { source: "party", availability: "searched", reason: null },
      { source: "graph", availability: "searched", reason: null },
    ],
  );
  expect(statement.some((line) => line.includes("followed to closure"))).toBe(true);
  expect(statement.some((line) => line.includes("TRUNCATED"))).toBe(false);
});
