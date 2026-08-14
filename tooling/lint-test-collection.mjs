import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Fitness function for what the gate's test jobs actually COLLECT (mirrors lint-test-registration.mjs,
// which guards the layer above: that every vitest config on disk is registered as a project at all).
//
// This one guards the layer below it. The gate splits the suite across three jobs whose union is
// supposed to be every registered test file exactly once. Nothing in the runner enforces that: a job
// whose filter matches nothing exits 0 having run nothing, so a mis-scoped filter reads as a fast green
// job rather than as a failure. That is not hypothetical — a filter of `packages` (a directory that is
// the PARENT of many project roots) silently collected zero files from every package in the repo while
// the job reported success.
//
// The mechanism, and why the gate passes ABSOLUTE paths: the runner matches a positional path filter
// per project, against the candidate file's path relative to THAT PROJECT'S OWN root — not against the
// repository-relative path. A relative filter naming an ancestor of a project root therefore reduces to
// `..` under that project and matches none of its files. An absolute filter takes a different branch
// entirely (a prefix test against the file's absolute path) and narrows exactly as a reader expects.
// Full explanation, and the guidance for filtering a run by hand: docs/conventions/build-performance.md.
//
// What this asserts, by re-running each of the gate's own invocations in list-only mode:
//   1. the unfiltered whole-suite collection meets a committed floor (below), so a config change that
//      silently drops whole swathes of the suite fails loudly instead of speeding CI up;
//   2. the union of the gate's three test jobs equals that whole-suite collection — no file runs
//      nowhere;
//   3. the three jobs are pairwise disjoint — no file is paid for twice.
//
// The invocations are not restated here from memory: each job's command is held verbatim and checked
// against the workflow file, so editing one without the other fails this lint rather than drifting.
//
// Run: `pnpm run lint:test-collection`. It invokes the runner four times serially (roughly 70 seconds);
// it deliberately does not go through the `pnpm test` single-flight lock, because it never executes a
// test — `list` only resolves configs and globs files.

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// The collection floor: the minimum number of test files the unfiltered whole-suite invocation must
// collect. It is a GENEROUS MINIMUM, not an exact count — the point is to catch a collapse (a project
// that stopped resolving, a filter that started matching nothing), not to churn on every added test.
//
// UPDATE PROCEDURE. Raise it only when the honest count has grown well past it, and never lower it
// without naming the suites that were deliberately removed. To recompute: run
// `pnpm run lint:test-collection`, take the "whole suite" count it prints, multiply by 0.9, round down,
// and put that here together with the count and the date it came from.
const COLLECTION_FLOOR = 647; // 90% of 719 files, measured 2026-08-05.

// Every test invocation in .github/workflows/gate.yml that collects a SHARE of the suite, verbatim.
// The `governance` job's single-file migration-integrity run is deliberately absent: it re-runs one file
// that test-node already covers, as a fail-fast, so it is not part of the partition.
const GATE_INVOCATIONS = [
  {
    job: "test-node",
    command:
      "pnpm exec vp test run --project='!storybook' --shard=${{ matrix.shard }}/${{ env.SHARD_TOTAL }} " +
      '"$PWD/packages" "$PWD/tooling" "$PWD/apps/web" "$PWD/apps/bundle-worker" ' +
      '"$PWD/apps/convert-worker" "$PWD/apps/discovery-worker" "$PWD/apps/email-worker" ' +
      '"$PWD/apps/file-repair-worker" "$PWD/apps/magna-carta-edit" "$PWD/apps/ocr-worker" ' +
      '"$PWD/apps/recovery-worker" "$PWD/apps/scan-worker" "$PWD/apps/search-worker" ' +
      '"$PWD/apps/sign-worker"',
  },
  {
    job: "test-worker",
    command:
      "pnpm exec vp test run --project='!storybook' --shard=${{ matrix.shard }}/${{ env.SHARD_TOTAL }} " +
      '"$PWD/apps/worker" "$PWD/apps/status-worker"',
  },
  {
    job: "test-stories",
    command: "pnpm exec vp test run --project=storybook",
  },
];

const WORKFLOW_PATH = join(ROOT, ".github", "workflows", "gate.yml");
const OUTPUT_DIRECTORY = join(ROOT, "node_modules", ".cache", "magna-carta", "test-collection");

