import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { seededRandomSource } from "@magna-carta/identifiers/random";
import type { UserId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import type { ConflictsWriteOptions } from "../src/audit.ts";
import { readHitDispositionStates, recordDisposition } from "../src/disposition.ts";
import { readMatterConflictsPosture } from "../src/posture.ts";

// The posture read is a DERIVED read: it computes the answer from stored rows on every call and writes
// nothing. These fixtures therefore seed the log directly rather than driving runConflictsCheck — the
// matching pipeline is a different subject, and what matters here is which rows are on the books.

const ACTOR = "user_actor" as UserId;
const MATTER = "matter_alpha";
const OTHER_MATTER = "matter_beta";
const clock = { now: () => "2026-08-13T09:00:00.000Z" };

interface Fixture {
  readonly database: BatchDatabase;
  readonly raw: { exec(sql: string): void };
  readonly options: ConflictsWriteOptions;
  readonly randomSource: ReturnType<typeof seededRandomSource>;
}

function fixture(seed: string): Fixture {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const randomSource = seededRandomSource(seed);
  return {
    database,
    raw,
    randomSource,
    options: { clock, actorUserId: ACTOR, randomSource },
  };
}

interface SeededCheck {
  readonly matterId: string | null;
  readonly createdAt: string;
  readonly scope: Record<string, "searched" | "unavailable">;
  readonly strictness?: string;
  readonly depth?: number;
  readonly floorRaised?: boolean;
  readonly subjectEntityIds?: readonly string[];
  readonly expandedEntityIds?: readonly string[];
}

function seedCheck(fixtureValue: Fixture, check: SeededCheck): string {
  const checkId = newIdentifier("conflictsCheck", fixtureValue.randomSource);
  const inputs = JSON.stringify({
    subjectEntityIds: check.subjectEntityIds ?? [],
    expandedEntityIds: check.expandedEntityIds ?? check.subjectEntityIds ?? [],
    identifierRefs: [],
    skippedIdentifierTypes: ["dob", "ssn_last_four"],
  });
  fixtureValue.raw.exec(
    `INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) VALUES ` +
      `('${checkId}', 'comprehensive', ${check.matterId === null ? "NULL" : `'${check.matterId}'`}, '[]', ` +
      `'${JSON.stringify(check.scope)}', '${check.strictness ?? "balanced"}', ${check.depth ?? 1}, '${inputs}', ` +
      `${check.floorRaised === true ? 1 : 0}, '${ACTOR}', '${check.createdAt}')`,
  );
  return checkId;
}

// A waiver names the Directory entity that consented, and the write refuses a handle that resolves
// to nothing — the whole point of recording the giver by handle is that a reader can look them up.
const CONSENTING_PARTY = "directoryPerson_consenting";

function seedConsentingParty(fixtureValue: Fixture): void {
  fixtureValue.raw.exec(
    `INSERT INTO directory_person (id, display_name, status, needs_review, created_at, updated_at) VALUES ` +
      `('${CONSENTING_PARTY}', 'The Consenting Client', 'active', 0, '2026-08-13T09:00:00.000Z', '2026-08-13T09:00:00.000Z')`,
  );
}

// A waiver whose informed consent WAS confirmed in writing but whose confirmation is filed nowhere.
// These fixtures seed the log directly against a matter handle that has no matter row, so there is no
// file to point at — which makes this the ordinary shape a real firm records first, and the reason the
// posture read has to count it apart from a waiver the firm could hand over.
const WAIVER_CONFIRMED_BUT_UNFILED = {
  givenByEntityId: CONSENTING_PARTY,
  confirmedInWriting: true,
  documentFileId: null,
  givenOn: "2026-08-12",
} as const;

function seedHit(fixtureValue: Fixture, checkId: string, tier: number, createdAt: string): string {
  const hitId = newIdentifier("conflictsHit", fixtureValue.randomSource);
  fixtureValue.raw.exec(
    `INSERT INTO conflicts_hit (id, check_id, entity_id, source_class, evidence_tier, matched_fields_json, graph_path_json, co_party, created_at) VALUES ` +
      `('${hitId}', '${checkId}', 'directoryPerson_seeded', 'party', ${tier}, '[]', '[]', 0, '${createdAt}')`,
  );
  return hitId;
}

const SEARCHED_DEFAULT_SCOPE = {
  party: "searched",
  graph: "searched",
  imputation: "searched",
  content: "unavailable",
  prior_firm_history: "unavailable",
} as const;

test("a matter with no check reads neverChecked, and is a different state from a check with no hits", async () => {
  const never = fixture("never-checked");
  const posture = await readMatterConflictsPosture(never.database, MATTER);
  expect(posture.neverChecked).toBe(true);
  expect(posture.latestCheck).toBeNull();
  // Every tier is stated, zero included: an absent tier would read as "nothing to say".
  expect(posture.undisposedByTier).toEqual([
    { tier: 1, count: 0 },
    { tier: 2, count: 0 },
    { tier: 3, count: 0 },
    { tier: 4, count: 0 },
  ]);
  expect(posture.unavailableSources).toEqual([]);

  const searched = fixture("zero-hit");
  seedCheck(searched, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { ...SEARCHED_DEFAULT_SCOPE },
  });
  const zeroHit = await readMatterConflictsPosture(searched.database, MATTER);
  expect(zeroHit.neverChecked).toBe(false);
  expect(zeroHit.latestCheck?.hitCount).toBe(0);
  // The two states share no field value that could collapse them into one rendering.
  expect(zeroHit.latestCheck).not.toBeNull();
});

