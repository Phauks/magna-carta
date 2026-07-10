import { expect, test } from "vitest";
import { DEFAULT_CONFLICTS_POLICY, resolveScope, type ConflictsPolicy } from "../src/settings.ts";

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
