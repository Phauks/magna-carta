import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { reconcile, specificationKey } from "./collection.mjs";

// Fitness function for what the test suite actually COLLECTS (mirrors lint-test-registration.mjs,
// which guards the layer above: that every vitest config on disk is registered as a project at all).
//
// This one guards the layer below it. `test.projects` in the root vite.config.ts is a closed list, and
// a registered project whose config stops resolving — or whose include glob starts matching nothing —
// does not fail the run: the suite gets smaller, faster and greener, and nothing else notices. That
// is not hypothetical. When the suite was split across hosted runners, ten of one job's fourteen
// path filters were lost in a copy and the job reported a confident green over 649 files against the
// true 656, twice running, with nothing in the output distinguishing the two. The gate now runs the
// suite whole (`pnpm gate`, one `pnpm test` under the single-flight lock), so the partition arithmetic
// that once lived here is gone; what stays is the part that catches a collapse.
//
// What this asserts, by running the unfiltered whole-suite collection in list-only mode: it meets a
// committed floor (below), so a config change that silently drops whole swathes of the suite fails
// loudly instead of speeding the run up.
//
// WHAT THIS DOES NOT PROVE. `list` resolves configs and globs files; it never executes anything. The
// step from "collected" to "executed" is the runner's own, and it holds — measured directly. Two
// things to know before re-measuring, both of which manufacture a phantom gap: `--shard=i/N` is
// applied inside the pool, after the point `list` stops, so a sharded collection cannot be listed; and
// a run's file count is the number in PARENTHESES, not the `passed` tally before it — a collected file
// that produces no result is inside the total and in neither state count.
// docs/conventions/build-performance.md has both traps written out with the measurements behind them.
//
// Run: `pnpm run lint:test-collection`. One list-only run of the runner (tens of seconds); it
// deliberately does not go through the `pnpm test` single-flight lock, because it never executes a
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
const COLLECTION_FLOOR = 1215; // 90% of 1351 files, measured 2026-09-16.

const OUTPUT_DIRECTORY = join(ROOT, "node_modules", ".cache", "magna-carta", "test-collection");

function fail(messages) {
  console.error("\nlint-test-collection: the suite does not collect what it should:\n");
  for (const message of messages) console.error(message);
  console.error("");
  process.exit(1);
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
  const entries = JSON.parse(readFileSync(outputPath, "utf8"));
  return new Set(entries.map((entry) => specificationKey(entry, normalizedRoot)));
}

rmSync(OUTPUT_DIRECTORY, { recursive: true, force: true });
mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

console.log("lint-test-collection: collecting the whole suite (unfiltered)...");
const wholeSuite = collect("whole-suite", []);

console.log("");
console.log(`  whole suite (unfiltered)      ${String(wholeSuite.size).padStart(5)} files`);
console.log("");

const failures = reconcile({ wholeSuite, floor: COLLECTION_FLOOR });
if (failures.length > 0) fail(failures);

console.log(
  `The suite collects ${wholeSuite.size} registered test files (floor ${COLLECTION_FLOOR}).`,
);
