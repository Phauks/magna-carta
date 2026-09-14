// Computes the minimal path set the CI type-aware lint (`vp check --no-fmt <paths>`) must cover for a
// given change, so the gate lints only what a change can affect instead of the whole repo (~45 min).
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
// default) is the complete answer. A cap of 1 — the changed packages plus their DIRECT dependents —
// remains available, but the gate no longer uses it, because graph DISTANCE turned out to be a poor
// proxy for lint COST here: `apps/api-worker` depends directly on 39 of the repository's 61 workspace
// packages, so it sits one hop from nearly every change and a one-hop cap saved almost nothing.
// `--defer-fanout-sinks` below measures cost directly instead.
//
// FAN-OUT SINKS (`--defer-fanout-sinks`). A package's type-aware lint cost is set by the size of the
// type program the linter has to build, and that program is the package's own files plus everything
// they import — so `typeProgramWeight` below (the lintable-file count of a package's transitive
// DEPENDENCY closure) is the cost proxy. One package is a wild outlier on it, and re-linting that one
// package as a DEPENDENT is most of the merge gate's bill. `--defer-fanout-sinks` drops such a package
// from the scope when it is merely a dependent — never when it is itself changed, so an author's own
// code is always linted on their own pull request. The dropped work is not skipped, it MOVES: every
// trigger other than `pull_request` passes no such flag and lints the full unbounded closure, so the
// union of the pull-request pass and the post-merge pass still covers everything the unbounded walk
// covers. Coverage of that union is asserted by scope-fitness.mjs beside this file.
//
// Output (stdout): the literal `ALL` (lint the whole repo), the literal `NONE` (no lintable package
// affected — skip), or a space-separated list of package directories to pass to `vp check --no-fmt`.
// Human context goes to stderr.
// Usage: `node tooling/affected-lint/index.mjs --base <ref> [--max-hops <n>] [--defer-fanout-sinks]`.

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
// not force the ~45-min whole-repo lint. A genuinely lintable file under `.github/` (a JS-based action) is
// still caught below by the "lintable source outside any package" rule, which forces ALL — so dropping the
// blanket prefix narrows the trigger to real lint inputs without a soundness gap.
export const GLOBAL_TRIGGER_PREFIXES = [
  "packages/tsconfig/", // the shared tsconfig base every package extends
  "tooling/affected-lint/", // THIS logic — if it changes, it cannot be trusted to scope itself
];

// The extensions oxlint / tsgolint lint. A changed source file outside every workspace package (a root
// script, most of tooling/) can't be scoped via the graph, so it forces a whole-repo lint.
const LINT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

/*
 * Package sources the linter is configured never to read, held verbatim from `lint.ignorePatterns`
 * in the root vite.config.ts and checked against it by scope-fitness.mjs, so the two cannot drift.
 *
 * WHY THE COST PROXY HAS TO KNOW. The proxy below counts a package's transitive closure by file
 * EXTENSION, which was right while every `.ts` file in the workspace was one the linter opens. The
 * generated Hey API client is not: it is excluded from lint outright (its codegen idioms trip our
 * rules) and type-checked by its own `tsc -p` instead. Counting it charged @magna-carta/web 19 files
 * of lint minutes that the linter does not spend, and that error lands on the one measurement the
 * fan-out-sink rule is decided by — a package can be pushed across the outlier threshold by a
 * dependency that costs the linter nothing. Only the two whole-directory package excludes are
 * listed; `.claude/worktrees/**` is outside every package and cannot reach this count.
 */
export const LINT_EXCLUDED_PACKAGE_SOURCES = ["packages/api-client/src"];

/** True when the linter is configured to skip this directory and everything under it. */
function isLintExcluded(directory, root) {
  const relative = path.relative(root, directory).split(path.sep).join("/");
  return LINT_EXCLUDED_PACKAGE_SOURCES.some(
    (excluded) => relative === excluded || relative.startsWith(`${excluded}/`),
  );
}

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

// Directories that hold no hand-written source and must not count toward a package's weight: build
// output, the git-ignored Rust->WASM output (`src/pkg`), and generated token/client trees. Counting
// them would inflate the weight of whichever package happened to have been built in the checkout,
// making the sink selection depend on build state rather than on the repository.
const UNCOUNTED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "pkg",
  "generated",
  ".svelte-kit",
  ".wrangler",
  ".tsbuild",
  ".vite",
]);

/*
 * A test file — one nothing in the product imports.
 *
 * This matters because the two counts below diverge on exactly this set. A package's OWN tests are
 * linted with it, so they are part of ITS cost. A DEPENDENCY's tests are not: the type-aware linter
 * builds its program from what the code under lint imports, and no source file imports a test. They
 * were being counted anyway, and across api-worker's 61-package closure that was 609 files of lint
 * work nobody does — 30% of the number the fan-out-sink rule is decided by.
 */
