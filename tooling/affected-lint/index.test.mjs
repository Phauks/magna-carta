import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeAffected,
  computeTypeProgramWeights,
  parseMaxHops,
  resolveFanoutSinks,
  selectFanoutSinks,
} from "./index.mjs";

// A small synthetic graph: money is a leaf; data-access depends on money; worker depends on data-access;
// web depends on worker. So a change to money must pull in data-access, worker, and web (transitively).
const packages = new Map([
  ["@magna-carta/money", { dir: "packages/money", deps: new Set() }],
  [
    "@magna-carta/data-access",
    { dir: "packages/data-access", deps: new Set(["@magna-carta/money"]) },
  ],
  [
    "@magna-carta/api-worker",
    { dir: "apps/api-worker", deps: new Set(["@magna-carta/data-access"]) },
  ],
  ["@magna-carta/web", { dir: "apps/web", deps: new Set(["@magna-carta/api-worker"]) }],
]);

describe("computeAffected", () => {
  it("a leaf-package change pulls in its whole transitive-dependent closure", () => {
    const result = computeAffected({
      changedFiles: ["packages/money/src/dinero.ts"],
      packages,
    });
    expect(result.mode).toBe("paths");
    // money + everything that (transitively) depends on it — the soundness requirement.
    expect(result.paths).toEqual([
      "apps/api-worker",
      "apps/web",
      "packages/data-access",
      "packages/money",
    ]);
  });

  it("a top-of-graph change scopes to just that package (nothing depends on it)", () => {
    const result = computeAffected({ changedFiles: ["apps/web/src/app.ts"], packages });
    expect(result.mode).toBe("paths");
    expect(result.paths).toEqual(["apps/web"]);
  });

  it("dedupes when several changed files share dependents", () => {
    const result = computeAffected({
      changedFiles: ["packages/money/src/a.ts", "packages/data-access/src/b.ts"],
      packages,
    });
    expect(result.paths).toEqual([
      "apps/api-worker",
      "apps/web",
      "packages/data-access",
      "packages/money",
    ]);
  });

  it("forces a whole-repo lint when a global-input file changes", () => {
    for (const file of ["vite.config.ts", "pnpm-lock.yaml", "tsconfig.base.json"]) {
      expect(
        computeAffected({ changedFiles: [file, "packages/money/src/a.ts"], packages }).mode,
      ).toBe("all");
    }
  });

  it("forces a whole-repo lint for the global-input prefixes (shared tsconfig, this logic)", () => {
    for (const file of ["packages/tsconfig/base.json", "tooling/affected-lint/index.mjs"]) {
      expect(computeAffected({ changedFiles: [file], packages }).mode).toBe("all");
    }
  });

  it("does not force a whole-repo lint for a workflow/action YAML change (it can't move a lint result)", () => {
    // A .github change is NOT a global trigger: a workflow alone has nothing lintable → none.
    expect(
      computeAffected({ changedFiles: [".github/workflows/assemble-docs.yml"], packages }).mode,
    ).toBe("none");
    // Alongside a package change, it is ignored and the scope is just that package's closure.
    expect(
      computeAffected({
        changedFiles: [".github/workflows/assemble-docs.yml", "apps/web/src/app.ts"],
        packages,
      }).paths,
    ).toEqual(["apps/web"]);
  });

  it("still forces a whole-repo lint for a lintable JS action under .github (caught as source outside any package)", () => {
    expect(
      computeAffected({ changedFiles: [".github/actions/foo/index.mjs"], packages }).mode,
    ).toBe("all");
  });

  it("forces a whole-repo lint for a lintable source file outside every package", () => {
    // A root or tooling script can't be reasoned about through the package graph.
    expect(computeAffected({ changedFiles: ["tooling/some-script/run.mjs"], packages }).mode).toBe(
      "all",
    );
  });

  it("returns none when only a non-source file outside any package changed", () => {
    expect(computeAffected({ changedFiles: ["ROADMAP.txt"], packages }).mode).toBe("none");
  });

  it("stops at the direct dependents when the walk is capped at one hop", () => {
    // money -> data-access -> worker -> web. One hop from money is data-access only.
    const result = computeAffected({
      changedFiles: ["packages/money/src/dinero.ts"],
      packages,
      maxHops: 1,
    });
    expect(result.paths).toEqual(["packages/data-access", "packages/money"]);
  });

  it("walks exactly as many hops as asked", () => {
    const twoHops = computeAffected({
      changedFiles: ["packages/money/src/dinero.ts"],
      packages,
      maxHops: 2,
    });
    expect(twoHops.paths).toEqual(["apps/api-worker", "packages/data-access", "packages/money"]);
    // A cap at or beyond the graph's depth is identical to the unbounded default.
    const deep = computeAffected({
      changedFiles: ["packages/money/src/dinero.ts"],
      packages,
      maxHops: 9,
    });
    const unbounded = computeAffected({ changedFiles: ["packages/money/src/dinero.ts"], packages });
    expect(deep.paths).toEqual(unbounded.paths);
  });

  it("a capped walk never narrows the global-input or outside-a-package escape hatches", () => {
    // Capping is a depth dial on the dependent walk only — the whole-repo triggers still win.
    expect(computeAffected({ changedFiles: ["vite.config.ts"], packages, maxHops: 1 }).mode).toBe(
      "all",
    );
    expect(
      computeAffected({ changedFiles: ["tooling/some-script/run.mjs"], packages, maxHops: 1 }).mode,
    ).toBe("all");
  });

  it("rejects a nonsensical hop cap rather than silently linting less", () => {
    expect(() =>
      computeAffected({ changedFiles: ["packages/money/src/a.ts"], packages, maxHops: 0 }),
    ).toThrow(/at least 1/);
  });

  it("parses the --max-hops flag, defaulting to the full closure", () => {
    expect(parseMaxHops(["node", "index.mjs", "--base", "HEAD~1"])).toBe(Number.POSITIVE_INFINITY);
    expect(parseMaxHops(["node", "index.mjs", "--max-hops", "all"])).toBe(Number.POSITIVE_INFINITY);
    expect(parseMaxHops(["node", "index.mjs", "--max-hops", "1"])).toBe(1);
    expect(() => parseMaxHops(["node", "index.mjs", "--max-hops", "0"])).toThrow(
      /positive integer/,
    );
    expect(() => parseMaxHops(["node", "index.mjs", "--max-hops", "-2"])).toThrow(
      /positive integer/,
    );
  });

  it("defers a fan-out sink that is only in scope as a dependent", () => {
    const result = computeAffected({
      changedFiles: ["packages/money/src/dinero.ts"],
      packages,
      sinks: new Set(["@magna-carta/api-worker"]),
    });
    // The worker drops out; everything else in the closure — including the worker's OWN dependent,
    // web — stays, because deferral is per package, not a cut of the walk.
    expect(result.paths).toEqual(["apps/web", "packages/data-access", "packages/money"]);
    expect(result.deferred).toEqual(["apps/api-worker"]);
  });

  it("never defers a sink the change itself touched", () => {
    const result = computeAffected({
      changedFiles: ["apps/api-worker/src/http/app.ts"],
      packages,
      sinks: new Set(["@magna-carta/api-worker"]),
    });
    expect(result.paths).toEqual(["apps/api-worker", "apps/web"]);
    expect(result.deferred).toEqual([]);
  });

  it("still defers the sink as a dependent when the same change also touches it", () => {
    // Both changed: the worker is linted because it changed, not despite being a sink.
    const result = computeAffected({
      changedFiles: ["packages/money/src/dinero.ts", "apps/api-worker/src/http/app.ts"],
      packages,
      sinks: new Set(["@magna-carta/api-worker"]),
    });
    expect(result.paths).toContain("apps/api-worker");
    expect(result.deferred).toEqual([]);
  });

  it("cannot produce an empty scope, however aggressively the sinks are declared", () => {
    // Every package a sink: the changed one is still linted, because a changed package is never
    // deferred. An empty scope is the one value the gate's contract has no branch for.
    const result = computeAffected({
      changedFiles: ["packages/data-access/src/b.ts"],
      packages,
      sinks: new Set(packages.keys()),
    });
    expect(result.paths).toEqual(["packages/data-access"]);
    expect(result.deferred).toEqual(["apps/api-worker", "apps/web"]);
  });

  it("deferral never overrides the whole-repo triggers", () => {
    expect(
      computeAffected({
        changedFiles: ["vite.config.ts"],
        packages,
        sinks: new Set(["@magna-carta/api-worker"]),
      }).mode,
    ).toBe("all");
  });

  it("maps a nested path to its package (longest-prefix wins), not an ancestor", () => {
    const nested = new Map([
      ["@magna-carta/outer", { dir: "packages/outer", deps: new Set() }],
      ["@magna-carta/inner", { dir: "packages/outer/inner", deps: new Set() }],
    ]);
    const result = computeAffected({
      changedFiles: ["packages/outer/inner/src/x.ts"],
      packages: nested,
    });
    expect(result.paths).toEqual(["packages/outer/inner"]);
  });
});

