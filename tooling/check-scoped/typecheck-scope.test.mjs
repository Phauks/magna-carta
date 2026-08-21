import { describe, expect, it } from "vitest";
import { reachesTypeGraph, reachingPaths } from "./typecheck-scope.mjs";

// The asymmetry under test is the whole point: a wrong `true` costs seconds, a wrong `false` returns a
// green gate for a diff nothing read. So the "still checks" cases far outnumber the "skips" ones, and
// every extension and directory anybody has proposed skipping is pinned here as one that does not.
describe("reachesTypeGraph", () => {
  it("skips a diff of nothing but prose", () => {
    expect(reachesTypeGraph(["docs/conventions/build-performance.md", "CLAUDE.md"])).toBe(false);
  });

  it("skips the full retire-an-active-work-note change set", () => {
    // The shape that motivated this: delete a stream note, clear the fragment pointer naming it, and
    // re-render both status trackers. Four files, no code, and STATUS.json is the one that would have
    // dragged the whole set back into a type-check.
    expect(
      reachesTypeGraph([
        "docs/active-work/claude/some-branch.md",
        "status.d/tools-area.md",
        "STATUS.md",
        "STATUS.json",
      ]),
    ).toBe(false);
  });

  it("skips the generated renderings of the feature ledger", () => {
    expect(
      reachesTypeGraph([
        "roadmap.d/platform.md",
        "docs/now.md",
        "docs/now.html",
        "docs/register-history.json",
      ]),
    ).toBe(false);
  });

  for (const file of [
    "packages/ledger/src/post-entry.ts",
    "apps/web-worker/src/routes/+page.svelte",
    "tooling/platform-seal-certificate/index.mts",
    "packages/database/src/schema.cts",
    "apps/api-worker/scripts/emit-openapi.mts",
    "packages/money/package.json",
    "packages/money/tsconfig.build.json",
    "tsconfig.base.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "vite.config.ts",
    "tooling/check-scoped/index.mjs",
  ]) {
    it(`still type-checks when ${file} changed`, () => {
      expect(reachesTypeGraph(["docs/Decision-Log.md", file])).toBe(true);
    });
  }

  it("still type-checks a JSON fixture under packages/, which resolveJsonModule makes a module", () => {
    expect(reachesTypeGraph(["packages/encryption/test/golden/aad-vectors.json"])).toBe(true);
  });

  it("still type-checks a package's own docs directory", () => {
    // The `docs/` rule is anchored at the repository root on purpose — a `docs/` folder inside a
    // package is inside a project's include glob.
    expect(reachesTypeGraph(["packages/design-system/docs/tokens.ts"])).toBe(true);
  });

  it("still type-checks a path shape nobody anticipated", () => {
    expect(reachesTypeGraph(["some-new-top-level-thing/whatever.qq"])).toBe(true);
  });

  it("answers true for an empty change set", () => {
    // "Nothing to go on" must not read as "nothing to check". The caller exits before this, but the
    // predicate has to be safe on its own.
    expect(reachesTypeGraph([])).toBe(true);
  });
});

describe("reachingPaths", () => {
  it("names only the paths that forced the check", () => {
    expect(
      reachingPaths(["CLAUDE.md", "packages/ledger/src/post-entry.ts", "STATUS.json"]),
    ).toEqual(["packages/ledger/src/post-entry.ts"]);
  });

  it("caps the list so a large diff does not print itself", () => {
    const files = Array.from({ length: 40 }, (_, index) => `packages/ledger/src/f${index}.ts`);
    expect(reachingPaths(files)).toHaveLength(3);
  });
});
