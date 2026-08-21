import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  driftedInvocations,
  listArgumentsFor,
  reconcile,
  runnableCommand,
  specificationKey,
  unregisteredInvocations,
} from "./collection.mjs";

// Fitness function for what the gate's test jobs actually COLLECT (mirrors lint-test-registration.mjs,
// which guards the layer above: that every vitest config on disk is registered as a project at all).
//
// This one guards the layer below it. The gate splits the suite across three jobs whose union is
// supposed to be every registered test file exactly once. Nothing in the runner enforces that — and the
// gap is SILENT NARROWING, not an empty filter sailing through. A filter set matching nothing does fail:
// the runner prints "No test files found, exiting with code 1" and exits 1, measured on this version
// across `run`, `--shard=i/N` and `--project`. What escapes is a filter set that still matches SOME
// files. Each gate job passes a dozen-odd paths, so one wrong or dropped entry leaves the others
// collecting and the job exits 0 over a fraction of the suite. That is not hypothetical: a filter of
// `packages` (a directory that is the PARENT of many project roots) contributed zero files of its own,
// and because it travelled alongside paths that did resolve, the job reported success on what was left.
//
// The mechanism, and why the gate passes ABSOLUTE paths: the runner matches a positional path filter
// per project, against the candidate file's path relative to THAT PROJECT'S OWN root — not against the
// repository-relative path. A relative filter naming an ancestor of a project root therefore reduces to
// `..` under that project and matches none of its files. An absolute filter takes a different branch
// entirely (a prefix test against the file's absolute path) and narrows exactly as a reader expects.
// Full explanation, and the guidance for filtering a run by hand: docs/conventions/build-performance.md.
//
// What this asserts, by re-running each of the gate's own invocations in list-only mode:
//   1. every invocation below still appears verbatim in the workflow, and the workflow holds no test
//      invocation this file does not know about — the list is closed in both directions;
//   2. the unfiltered whole-suite collection meets a committed floor (below), so a config change that
//      silently drops whole swathes of the suite fails loudly instead of speeding CI up;
//   3. the union of the gate's three test jobs equals that whole-suite collection — no file runs
//      nowhere;
//   4. the three jobs are pairwise disjoint — no file is paid for twice.
//
// The set arithmetic behind 2-4 lives in collection.mjs and is driven from constructed inputs by
// collection.test.mjs, so each assertion is shown to bite rather than merely to exist.
//
// WHAT THIS DOES NOT PROVE. `list` resolves configs and globs files; it never executes anything. The
// step from "collected" to "executed" is the runner's own, and it holds — measured directly at 949
// registered files: test-node collected 656 and ran `Test Files 656 passed (656)` unsharded, 328 + 328
// across the two shards with no overlap and nothing dropped; test-worker collected 238 and ran
// `238 passed (238)`. Two things to know before re-measuring, both of which manufacture a phantom gap.
// `--shard=i/N` is applied inside the pool, after the point `list` stops, so a sharded collection
// cannot be listed and one shard's count is not the job's. And a run's file count is the number in
// PARENTHESES, not the `passed` tally before it: a collected file that produces no result is inside
// the total and in neither state count. docs/conventions/build-performance.md has both traps written
// out with the measurements behind them.
//
// Run: `pnpm run lint:test-collection`. It invokes the runner four times serially (roughly 70 seconds);
// it deliberately does not go through the `pnpm test` single-flight lock, because it never executes a
// test — `list` only resolves configs and globs files.

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// The collection floor: the minimum number of test files the unfiltered whole-suite invocation must
// collect. It is a GENEROUS MINIMUM, not an exact count — the point is to catch a collapse (a project
// that stopped resolving, a filter that started matching nothing), not to churn on every added test.
//
// UPDATE PROCEDURE. Raise it only when the honest count has grown well past it, and never lower it
// without naming the suites that were deliberately removed. To recompute: run
// `pnpm run lint:test-collection`, take the "whole suite" count it prints, multiply by 0.9, round down,
// and put that here together with the count and the date it came from.
const COLLECTION_FLOOR = 854; // 90% of 949 files, measured 2026-08-17.

// Every test invocation in .github/workflows/gate.yml that collects a SHARE of the suite, verbatim.
// The `governance` job's migration-integrity step is deliberately absent, and no longer even a runner
// invocation: it is a plain node script (tooling/migration-integrity) run as a fail-fast, whose Vitest
// twin test-node already collects. It takes no share of the partition.
const GATE_INVOCATIONS = [
  {
    job: "test-node",
    command:
      "pnpm exec vp test run --project='!storybook' --shard=${{ matrix.shard }}/${{ env.SHARD_TOTAL }} " +
      '"$PWD/packages" "$PWD/tooling" "$PWD/apps/web-worker" "$PWD/apps/bundle-worker" ' +
      '"$PWD/apps/convert-worker" "$PWD/apps/discovery-worker" "$PWD/apps/email-worker" ' +
      '"$PWD/apps/file-repair-worker" "$PWD/apps/edit-worker" "$PWD/apps/ocr-worker" ' +
      '"$PWD/apps/recovery-worker" "$PWD/apps/scan-worker" "$PWD/apps/search-worker" ' +
      '"$PWD/apps/sign-worker"',
  },
  {
    job: "test-worker",
    command:
      "pnpm exec vp test run --project='!storybook' --shard=${{ matrix.shard }}/${{ env.SHARD_TOTAL }} " +
      '"$PWD/apps/api-worker" "$PWD/apps/status-worker"',
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
// 1. The invocation list is closed in both directions.
// ---------------------------------------------------------------------------------------------------

const workflowText = readFileSync(WORKFLOW_PATH, "utf8");

// `--print-invocations` emits each job's command, resolved and on one line, and stops. Reproducing a
// count by hand means reproducing the gate's argument list exactly, and test-node's is fourteen
// positional paths wrapped over five YAML lines — the one that gets copied short. A short list runs a
// subset and reports green, so the mistake looks like a finding rather than a typo.
if (process.argv.includes("--print-invocations")) {
  for (const invocation of GATE_INVOCATIONS) {
    console.log(`# ${invocation.job}`);
    console.log(`${runnableCommand(invocation.command, ROOT)}\n`);
  }
  process.exit(0);
}

const registration = [
  ...driftedInvocations(workflowText, GATE_INVOCATIONS),
  ...unregisteredInvocations(workflowText, GATE_INVOCATIONS),
];
if (registration.length > 0) fail(registration);

// ---------------------------------------------------------------------------------------------------
// 2. Collect what each invocation, and the unfiltered whole suite, actually resolve to.
// ---------------------------------------------------------------------------------------------------

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
  const entries = JSON.parse(readFileSync(outputPath, "utf8"));
  return new Set(entries.map((entry) => specificationKey(entry, normalizedRoot)));
}

rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true });
mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

console.log("lint-test-collection: collecting the whole suite (unfiltered)...");
const wholeSuite = collect("whole-suite", []);

const collected = new Map();
for (const invocation of GATE_INVOCATIONS) {
  console.log(`lint-test-collection: collecting ${invocation.job}...`);
  collected.set(
    invocation.job,
    collect(invocation.job, listArgumentsFor(invocation.command, ROOT)),
  );
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

const failures = reconcile({ wholeSuite, collected, floor: COLLECTION_FLOOR });
if (failures.length > 0) fail(failures);

console.log(
  `The gate's ${GATE_INVOCATIONS.length} test jobs partition all ${wholeSuite.size} registered test ` +
    `files exactly once (floor ${COLLECTION_FLOOR}).`,
);