test("a check whose sources were all unavailable is distinguishable from one that searched", async () => {
  const value = fixture("all-unavailable");
  seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { content: "unavailable", prior_firm_history: "unavailable" },
  });
  const posture = await readMatterConflictsPosture(value.database, MATTER);
  expect(posture.neverChecked).toBe(false);
  expect(posture.unavailableSources.map((entry) => entry.source)).toEqual([
    "content",
    "prior_firm_history",
  ]);
  for (const entry of posture.unavailableSources) expect(entry.reason.length).toBeGreaterThan(0);
  // Nothing in the shape says the sources were searched.
  expect(Object.values(posture.latestCheck?.scope.sources ?? {})).not.toContain("searched");
});

test("an unavailable source carries its reason and is never reported as searched", async () => {
  const value = fixture("unavailable-reason");
  seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { ...SEARCHED_DEFAULT_SCOPE },
  });
  const posture = await readMatterConflictsPosture(value.database, MATTER);
  const content = posture.unavailableSources.find((entry) => entry.source === "content");
  expect(content?.reason).toContain("Nothing indexes the text of documents");
  const priorFirm = posture.unavailableSources.find(
    (entry) => entry.source === "prior_firm_history",
  );
  expect(priorFirm?.reason).toContain("Nothing is recorded for it yet");
  expect(posture.unavailableSources.some((entry) => entry.source === "party")).toBe(false);
});

