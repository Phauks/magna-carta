// Computes the minimal path set the CI type-aware lint (`vp check --no-fmt <paths>`) must cover for a
// given change, so the gate lints only what a change can affect instead of the whole repo (~24 min).
// The type-aware pass builds its type program lazily from the passed files' import closure, so linting
// one package is seconds where the whole repo is minutes — the win is real and needs no upstream cache.
//
// SOUNDNESS. A type-aware lint finding in an UNCHANGED file can flip when a DEPENDENCY changes (e.g.
// `no-floating-promises` once a dependency's function starts returning a Promise). So the affected set
// is the changed workspace packages PLUS their DEPENDENTS — never just the changed files (that is why
// `check-scoped`, which lints only changed files, is right for the local pre-push loop but not for a
// merge gate). Any change to a global input that can move lint results repo-wide — the lint ruleset,
// the compiler options every package inherits, the lockfile, or this logic itself — forces a whole-repo
// lint. A lintable source file outside every workspace package cannot be reasoned about through the
// package graph, so it too forces a whole-repo lint. Only the lint job is scoped this way; type-check,
// tests, and the contract checks still run whole-repo, so this bounds the type-aware lint pass, nothing
// else. Home: docs/conventions/build-performance.md.
//
// DEPTH (`--max-hops`). How far down the dependent chain to walk is a cost/latency dial, not a
// correctness one, because the closure is re-walked in full before anything ships. Unbounded (the
// default) is the complete answer and is what the merge and scheduled passes use. `--max-hops 1` — the
// changed packages plus their DIRECT dependents — is the pull-request setting: it catches the type flip
// a change actually propagates in the overwhelming majority of cases, at a fraction of the cost of
// re-linting a foundational package's entire dependent set, and anything deeper than one hop is caught
// by the unbounded pass before the change can reach a release.
//
// Output (stdout): the literal `ALL` (lint the whole repo), the literal `NONE` (no lintable package
// affected — skip), or a space-separated list of package directories to pass to `vp check --no-fmt`.
// Human context goes to stderr.
// Usage: `node tooling/affected-lint/index.mjs --base <ref> [--max-hops <n>]`.

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

// Repo-relative path prefixes whose change re-verifies the whole repo. `.github/` is deliberately NOT
// here: a workflow or action YAML change (e.g. gate.yml) cannot move a type-aware lint result, so it must
// not force the ~24-min whole-repo lint. A genuinely lintable file under `.github/` (a JS-based action) is
// still caught below by the "lintable source outside any package" rule, which forces ALL — so dropping the
// blanket prefix narrows the trigger to real lint inputs without a soundness gap.
export const GLOBAL_TRIGGER_PREFIXES = [
  "packages/tsconfig/", // the shared tsconfig base every package extends
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
// `maxHops` bounds how far the dependent walk goes (Infinity = the full transitive closure; 1 = the
// changed packages plus their direct dependents). Returns { mode: "all" | "none", reason } or
// { mode: "paths", paths }.
export function computeAffected({ changedFiles, packages, maxHops = Number.POSITIVE_INFINITY }) {
  if (!(maxHops >= 1)) {
    throw new Error(`affected-lint: --max-hops must be at least 1 (got ${maxHops})`);
  }
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

  // Invert the dependency edges into direct-dependent edges, then walk them breadth-first so the walk
  // can be cut off at a hop count. Breadth-first is what makes `maxHops` mean "hops from a changed
  // package" rather than "whatever a depth-first stack happened to reach first".
  const dependents = new Map([...packages.keys()].map((name) => [name, new Set()]));
  for (const [name, member] of packages) {
    for (const dependency of member.deps) dependents.get(dependency)?.add(name);
  }
  const affected = new Set(changed);
  let frontier = [...changed];
  for (let hop = 0; hop < maxHops && frontier.length > 0; hop += 1) {
    const next = [];
    for (const name of frontier) {
      for (const dependent of dependents.get(name) ?? []) {
        if (!affected.has(dependent)) {
          affected.add(dependent);
          next.push(dependent);
        }
      }
    }
    frontier = next;
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

// `--max-hops <n>`; absent or `all` means the full transitive closure. Anything else is a hard error —
// a typo must not silently widen or narrow the scope the gate then trusts.
export function parseMaxHops(argv) {
  const index = argv.indexOf("--max-hops");
  if (index < 0) return Number.POSITIVE_INFINITY;
  const raw = argv[index + 1];
  if (raw === undefined || raw === "all") return Number.POSITIVE_INFINITY;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`affected-lint: --max-hops expects a positive integer or "all" (got "${raw}")`);
  }
  return Number(raw);
}

if (isMain()) {
  const baseIndex = process.argv.indexOf("--base");
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : "HEAD~1";
  const maxHops = parseMaxHops(process.argv);
  const result = computeAffected({
    changedFiles: changedFilesSince(base),
    packages: discoverPackages(process.cwd()),
    maxHops,
  });
  const depth = maxHops === Number.POSITIVE_INFINITY ? "full closure" : `${maxHops} hop(s)`;
  if (result.mode === "all") {
    console.error(`affected-lint: whole repo — ${result.reason}`);
    console.log("ALL");
  } else if (result.mode === "none") {
    console.error(`affected-lint: nothing to lint — ${result.reason}`);
    console.log("NONE");
  } else {
    console.error(`affected-lint: ${result.paths.length} affected package(s) to lint (${depth})`);
    console.log(result.paths.join(" "));
  }
}
