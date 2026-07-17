import { describe, expect, it } from "vitest";
import { computeAffected } from "./index.mjs";

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

  it("forces a whole-repo lint for the global-input prefixes (shared tsconfig, .github, this logic)", () => {
    for (const file of [
      "packages/tsconfig/base.json",
      ".github/workflows/gate.yml",
      "tooling/affected-lint/index.mjs",
    ]) {
      expect(computeAffected({ changedFiles: [file], packages }).mode).toBe("all");
    }
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