// A throwaway workspace on disk: the weight is a file count over the real tree, so it needs one.
function writeWorkspace(layout) {
  const root = mkdtempSync(path.join(tmpdir(), "affected-lint-"));
  for (const [name, member] of Object.entries(layout)) {
    const directory = path.join(root, member.dir, "src");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(root, member.dir, "package.json"),
      JSON.stringify({
        name,
        dependencies: Object.fromEntries((member.deps ?? []).map((d) => [d, "workspace:*"])),
      }),
    );
    for (let index = 0; index < member.files; index += 1) {
      writeFileSync(path.join(directory, `file-${index}.ts`), "export const x = 1;\n");
    }
    if (member.tests) {
      const tests = path.join(root, member.dir, "test");
      mkdirSync(tests, { recursive: true });
      for (let index = 0; index < member.tests; index += 1) {
        writeFileSync(path.join(tests, `case-${index}.test.ts`), "export const t = 1;\n");
      }
    }
    for (const [uncounted, count] of Object.entries(member.uncounted ?? {})) {
      const generated = path.join(root, member.dir, uncounted);
      mkdirSync(generated, { recursive: true });
      for (let index = 0; index < count; index += 1) {
        writeFileSync(path.join(generated, `gen-${index}.ts`), "export const y = 1;\n");
      }
    }
  }
  return root;
}

