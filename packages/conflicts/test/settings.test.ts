import type { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import {
  DEFAULT_CONFLICTS_POLICY,
  readConflictsPolicy,
  resolveScope,
  type ConflictsPolicy,
} from "../src/settings.ts";

const policy: ConflictsPolicy = {
  floorSources: ["party", "graph"],
  floorStrictness: "balanced",
  defaultDepth: 1,
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
  const a = resolveScope(policy, { sources: ["imputation", "party"], strictness: "balanced", depth: 1 });
  const b = resolveScope(policy, { sources: ["party", "imputation"], strictness: "balanced", depth: 1 });
  expect(a.sources).toEqual(b.sources);
});

test("depth below zero is clamped to zero", () => {
  const resolved = resolveScope(policy, { sources: ["party", "graph"], strictness: "balanced", depth: -1 });
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
  };
  seedConflictsPolicy(raw, JSON.stringify(stored));

  const resolved = await readConflictsPolicy(database);
  expect(resolved.floorSources).toEqual(["party", "graph"]);
  expect(resolved.floorStrictness).toBe("over_inclusive");
  expect(resolved.defaultDepth).toBe(3);
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