test("raising the firm floor makes the shortfall appear, with no write to any conflicts table", async () => {
  const value = fixture("shortfall");
  seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { party: "searched", prior_firm_history: "unavailable" },
    strictness: "balanced",
    depth: 1,
  });

  const before = await readMatterConflictsPosture(value.database, MATTER);
  expect(before.scopeShortfall).toEqual({ sources: [], strictness: null });

  const countRows = async (table: string): Promise<number> => {
    const { results } = await value.database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .all<{ count: number }>();
    return results[0]?.count ?? 0;
  };
  const checksBefore = await countRows("conflicts_check");
  const hitsBefore = await countRows("conflicts_hit");
  const dispositionsBefore = await countRows("conflicts_disposition");

  value.raw.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('conflicts.policy', ` +
      `'{"floorSources":["party","graph","imputation"],"floorStrictness":"over_inclusive","defaultDepth":3}', ` +
      `'2026-08-13T10:00:00.000Z')`,
  );

  const after = await readMatterConflictsPosture(value.database, MATTER);
  expect(after.scopeShortfall.sources).toEqual(["graph", "imputation"]);
  expect(after.scopeShortfall.strictness).toEqual({
    firmFloor: "over_inclusive",
    ranUnder: "balanced",
  });
  // Depth is no longer a firm setting, so a policy row that still carries one reports no shortfall
  // for it: the check followed relationships as far as they went, and there is nothing to fall short
  // of.
  expect(after.scopeShortfall).not.toHaveProperty("depth");

  // The shortfall is a comparison, not a record. Nothing was written.
  expect(await countRows("conflicts_check")).toBe(checksBefore);
  expect(await countRows("conflicts_hit")).toBe(hitsBefore);
  expect(await countRows("conflicts_disposition")).toBe(dispositionsBefore);
});

test("a source the check recorded unavailable is reported as unavailable, not as a shortfall", async () => {
  const value = fixture("unavailable-not-shortfall");
  seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { party: "searched", content: "unavailable", prior_firm_history: "unavailable" },
  });
  value.raw.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('conflicts.policy', ` +
      `'{"floorSources":["party","content"],"floorStrictness":"balanced","defaultDepth":1}', ` +
      `'2026-08-13T10:00:00.000Z')`,
  );
  const posture = await readMatterConflictsPosture(value.database, MATTER);
  expect(posture.scopeShortfall.sources).toEqual([]);
  expect(posture.unavailableSources.map((entry) => entry.source)).toContain("content");
});

test("the latest check is the one reported, and its scope comes back verbatim", async () => {
  const value = fixture("latest");
  seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-01T09:00:00.000Z",
    scope: { party: "searched" },
    strictness: "balanced",
    depth: 0,
  });
  const newest = seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { ...SEARCHED_DEFAULT_SCOPE },
    strictness: "over_inclusive",
    depth: 2,
    floorRaised: true,
    subjectEntityIds: ["directoryPerson_a", "directoryPerson_b"],
    expandedEntityIds: ["directoryPerson_a", "directoryPerson_b", "directoryOrganization_c"],
  });
  // A check on a DIFFERENT matter, newer than both, must not be picked up.
  seedCheck(value, {
    matterId: OTHER_MATTER,
    createdAt: "2026-08-14T09:00:00.000Z",
    scope: { party: "searched" },
  });

  const posture = await readMatterConflictsPosture(value.database, MATTER);
  expect(posture.latestCheck?.id).toBe(newest);
  expect(posture.latestCheck?.scope).toEqual({
    sources: SEARCHED_DEFAULT_SCOPE,
    strictness: "over_inclusive",
    depth: 2,
    floorRaised: true,
    // The seeded row carries no matching record either, and null reads the same way: "the row does
    // not say which names it compared" — never "it compared what today's code compares", which is
    // exactly the reading the record exists to end.
    matching: null,
    // The seeded row carries no traversal record, and null is reported as "the row does not say" —
    // never silently as a walk that completed.
    traversal: null,
    // Same rule for the candidate record: a row written before the bound existed does not say how
    // many candidates the run was allowed to write, and that is a third state, not "all of them".
    candidates: null,
  });
  expect(posture.latestCheck?.subjectEntityCount).toBe(2);
  expect(posture.latestCheck?.expandedEntityCount).toBe(3);
  expect(posture.latestCheck?.skippedIdentifierTypes).toEqual(["dob", "ssn_last_four"]);
});

test("same-millisecond checks resolve to the genuinely-latest by insertion order, not by id", async () => {
  const value = fixture("tie-break");
  const first = seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { party: "searched" },
    depth: 1,
  });
  const second = seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { party: "searched" },
    depth: 2,
  });
  // The fixture only proves the tie-break when the ids do not already order the way insertion does.
  expect(first > second).toBe(true);

  const posture = await readMatterConflictsPosture(value.database, MATTER);
  expect(posture.latestCheck?.id).toBe(second);
  expect(posture.latestCheck?.scope.depth).toBe(2);
});