function fail(messages) {
  console.error("\nlint-test-collection: the gate's test jobs do not cover the suite:\n");
  for (const message of messages) console.error(message);
  console.error("");
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------------
// 1. Every invocation above must appear verbatim in the workflow.
// ---------------------------------------------------------------------------------------------------

// Whitespace-insensitive so a YAML folded block (`run: >-`) that wraps one command across several
// indented lines still matches the single-line form written above.
const collapse = (text) => text.replaceAll(/\s+/g, " ").trim();

const workflow = collapse(readFileSync(WORKFLOW_PATH, "utf8"));
const drifted = GATE_INVOCATIONS.filter(
  (invocation) => !workflow.includes(collapse(invocation.command)),
).map(
  (invocation) =>
    `  ${invocation.job}: this lint's copy of the invocation is not present in ` +
    `.github/workflows/gate.yml. The two must agree — update whichever is wrong.\n` +
    `    expected: ${collapse(invocation.command)}`,
);
if (drifted.length > 0) fail(drifted);

// ---------------------------------------------------------------------------------------------------
// 2. Collect what each invocation, and the unfiltered whole suite, actually resolve to.
// ---------------------------------------------------------------------------------------------------

// Turn a workflow command into the argument list for a list-only run of the same selection: drop the
// `pnpm exec vp test run` prefix, drop the shard split (`--shard=i/N` partitions whatever the rest of
// the arguments collected, so it never changes WHICH files are in the set), unquote, and resolve `$PWD`
// to this checkout the way the workflow's shell resolves it to the runner's.
function listArgumentsFor(command) {
  return (
    command
      // Collapse the workflow expressions first, so the shard argument stays a single whitespace-free
      // token and cannot leave `matrix.shard` behind as a stray positional filter.
      .replaceAll(/\$\{\{[^}]*\}\}/g, "0")
      .split(/\s+/)
      .slice(5)
      .filter((token) => !token.startsWith("--shard="))
      // Dequote the way the workflow's shell does. Quotes appear both around a whole token
      // ("$PWD/packages") and inside one (--project='!storybook'), and no argument here legitimately
      // contains a quote character, so stripping them all is the faithful reading.
      .map((token) => token.replaceAll(/["']/g, ""))
      .map((token) => token.replaceAll("$PWD", ROOT.replace(/[/\\]$/, "")))
  );
}

const normalizedRoot = ROOT.replaceAll("\\", "/");

function collect(label, listArguments) {
  const outputPath = join(OUTPUT_DIRECTORY, `${label}.json`);
  const result = spawnSync(
    "pnpm",
    ["exec", "vp", "test", "list", "--filesOnly", `--json=${outputPath}`, ...listArguments],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" },
  );
  if (result.status !== 0 || !existsSync(outputPath)) {
    console.error(
      `lint-test-collection: the runner failed to list "${label}" (exit ${result.status}). ` +
        `A collection that cannot be taken is a failure, never an empty set.`,
    );
    process.exit(1);
  }
  // Every path is absolute under this checkout; key on the repo-relative path plus the project that
  // claimed it, so the same file registered by two projects counts as two entries and the diagnostics
  // below name something a reader can act on.
  const entries = JSON.parse(readFileSync(outputPath, "utf8"));
  return new Set(
    entries.map(
      (entry) =>
        `${entry.file.replaceAll("\\", "/").replace(normalizedRoot, "")} [${entry.projectName}]`,
    ),
  );
}

rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true });
mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

console.log("lint-test-collection: collecting the whole suite (unfiltered)...");
const wholeSuite = collect("whole-suite", []);

const collected = new Map();
for (const invocation of GATE_INVOCATIONS) {
  console.log(`lint-test-collection: collecting ${invocation.job}...`);
  collected.set(invocation.job, collect(invocation.job, listArgumentsFor(invocation.command)));
}

// ---------------------------------------------------------------------------------------------------
// 3. Assert the floor, the union, and disjointness.
// ---------------------------------------------------------------------------------------------------

console.log("");
console.log(`  whole suite (unfiltered)      ${String(wholeSuite.size).padStart(5)} files`);
for (const [job, files] of collected) {
  console.log(`  ${job.padEnd(30)}${String(files.size).padStart(5)} files`);
}
console.log("");

const failures = [];

if (wholeSuite.size < COLLECTION_FLOOR) {
  failures.push(
    `  the whole-suite invocation collected ${wholeSuite.size} test files, below the committed floor ` +
      `of ${COLLECTION_FLOOR}. Either whole suites stopped resolving (find out which — that is the ` +
      `failure this floor exists for), or suites were deliberately removed and the floor in ` +
      `tooling/lint-test-collection.mjs needs lowering, with a reason.`,
  );
}

const union = new Set();
const duplicates = [];
for (const [job, files] of collected) {
  for (const file of files) {
    if (union.has(file)) duplicates.push(`${file} — also collected by ${job}`);
    union.add(file);
  }
}

const uncovered = [...wholeSuite]
  .filter((file) => !union.has(file))
  .sort((left, right) => left.localeCompare(right));
if (uncovered.length > 0) {
  failures.push(
    `  ${uncovered.length} registered test file(s) are collected by NO gate job — they run nowhere, and ` +
      `nothing else fails on their absence. Add their path to a job in .github/workflows/gate.yml ` +
      `(and to the matching invocation in this file):\n` +
      uncovered.map((file) => `      ${file}`).join("\n"),
  );
}

const strays = [...union]
  .filter((file) => !wholeSuite.has(file))
  .sort((left, right) => left.localeCompare(right));
if (strays.length > 0) {
  failures.push(
    `  ${strays.length} file(s) are collected by a gate job but not by the unfiltered whole-suite run. ` +
      `That should be impossible — a filter can only narrow. Investigate before changing anything:\n` +
      strays.map((file) => `      ${file}`).join("\n"),
  );
}

if (duplicates.length > 0) {
  failures.push(
    `  ${duplicates.length} file(s) are collected by more than one gate job — the split is meant to be a ` +
      `partition, so this is runtime paid for twice:\n` +
      duplicates.map((file) => `      ${file}`).join("\n"),
  );
}

if (failures.length > 0) fail(failures);

console.log(
  `The gate's ${GATE_INVOCATIONS.length} test jobs partition all ${wholeSuite.size} registered test ` +
    `files exactly once (floor ${COLLECTION_FLOOR}).`,
);