function isTestFile(relativePath) {
  const segments = relativePath.split("/");
  return (
    segments.includes("test") ||
    segments.includes("tests") ||
    segments.includes("__tests__") ||
    /\.test\.[mc]?tsx?$/.test(relativePath) ||
    /\.spec\.[mc]?tsx?$/.test(relativePath)
  );
}

/**
 * Count a package's lintable files, split by what each count is for.
 *
 * `linted` is every lintable file in the package — what a lint of THIS package covers, tests
 * included. `importable` drops the tests — what a lint of a package that DEPENDS on this one has to
 * pull into its type program. See `isTestFile` for why the two differ.
 */
function countLintableFiles(directory, root) {
  if (root !== undefined && isLintExcluded(directory, root)) return { linted: 0, importable: 0 };
  let linted = 0;
  let importable = 0;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return { linted: 0, importable: 0 };
  }
  for (const entry of entries) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!UNCOUNTED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
        const nested = countLintableFiles(child, root);
        linted += nested.linted;
        importable += nested.importable;
      }
    } else if (LINT_EXTENSIONS.has(path.posix.extname(entry.name))) {
      linted += 1;
      const relative =
        root === undefined ? entry.name : path.relative(root, child).split(path.sep).join("/");
      if (!isTestFile(relative)) importable += 1;
    }
  }
  return { linted, importable };
}

// The cost proxy: how many lintable files the type-aware linter has to pull into a type program to
// lint this package — the package's own files (tests included; they are linted with it) plus the
// IMPORTABLE files of its transitive dependency closure. This is the direction the linter reads (a
// package's findings depend on what it imports), which is the opposite of the dependent walk the
// scope is computed with, and it is what makes one package's lint minutes and another's seconds.
//
// The own/dependency asymmetry is the whole point and was the bug: the proxy used to add every
// lintable file in the closure, tests and all. A dependency's tests are never pulled into a
// dependent's type program — nothing imports a test — so they were 609 phantom files on
// api-worker's 61-package closure, 30% of the one number the fan-out-sink rule is decided by.
// Verified against measured lint times; see scope-fitness.mjs for the figures and what they settled.
//
// Returns name -> weight.
export function computeTypeProgramWeights({ root, packages }) {
  const counts = new Map();
  for (const [name, member] of packages) {
    counts.set(name, countLintableFiles(path.join(root, member.dir), root));
  }
  const weights = new Map();
  for (const name of packages.keys()) {
    const closure = new Set();
    const stack = [name];
    while (stack.length > 0) {
      const current = stack.pop();
      if (closure.has(current)) continue;
      closure.add(current);
      for (const dependency of packages.get(current)?.deps ?? []) stack.push(dependency);
    }
    let weight = counts.get(name)?.linted ?? 0;
    for (const member of closure) {
      if (member !== name) weight += counts.get(member)?.importable ?? 0;
    }
    weights.set(name, weight);
  }
  return weights;
}

// A package is a fan-out sink when its type program is at least this share of every lintable file in
// the workspace. Expressed as a SHARE rather than a file count so it needs no re-tuning as the repo
// grows: the point is "this package's lint costs what a whole-repo lint costs", which is a ratio, not
// an absolute.
//
// LOWERED FROM 0.5 TO 0.35 ON 2026-09-14, together with the weighting fix above and NOT independently
// of it. Dropping the 609 phantom dependency-test files moved apps/api-worker from 2022 to 1413 of
// 3088 — from 65% of the workspace to 46% — so at 0.5 it stopped being selected and the deferral
// became a silent no-op. The share had been calibrated against an inflated numerator; correcting one
// without the other would have changed the gate's behaviour while appearing to leave it alone.
//
// 0.35 is set from MEASURED LINT TIME rather than from the proxy, because the proxy is what was in
// question. Warm `vp check --no-fmt <package>` on 2026-09-14 (one machine, second of two runs):
//   apps/api-worker     11,730 ms   (first run, cold: 16,774)
//   apps/web             2,561 ms
//   packages/data-access 2,088 ms
//   packages/trust       1,652 ms
//   packages/money       1,372 ms
// api-worker is 4.6x apps/web and 7.1x a typical domain package, which is what justifies deferring it
// off the pull-request tier and justifies nothing else being deferred. Note the per-file cost is
// superlinear — 8.3 ms/file for api-worker against 2.5 for apps/web — so a file-count proxy
// UNDERSTATES the outlier it is selecting, which is the safe direction for this rule to be wrong in.
//
// At 0.35 the threshold is 1081: api-worker clears it at 1.31x and apps/web (1042) sits below, which
// reproduces exactly the selection the gate has been making, now on a numerator that means what it
// says. Raise or lower it only with a fresh distribution AND fresh timings in hand — scope-fitness.mjs
// prints the distribution and fails if the rule ever selects a broad slice of the workspace.
export const FANOUT_SINK_SHARE = 0.35;

