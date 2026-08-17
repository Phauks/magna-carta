// `pnpm test` — the guarded entry point to the test runner.
//
// This is `vp test` with two things added:
//
//   - a per-worktree single-flight lock, so a second run started while one is in flight fails in
//     milliseconds with a readable message instead of wedging both at 0% CPU (lock.mjs explains the
//     contention);
//   - path-filter resolution, so `pnpm test tooling` selects the tests under `tooling/` instead of
//     reporting that it found none (path-filters.mjs explains why the short spelling misses).
//
// Options are passed through untouched, and so is any filter that is not a directory in this
// repository, so `pnpm test run packages/ledger` and `pnpm test --watch` behave exactly as the runner
// does.
//
// Prefer `pnpm test` over a bare `vp test`: the bare command is unguarded and is what produces the
// wedge. See docs/conventions/build-performance.md.
//
// MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1 skips the lock entirely — for the deliberate case (two disjoint
// project filters you have reason to believe will not collide), and as the escape hatch if the guard
// itself is ever the thing in the way.

import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireSingleFlightLock, blockedMessage } from "./lock.mjs";
import { planPathFilters } from "./path-filters.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// A vitest project is a directory holding one of these. The root `vite.config.ts` is deliberately not
// one: it REGISTERS the projects (its `test.projects` list) without being one, so counting it would
// make every directory in the repo look reachable.
const PROJECT_CONFIG_PATTERN = /^vitest.*\.config\.ts$/;

const isDirectory = (candidate) => {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

const holdsConfig = (directory) => {
  try {
    return readdirSync(directory).some((entry) => PROJECT_CONFIG_PATTERN.test(entry));
  } catch {
    return false;
  }
};

/** A project config at `directory` or anywhere beneath it. Stops at the first hit. */
function configAtOrBelow(directory) {
  if (holdsConfig(directory)) return true;
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (configAtOrBelow(path.join(directory, entry.name))) return true;
  }
  return false;
}

/** A project config in any ancestor of `directory`, up to and including the repository root. */
function configAbove(directory) {
  let current = path.dirname(directory);
  while (current.startsWith(ROOT) && current !== path.dirname(current)) {
    if (holdsConfig(current)) return true;
    if (current === ROOT) break;
    current = path.dirname(current);
  }
  return false;
}

// The filesystem view path-filters.mjs plans against. Filters are resolved against ROOT because that
// is the directory the runner is spawned in below — the two must agree, or a filter would be judged
// against one tree and applied to another.
function inspectFilter(token) {
  const absolutePath = path.resolve(ROOT, token);
  if (!absolutePath.startsWith(ROOT) || !isDirectory(absolutePath)) return undefined;
  return {
    absolutePath,
    holdsProject: configAtOrBelow(absolutePath) || configAbove(absolutePath),
  };
}

// Under node_modules because it is already git-ignored and already per-worktree — which is exactly the
// scope of the contention. A lock shared across worktrees would block runs that never touch each other.
const LOCK_PATH = path.join(
  ROOT,
  "node_modules",
  ".cache",
  "magna-carta",
  "test-single-flight.lock",
);

const requestedArguments = process.argv.slice(2);
const plan = planPathFilters(requestedArguments, inspectFilter);

// Refuse a provably empty selection BEFORE taking the lock — a run that cannot collect a file should
// not hold the lock a real run is waiting for, and it should not exit 0 either. The runner's own exit
// code for an empty selection is already 1; making the refusal explicit here means that stays true
// however the runner's defaults move.
if (plan.refusals.length > 0) {
  for (const refusal of plan.refusals) console.error(`test: ${refusal}`);
  process.exit(1);
}
if (plan.resolved.length > 0) {
  console.log(
    `test: resolved ${plan.resolved.length} directory filter(s) to absolute paths — ` +
      `${plan.resolved.join(", ")} (see tooling/test-single-flight/path-filters.mjs)`,
  );
}

const passthroughArguments = plan.arguments;
const skipLock = process.env.MAGNA_CARTA_ALLOW_CONCURRENT_TESTS === "1";

let release = () => {};
if (skipLock) {
  console.log("test: MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1 — single-flight lock skipped");
} else {
  const claim = acquireSingleFlightLock({
    lockPath: LOCK_PATH,
    identity: {
      processIdentifier: process.pid,
      host: hostname(),
      command: ["vp", "test", ...passthroughArguments].join(" "),
    },
  });
  if (!claim.acquired) {
    console.error("test: " + blockedMessage(claim.holder, LOCK_PATH));
    process.exit(1);
  }
  if (claim.reclaimedFrom !== undefined) {
    console.log(`test: reclaimed an abandoned lock (${claim.reason})`);
  }
  release = claim.release;
}

const child = spawn("vp", ["test", ...passthroughArguments], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32",
});

// The lock must not outlive this process by any exit path — a normal finish, a runner crash, or the
// Ctrl-C that ends a watch run. A lock left behind by a clean exit is the fastest way to make the guard
// look like the bug it exists to prevent.
let finished = false;
const finish = (code) => {
  if (finished) return;
  finished = true;
  release();
  process.exit(code);
};

child.on("exit", (code, signal) => finish(signal ? 1 : (code ?? 1)));
child.on("error", (error) => {
  console.error("test: could not start the test runner —", error.message);
  finish(1);
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal);
    // Let the child's own exit handler do the release; this is the backstop if it never reports.
    setTimeout(() => finish(1), 5000).unref();
  });
}
process.on("exit", () => release());
