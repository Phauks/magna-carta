// Computes the minimal path set the CI type-aware lint (`vp check --no-fmt <paths>`) must cover for a
// given change, so the gate lints only what a change can affect instead of the whole repo (~24 min).
// The type-aware pass builds its type program lazily from the passed files' import closure, so linting
// one package is seconds where the whole repo is minutes — the win is real and needs no upstream cache.
//
// SOUNDNESS. A type-aware lint finding in an UNCHANGED file can flip when a DEPENDENCY changes (e.g.
// `no-floating-promises` once a dependency's function starts returning a Promise). So the affected set
// is the changed workspace packages PLUS their transitive DEPENDENTS — never just the changed files
// (that is why `check-scoped`, which lints only changed files, is right for the local pre-push loop but
// not for the gate of record). Any change to a global input that can move lint results repo-wide — the
// lint ruleset, the compiler options every package inherits, the lockfile, or this logic itself — forces
// a whole-repo lint. A lintable source file outside every workspace package cannot be reasoned about
// through the package graph, so it too forces a whole-repo lint. Only the lint job is scoped this way;
// type-check, tests, and the contract checks still run whole-repo, so this bounds the type-aware lint
// pass, nothing else. Home: docs/conventions/build-performance.md.
//
// Output (stdout): the literal `ALL` (lint the whole repo), the literal `NONE` (no lintable package
// affected — skip), or a space-separated list of package directories to pass to `vp check --no-fmt`.
// Human context goes to stderr. Usage: `node tooling/affected-lint/index.mjs --base <ref>`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The pnpm workspace globs that hold `@magna-carta/*` packages (pnpm-workspace.yaml).
const GROUPS = ["apps", "packages", "plugins"];

// Exact repo-relative paths whose change re-verifies the whole repo.
export const GLOBAL_TRIGGER_PATHS = new Set([
  "vite.config.ts", // the lint ruleset (rules / categories / plugins) + where typeAware is configured
  "pnpm-lock.yaml", // the resolved dependency versions (and thus their types)
  "pnpm-workspace.yaml", // the version catalog + the workspace shape
  "package.json", // the root manifest: catalog + toolchain
  "tsconfig.base.json", // the compiler options every package extends
  "tsconfig.json", // the root solution config
]);

// Repo-relative path prefixes whose change re-verifies the whole repo.
export const GLOBAL_TRIGGER_PREFIXES = [
  "packages/tsconfig/", // the shared tsconfig base every package extends
  ".github/", // a workflow / action change — re-verify everything
  "tooling/affected-lint/", // THIS logic — if it changes, it cannot be trusted to scope itself
];

// The extensions oxlint / tsgolint lint. A changed source file outside every workspace package (a root
// script, most of tooling/) can't be scoped via the graph, so it forces a whole-repo lint.
const LINT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

// Discover every workspace package as name -> { dir (repo-relative, POSIX), deps:Set<@magna-carta/*> }.
// Unlike the tsconfig-references graph this includes web and api-client: they are lint dependents whose
// findings can flip when a dependency changes, even though api-client's own src is lint-ignored.
export function discoverPackages(root) {
  const packages = new Map();
  for (const group of GROUPS) {
    const base = path.join(root, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const manifestPath = path.join(base, entry, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name !== "string" || !manifest.name.startsWith("@magna-carta/")) continue;
      const deps = new Set(
        Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
          (dependency) => dependency.startsWith("@magna-carta/"),
        ),
      );
      packages.set(manifest.name, { dir: `${group}/${entry}`, deps });
    }
  }
  return packages;
}

// Pure core: given the changed files and the discovered package graph, decide the lint scope.
// Returns { mode: "all" | "none" | "paths", reason?, paths? }.
export function computeAffected({ changedFiles, packages }) {
  for (const file of changedFiles) {
    if (GLOBAL_TRIGGER_PATHS.has(file) || GLOBAL_TRIGGER_PREFIXES.some((p) => file.startsWith(p))) {
      return { mode: "all", reason: `global input changed (${file})` };
    }
  }

  // Longest dir prefix wins, so a nested package is not swallowed by an ancestor.
  const owners = [...packages.entries()]
    .map(([name, member]) => ({ name, prefix: `${member.dir}/` }))
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const changed = new Set();
  for (const file of changedFiles) {
    const owner = owners.find(({ prefix }) => file.startsWith(prefix));
    if (owner) {
      changed.add(owner.name);
    } else if (LINT_EXTENSIONS.has(path.posix.extname(file))) {
      return { mode: "all", reason: `lintable source outside any package (${file})` };
    }
    // A non-source file outside every package (a stray data/text file) has nothing to lint.
  }

  if (changed.size === 0) return { mode: "none", reason: "no lintable package changed" };

  // Invert the dependency edges into direct-dependent edges, then close over them.
  const dependents = new Map([...packages.keys()].map((name) => [name, new Set()]));
  for (const [name, member] of packages) {
    for (const dependency of member.deps) dependents.get(dependency)?.add(name);
  }
  const affected = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    for (const dependent of dependents.get(queue.pop()) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }

  const paths = [...affected]
    .map((name) => packages.get(name).dir)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { mode: "paths", paths };
}

function changedFilesSince(base) {
  return execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMain()) {
  const baseIndex = process.argv.indexOf("--base");
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : "HEAD~1";
  const result = computeAffected({
    changedFiles: changedFilesSince(base),
    packages: discoverPackages(process.cwd()),
  });
  if (result.mode === "all") {
    console.error(`affected-lint: whole repo — ${result.reason}`);
    console.log("ALL");
  } else if (result.mode === "none") {
    console.error(`affected-lint: nothing to lint — ${result.reason}`);
    console.log("NONE");
  } else {
    console.error(`affected-lint: ${result.paths.length} affected package(s) to lint`);
    console.log(result.paths.join(" "));
  }
}