export function selectFanoutSinks({
  weights,
  share = FANOUT_SINK_SHARE,
  totalLintableFiles,
  ownFiles = new Map(),
}) {
  const threshold = totalLintableFiles * share;
  const sinks = new Set();
  for (const [name, weight] of weights) {
    if (weight < threshold) continue;
    // A package with no lintable files OF ITS OWN cannot be a sink, however heavy its closure.
    // Deferring it defers no lint work — there is nothing in it to lint — while its weight is
    // entirely its dependencies', which are selected on their own merits or not at all. apps/web-worker
    // is the live case: zero own files, one dependency on apps/web, and therefore apps/web's weight
    // exactly and forever. Counting it as a second sink would report the same lint minutes twice and
    // spend the two-sink budget on a package whose deferral saves nothing.
    if (ownFiles.size > 0 && (ownFiles.get(name) ?? 0) === 0) continue;
    sinks.add(name);
  }
  return sinks;
}

// Pure core: given the changed files and the discovered package graph, decide the lint scope.
// `maxHops` bounds how far the dependent walk goes (Infinity = the full transitive closure; 1 = the
// changed packages plus their direct dependents). `sinks` (when given) are dropped from the scope
// unless they are themselves changed — see the fan-out note at the top of this file. Returns
// { mode: "all" | "none", reason } or { mode: "paths", paths, deferred }.
export function computeAffected({
  changedFiles,
  packages,
  maxHops = Number.POSITIVE_INFINITY,
  sinks = new Set(),
}) {
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

  // Drop the fan-out sinks that are only in scope AS DEPENDENTS. A sink the change itself touched
  // stays: the rule is about not re-linting the repository's one whole-program package every time
  // something it imports moves, never about skipping the author's own code.
  const deferred = new Set();
  for (const name of affected) {
    if (sinks.has(name) && !changed.has(name)) deferred.add(name);
  }
  const scoped = [...affected].filter((name) => !deferred.has(name));

  // The scope can never come back empty here: every changed package is in `affected` and none of them
  // can be deferred, and `changed` is non-empty or we returned above. Asserted rather than assumed,
  // because an empty scope is the one value the gate's contract has no branch for — it refuses to
  // guess, so a refactor that broke the invariant would fail the gate on a confusing message instead
  // of this one.
  if (scoped.length === 0) {
    throw new Error(
      "affected-lint: deferral emptied a non-empty scope — the changed packages are missing",
    );
  }

  const toDirectories = (names) =>
    names.map((name) => packages.get(name).dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { mode: "paths", paths: toDirectories(scoped), deferred: toDirectories([...deferred]) };
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

// Resolve the fan-out sinks for a real checkout: weigh every package's type program, then take the
// outliers. Exported so the fitness function reports the same set the gate acts on.
export function resolveFanoutSinks({ root, packages }) {
  const weights = computeTypeProgramWeights({ root, packages });
  // The workspace total is the sum of each package's OWN files, which is what a whole-repo lint
  // covers; a weight is measured against that, not against the sum of the weights (which
  // double-counts every shared dependency).
  let totalLintableFiles = 0;
  const ownFiles = new Map();
  for (const [name, member] of packages) {
    const own = countLintableFiles(path.join(root, member.dir), root).linted;
    ownFiles.set(name, own);
    totalLintableFiles += own;
  }
  return {
    weights,
    ownFiles,
    totalLintableFiles,
    threshold: totalLintableFiles * FANOUT_SINK_SHARE,
    sinks: selectFanoutSinks({ weights, totalLintableFiles, ownFiles }),
  };
}

if (isMain()) {
  const baseIndex = process.argv.indexOf("--base");
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : "HEAD~1";
  const maxHops = parseMaxHops(process.argv);
  const deferSinks = process.argv.includes("--defer-fanout-sinks");
  const root = process.cwd();
  const packages = discoverPackages(root);
  const sinks = deferSinks ? resolveFanoutSinks({ root, packages }).sinks : new Set();
  const result = computeAffected({
    changedFiles: changedFilesSince(base),
    packages,
    maxHops,
    sinks,
  });
  const depth = maxHops === Number.POSITIVE_INFINITY ? "full closure" : `${maxHops} hop(s)`;
  if (result.deferred?.length) {
    console.error(
      `affected-lint: deferring ${result.deferred.length} fan-out sink(s) to the post-merge pass — ${result.deferred.join(", ")}`,
    );
  }
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
