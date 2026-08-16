// The repo-wide gate: the checks whose jurisdiction is the WHOLE repository, and which therefore
// cannot be scoped to a diff.
//
// WHAT BELONGS HERE. A check belongs to this set when **it scans the whole repository (or a registry
// spread across it) and can be broken by a change made anywhere** — so the file that breaks it is
// routinely in a different package from the check itself. That is the whole hazard: a diff-scoped
// gate runs the checks that live near the diff, and these never live near the diff. Three separate
// changes reached `main` red in one session that way — a measurement harness printing to the console
// (banned by a scan owned by packages/telemetry), a sweep of landed stream notes leaving dangling
// `status.d/` pointers, and a new table added unclassified against a registry owned by
// packages/data-access. None of the three touched the package that owned the check that governed it.
//
// A check does NOT belong here merely because it is a fitness function. A fitness function whose
// only possible input is its own package's source is already covered — the diff that can break it is
// the diff that reaches it.
//
// MEMBERSHIP IS DERIVED, NEVER LISTED. A hand-maintained roster in the gate is the same bug one level
// up: the next repo-wide check somebody writes will not be on it, and nothing will say so. So both
// halves of the set discover themselves.
//
//   * The LINTS are enumerated from the `lint:*` scripts in the root package.json. Adding
//     `"lint:whatever"` there puts it in the gate, with no edit here. The only entries not in the
//     inner-loop set are the ones in DEFERRED_LINTS below, each with a measured cost and the tier
//     that does run it.
//
//   * The FITNESS TESTS self-register with a directive comment in their own header
//     (`@repo-wide-fitness`, see FITNESS_DIRECTIVE). The check declares its own jurisdiction, in the
//     file a reader is already looking at, rather than in a list two directories away.
//
// Consumed by tooling/check-scoped/index.mjs (the inner loop), run-repo-wide-lints.mjs (the CLI both
// that gate and CI call), and vitest.repo-wide-fitness.config.ts (the sweep's include list).

import { closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./changed-files.mjs";

/**
 * The `lint:*` scripts deliberately kept OUT of the always-on inner-loop set, each with the measured
 * cost that put it here and the tier that does run it. Everything else in `lint:*` is always-on.
 *
 * Nothing is excluded for being unimportant — only for being too slow to sit in front of a command
 * people run dozens of times an hour. A gate that makes the inner loop unpleasant gets skipped, and a
 * skipped gate protects nothing.
 */
export const DEFERRED_LINTS = new Map([
  [
    "lint:licenses",
    {
      // 1.6 s — twenty times the median lint here, because it reads every installed package's license
      // file. Its only possible input is the dependency set, so the inner loop runs it exactly when a
      // manifest or a lockfile moves (see index.mjs); on every other diff it cannot fail.
      reason: "1.6 s, and dependency-set-only — run when a manifest or lockfile changes",
      runWhenDependenciesChange: true,
    },
  ],
  [
    "lint:test-collection",
    {
      // 26 s — four list-only Vitest collections over ~70 projects. An order of magnitude past what
      // the inner loop can absorb, and it verifies the SHAPE of the CI test split, which only a CI
      // change can break. Its home is the dedicated `test-collection` job in the gate workflow.
      reason: "26 s (four list-only Vitest collections) — CI's test-collection job only",
      runWhenDependenciesChange: false,
    },
  ],
]);

/** Paths whose change can move what `lint:licenses` sees. */
export const DEPENDENCY_MANIFEST_PATTERN =
  /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|Cargo\.toml|Cargo\.lock)$/;

/**
 * Every `lint:*` script in the root package.json, in declaration order.
 * Throws rather than returning an empty set: a scan that silently finds nothing is the failure mode
 * this whole module exists to prevent.
 */
export function allRepoWideLints({ root = ROOT } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const names = Object.keys(manifest.scripts ?? {}).filter((name) => name.startsWith("lint:"));
  if (names.length === 0) {
    throw new Error(
      "repo-wide: the root package.json declares no `lint:*` scripts — the derivation is broken, " +
        "not the repository (a genuinely empty set would mean every governance lint was deleted).",
    );
  }
  return names;
}

/**
 * The lint set for one tier.
 *
 * @param {object} options
 * @param {boolean} [options.dependenciesChanged] include the deferred lints whose input is the
 *   dependency set (inner loop, when a manifest or lockfile moved).
 * @param {boolean} [options.all] include every deferred lint (the whole-repo tier).
 * @param {readonly string[]} [options.except] names to drop — for a tier that runs one in its own job.
 */