test("undisposed hits are counted by tier, and disposed hits are counted by kind with their reviewer", async () => {
  const value = fixture("counts");
  const checkId = seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { ...SEARCHED_DEFAULT_SCOPE },
  });
  const tierOne = seedHit(value, checkId, 1, "2026-08-13T09:00:00.000Z");
  seedHit(value, checkId, 1, "2026-08-13T09:00:01.000Z");
  seedHit(value, checkId, 4, "2026-08-13T09:00:02.000Z");
  const waived = seedHit(value, checkId, 2, "2026-08-13T09:00:03.000Z");

  await recordDisposition(
    value.database,
    {
      hitId: tierOne,
      kind: "cleared",
      rationale: "a different person of the same name",
      reviewerUserId: ACTOR,
    },
    value.options,
  );
  seedConsentingParty(value);
  await recordDisposition(
    value.database,
    {
      hitId: waived,
      kind: "waiver_obtained",
      rationale: "informed written consent on file",
      reviewerUserId: "user_second_reviewer" as UserId,
      waiver: WAIVER_CONFIRMED_BUT_UNFILED,
    },
    { ...value.options, clock: { now: () => "2026-08-13T09:05:00.000Z" } },
  );

  const posture = await readMatterConflictsPosture(value.database, MATTER);
  expect(posture.undisposedByTier).toEqual([
    { tier: 1, count: 1 },
    { tier: 2, count: 0 },
    { tier: 3, count: 0 },
    { tier: 4, count: 1 },
  ]);
  expect(posture.dispositionsByKind).toEqual([
    { kind: "cleared", count: 1, reviewerUserIds: [ACTOR], incompleteCount: 0 },
    {
      kind: "waiver_obtained",
      count: 1,
      reviewerUserIds: ["user_second_reviewer"],
      // The confirmation is filed nowhere, so the platform still cannot produce it. A waiver the
      // firm can describe and cannot hand over is not the same as one it can.
      incompleteCount: 1,
    },
  ]);
});

test("a reversed disposition counts under the reversal, not under the reversed call", async () => {
  const value = fixture("reversal-counts");
  const checkId = seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { ...SEARCHED_DEFAULT_SCOPE },
  });
  const hitId = seedHit(value, checkId, 1, "2026-08-13T09:00:00.000Z");

  await recordDisposition(
    value.database,
    { hitId, kind: "cleared", rationale: "looked unrelated", reviewerUserId: ACTOR },
    value.options,
  );
  await recordDisposition(
    value.database,
    {
      hitId,
      kind: "representation_declined",
      rationale: "on review, adverse",
      reviewerUserId: ACTOR,
    },
    { ...value.options, clock: { now: () => "2026-08-13T10:00:00.000Z" } },
  );

  const posture = await readMatterConflictsPosture(value.database, MATTER);
  expect(posture.dispositionsByKind).toEqual([
    { kind: "representation_declined", count: 1, reviewerUserIds: [ACTOR], incompleteCount: 0 },
  ]);
});

test("readHitDispositionStates returns every hit of a check with its latest disposition, in one read", async () => {
  const value = fixture("hit-states");
  const checkId = seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { ...SEARCHED_DEFAULT_SCOPE },
  });
  const disposed = seedHit(value, checkId, 2, "2026-08-13T09:00:00.000Z");
  seedHit(value, checkId, 3, "2026-08-13T09:00:01.000Z");
  await recordDisposition(
    value.database,
    { hitId: disposed, kind: "wall_erected", rationale: "screened", reviewerUserId: ACTOR },
    value.options,
  );

  const states = await readHitDispositionStates(value.database, checkId);
  expect(states).toHaveLength(2);
  expect(states[0]?.hitId).toBe(disposed);
  expect(states[0]?.disposition?.kind).toBe("wall_erected");
  expect(states[1]?.disposition).toBeNull();
});

