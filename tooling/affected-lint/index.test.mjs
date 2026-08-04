import { describe, expect, it } from "vitest";
import { computeAffected, parseMaxHops } from "./index.mjs";

// A small synthetic graph: money is a leaf; data-access depends on money; worker depends on data-access;
// web depends on worker. So a change to money must pull in data-access, worker, and web (transitively).
const packages = new Map([
  ["@magna-carta/money", { dir: "packages/money", deps: new Set() }],
  [
    "@magna-carta/data-access",
    { dir: "packages/data-access", deps: new Set(["@magna-carta/money"]) },
  ],
  ["@magna-carta/worker", { dir: "apps/worker", deps: new Set(["@magna-carta/data-access"]) }],
  ["@magna-carta/web", { dir: "apps/web", deps: new Set(["@magna-carta/worker"]) }],
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
      "apps/web",
      "apps/worker",
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
      "apps/web",
      "apps/worker",
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
    // A .github change is NOT a global trigger: gate.yml alone has nothing lintable → none.
    expect(computeAffected({ changedFiles: [".github/workflows/gate.yml"], packages }).mode).toBe(
      "none",
    );
    // Alongside a package change, it is ignored and the scope is just that package's closure.
    expect(
      computeAffected({
        changedFiles: [".github/workflows/gate.yml", "apps/web/src/app.ts"],
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
    expect(twoHops.paths).toEqual(["apps/worker", "packages/data-access", "packages/money"]);
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