export function repoWideLints({
  root = ROOT,
  dependenciesChanged = false,
  all = false,
  except = [],
} = {}) {
  const dropped = new Set(except);
  return allRepoWideLints({ root }).filter((name) => {
    if (dropped.has(name)) return false;
    const deferral = DEFERRED_LINTS.get(name);
    if (deferral === undefined) return true;
    if (all) return true;
    return dependenciesChanged && deferral.runWhenDependenciesChange;
  });
}

/**
 * How to spawn one lint. A plain `word word word` script (which every lint here is today — they are
 * all `node tooling/<something>`) is spawned directly, skipping ~600 ms of `pnpm run` startup per
 * lint. Anything with shell syntax in it — a pipe, a chain, an env assignment, a redirect — goes back
 * through `pnpm run`, which is slower but correct; nothing silently fails to run.
 */
export function lintInvocation(name, { root = ROOT } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const script = manifest.scripts?.[name];
  if (typeof script === "string" && /^[\w./@-]+(?: [\w./@=-]+)*$/.test(script.trim())) {
    const [command, ...args] = script.trim().split(/\s+/);
    return { command, args };
  }
  return { command: "pnpm", args: ["run", "--silent", name] };
}

/**
 * The self-registration directive. A repo-wide fitness test carries this in its header:
 *
 *     // @repo-wide-fitness — one line saying what it scans and why the diff can't reach it
 *     // @repo-wide-fitness scope=schema — ... (for a check whose only input is the Drizzle schema)
 *
 * Scopes, and why there are two rather than one:
 *   * `source` (the default) — the check reads first-party source, so any source change can break it.
 *     The inner loop runs these whenever the diff touches source at all.
 *   * `schema` — the check reads the Drizzle schema and nothing else. These are real, and they are
 *     exactly the shape that burned us (the check lives in packages/calendar, the table it pins lives
 *     in packages/database) — but they cost 2.0 s of module import for a combined 124 ms of assertion,
 *     and only a packages/database change can move their input. The inner loop runs them on that
 *     trigger, which is exact rather than approximate.
 */
export const FITNESS_DIRECTIVE = "@repo-wide-fitness";

const DIRECTIVE_PATTERN = /@repo-wide-fitness(?:\s+scope=([a-z-]+))?/;
export const FITNESS_SCOPES = new Set(["source", "schema"]);

/** Only the first slice of a file is read — the directive is a header declaration, not a footnote. */
const HEADER_BYTES = 4096;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  ".svelte-kit",
  "pkg",
]);

function walkTestFiles(directory, found) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      walkTestFiles(path.join(directory, entry.name), found);
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      found.push(path.join(directory, entry.name));
    }
  }
}

function readHeader(file) {
  const buffer = Buffer.alloc(HEADER_BYTES);
  const handle = openSync(file, "r");
  try {
    const read = readSync(handle, buffer, 0, HEADER_BYTES, 0);
    return buffer.toString("utf8", 0, read);
  } finally {
    closeSync(handle);
  }
}

/**
 * Every test file that has declared itself repo-wide, as repo-relative forward-slash paths with the
 * scope it declared.
 *
 * @returns {{ file: string, scope: string }[]} sorted by path, so the sweep's include list is stable.
 */
export function discoverFitnessMembers({ root = ROOT } = {}) {
  const files = [];
  for (const group of ["apps", "packages"]) {
    const base = path.join(root, group);
    let children;
    try {
      children = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      walkTestFiles(path.join(base, child.name, "test"), files);
      walkTestFiles(path.join(base, child.name, "src"), files);
    }
  }

  const members = [];
  for (const file of files) {
    const match = DIRECTIVE_PATTERN.exec(readHeader(file));
    if (match === null) continue;
    const scope = match[1] ?? "source";
    if (!FITNESS_SCOPES.has(scope)) {
      throw new Error(
        `repo-wide: ${path.relative(root, file)} declares ${FITNESS_DIRECTIVE} scope=${scope}, ` +
          `which is not one of: ${[...FITNESS_SCOPES].join(", ")}`,
      );
    }
    members.push({ file: path.relative(root, file).split(path.sep).join("/"), scope });
  }
  members.sort((a, b) => a.file.localeCompare(b.file));
  return members;
}

/** The member files for a set of scopes, as repo-relative forward-slash paths. */
export function fitnessMemberFiles({ root = ROOT, scopes = ["source"] } = {}) {
  const wanted = new Set(scopes);
  return discoverFitnessMembers({ root })
    .filter((member) => wanted.has(member.scope))
    .map((member) => member.file);
}

/** The env var the sweep config reads to know which scopes this run covers. */
export const FITNESS_SCOPES_ENV = "MAGNA_CARTA_FITNESS_SCOPES";