test("nothing in the posture shape is an aggregate or a verdict", async () => {
  const value = fixture("shape");
  seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { ...SEARCHED_DEFAULT_SCOPE },
  });
  const posture = await readMatterConflictsPosture(value.database, MATTER);

  // The structural half of the vocabulary rule, asserted against the real returned object rather than
  // against the type: a verdict field added by a later edit fails here as well as in the source scan.
  const verdictShaped = /^(clear|clean|ok|passed|conflictFree|status|severity)$/i; // conflicts-vocabulary:allow — the banned field-name list itself
  const walk = (value_: unknown, path: string): void => {
    if (value_ === null || typeof value_ !== "object") return;
    if (Array.isArray(value_)) {
      value_.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, nested] of Object.entries(value_)) {
      expect(verdictShaped.test(key), `${path}.${key}`).toBe(false);
      walk(nested, `${path}.${key}`);
    }
  };
  walk(posture, "posture");

  // And no top-level boolean summarising the matter. neverChecked is the one boolean, and it reports
  // whether a search happened — never what a search concluded.
  const booleans = Object.entries(posture).filter(([, entry]) => typeof entry === "boolean");
  expect(booleans.map(([key]) => key)).toEqual(["neverChecked"]);
});

// The posture read runs on every view of a matter, over an append-only log that only grows. Both of
// its queries must therefore be served by an index rather than by a scan of the firm's whole conflicts
// history — a read whose cost tracks the firm's total check count is a read that gets slower forever.
test("both posture queries walk an index rather than scanning the log", () => {
  const value = fixture("plan");
  const planFor = (sql: string, ...bindings: string[]): string =>
    (
      (
        value.raw as unknown as {
          prepare(query: string): { all(...values: string[]): { detail: string }[] };
        }
      )
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...bindings) as { detail: string }[]
    )
      .map((row) => row.detail)
      .join(" | ");

  const latestCheck = planFor(
    `SELECT id, trigger, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at
       FROM conflicts_check WHERE subject_matter_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    MATTER,
  );
  expect(latestCheck, latestCheck).toContain("conflicts_check_subject_matter_created_id_index");
  expect(latestCheck, latestCheck).not.toMatch(/SCAN (?!.* USING )/);

  const hitStates = planFor(
    `SELECT hit.id AS hit_id, hit.evidence_tier, hit.source_class, hit.co_party,
            latest.id AS disposition_id, latest.kind, latest.rationale, latest.reviewer_user_id,
            latest.created_at AS disposition_created_at
       FROM conflicts_hit AS hit
       LEFT JOIN conflicts_disposition AS latest
         ON latest.rowid = (
           SELECT candidate.rowid FROM conflicts_disposition AS candidate
            WHERE candidate.hit_id = hit.id
            ORDER BY candidate.created_at DESC, candidate.rowid DESC
            LIMIT 1
         )
      WHERE hit.check_id = ?1
      ORDER BY hit.created_at ASC, hit.id ASC`,
    "conflictsCheck_probe",
  );
  expect(hitStates, hitStates).toContain("conflicts_hit_check_id_index");
  expect(hitStates, hitStates).toContain("conflicts_disposition_hit_id_created_at_index");
  expect(hitStates, hitStates).not.toMatch(/SCAN (?!.* USING )/);
});

test("pendingRecheck is empty because nothing produces one yet", async () => {
  const value = fixture("pending");
  seedCheck(value, {
    matterId: MATTER,
    createdAt: "2026-08-13T09:00:00.000Z",
    scope: { ...SEARCHED_DEFAULT_SCOPE },
  });
  const posture = await readMatterConflictsPosture(value.database, MATTER);
  expect(posture.pendingRecheck).toEqual([]);
});
