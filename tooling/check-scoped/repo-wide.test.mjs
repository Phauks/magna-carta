import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFERRED_LINTS,
  DEPENDENCY_MANIFEST_PATTERN,
  allRepoWideLints,
  discoverFitnessMembers,
  fitnessMemberFiles,
  lintInvocation,
  repoWideLints,
} from "./repo-wide.mjs";

// The derivation is the whole design (see repo-wide.mjs): membership must not be a list anybody has to
// remember to extend. These tests hold the derivation against a scratch tree, and then hold the REAL
// repository to the three checks whose escape is on record — a de-registration that made the gate
// vacuously green would otherwise look exactly like a passing run.

let root;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "repo-wide-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeManifest(scripts) {
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts }), "utf8");
}

function writeTest(relativePath, contents) {
  const full = path.join(root, relativePath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

describe("lint derivation", () => {
  it("takes every lint:* script and nothing else, so a new one is gated with no edit here", () => {
    writeManifest({ "lint:new-rule": "node tooling/x.mjs", build: "vp build", test: "vp test" });
    expect(allRepoWideLints({ root })).toEqual(["lint:new-rule"]);
  });

  it("throws rather than returning an empty set — a scan that finds nothing must not pass", () => {
    writeManifest({ build: "vp build" });
    expect(() => allRepoWideLints({ root })).toThrow(/derivation is broken/);
  });

  it("holds the deferred lints out of the inner-loop set", () => {
    writeManifest({ "lint:a": "node a.mjs", "lint:licenses": "node b.mjs" });
    expect(repoWideLints({ root })).toEqual(["lint:a"]);
  });

  it("admits the dependency-set lint when a manifest or lockfile moved", () => {
    writeManifest({ "lint:a": "node a.mjs", "lint:licenses": "node b.mjs" });
    expect(repoWideLints({ root, dependenciesChanged: true })).toEqual(["lint:a", "lint:licenses"]);
  });

  it("does not admit test-collection on a dependency change — it is deferred outright", () => {
    writeManifest({ "lint:test-collection": "node c.mjs" });
    expect(repoWideLints({ root, dependenciesChanged: true })).toEqual([]);
    expect(repoWideLints({ root, all: true })).toEqual(["lint:test-collection"]);
  });

  it("drops an explicitly excepted name, for a tier that runs it in its own job", () => {
    writeManifest({ "lint:a": "node a.mjs", "lint:test-collection": "node c.mjs" });
    expect(repoWideLints({ root, all: true, except: ["lint:test-collection"] })).toEqual([
      "lint:a",
    ]);
  });

  it("every deferred name is a real script, so a renamed lint cannot sit silently deferred", () => {
    const declared = new Set(allRepoWideLints());
    for (const name of DEFERRED_LINTS.keys()) expect(declared).toContain(name);
  });
});

describe("lintInvocation", () => {
  it("spawns a plain command directly, skipping the pnpm startup cost", () => {
    writeManifest({ "lint:a": "node tooling/lint-a.mjs" });
    expect(lintInvocation("lint:a", { root })).toEqual({
      command: "node",
      args: ["tooling/lint-a.mjs"],
    });
  });

  it("falls back to pnpm for a script with shell syntax, rather than not running it", () => {
    writeManifest({ "lint:a": "node a.mjs && node b.mjs" });
    expect(lintInvocation("lint:a", { root })).toEqual({
      command: "pnpm",
      args: ["run", "--silent", "lint:a"],
    });
  });
});

describe("dependency manifest pattern", () => {
  it("matches the files that can move what the license scan sees", () => {
    for (const file of [
      "package.json",
      "packages/trust/package.json",
      "pnpm-lock.yaml",
      "crates/Cargo.lock",
      "containers/scan/Cargo.toml",
    ]) {
      expect(DEPENDENCY_MANIFEST_PATTERN.test(file), file).toBe(true);
    }
  });

  it("does not match ordinary source or docs", () => {
    for (const file of ["packages/trust/src/holds.ts", "docs/conventions/testing.md"]) {
      expect(DEPENDENCY_MANIFEST_PATTERN.test(file), file).toBe(false);
    }
  });
});

describe("fitness member discovery", () => {
  it("finds a test that declares the directive and ignores one that does not", () => {
    writeTest("packages/a/test/declared.test.ts", "// @repo-wide-fitness — scans everything\n");
    writeTest("packages/a/test/ordinary.test.ts", "// an ordinary unit test\n");
    expect(discoverFitnessMembers({ root })).toEqual([
      { file: "packages/a/test/declared.test.ts", scope: "source" },
    ]);
  });

  it("reads the declared scope, so the schema-only checks trigger separately", () => {
    writeTest("packages/a/test/one.test.ts", "// @repo-wide-fitness scope=schema — pins a table\n");
    expect(fitnessMemberFiles({ root, scopes: ["source"] })).toEqual([]);
    expect(fitnessMemberFiles({ root, scopes: ["source", "schema"] })).toEqual([
      "packages/a/test/one.test.ts",
    ]);
  });

  it("refuses an unknown scope rather than silently dropping the member", () => {
    writeTest("packages/a/test/one.test.ts", "// @repo-wide-fitness scope=invented\n");
    expect(() => discoverFitnessMembers({ root })).toThrow(/not one of/);
  });

  it("does not descend into node_modules", () => {
    writeTest("packages/a/test/node_modules/dep/x.test.ts", "// @repo-wide-fitness\n");
    expect(discoverFitnessMembers({ root })).toEqual([]);
  });

  it("ignores a directive that is not in the header — it is a declaration, not a footnote", () => {
    writeTest("packages/a/test/late.test.ts", `${"x".repeat(5000)}\n// @repo-wide-fitness\n`);
    expect(discoverFitnessMembers({ root })).toEqual([]);
  });
});

describe("the real repository's membership", () => {
  const members = new Set(discoverFitnessMembers().map((member) => member.file));

  // Named individually because each of these got a red `main` past a diff-scoped gate. Discovery is a
  // glob, so an empty result is the failure mode to fear; these three make "the sweep found nothing"
  // and "the sweep found the wrong things" both loud.
  it.each([
    "packages/data-access/test/pii-registry-coverage.test.ts",
    "packages/telemetry/test/console-ban.test.ts",
    "packages/telemetry/test/metric-catalog.test.ts",
  ])("%s is registered", (file) => {
    expect(members).toContain(file);
  });

  it("sweeps a meaningful number of checks in each scope", () => {
    expect(fitnessMemberFiles({ scopes: ["source"] }).length).toBeGreaterThanOrEqual(9);
    expect(fitnessMemberFiles({ scopes: ["schema"] }).length).toBeGreaterThanOrEqual(10);
  });
});
