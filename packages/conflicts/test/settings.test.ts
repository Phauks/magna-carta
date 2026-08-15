import type { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import {
  DEFAULT_CANDIDATE_CAP,
  DEFAULT_CLOSURE_CAP,
  DEFAULT_CONFLICTS_POLICY,
  DEFAULT_EDGE_CLASS_BUDGETS,
  MAX_CANDIDATE_CAP,
  readConflictsPolicy,
  resolveScope,
  type ConflictsPolicy,
} from "../src/settings.ts";

const policy: ConflictsPolicy = {
  floorSources: ["party", "graph"],
  floorStrictness: "balanced",
  defaultDepth: 1,
  edgeClassBudgets: DEFAULT_EDGE_CLASS_BUDGETS,
  closureCap: DEFAULT_CLOSURE_CAP,
  candidateCap: DEFAULT_CANDIDATE_CAP,
};

test("a request above the floor passes through untouched", () => {
  const resolved = resolveScope(policy, {
    sources: ["party", "graph", "imputation"],
    strictness: "over_inclusive",
    depth: 2,
  });
  expect(resolved.sources).toEqual(["party", "graph", "imputation"]);
  expect(resolved.strictness).toBe("over_inclusive");
  expect(resolved.depth).toBe(2);
  expect(resolved.floorRaised).toBe(false);
});

test("a request below the floor is raised and the raise is recorded", () => {
  const resolved = resolveScope(policy, { sources: ["party"], strictness: "balanced", depth: 1 });
  expect(resolved.sources).toEqual(["party", "graph"]);
  expect(resolved.floorRaised).toBe(true);
});

test("strictness below the floor is raised to the floor", () => {
  const strictPolicy: ConflictsPolicy = { ...policy, floorStrictness: "over_inclusive" };
  const resolved = resolveScope(strictPolicy, {
    sources: ["party", "graph"],
    strictness: "balanced",
    depth: 1,
  });
  expect(resolved.strictness).toBe("over_inclusive");
  expect(resolved.floorRaised).toBe(true);
});

test("party is always in scope even when a caller omits it", () => {
  const resolved = resolveScope(DEFAULT_CONFLICTS_POLICY, {
    sources: [],
    strictness: "balanced",
    depth: 1,
  });
  expect(resolved.sources).toContain("party");
  expect(resolved.floorRaised).toBe(true);
});

test("resolved sources are deterministically ordered", () => {
  const a = resolveScope(policy, {
    sources: ["imputation", "party"],
    strictness: "balanced",
    depth: 1,
  });
  const b = resolveScope(policy, {
    sources: ["party", "imputation"],
    strictness: "balanced",
    depth: 1,
  });
  expect(a.sources).toEqual(b.sources);
});

test("depth below zero is clamped to zero", () => {
  const resolved = resolveScope(policy, {
    sources: ["party", "graph"],
    strictness: "balanced",
    depth: -1,
  });
  expect(resolved.depth).toBe(0);
});

test("an omitted depth falls back to the firm's default depth, without raising the floor", () => {
  // A firm's configured depth and its per-class budgets are one setting read together — readConflicts
  // Policy derives the budgets from defaultDepth whenever a stored row predates them, so the two can
  // never disagree in a policy that came off the database.
  const deepPolicy: ConflictsPolicy = {
    ...policy,
    defaultDepth: 3,
    edgeClassBudgets: { control: 3, family: 3, representation: 3 },
  };
  const resolved = resolveScope(deepPolicy, {
    sources: ["party", "graph"],
    strictness: "balanced",
  });
  expect(resolved.depth).toBe(3);
  // Defaulting is not a narrowing the caller asked for, so it is not a floor-raise.
  expect(resolved.floorRaised).toBe(false);
});

test("an explicit depth is honored over the default, including a deliberate zero", () => {
  const deepPolicy: ConflictsPolicy = { ...policy, defaultDepth: 3 };
  const resolved = resolveScope(deepPolicy, {
    sources: ["party", "graph"],
    strictness: "balanced",
    depth: 0,
  });
  expect(resolved.depth).toBe(0);
});

// Seeds the flat firm-level setting row directly through the sync `raw` handle (the D1-shaped
// `database` adapter only exposes async prepare/run) so each case starts from a freshly migrated,
// otherwise-empty per-firm database.
function seedConflictsPolicy(raw: DatabaseSync, value: string): void {
  raw.exec(
    `INSERT INTO setting (key, value, updated_at) VALUES ('conflicts.policy', '${value.replace(/'/g, "''")}', '2026-07-10T00:00:00.000Z');`,
  );
}

test("readConflictsPolicy: a missing row falls back to the default policy", async () => {
  const { database } = createMigratedNodeDatabase("per-firm");
  expect(await readConflictsPolicy(database)).toEqual(DEFAULT_CONFLICTS_POLICY);
});

test("readConflictsPolicy: a well-formed stored row round-trips its values", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  const stored: ConflictsPolicy = {
    floorSources: ["party", "graph"],
    floorStrictness: "over_inclusive",
    defaultDepth: 3,
    edgeClassBudgets: { control: 2, family: 1, representation: 1 },
    closureCap: 250,
  };
  seedConflictsPolicy(raw, JSON.stringify(stored));

  const resolved = await readConflictsPolicy(database);
  expect(resolved.floorSources).toEqual(["party", "graph"]);
  expect(resolved.floorStrictness).toBe("over_inclusive");
  expect(resolved.defaultDepth).toBe(3);
  expect(resolved.edgeClassBudgets).toEqual({ control: 2, family: 1, representation: 1 });
  expect(resolved.closureCap).toBe(250);
});