describe("type-program weight and fan-out sinks", () => {
  it("weighs a package by its own files plus its transitive dependency closure", () => {
    // leaf(2) <- middle(3) <- app(5). The weight is the DEPENDENCY direction, the opposite of the
    // dependent walk the scope uses: app has to pull all three into a type program, leaf only itself.
    const graph = new Map([
      ["@magna-carta/leaf", { dir: "packages/leaf", deps: new Set() }],
      ["@magna-carta/middle", { dir: "packages/middle", deps: new Set(["@magna-carta/leaf"]) }],
      ["@magna-carta/app", { dir: "apps/app", deps: new Set(["@magna-carta/middle"]) }],
    ]);
    const root = writeWorkspace({
      "@magna-carta/leaf": { dir: "packages/leaf", files: 2 },
      "@magna-carta/middle": { dir: "packages/middle", files: 3, deps: ["@magna-carta/leaf"] },
      "@magna-carta/app": { dir: "apps/app", files: 5, deps: ["@magna-carta/middle"] },
    });
    const weights = computeTypeProgramWeights({ root, packages: graph });
    expect(weights.get("@magna-carta/leaf")).toBe(2);
    expect(weights.get("@magna-carta/middle")).toBe(5);
    expect(weights.get("@magna-carta/app")).toBe(10);
  });

  it("counts a package's OWN tests but never a dependency's", () => {
    // The asymmetry is the whole proxy. Linting a package lints its own tests, so they are part of
    // its cost. A DEPENDENCY's tests are not: the type-aware linter builds its program from what the
    // code under lint imports, and nothing imports a test. Counting them added 609 phantom files to
    // api-worker's 61-package closure — 30% of the one number the fan-out-sink rule is decided by.
    const graph = new Map([
      ["@magna-carta/leaf", { dir: "packages/leaf", deps: new Set() }],
      ["@magna-carta/app", { dir: "apps/app", deps: new Set(["@magna-carta/leaf"]) }],
    ]);
    const root = writeWorkspace({
      "@magna-carta/leaf": { dir: "packages/leaf", files: 2, tests: 50 },
      "@magna-carta/app": { dir: "apps/app", files: 5, tests: 7, deps: ["@magna-carta/leaf"] },
    });
    const weights = computeTypeProgramWeights({ root, packages: graph });
    // leaf lints itself: 2 source + its own 50 tests.
    expect(weights.get("@magna-carta/leaf")).toBe(52);
    // app lints itself (5 + its own 7) and imports leaf's 2 source files — NOT leaf's 50 tests.
    expect(weights.get("@magna-carta/app")).toBe(14);
  });

  it("does not count build output or generated trees toward a weight", () => {
    // Otherwise the sink selection would depend on whether the checkout happened to be built.
    const graph = new Map([["@magna-carta/leaf", { dir: "packages/leaf", deps: new Set() }]]);
    const root = writeWorkspace({
      "@magna-carta/leaf": {
        dir: "packages/leaf",
        files: 2,
        uncounted: { "src/pkg": 40, dist: 40, "node_modules/x": 40 },
      },
    });
    expect(computeTypeProgramWeights({ root, packages: graph }).get("@magna-carta/leaf")).toBe(2);
  });

  it("selects only the packages whose type program is at least the share of the workspace", () => {
    const weights = new Map([
      ["@magna-carta/huge", 80],
      ["@magna-carta/middling", 49],
      ["@magna-carta/small", 4],
    ]);
    expect([...selectFanoutSinks({ weights, share: 0.5, totalLintableFiles: 100 })]).toEqual([
      "@magna-carta/huge",
    ]);
    // The share is the dial; nothing is hardcoded to a package name.
    expect([...selectFanoutSinks({ weights, share: 0.4, totalLintableFiles: 100 })]).toEqual([
      "@magna-carta/huge",
      "@magna-carta/middling",
    ]);
  });

  it("selects nothing when no package's type program dominates the workspace", () => {
    const root = writeWorkspace({
      "@magna-carta/a": { dir: "packages/a", files: 10 },
      "@magna-carta/b": { dir: "packages/b", files: 10 },
      "@magna-carta/c": { dir: "packages/c", files: 10 },
    });
    const graph = new Map([
      ["@magna-carta/a", { dir: "packages/a", deps: new Set() }],
      ["@magna-carta/b", { dir: "packages/b", deps: new Set() }],
      ["@magna-carta/c", { dir: "packages/c", deps: new Set() }],
    ]);
    expect([...resolveFanoutSinks({ root, packages: graph }).sinks]).toEqual([]);
  });
});
