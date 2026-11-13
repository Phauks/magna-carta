import type { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import {
  DEFAULT_BALANCED_NAME_ROLES,
  DEFAULT_CONFLICTS_POLICY,
  readConflictsPolicy,
  resolveScope,
  type ConflictsPolicy,
} from "../src/settings.ts";

// The firm's floor: what every check must search and the band it must reach. What is deliberately
// NOT here any more is a depth, a hop budget or a cap — the walk follows relationships to closure and
// the bound on a run is the platform's, so a policy row carries neither and a request cannot ask for
// one.

const policy: ConflictsPolicy = {
  floorSources: ["party", "graph"],
  floorStrictness: "balanced",
  balancedNameRoles: DEFAULT_BALANCED_NAME_ROLES,
};

test("a request above the floor passes through untouched", () => {
  const resolved = resolveScope(policy, {
    sources: ["party", "graph", "imputation"],
    strictness: "over_inclusive",
  });
  expect(resolved.sources).toEqual(["party", "graph", "imputation"]);
  expect(resolved.strictness).toBe("over_inclusive");
  expect(resolved.floorRaised).toBe(false);
});

test("a request below the floor is raised and the raise is recorded", () => {
  const resolved = resolveScope(policy, { sources: ["party"], strictness: "balanced" });
  expect(resolved.sources).toEqual(["party", "graph"]);
  expect(resolved.floorRaised).toBe(true);
});

test("strictness below the floor is raised to the floor", () => {
  const strictPolicy: ConflictsPolicy = { ...policy, floorStrictness: "over_inclusive" };
  const resolved = resolveScope(strictPolicy, {
    sources: ["party", "graph"],
    strictness: "balanced",
  });
  expect(resolved.strictness).toBe("over_inclusive");
  expect(resolved.floorRaised).toBe(true);
});

test("party is always in scope even when a caller omits it", () => {
  const resolved = resolveScope(DEFAULT_CONFLICTS_POLICY, { sources: [], strictness: "balanced" });
  expect(resolved.sources).toContain("party");
  expect(resolved.floorRaised).toBe(true);
});

test("resolved sources are deterministically ordered", () => {
  const a = resolveScope(policy, { sources: ["imputation", "party"], strictness: "balanced" });
  const b = resolveScope(policy, { sources: ["party", "imputation"], strictness: "balanced" });
  expect(a.sources).toEqual(b.sources);
});

test("the balanced band resolves the firm's name roles, and the widest band resolves every role", () => {
  const narrowed: ConflictsPolicy = { ...policy, balancedNameRoles: ["current", "former"] };
  expect(resolveScope(narrowed, { sources: ["party"], strictness: "balanced" }).nameRoles).toEqual([
    "current",
    "former",
  ]);
  // Null is a stronger statement than a list naming every role: a role the firm adds later is
  // covered by it, which is what keeps the wider band a superset whatever the firm configures.
  expect(
    resolveScope(narrowed, { sources: ["party"], strictness: "over_inclusive" }).nameRoles,
  ).toBeNull();
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
    balancedNameRoles: ["current", "former"],
  };
  seedConflictsPolicy(raw, JSON.stringify(stored));

  const resolved = await readConflictsPolicy(database);
  expect(resolved.floorSources).toEqual(["party", "graph"]);
  expect(resolved.floorStrictness).toBe("over_inclusive");
  expect(resolved.balancedNameRoles).toEqual(["current", "former"]);
});

test("readConflictsPolicy: a row written under the old bounds reads past them", async () => {
  // A firm that configured a depth, hop budgets and caps before 2026-09-11 still has them in its
  // row. None of them is honoured — the walk goes to closure and the bound is the platform's — and
  // the three fields that are still the firm's to decide read exactly as they were saved.
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(
    raw,
    JSON.stringify({
      floorSources: ["party", "graph"],
      floorStrictness: "over_inclusive",
      defaultDepth: 3,
      edgeClassBudgets: { control: 2, family: 1, representation: 1 },
      closureCap: 250,
      candidateCap: 120,
      balancedNameRoles: ["current", "former"],
    }),
  );

  const resolved = await readConflictsPolicy(database);
  expect(resolved).toEqual({
    floorSources: ["party", "graph"],
    floorStrictness: "over_inclusive",
    balancedNameRoles: ["current", "former"],
  });
});

test("readConflictsPolicy: an empty stored floorSources still yields party in the floor", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(raw, JSON.stringify({ floorSources: [], floorStrictness: "balanced" }));

  const resolved = await readConflictsPolicy(database);
  expect(resolved.floorSources).toContain("party");
});

test("readConflictsPolicy: an unknown source class in the floor is dropped rather than run", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(
    raw,
    JSON.stringify({ floorSources: ["party", "telepathy"], floorStrictness: "balanced" }),
  );
  const resolved = await readConflictsPolicy(database);
  expect(resolved.floorSources).toEqual(["party"]);
});

test("readConflictsPolicy: an invalid stored floorStrictness falls back to the default strictness", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(raw, JSON.stringify({ floorSources: ["party"], floorStrictness: "bogus" }));

  const resolved = await readConflictsPolicy(database);
  expect(resolved.floorStrictness).toBe(DEFAULT_CONFLICTS_POLICY.floorStrictness);
});

test("readConflictsPolicy: malformed JSON in the stored value falls back to the default policy, no throw", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(raw, "{not json");

  await expect(readConflictsPolicy(database)).resolves.toEqual(DEFAULT_CONFLICTS_POLICY);
});

test("readConflictsPolicy: an emptied name-role set falls back to the default, and current is always in it", async () => {
  const { database, raw } = createMigratedNodeDatabase("per-firm");
  seedConflictsPolicy(
    raw,
    JSON.stringify({ floorSources: ["party"], floorStrictness: "balanced", balancedNameRoles: [] }),
  );
  expect((await readConflictsPolicy(database)).balancedNameRoles).toEqual(
    [...DEFAULT_BALANCED_NAME_ROLES].toSorted(),
  );

  raw.exec("DELETE FROM setting WHERE key = 'conflicts.policy'");
  seedConflictsPolicy(
    raw,
    JSON.stringify({
      floorSources: ["party"],
      floorStrictness: "balanced",
      balancedNameRoles: ["maiden"],
    }),
  );
  expect((await readConflictsPolicy(database)).balancedNameRoles).toEqual(["current", "maiden"]);
});

test("trigram matching is on unless a balanced request turns it off", () => {
  expect(resolveScope(policy, { sources: ["party"], strictness: "balanced" }).trigramMatching).toBe(
    true,
  );
  expect(
    resolveScope(policy, { sources: ["party"], strictness: "balanced", trigramMatching: false })
      .trigramMatching,
  ).toBe(false);
  // Over-inclusive may never find less than balanced, so it runs trigram matching whatever is asked.
  expect(
    resolveScope(policy, {
      sources: ["party"],
      strictness: "over_inclusive",
      trigramMatching: false,
    }).trigramMatching,
  ).toBe(true);
});