test("readConflictsPolicy: an empty stored floorSources still yields party in the floor", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(
    raw,
    JSON.stringify({ floorSources: [], floorStrictness: "balanced", defaultDepth: 1 }),
  );

  const resolved = await readConflictsPolicy(database);
  expect(resolved.floorSources).toContain("party");
});

test("readConflictsPolicy: an invalid stored floorStrictness falls back to the default strictness", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(
    raw,
    JSON.stringify({ floorSources: ["party"], floorStrictness: "bogus", defaultDepth: 1 }),
  );

  const resolved = await readConflictsPolicy(database);
  expect(resolved.floorStrictness).toBe(DEFAULT_CONFLICTS_POLICY.floorStrictness);
});

test("readConflictsPolicy: malformed JSON in the stored value falls back to the default policy, no throw", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(raw, "{not json");

  await expect(readConflictsPolicy(database)).resolves.toEqual(DEFAULT_CONFLICTS_POLICY);
});

test("resolveScope: an explicit depth sets every budgeted edge class, as it always meant", () => {
  const resolved = resolveScope(policy, {
    sources: ["party", "graph"],
    strictness: "balanced",
    depth: 3,
  });
  expect(resolved.edgeClassBudgets).toEqual({ control: 3, family: 3, representation: 3 });
  expect(resolved.depth).toBe(3);
});

test("resolveScope: a per-class override wins over the uniform depth, and the recorded depth is the widest", () => {
  const resolved = resolveScope(policy, {
    sources: ["party", "graph"],
    strictness: "balanced",
    depth: 1,
    edgeClassBudgets: { control: 4 },
  });
  expect(resolved.edgeClassBudgets).toEqual({ control: 4, family: 1, representation: 1 });
  // The one-number column carries the widest budget in force, so a reader of it alone is never told
  // the traversal was shallower than it was.
  expect(resolved.depth).toBe(4);
});

test("resolveScope: the closure cap defaults to the firm's and an explicit request is honoured", () => {
  const base = resolveScope(policy, { sources: ["party"], strictness: "balanced" });
  expect(base.closureCap).toBe(DEFAULT_CLOSURE_CAP);
  const narrowed = resolveScope(policy, {
    sources: ["party"],
    strictness: "balanced",
    closureCap: 25,
  });
  expect(narrowed.closureCap).toBe(25);
});

test("readConflictsPolicy: a stored row predating the typed budgets keeps its own depth for every class", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  // A firm that widened defaultDepth before per-class budgets existed means that number for every
  // class. Falling back to the shipped default here would silently narrow the search for exactly the
  // firms that took the trouble to widen it.
  seedConflictsPolicy(
    raw,
    JSON.stringify({ floorSources: ["party"], floorStrictness: "balanced", defaultDepth: 3 }),
  );

  const resolved = await readConflictsPolicy(database);
  expect(resolved.edgeClassBudgets).toEqual({ control: 3, family: 3, representation: 3 });
  expect(resolved.closureCap).toBe(DEFAULT_CLOSURE_CAP);
});

test("the candidate cap defaults, is overridable per run, and never exceeds what one batch can carry", () => {
  expect(resolveScope(policy, { sources: ["party"], strictness: "balanced" }).candidateCap).toBe(
    DEFAULT_CANDIDATE_CAP,
  );
  // A run may ask for a narrower bound, exactly as it may ask for a narrower closure.
  expect(
    resolveScope(policy, { sources: ["party"], strictness: "balanced", candidateCap: 42 })
      .candidateCap,
  ).toBe(42);
  // A cap raised past what one atomic batch can hold would turn a truncation the platform can report
  // into a check that fails outright, so the two bounds compose mechanically rather than by
  // convention: nothing a caller or a settings row can supply puts them in conflict.
  expect(
    resolveScope(policy, {
      sources: ["party"],
      strictness: "balanced",
      candidateCap: MAX_CANDIDATE_CAP * 10,
    }).candidateCap,
  ).toBe(MAX_CANDIDATE_CAP);
  expect(
    resolveScope(policy, { sources: ["party"], strictness: "balanced", candidateCap: -5 })
      .candidateCap,
  ).toBe(0);
});

test("a stored policy predating the candidate cap resolves to the bound, never to none", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(raw, '{"floorSources":["party"],"closureCap":250}');
  const stored = await readConflictsPolicy(database);
  // An unbounded run is the state the cap exists to end, so "the row does not say" has to resolve to
  // the shipped bound rather than to no bound at all.
  expect(stored.candidateCap).toBe(DEFAULT_CANDIDATE_CAP);

  raw.exec("DELETE FROM setting WHERE key = 'conflicts.policy'");
  seedConflictsPolicy(raw, '{"candidateCap":99999999}');
  expect((await readConflictsPolicy(database)).candidateCap).toBe(MAX_CANDIDATE_CAP);
});
